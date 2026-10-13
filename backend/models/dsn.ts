interface DsnConfig {
  projectId: string;
  publicKey: string;
  host: string;
  protocol: string;
}

interface DsnRecord {
  id: string;
  config: DsnConfig;
  createdAt: Date;
}

interface DsnCreateRequest {
  projectId: string;
  host: string;
  publicKey?: string;
}

interface DsnResponse {
  dsn: string;
  projectId: string;
  publicKey: string;
  host: string;
  protocol: string;
}

interface DsnCreateResponse extends DsnResponse {
  id: string;
  createdAt: string;
}

// Feature Flags Types
type FeatureFlagType = "boolean" | "string" | "number" | "json";
type FeatureFlagStatus = "draft" | "active" | "paused" | "archived";
type Operator = "equals" | "not_equals" | "contains" | "not_contains" | "starts_with" | "ends_with" | "in" | "not_in" | "greater_than" | "less_than" | "greater_than_or_equal" | "less_than_or_equal" | "before" | "after" | "on" | "between";

interface FeatureFlagVariant {
  key: string;
  name: string;
  value: any;
  weight: number;
}

interface TargetingRule {
  id: string;
  attribute: string;
  operator: Operator;
  value: any;
  variantKey: string;
}

interface ExperimentConfig {
  enabled: boolean;
  hypothesis?: string;
  primaryMetric?: string;
  minimumSampleSize?: number;
  confidenceLevel?: number;
  minimumDetectableEffect?: number;
  guardrailMetrics?: Array<{ metric: string; threshold: number; action: "pause" | "alert" }>;
}

interface FeatureFlag {
  id: string;
  key: string;
  name: string;
  description: string;
  type: FeatureFlagType;
  defaultValue: any;
  variants: FeatureFlagVariant[];
  targetingRules: TargetingRule[];
  segments: string[];
  status: FeatureFlagStatus;
  rolloutPercentage: number;
  experiment?: ExperimentConfig;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy: string;
}

interface Segment {
  id: string;
  name: string;
  description: string;
  rules: TargetingRule[];
  userCount: number;
  createdAt: Date;
  updatedAt: Date;
}

interface FeatureFlagCreateRequest {
  key: string;
  name: string;
  description?: string;
  type: FeatureFlagType;
  defaultValue: any;
  variants?: FeatureFlagVariant[];
  targetingRules?: TargetingRule[];
  segments?: string[];
  experiment?: ExperimentConfig;
}

interface FeatureFlagUpdateRequest {
  name?: string;
  description?: string;
  rolloutPercentage?: number;
  variants?: FeatureFlagVariant[];
  targetingRules?: TargetingRule[];
  segments?: string[];
  experiment?: ExperimentConfig;
}

interface FeatureFlagListResponse {
  data: FeatureFlag[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface EvaluationRequest {
  user: {
    id: string;
    email?: string;
    name?: string;
    custom?: Record<string, any>;
  };
  context?: {
    ip?: string;
    country?: string;
    device?: string;
    browser?: string;
  };
  flags: string[];
}

interface EvaluationResponse {
  evaluations: Array<{
    flagKey: string;
    variantKey: string;
    value: any;
    reason: string;
  }>;
  evaluatedAt: string;
}

export type {
  DsnConfig, DsnRecord, DsnCreateRequest, DsnResponse, DsnCreateResponse,
  FeatureFlagType, FeatureFlagStatus, Operator,
  FeatureFlagVariant, TargetingRule, ExperimentConfig,
  FeatureFlag, Segment,
  FeatureFlagCreateRequest, FeatureFlagUpdateRequest, FeatureFlagListResponse,
  EvaluationRequest, EvaluationResponse
};