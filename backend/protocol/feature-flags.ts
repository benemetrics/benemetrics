export interface FeatureFlagVariant {
  key: string;
  name: string;
  value: unknown;
  weight: number;
}

export interface TargetingRule {
  attribute: string;
  operator: string;
  value: unknown;
  variantKey?: string;
}

export interface ExperimentConfig {
  enabled: boolean;
  hypothesis?: string;
  primaryMetric?: string;
  confidenceLevel?: number;
  minimumSampleSize?: number;
  status?: "running" | "paused" | "completed";
  guardrailMetrics?: Array<{
    metric: string;
    action: "pause";
    threshold: number;
  }>;
}

export interface FeatureFlagCreate {
  key: string;
  name: string;
  description?: string;
  type: "boolean" | "string" | "number" | "json";
  defaultValue: string | number | boolean;
  variants?: FeatureFlagVariant[];
  targetingRules?: TargetingRule[];
  segments?: string[];
  experiment?: ExperimentConfig | null;
  rolloutPercentage?: number;
}

export interface FeatureFlagResponse {
  id: string;
  key: string;
  name: string;
  description: string;
  type: "boolean" | "string" | "number" | "json";
  defaultValue: string | number | boolean;
  variants: FeatureFlagVariant[];
  targetingRules: TargetingRule[];
  segments: string[];
  status: "draft" | "active" | "paused" | "archived";
  rolloutPercentage: number;
  experiment: ExperimentConfig | null;
  createdAt: string;
  updatedAt: string;
}

export interface EvaluationRequest {
  user: {
    id: string;
    email?: string;
    name?: string;
    custom?: Record<string, unknown>;
  };
  context?: Record<string, unknown>;
  flags: string[];
}

export interface EvaluationItem {
  flagKey: string;
  variantKey: string;
  value: unknown;
  reason: string;
  errorCode?: string;
  assignmentId?: string;
}

export interface EvaluationResponse {
  evaluations: EvaluationItem[];
  evaluatedAt: string;
}

export interface ExperimentTrackRequest {
  flagKey: string;
  userId: string;
  metric: string;
  value?: number;
}

export interface ExperimentTrackResponse {
  success: boolean;
  flagKey: string;
  variantKey: string;
  assignmentId: string;
}

export interface ExperimentResults {
  featureFlagId: string;
  experiment: {
    enabled: boolean;
    hypothesis?: string;
    primaryMetric: string;
    status: string;
  };
  variants: Array<{
    key: string;
    name: string;
    participants: number;
    conversions: number;
    conversionRate: number;
    confidenceInterval: [number, number];
    pValue?: number;
    isSignificant?: boolean;
    relativeImprovement?: number;
  }>;
  recommendation: {
    winner?: string;
    confidence: "high" | "medium" | "low";
    action: "implement" | "continue";
  };
}