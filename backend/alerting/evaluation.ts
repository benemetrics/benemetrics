
import { alertRuleDAO } from "db/dao/alert-rules";
import { alertIncidentDAO } from "db/dao/alert-incidents";
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
import {
  buildAlertNotification,
  buildIssueAlertNotification,
  deliverAlertToChannels,
} from "./notifiers";
import type {
  AlertIncident,
  AlertMetric,
  AlertRuleFilters,
} from "../protocol/alerting";

const DEFAULT_MEASUREMENT = "duration";

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
          apps.map((app) => issueDAO.countNewSince(app.id, since)),
        );
        return counts.reduce((total, count) => total + count, 0);
      }
      return issueDAO.countNewSince(appId!, since);
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

      if (!breached) {
        await alertIncidentDAO.resolveOpen(rule.id);
        return null;
      }

      const now = new Date().toISOString();
      if (rule.lastTriggeredAt !== null) {
        const elapsed = Date.now() - new Date(rule.lastTriggeredAt).getTime();
        if (elapsed < rule.cooldownSeconds * 1000) return null;
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

async function fireIssueTriggerRules(
  scope: { appId: string; projectId?: string | null },
  trigger: "new_issue" | "regression",
  issues: TrackedIssue[],
): Promise<void> {
  const { rules, channels } = await resolveEffectiveAlertConfig(scope);
  const matching = rules.filter(
    (rule) => rule.isEnabled && rule.trigger === trigger,
  );

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
        issues.map(async (issue): Promise<boolean> => {
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
          await deliverAlertToChannels(selected, notification);
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
    void Promise.all([appDAO.listAll(), alertRuleDAO.listProjectScoped()])
      .then(([apps, projectRules]) => {
        for (const app of apps) evaluateRulesForApp(app.id);
        // The project-scoped rules are evaluated per project.
        const projectIds = new Set(
          projectRules
            .map((rule) => rule.projectId)
            .filter((id): id is string => Boolean(id)),
        );
        for (const projectId of projectIds) evaluateProjectRules(projectId);
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
