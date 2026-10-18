import type { AlertChannel, AlertRule, AlertIncident } from "../../db/schema/alert-channels.ts";
import type { AlertChannelResponse, AlertRuleResponse, AlertIncidentResponse } from "../protocol/alerting.ts";

export function toChannelResponse(ch: AlertChannel): AlertChannelResponse {
  return {
    id: ch.id,
    name: ch.name,
    type: ch.type,
    config: JSON.parse(ch.config),
    appId: ch.appId,
    createdAt: ch.createdAt,
    updatedAt: ch.updatedAt,
  };
}

export function toRuleResponse(rule: AlertRule): AlertRuleResponse {
  return {
    id: rule.id,
    name: rule.name,
    trigger: rule.trigger,
    metric: rule.metric,
    operator: rule.operator,
    threshold: rule.threshold,
    windowSeconds: rule.windowSeconds,
    cooldownSeconds: rule.cooldownSeconds,
    channelIds: JSON.parse(rule.channelIds),
    measurement: rule.measurement,
    appId: rule.appId,
    isEnabled: rule.isEnabled === 1,
    lastTriggeredAt: rule.lastTriggeredAt,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

export function toIncidentResponse(incident: AlertIncident): AlertIncidentResponse {
  return {
    id: incident.id,
    ruleId: incident.ruleId,
    appId: incident.appId,
    trigger: incident.trigger,
    issueFingerprint: incident.issueFingerprint,
    metric: incident.metric,
    value: incident.value,
    threshold: incident.threshold,
    status: incident.status,
    triggeredAt: incident.triggeredAt,
    resolvedAt: incident.resolvedAt,
  };
}