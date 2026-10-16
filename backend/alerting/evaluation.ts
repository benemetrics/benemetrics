// Metrics are computed from stored_events of one app; a rule
// breaches when the metric crosses its threshold. Breaching
// rules dispatch a uniform notification to their channels
// (or every effective channel when none are selected), record
// an incident and respect the cooldown between notifications.

import { storedEventDAO } from "db/dao/stored-event";
import { alertRuleDAO } from "db/dao/alert-rules";
import { alertIncidentDAO } from "db/dao/alert-incidents";
import { appDAO } from "db/dao/project";
import { issueFingerprint } from "../events/utils";
import { trackIssuesForEvent, type TrackedIssue } from "../issues/tracking";
import { resolveEffectiveAlertConfig } from "./resolver";
import { toIncident } from "./serialize";
import {
  buildAlertNotification,
  buildIssueAlertNotification,
  deliverAlertToChannels,
} from "./notifiers";
import type { AlertIncident, AlertMetric } from "../protocol/alerting";
import type { StoredEvent } from "db/schema/stored-event";

const DEFAULT_MEASUREMENT = "duration";

interface ParsedAppEvent {
  receivedAt: string;
  // Event-type payloads (level/issue metrics).
  eventPayloads: Array<Record<string, unknown>>;
  // All item payloads (latency metrics read transaction measurements).
  allPayloads: Array<Record<string, unknown>>;
}

function parseAppEvents(events: StoredEvent[]): ParsedAppEvent[] {
  return events.map((event) => {
    const parsed: ParsedAppEvent = {
      receivedAt: event.receivedAt,
      eventPayloads: [],
      allPayloads: [],
    };
    try {
      const items = JSON.parse(event.envelopeItems);
      if (Array.isArray(items)) {
        for (const item of items) {
          if (!item?.payload || typeof item.payload !== "object") continue;
          const payload = item.payload as Record<string, unknown>;
          parsed.allPayloads.push(payload);
          if (item?.header?.type === "event") parsed.eventPayloads.push(payload);
        }
      }
    } catch {
      // Malformed rows contribute nothing to metrics.
    }
    return parsed;
  });
}

export function computeMetric(
  events: ParsedAppEvent[],
  metric: AlertMetric,
  windowSeconds: number,
  measurement: string | null,
): number {
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();

  switch (metric) {
    case "event_count":
      return events.filter((event) => event.receivedAt >= since).length;
    case "error_count":
      return countByLevel(events, since, ["error", "fatal"]);
    case "fatal_count":
      return countByLevel(events, since, ["fatal"]);
    case "new_issue_count":
      return countNewIssues(events, since);
    case "latency_p95":
      return percentile(collectDurations(events, since, measurement), 95);
    case "latency_p99":
      return percentile(collectDurations(events, since, measurement), 99);
    default:
      return 0;
  }
}

function countByLevel(
  events: ParsedAppEvent[],
  since: string,
  levels: string[],
): number {
  let count = 0;
  for (const event of events) {
    if (event.receivedAt < since) continue;
    for (const payload of event.eventPayloads) {
      if (typeof payload.level === "string" && levels.includes(payload.level)) {
        count += 1;
        break;
      }
    }
  }
  return count;
}

// An issue is "new" when its first-ever appearance falls inside
// the window.
function countNewIssues(
  events: ParsedAppEvent[],
  since: string,
): number {
  const firstSeen = new Map<string, string>();
  for (const event of events) {
    for (const payload of event.eventPayloads) {
      const fingerprint = issueFingerprint(payload);
      if (!firstSeen.has(fingerprint)) {
        firstSeen.set(fingerprint, event.receivedAt);
      }
    }
  }
  let count = 0;
  for (const seen of firstSeen.values()) {
    if (seen >= since) count += 1;
  }
  return count;
}

// Durations come from the `measurements` map of transaction
// payloads (Sentry: sentry.measurement.* attributes).
function collectDurations(
  events: ParsedAppEvent[],
  since: string,
  measurement: string | null,
): number[] {
  const name = measurement ?? DEFAULT_MEASUREMENT;
  const values: number[] = [];
  for (const event of events) {
    if (event.receivedAt < since) continue;
    for (const payload of event.allPayloads) {
      const measurements = payload.measurements;
      if (!measurements || typeof measurements !== "object") continue;
      const entry = (measurements as Record<string, unknown>)[name];
      const value =
        typeof entry === "object" && entry !== null
          ? (entry as { value?: unknown }).value
          : entry;
      if (typeof value === "number") values.push(value);
    }
  }
  return values;
}

// Nearest-rank percentile: p95 of [100, 200, 300, 400, 500] is 500.
function percentile(values: number[], percent: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil((percent / 100) * sorted.length) - 1);
  return sorted[index] ?? 0;
}

