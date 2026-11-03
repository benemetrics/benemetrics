import { type as arktype } from "arktype";

type FeatureFlagType = "boolean" | "string" | "number" | "json";
type FeatureFlagStatus = "draft" | "active" | "paused" | "archived";
type Operator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "in"
  | "not_in"
  | "greater_than"
  | "less_than"
  | "greater_than_or_equal"
  | "less_than_or_equal";

export const targetingOperatorSchema = arktype(
  "'equals' | 'not_equals' | 'contains' | 'not_contains' | 'starts_with' | 'ends_with' | 'in' | 'not_in' | 'greater_than' | 'less_than' | 'greater_than_or_equal' | 'less_than_or_equal'",
);

export const targetingRuleSchema = arktype({
  attribute: "string >= 1",
  operator: targetingOperatorSchema,
  value: "unknown",
  variantKey: "string?",
});

export const flagVariantSchema = arktype({
  key: "string >= 1",
  name: "string >= 1",
  value: "unknown",
  weight: "0 <= number.integer <= 100",
});

const guardrailMetricSchema = arktype({
  metric: "string >= 1",
  threshold: "number",
  action: "'pause' | 'alert'",
});

export const experimentConfigSchema = arktype({
  enabled: "boolean",
  status: "'running' | 'paused' | 'completed'?",
  hypothesis: "string?",
  primaryMetric: "string?",
  minimumSampleSize: "number.integer >= 0?",
  confidenceLevel: "0.9 | 0.95 | 0.99?",
  guardrailMetrics: guardrailMetricSchema.array().optional(),
});

interface FeatureFlagVariant {
  key: string;
  name: string;
  value: any;
  weight: number;
}

interface TargetingRule {
  id?: string;
  attribute: string;
  operator: Operator;
  value: any;
  variantKey?: string;
}

interface ExperimentConfig {
  enabled: boolean;
  status?: "running" | "paused" | "completed";
  hypothesis?: string;
  primaryMetric?: string;
  minimumSampleSize?: number;
  confidenceLevel?: number;
  guardrailMetrics?: Array<{
    metric: string;
    threshold: number;
    action: "pause" | "alert";
  }>;
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
  /** The scope: the project, optionally narrowed to one of its apps. */
  projectId?: string | null;
  appId?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Segment {
  id: string;
  name: string;
  description: string;
  rules: TargetingRule[];
  createdAt: string;
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
}

// ── OpenFeature Remote Evaluation Protocol (OFREP) ───────

/** The evaluation context: `targetingKey` plus arbitrary attributes. */
type OfrepContext = { targetingKey?: string } & Record<string, unknown>;

interface OfrepEvaluationRequest {
  context: OfrepContext;
}

interface OfrepSingleEvaluationRequest {
  context: {
    targetingKey: string;
  } & Record<string, unknown>;
}

/** A successful evaluation; `value` is absent for `codeDefaultFlag` in the spec. */
interface OfrepEvaluationSuccess {
  key: string;
  value: unknown;
  reason:
    | "STATIC"
    | "TARGETING_MATCH"
    | "SPLIT"
    | "DISABLED"
    | "UNKNOWN";
  variant?: string;
  errorCode?: never;
  errorDetails?: never;
  metadata?: Record<string, boolean | string | number>;
}

/** An evaluation failure entry inside a successful bulk response. */
interface OfrepEvaluationFailure {
  key: string;
  errorCode: "GENERAL" | "INVALID_CONTEXT" | "PARSE_ERROR" | "TARGETING_KEY_MISSING";
  errorDetails?: string;
  value?: never;
  reason?: never;
  variant?: never;
  metadata?: Record<string, boolean | string | number>;
}

/** The single-flag endpoint's dedicated 404 body. */
interface OfrepFlagNotFound {
  key: string;
  errorCode: "FLAG_NOT_FOUND";
  errorDetails?: string;
}

interface OfrepBulkEvaluationSuccess {
  flags: Array<OfrepEvaluationSuccess | OfrepEvaluationFailure>;
  metadata?: {
    version: string;
  };
  eventStreams?: Array<{
    type: "sse";
    url: string;
    inactivityDelaySec?: number;
  }>;
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
  variants: Record<
    string,
    {
      userCount: number;
      users: Array<{
        id: string;
        variantKey: string;
        assignedAt: string;
        context: unknown;
      }>;
    }
  >;
}

export type {
  FeatureFlagType,
  FeatureFlagStatus,
  Operator,
  FeatureFlagVariant,
  TargetingRule,
  ExperimentConfig,
  FeatureFlag,
  Segment,
  FeatureFlagCreateRequest,
  FeatureFlagUpdateRequest,
  FeatureFlagListResponse,
  OfrepContext,
  OfrepEvaluationRequest,
  OfrepSingleEvaluationRequest,
  OfrepEvaluationSuccess,
  OfrepEvaluationFailure,
  OfrepFlagNotFound,
  OfrepBulkEvaluationSuccess,
  ExperimentAssignment,
  ExperimentMetric,
  ExperimentTrackRequest,
  VariantResult,
  ExperimentResults,
  ExperimentUsersResponse,
};
