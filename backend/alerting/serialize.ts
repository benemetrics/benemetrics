import type {
  AlertChannel,
  AlertChannelType,
  AlertIncident,
  AlertMetric,
  AlertOperator,
  AlertRule,
} from "../protocol/alerting";
import type { AlertChannelRow } from "db/schema/alert-channels";
import type { AlertRuleRow } from "db/schema/alert-rules";
import type { AlertIncidentRow } from "db/schema/alert-incidents";
import { parseJson } from "db/json";

export function toChannel(row: AlertChannelRow): AlertChannel {
  return {
    id: row.id,
    name: row.name,
    type: row.type as AlertChannelType,
    config: parseJson<Record<string, unknown>>(row.config, {}),
    appId: row.appId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toRule(row: AlertRuleRow): AlertRule {
  return {
    id: row.id,
    name: row.name,
    metric: row.metric as AlertMetric,
    operator: row.operator as AlertOperator,
    threshold: row.threshold,
    windowSeconds: row.windowSeconds,
    cooldownSeconds: row.cooldownSeconds,
    channelIds: parseJson<string[]>(row.channelIds, []),
    measurement: row.measurement ?? null,
    appId: row.appId ?? null,
    isEnabled: row.isEnabled === 1,
    lastTriggeredAt: row.lastTriggeredAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toIncident(row: AlertIncidentRow): AlertIncident {
  return {
    id: row.id,
    ruleId: row.ruleId,
    appId: row.appId ?? null,
    metric: row.metric as AlertMetric,
    value: row.value,
    threshold: row.threshold,
    status: row.status as AlertIncident["status"],
    triggeredAt: row.triggeredAt,
    resolvedAt: row.resolvedAt ?? null,
  };
}
