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
  /** The message template; null keeps the default message. */
  message: string | null;
  isEnabled: boolean;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// The scope of a silence: global, a project or an app.
export type AlertSilenceScope = "global" | "project" | "app";

// The recorded change of an alert rule.
export interface AlertRuleHistory {
  id: string;
  ruleId: string;
  name: string;
  action: "created" | "updated" | "deleted";
  snapshot: Record<string, unknown>;
  actor: string | null;
  createdAt: string;
}

// A silence: while it is active the rules in its scope do not fire.
export interface AlertSilence {
  id: string;
  name: string;
  scopeType: AlertSilenceScope;
  scopeId: string | null;
  startsAt: string;
  endsAt: string | null;
  reason: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// A delivery that failed: it is retried with a backoff and stays in the
// queue while it keeps failing.
export interface AlertDeadLetter {
  id: string;
  channelId: string;
  channelName: string;
  channelType: string;
  ruleId: string | null;
  appId: string | null;
  notification: unknown;
  error: string;
  attempts: number;
  nextAttemptAt: string;
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
  correlationKey: string | null;
  parentId: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  assignee: string | null;
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
