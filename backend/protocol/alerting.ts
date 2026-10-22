import type { IssueSummary } from "./issues";

export type AlertChannelType =
  | "email"
  | "webhook"
  | "slack"
  | "rocketchat"
  | "pagerduty"
  | "opsgenie"
  | "msteams"
  | "victorops";

export type AlertMetric =
  | "event_count"
  | "error_count"
  | "fatal_count"
  | "new_issue_count"
  | "latency_p95"
  | "latency_p99";

export type AlertOperator = "gt" | "lt";

export type AlertTrigger = "threshold" | "new_issue" | "regression";

export type AlertSeverity = "info" | "warning" | "critical";

export type AlertIncidentStatus = "firing" | "resolved";

/**
 * The dimensions a rule matches on. A tag filter keeps the samples (and
 * the issue events) whose event carries the tag with that value.
 */
export interface AlertRuleFilters {
  tags?: Record<string, string>;
}

export interface AlertChannel {
  id: string;
  name: string;
  type: AlertChannelType;
  config: Record<string, unknown>;
  appId: string | null;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlertChannelCreateRequest {
  name: string;
  type: AlertChannelType;
  config?: Record<string, unknown>;
  appId?: string | null;
  projectId?: string | null;
}

export interface AlertRule {
  id: string;
  name: string;
  trigger: AlertTrigger;
  metric: AlertMetric | null;
  operator: AlertOperator | null;
  threshold: number | null;
  windowSeconds: number | null;
  cooldownSeconds: number;
  channelIds: string[];
  measurement: string | null;
  appId: string | null;
  projectId: string | null;
  /** The dimensions the rule matches on. */
  filters: AlertRuleFilters;
  isEnabled: boolean;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlertIncident {
  id: string;
  ruleId: string;
  appId: string | null;
  trigger: AlertTrigger;
  metric: AlertMetric | null;
  value: number | null;
  threshold: number | null;
  issueFingerprint: string | null;
  status: AlertIncidentStatus;
  triggeredAt: string;
  resolvedAt: string | null;
}

export interface AlertNotification {
  title: string;
  message: string;
  severity: AlertSeverity;
  ruleName: string;
  trigger: AlertTrigger;
  metric: AlertMetric | null;
  value: number | null;
  threshold: number | null;
  issue?: IssueSummary;
  appId: string | null;
  occurredAt: string;
  link?: string;
}

export interface DeliveryResult {
  channelId: string;
  channelName: string;
  type: AlertChannelType;
  ok: boolean;
  error?: string;
}
