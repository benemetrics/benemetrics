export interface AlertChannelType {
  type: "webhook" | "slack" | "rocketchat" | "email";
  config: Record<string, unknown>;
}

export interface AlertChannelCreate {
  name: string;
  type: "webhook" | "slack" | "rocketchat" | "email";
  config?: Record<string, unknown>;
  appId?: string;
}

export interface AlertChannelResponse {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  appId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlertRuleCreate {
  name: string;
  trigger: "threshold" | "new_issue" | "regression";
  metric?: "event_count" | "error_count" | "fatal_count" | "new_issue_count" | "latency_p95" | "latency_p99";
  operator?: "gt" | "lt";
  threshold?: number;
  windowSeconds?: number;
  cooldownSeconds?: number;
  channelIds?: string[];
  measurement?: string;
  appId?: string;
}

export interface AlertRuleResponse {
  id: string;
  name: string;
  trigger: "threshold" | "new_issue" | "regression";
  metric: string | null;
  operator: string | null;
  threshold: number | null;
  windowSeconds: number | null;
  cooldownSeconds: number;
  channelIds: string[];
  measurement: string | null;
  appId: string | null;
  isEnabled: boolean;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlertNotification {
  title: string;
  message: string;
  severity: "info" | "warning" | "critical";
  ruleName: string;
  trigger: "threshold" | "new_issue" | "regression";
  metric: string | null;
  value: number | null;
  threshold: number | null;
  issue?: {
    id: string;
    title: string;
    fingerprint: string;
    level: string;
    appId: string;
    projectId: string;
    environmentId: string;
  };
  projectId: string;
  environmentId: string | null;
  occurredAt: string;
  link?: string;
}

export interface AlertIncidentResponse {
  id: string;
  ruleId: string;
  appId: string | null;
  trigger: "threshold" | "new_issue" | "regression";
  issueFingerprint: string | null;
  metric: string | null;
  value: number | null;
  threshold: number | null;
  status: "firing" | "resolved";
  triggeredAt: string;
  resolvedAt: string | null;
}