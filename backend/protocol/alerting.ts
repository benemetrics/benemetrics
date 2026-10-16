export type AlertChannelType = "email" | "webhook" | "slack" | "rocketchat";

export type AlertMetric =
  | "event_count"
  | "error_count"
  | "fatal_count"
  | "new_issue_count"
  | "latency_p95"
  | "latency_p99";

export type AlertOperator = "gt" | "lt";

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
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
  windowSeconds: number;
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
  metric: AlertMetric;
  value: number;
  threshold: number;
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
  metric: AlertMetric;
  value: number;
  threshold: number;
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