async function evaluateRules(appId: string): Promise<AlertIncident[]> {
  const { rules, channels } = await resolveEffectiveAlertConfig(appId);
  // Only windowed threshold rules are swept; issue triggers fire exactly
  // once from the ingestion path (see processIngestedEvent).
  const enabled = rules.filter(
    (rule) => rule.isEnabled && rule.trigger === "threshold",
  );
  if (enabled.length === 0) return [];

  const incidents: AlertIncident[] = [];
  const events = parseAppEvents(await storedEventDAO.listByApp(appId));
  for (const rule of enabled) {
    const { metric, operator, threshold, windowSeconds } = rule;
    if (
      metric === null ||
      operator === null ||
      threshold === null ||
      windowSeconds === null
    ) {
      continue;
    }
    const value = computeMetric(events, metric, windowSeconds, rule.measurement);
    const breached = operator === "gt" ? value > threshold : value < threshold;

    if (!breached) {
      // Metric recovered: close any open incident for the rule.
      await alertIncidentDAO.resolveOpen(rule.id);
      continue;
    }

    const now = new Date().toISOString();
    if (rule.lastTriggeredAt !== null) {
      const elapsed = Date.now() - new Date(rule.lastTriggeredAt).getTime();
      if (elapsed < rule.cooldownSeconds * 1000) continue;
    }

    const targets =
      rule.channelIds.length > 0
        ? rule.channelIds
        : channels.map((channel) => channel.id);
    const selected = channels.filter((channel) =>
      targets.includes(channel.id),
    );
    const notification = buildAlertNotification(
      { name: rule.name, metric, operator, threshold, windowSeconds },
      value,
      appId,
      now,
    );
    await deliverAlertToChannels(selected, notification);

    const incident = await alertIncidentDAO.create({
      ruleId: rule.id,
      appId,
      trigger: "threshold",
      metric,
      value,
      threshold,
      triggeredAt: now,
    });
    await alertRuleDAO.touchTriggered(rule.id, now);
    incidents.push(toIncident(incident));
  }
  return incidents;
}

// Issue triggers fire once per state transition, detected at ingestion:
// "new_issue" for the first-ever occurrence of a fingerprint,
// "regression" when a resolved issue is reopened. The cooldown applies
// per issue (fingerprint), so separate issues are never batched into a
// single notification.
async function fireIssueTriggerRules(
  appId: string,
  trigger: "new_issue" | "regression",
  issues: TrackedIssue[],
): Promise<void> {
  const { rules, channels } = await resolveEffectiveAlertConfig(appId);
  const matching = rules.filter(
    (rule) => rule.isEnabled && rule.trigger === trigger,
  );
  if (matching.length === 0) return;

  for (const rule of matching) {
    const targets =
      rule.channelIds.length > 0
        ? rule.channelIds
        : channels.map((channel) => channel.id);
    const selected = channels.filter((channel) =>
      targets.includes(channel.id),
    );

    let fired = false;
    for (const issue of issues) {
      const last = await alertIncidentDAO.findLastForIssue(
        rule.id,
        issue.fingerprint,
      );
      if (last !== undefined) {
        const elapsed = Date.now() - new Date(last.triggeredAt).getTime();
        if (elapsed < rule.cooldownSeconds * 1000) continue;
      }

      const now = new Date().toISOString();
      const notification = buildIssueAlertNotification(
        rule,
        trigger,
        { fingerprint: issue.fingerprint, title: issue.title },
        appId,
        now,
      );
      await deliverAlertToChannels(selected, notification);
      // One-shot: the transition already happened, so the incident is
      // recorded already resolved — there is nothing to recover.
      await alertIncidentDAO.create({
        ruleId: rule.id,
        appId,
        trigger,
        issueFingerprint: issue.fingerprint,
        status: "resolved",
        triggeredAt: now,
        resolvedAt: now,
      });
      fired = true;
    }

    if (fired) await alertRuleDAO.touchTriggered(rule.id, new Date().toISOString());
  }
}

const evaluationChains = new Map<string, Promise<unknown>>();

// Serializes per-app work: ingestion-triggered processing and sweeper
// runs never interleave for the same app.
function enqueueAppWork(
  appId: string,
  label: string,
  run: () => Promise<unknown>,
): void {
  const guarded = () =>
    run().catch((error: unknown) => {
      console.error(
        `[alerting] ${label} for app ${appId}:`,
        error instanceof Error ? error.message : error,
      );
    });
  const next = (evaluationChains.get(appId) ?? Promise.resolve()).then(
    guarded,
    guarded,
  );
  evaluationChains.set(appId, next);
}

export function evaluateRulesForApp(appId: string): void {
  enqueueAppWork(appId, "rule evaluation failed", () => evaluateRules(appId));
}

// Ingestion path: refresh the app's issue state (new issue / regression)
// and fire the matching issue triggers before the threshold rules are
// evaluated.
export function processIngestedEvent(
  appId: string,
  envelopeItems: string,
  receivedAt: string,
  eventId: string,
): void {
  enqueueAppWork(appId, "ingested event processing failed", async () => {
    const { newIssues, regressions } = await trackIssuesForEvent(
      appId,
      envelopeItems,
      receivedAt,
      eventId,
    );
    if (newIssues.length > 0) {
      await fireIssueTriggerRules(appId, "new_issue", newIssues);
    }
    if (regressions.length > 0) {
      await fireIssueTriggerRules(appId, "regression", regressions);
    }
    await evaluateRules(appId);
  });
}

let sweeperTimer: ReturnType<typeof setInterval> | null = null;

export function startAlertSweeper(): void {
  if (sweeperTimer !== null) return;
  const intervalMs = Number(process.env.ALERT_EVALUATION_INTERVAL_MS) || 60_000;
  sweeperTimer = setInterval(() => {
    void appDAO
      .listAll()
      .then((apps) => {
        for (const app of apps) evaluateRulesForApp(app.id);
      })
      .catch((error: unknown) => {
        console.error(
          "[alerting] sweeper failed to list apps:",
          error instanceof Error ? error.message : error,
        );
      });
  }, intervalMs);
  sweeperTimer.unref();
}
