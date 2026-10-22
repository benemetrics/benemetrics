
import { alertRuleDAO } from "db/dao/alert-rules";
import { alertIncidentDAO } from "db/dao/alert-incidents";
import { alertDeadLetterDAO } from "db/dao/alert-dead-letters";
import { alertSilenceDAO } from "db/dao/alert-silences";
import { appDAO } from "db/dao/project";
import { db } from "db";
import { issueDAO } from "db/dao/issues";
import {
  countMetricSamples,
  countProjectMetricSamples,
  metricSampleQuantile,
  projectMetricSampleQuantile,
} from "../metrics-store";
import { trackIssuesForEvent, type TrackedIssue } from "../issues/tracking";
import type { IssueDigest } from "../issues/grouping";
import { resolveEffectiveAlertConfig, resolveScopedRules } from "./resolver";
import { isClickHouseCircuitOpen } from "../clickhouse";
import { mapWithConcurrency } from "./concurrency";
import {
  countCooldownSkipped,
  countIncidentFired,
  countIncidentResolved,
  countRuleEvaluated,
} from "./stats";
import {
  buildAlertNotification,
  buildIssueAlertNotification,
  deliverAlertToChannels,
} from "./notifiers";
import type {
  AlertIncident,
  AlertMetric,
  AlertNotification,
  AlertRuleFilters,
  DeliveryResult,
} from "../protocol/alerting";

const DEFAULT_MEASUREMENT = "duration";

// The silence that covers the scope right now, if any.
async function activeSilence(scope: {
  appId?: string | null;
  projectId?: string | null;
}): Promise<{ id: string; name: string } | null> {
  const silences = await alertSilenceDAO.findActiveForScope(
    scope,
    new Date().toISOString(),
  );
  const silence = silences[0];
  return silence ? { id: silence.id, name: silence.name } : null;
}

