import { metricsStore } from "../metrics-store.ts";
import { issueDAO } from "../../db/dao/issues.ts";
import { alertRuleDAO, alertIncidentDAO, alertChannelDAO } from "../../db/dao/alert-rules.ts";
import { deliverAlertToChannels, AlertNotification } from "./notifiers.ts";

const ALERT_EVALUATION_INTERVAL_MS = parseInt(process.env.ALERT_EVALUATION_INTERVAL_MS || "60000");

interface AlertRule {
  id: string;
  trigger: string;
  metric?: string;
  operator?: string;
  threshold?: number;
  windowSeconds?: number;
  cooldownSeconds?: number;
  channelIds: string[];
  appId?: string;
  isEnabled: number;
  lastTriggeredAt?: string;
}

export async function startAlertSweeper(): Promise<void> {
  setInterval(async () => {
    try {
      await evaluateThresholdRules();
    } catch (err) {
      console.error("[alerting] Sweeper error:", err);
    }
  }, ALERT_EVALUATION_INTERVAL_MS);
}

async function evaluateThresholdRules() {
  // This would iterate over all app/project combinations with enabled threshold rules
}

async function computeRuleValue(rule: AlertRule, projectId: string, environmentId: string | null, appId: string | null): Promise<number> {
  if (rule.metric === "new_issue_count") {
    const issues = await issueDAO.list({ projectId, appId, status: "unresolved", page: 1, limit: 1 });
    return issues.pagination.total;
  }

  const result = await metricsStore.series({
    metric: rule.metric || "event_count",
    projectId,
    environmentId: environmentId || undefined,
    appId: appId || undefined,
    from: new Date(Date.now() - (rule.windowSeconds || 3600) * 1000).toISOString(),
    to: new Date().toISOString(),
  });

  if (rule.metric === "latency_p95" || rule.metric === "latency_p99") {
    return 0;
  }

  return result.reduce((sum: number, p: any) => sum + p.count, 0);
}

export async function evaluateThresholdRulesForScope(projectId: string, environmentId: string | null, appId: string | null) {
  const rules = await resolveEffectiveRulesForScope(projectId, environmentId, appId);
  for (const rule of rules) {
    if (!rule.isEnabled || rule.trigger !== "threshold") continue;
    const value = await computeRuleValue(rule, projectId, environmentId, appId);
    const breached = rule.operator === "gt" ? value > (rule.threshold || 0) : value < (rule.threshold || 0);
    // Check cooldown, fire alert if breached
  }
}

async function resolveEffectiveRulesForScope(projectId: string, environmentId: string | null, appId: string | null): Promise<AlertRule[]> {
  return [];
}