import type { IssueSummary } from "./issues";

export type AlertChannelType = "email" | "webhook" | "slack" | "rocketchat";

export type AlertMetric =
  | "event_count"
  | "error_count"
  | "fatal_count"
  | "new_issue_count"
  | "latency_p95"
  | "latency_p99";

export type AlertOperator = "gt" | "lt";

// A rule fires on a windowed metric breach ("threshold") or on an
// issue-state transition detected at ingestion ("new_issue" first
// occurrence, "regression" reoccurrence of a resolved issue).
export type AlertTrigger = "threshold" | "new_issue" | "regression";

export type AlertSeverity = "info" | "warning" | "critical";

export type AlertIncidentStatus = "firing" | "resolved";

// A delivery endpoint. `appId: null` marks a global (default) channel;
// an app-scoped channel with the same `name` replaces the global one.
export interface AlertChannel {
  id: string;
  name: string;
  type: AlertChannelType;
  config: Record<string, unknown>;
  appId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlertChannelCreateRequest {
  name: string;
  type: AlertChannelType;
  config?: Record<string, unknown>;
  appId?: string | null;
}

// Per-platform config shapes (all optional, validated at send time):
//   webhook:   { url, headers? }
//   slack:     { webhookUrl } | { token, channel }
//   rocketchat:{ webhookUrl }
//   email:     { to, from, ... } (SMTP — planned)

export interface AlertRule {
  id: string;
  name: string;
  trigger: AlertTrigger;
  // Set on threshold rules only; null on issue triggers.
  metric: AlertMetric | null;
  operator: AlertOperator | null;
  threshold: number | null;
  windowSeconds: number | null;
  cooldownSeconds: number;
  channelIds: string[];
  // Measurement name for latency_* metrics (default "duration").
  measurement: string | null;
  appId: string | null;
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
  // Set on threshold incidents; issue-trigger incidents carry the
  // fingerprint instead.
  metric: AlertMetric | null;
  value: number | null;
  threshold: number | null;
  issueFingerprint: string | null;
  status: AlertIncidentStatus;
  triggeredAt: string;
  resolvedAt: string | null;
}

// Uniform notification payload — identical for every platform so the
// caller never has to know platform quirks.
export interface AlertNotification {
  title: string;
  message: string;
  severity: AlertSeverity;
  ruleName: string;
  trigger: AlertTrigger;
  metric: AlertMetric | null;
  value: number | null;
  threshold: number | null;
  // Present on issue-trigger notifications.
  issue?: IssueSummary;
  appId: string | null;
  occurredAt: string;
  link?: string;
}

// Failures are reported, never thrown into the request path.
export interface DeliveryResult {
  channelId: string;
  channelName: string;
  type: AlertChannelType;
  ok: boolean;
  error?: string;
}