// A failed delivery goes to the dead letter queue: the queue retries it
// with a backoff.
async function recordFailedDeliveries(
  results: DeliveryResult[],
  notification: AlertNotification,
  ruleId: string,
  appId: string | null,
): Promise<void> {
  for (const result of results) {
    if (result.ok) continue;
    try {
      await alertDeadLetterDAO.create({
        channelId: result.channelId,
        channelName: result.channelName,
        channelType: result.type,
        ruleId,
        appId,
        notification: JSON.stringify(notification),
        error: result.error ?? "the delivery failed",
        attempts: 1,
        nextAttemptAt: new Date(Date.now() + 60_000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error(
        "[alerting] the failed delivery could not be recorded:",
        error instanceof Error ? error.message : error,
      );
    }
  }
}

// The evaluation decisions are logged as one JSON line each — the rule,
// the scope, the value and the outcome.
function logDecision(decision: Record<string, unknown>): void {
  console.log(JSON.stringify({ component: "alerting", ...decision }));
}

async function computeRuleValue(
  scope: { appId?: string; projectId?: string },
  metric: AlertMetric,
  windowSeconds: number,
  measurement: string | null,
  filters?: AlertRuleFilters,
): Promise<number> {
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const projectId = scope.projectId;
  const appId = scope.appId;

  switch (metric) {
    case "event_count":
    case "error_count":
    case "fatal_count":
      return projectId && !appId
        ? countProjectMetricSamples(projectId, metric, since, filters?.tags)
        : countMetricSamples(appId!, metric, since, filters?.tags);
    case "new_issue_count":
      if (projectId && !appId) {
        // The issues are app-scoped; the project's count is the sum of its apps.
        const apps = await appDAO.listRawByProject(projectId);
        const counts = await Promise.all(
          apps.map((app) => issueDAO.countNewSince(app.id, since, filters?.tags)),
        );
        return counts.reduce((total, count) => total + count, 0);
      }
      return issueDAO.countNewSince(appId!, since, filters?.tags);
    case "latency_p95":
    case "latency_p99": {
      const quantile = metric === "latency_p95" ? 95 : 99;
      const name = measurement ?? DEFAULT_MEASUREMENT;
      return projectId && !appId
        ? projectMetricSampleQuantile(projectId, name, quantile, since, filters?.tags)
        : metricSampleQuantile(appId!, name, quantile, since, filters?.tags);
    }
    default:
      return 0;
  }
}

async function evaluateRules(scope: {
  appId?: string;
  projectId?: string;
}): Promise<AlertIncident[]> {
  const appId = scope.appId ?? null;
  const { channels } = await resolveEffectiveAlertConfig(scope);
  const rules = await resolveScopedRules(scope);
  const enabled = rules.filter(
    (rule) => rule.isEnabled && rule.trigger === "threshold",
  );

  const incidents = await Promise.all(
    enabled.map(async (rule): Promise<AlertIncident | null> => {
      const { metric, operator, threshold, windowSeconds } = rule;
      if (
        metric === null ||
        operator === null ||
        threshold === null ||
        windowSeconds === null
      ) {
        return null;
      }
      const value = await computeRuleValue(
        scope,
        metric,
        windowSeconds,
        rule.measurement,
        rule.filters,
      );
      const breached = operator === "gt" ? value > threshold : value < threshold;
      countRuleEvaluated();

      if (!breached) {
        await alertIncidentDAO.resolveOpen(rule.id);
        countIncidentResolved();
        logDecision({
          event: "evaluated",
          rule: rule.name,
          scope: scope.projectId ? { projectId: scope.projectId } : { appId },
          metric,
          value,
          threshold,
          outcome: "no_breach",
        });
        return null;
      }

      const silence = await activeSilence(scope);
      if (silence) {
        logDecision({
          event: "evaluated",
          rule: rule.name,
          scope: scope.projectId ? { projectId: scope.projectId } : { appId },
          metric,
          value,
          threshold,
          outcome: "silenced",
          silence: silence.name,
        });
        return null;
      }

      const now = new Date().toISOString();
      if (rule.lastTriggeredAt !== null) {
        const elapsed = Date.now() - new Date(rule.lastTriggeredAt).getTime();
        if (elapsed < rule.cooldownSeconds * 1000) {
          countCooldownSkipped();
          logDecision({
            event: "evaluated",
            rule: rule.name,
            scope: scope.projectId ? { projectId: scope.projectId } : { appId },
            metric,
            value,
            threshold,
            outcome: "cooldown",
          });
          return null;
        }
      }

      const targets =
        rule.channelIds.length > 0
          ? rule.channelIds
          : channels.map((channel) => channel.id);
      const selected = channels.filter((channel) =>
        targets.includes(channel.id),
      );
      const notification = buildAlertNotification(
        {
          name: rule.name,
          metric,
          operator,
          threshold,
          windowSeconds,
          message: rule.message,
        },
        value,
        appId,
        now,
      );
      const deliveries = await deliverAlertToChannels(selected, notification);
      await recordFailedDeliveries(deliveries, notification, rule.id, appId);
      countIncidentFired();
      logDecision({
        event: "evaluated",
        rule: rule.name,
        scope: scope.projectId ? { projectId: scope.projectId } : { appId },
        metric,
        value,
        threshold,
        outcome: "fired",
      });

      // The incident and the cooldown stamp are one unit: a crash between
      // them would re-notify and duplicate the incident on the next tick.
      const incident = await db.transaction(async (tx) => {
        const open = await alertIncidentDAO.findOpen(rule.id, tx);
        const created =
          open ??
          (await alertIncidentDAO.create(
            {
              ruleId: rule.id,
              appId,
              trigger: "threshold",
              metric,
              value,
              threshold,
              triggeredAt: now,
            },
            tx,
          ));
        await alertRuleDAO.touchTriggered(rule.id, now, tx);
        return created;
      });
      return incident;
    }),
  );
  return incidents.filter((incident): incident is AlertIncident => incident !== null);
}

// A rule's tag filters: every filtered tag must be on the occurrence.
function matchesTagFilters(
  tags: Record<string, string> | undefined,
  filters: AlertRuleFilters | undefined,
): boolean {
  const wanted = filters?.tags;
  if (!wanted) return true;
  for (const [key, value] of Object.entries(wanted)) {
    if (!tags || tags[key] !== value) return false;
  }
  return true;
}

async function fireIssueTriggerRules(
  scope: { appId: string; projectId?: string | null },
  trigger: "new_issue" | "regression",
  issues: TrackedIssue[],
): Promise<void> {
  const { rules, channels } = await resolveEffectiveAlertConfig(scope);
  const matching = rules.filter(
    (rule) => rule.isEnabled && rule.trigger === trigger,
  );
  const silence = await activeSilence(scope);
  if (silence) {
    logDecision({
      event: "issue_trigger",
      trigger,
      outcome: "silenced",
      silence: silence.name,
    });
    return;
  }

  await Promise.all(
    matching.map(async (rule) => {
      const targets =
        rule.channelIds.length > 0
          ? rule.channelIds
          : channels.map((channel) => channel.id);
      const selected = channels.filter((channel) =>
        targets.includes(channel.id),
      );

      const fired = await Promise.all(
        issues
          .filter((issue) => matchesTagFilters(issue.tags, rule.filters))
          .map(async (issue): Promise<boolean> => {
            const last = await alertIncidentDAO.findLastForIssue(
              rule.id,
              issue.fingerprint,
            );
            if (last !== undefined) {
              const elapsed = Date.now() - new Date(last.triggeredAt).getTime();
              if (elapsed < rule.cooldownSeconds * 1000) return false;
            }

            const now = new Date().toISOString();
            const notification = buildIssueAlertNotification(
              rule,
              trigger,
              { fingerprint: issue.fingerprint, title: issue.title },
              scope.appId,
              now,
            );
            const deliveries = await deliverAlertToChannels(
              selected,
              notification,
            );
            await recordFailedDeliveries(
              deliveries,
              notification,
              rule.id,
              scope.appId,
            );
            countIncidentFired();
            logDecision({
              event: "issue_trigger",
              rule: rule.name,
              trigger,
              issue: issue.fingerprint,
              outcome: "fired",
            });
            await alertIncidentDAO.create({
              ruleId: rule.id,
              appId: scope.appId,
              trigger,
              issueFingerprint: issue.fingerprint,
              status: "resolved",
              triggeredAt: now,
              resolvedAt: now,
            });
            return true;
          }),
        );

        if (fired.some(Boolean)) await alertRuleDAO.touchTriggered(rule.id, new Date().toISOString());
      }),
    );
  }

  const evaluationChains = new Map<string, Promise<unknown>>();

  function enqueueAppWork(
    appId: string,
    label: string,
    run: () => Promise<unknown>,
  ): Promise<void> {
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
    return next.then(() => undefined);
  }

  export function evaluateProjectRules(projectId: string): void {
    enqueueAppWork(
      `project:${projectId}`,
      "project rule evaluation failed",
      () => evaluateRules({ projectId }),
    );
  }

  export function evaluateRulesForApp(appId: string): void {
    enqueueAppWork(appId, "rule evaluation failed", () => evaluateRules({ appId }));
  }

  // The same evaluation, awaited — the sweep runs the apps in parallel.
  export function evaluateRulesForAppAndWait(appId: string): Promise<void> {
    return enqueueAppWork(appId, "rule evaluation failed", () =>
      evaluateRules({ appId }),
    );
  }

  export function evaluateProjectRulesAndWait(projectId: string): Promise<void> {
    return enqueueAppWork(
      `project:${projectId}`,
      "project rule evaluation failed",
      () => evaluateRules({ projectId }),
    );
  }

  // Threshold rules belong to the sweeper: the ingestion path would read a
  // ClickHouse window that does not contain the event yet.
  export function processIngestedEvent(
    appId: string,
    digests: IssueDigest[],
    receivedAt: string,
    eventId: string,
    projectId?: string | null,
  ): void {
    enqueueAppWork(appId, "ingested event processing failed", async () => {
      const { newIssues, regressions } = await trackIssuesForEvent(
        appId,
        digests,
        receivedAt,
        eventId,
      );
      const scope = { appId, projectId: projectId ?? null };
      await Promise.all([
        newIssues.length > 0 ? fireIssueTriggerRules(scope, "new_issue", newIssues) : Promise.resolve(),
        regressions.length > 0 ? fireIssueTriggerRules(scope, "regression", regressions) : Promise.resolve(),
      ]);
    });
  }

  let sweeperTimer: ReturnType<typeof setInterval> | null = null;

  export function startAlertSweeper(): void {
    if (sweeperTimer !== null) return;
    const intervalMs = Number(process.env.ALERT_EVALUATION_INTERVAL_MS) || 60_000;
    sweeperTimer = setInterval(() => {
      // A down ClickHouse would fail every app's evaluation; the circuit
      // makes the queries fail fast, so the sweep is skipped as a whole.
      if (isClickHouseCircuitOpen()) {
        console.warn(
          "[alerting] the sweep is skipped — the ClickHouse circuit is open",
        );
        return;
      }
      void Promise.all([appDAO.listAll(), alertRuleDAO.listProjectScoped()])
        .then(async ([apps, projectRules]) => {
          const concurrency =
            Number(process.env.ALERT_SWEEPER_CONCURRENCY) || 8;
          // The project-scoped rules are evaluated per project.
          const projectIds = new Set(
            projectRules
              .map((rule) => rule.projectId)
              .filter((id): id is string => Boolean(id)),
          );
          await mapWithConcurrency(apps, concurrency, (app) =>
            evaluateRulesForAppAndWait(app.id),
          );
          await mapWithConcurrency([...projectIds], concurrency, (projectId) =>
            evaluateProjectRulesAndWait(projectId),
          );
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
