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
  status?: "draft" | "running" | "completed";
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

interface EvaluationItem {
  flagKey: string;
  variantKey: string;
  value: any;
  reason: string;
  errorCode?: string | null;
  assignmentId?: string;
}

interface EvaluationResponse {
  evaluations: EvaluationItem[];
  evaluatedAt: string;
}

interface ExperimentAssignment {
  id: string;
  flagId: string;
  userId: string;
  variantKey: string;
  context: unknown;
  assignedAt: string;
}

interface ExperimentMetric {
  id: string;
  flagId: string;
  variantKey: string;
  userId: string;
  metricName: string;
  value: number;
  recordedAt: string;
}

interface ExperimentTrackRequest {
  flagKey: string;
  userId: string;
  metric: string;
  value?: number;
}

interface VariantResult {
  key: string;
  name: string;
  participants: number;
  conversions: number;
  conversionRate: number;
  confidenceInterval: [number, number];
  pValue?: number;
  isSignificant?: boolean;
  relativeImprovement?: number;
}

interface ExperimentResults {
  featureFlagId: string;
  experiment: {
    enabled: boolean;
    hypothesis?: string;
    primaryMetric?: string;
    status: string;
  };
  variants: VariantResult[];
  recommendation: {
    winner?: string;
    confidence: "high" | "medium" | "low";
    action: "implement" | "continue";
  };
}

interface ExperimentUsersResponse {
  featureFlagId: string;
  variants: Record<string, { userCount: number; users: Array<{ id: string; variantKey: string; assignedAt: string; context: unknown }> }>;
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

interface ExperimentUserEvaluation {
  featureFlagId: string;
  userId: string;
  variantKey: string;
  variantValue: any;
  reason: string;
  evaluatedAt: string;
}

export type {
  FeatureFlagType, FeatureFlagStatus, Operator,
  FeatureFlagVariant, TargetingRule, ExperimentConfig,
  FeatureFlag, Segment,
  FeatureFlagCreateRequest, FeatureFlagUpdateRequest, FeatureFlagListResponse,
  EvaluationRequest, EvaluationResponse, EvaluationItem,
  ExperimentAssignment, ExperimentMetric, ExperimentTrackRequest,
  VariantResult, ExperimentResults, ExperimentUsersResponse, ExperimentUserEvaluation
};