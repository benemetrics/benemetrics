// Threshold metrics are computed from the metric samples in ClickHouse —
// sentinel counts and measurement quantiles; issue-driven metrics stay on
// the Postgres control plane. A rule breaches when the metric crosses its
// threshold. Breaching rules dispatch a uniform notification to their
// channels (or every effective channel when none are selected), record
// an incident and respect the cooldown between notifications.

import { alertRuleDAO } from "db/dao/alert-rules";
import { alertIncidentDAO } from "db/dao/alert-incidents";
import { appDAO } from "db/dao/project";
import { issueDAO } from "db/dao/issues";
import { countMetricSamples, metricSampleQuantile } from "../metrics-store";
import { trackIssuesForEvent, type TrackedIssue } from "../issues/tracking";
import { resolveEffectiveAlertConfig } from "./resolver";
import { toIncident } from "./serialize";
import {
  buildAlertNotification,
  buildIssueAlertNotification,
  deliverAlertToChannels,
} from "./notifiers";
import type { AlertIncident, AlertMetric } from "../protocol/alerting";

const DEFAULT_MEASUREMENT = "duration";

// The metric value of one threshold rule over its window. Counts come
// from the sentinel samples (one row per event/error/fatal event, see
// backend/metrics/samples.ts), latency from the quantile over the rule's
// measurement samples; new issues are counted in Postgres (`issues`). A
// ClickHouse failure rejects — the work queue logs it and the tick is
// skipped, so a CH outage pauses alerting instead of firing on zeros.
async function computeRuleValue(
  appId: string,
  metric: AlertMetric,
  windowSeconds: number,
  measurement: string | null,
): Promise<number> {
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();

  switch (metric) {
    case "event_count":
    case "error_count":
    case "fatal_count":
      return countMetricSamples(appId, metric, since);
    case "new_issue_count":
      return issueDAO.countNewSince(appId, since);
    case "latency_p95":
    case "latency_p99":
      return metricSampleQuantile(
        appId,
        measurement ?? DEFAULT_MEASUREMENT,
        metric === "latency_p95" ? 95 : 99,
        since,
      );
    default:
      return 0;
  }
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
    const value = await computeRuleValue(
      appId,
      metric,
      windowSeconds,
      rule.measurement,
    );
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
