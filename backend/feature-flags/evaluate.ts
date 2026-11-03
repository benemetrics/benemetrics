import type {
  FeatureFlagVariant,
  OfrepContext,
  TargetingRule,
} from "backend/protocol/feature-flags";
import { segmentDAO } from "db/dao/feature-flags/segments";
import { experimentAssignmentDAO } from "db/dao/feature-flags/experiment-assignments";
import { type ParsedFeatureFlag } from "./service";

/** The OpenFeature resolution-reason codes. */
export type EvaluationReason =
  | "STATIC"
  | "TARGETING_MATCH"
  | "SPLIT"
  | "DISABLED"
  | "UNKNOWN";

export type EvaluationResult = {
  variantKey: string;
  value: unknown;
  reason: EvaluationReason;
  /** The human-readable detail, not part of the reason enum. */
  reasonDetail: string;
};

/** OFREP contexts are flat; targeting rules keep the legacy `user.`/`context.` prefixes. */
function resolveAttribute(
  attribute: string,
  targetingKey: string,
  context: OfrepContext | undefined,
): unknown {
  const key =
    attribute.startsWith("user.") || attribute.startsWith("context.")
      ? attribute.split(".").slice(1).join(".")
      : attribute;
  if (key === "id") return targetingKey;
  return context?.[key];
}

function matches(
  operator: string,
  userValue: unknown,
  ruleValue: unknown,
): boolean {
  // An attribute the user does not carry never matches.
  if (userValue === undefined) return false;
  switch (operator) {
    case "equals":
      return userValue === ruleValue;
    case "not_equals":
      return userValue !== ruleValue;
    case "contains":
      return String(userValue).includes(String(ruleValue));
    case "not_contains":
      return !String(userValue).includes(String(ruleValue));
    case "starts_with":
      return String(userValue).startsWith(String(ruleValue));
    case "ends_with":
      return String(userValue).endsWith(String(ruleValue));
    case "in":
      return Array.isArray(ruleValue) && ruleValue.includes(userValue);
    case "not_in":
      return Array.isArray(ruleValue) && !ruleValue.includes(userValue);
    case "greater_than":
      return Number(userValue) > Number(ruleValue);
    case "less_than":
      return Number(userValue) < Number(ruleValue);
    case "greater_than_or_equal":
      return Number(userValue) >= Number(ruleValue);
    case "less_than_or_equal":
      return Number(userValue) <= Number(ruleValue);
    default:
      return false;
  }
}

function bucketFor(flagKey: string, targetingKey: string): number {
  let hash = 0x811c9dc5;
  const input = `${flagKey}:${targetingKey}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 100;
}

function weightedVariant(
  flag: ParsedFeatureFlag,
  variants: FeatureFlagVariant[],
  bucket: number,
  reason: EvaluationReason,
  reasonDetail: string,
): EvaluationResult {
  let cumulative = 0;
  for (const variant of variants) {
    cumulative += variant.weight;
    if (bucket < cumulative) {
      return {
        variantKey: variant.key,
        value: variant.value,
        reason,
        reasonDetail,
      };
    }
  }
  // Weights can miss the tail when the total is below 100; fall back to the default.
  const fallback = variants[0];
  if (fallback) {
    return {
      variantKey: fallback.key,
      value: fallback.value,
      reason,
      reasonDetail,
    };
  }
  return { variantKey: "default", value: flag.defaultValue ?? null, reason, reasonDetail };
}

export function controlVariant(
  variants: FeatureFlagVariant[],
): FeatureFlagVariant | undefined {
  return variants.find((v) => v.key === "control") ?? variants[0];
}

/** The disabled / out-of-rollout answer: the control variant, or the default. */
export function disabledResult(flag: ParsedFeatureFlag): EvaluationResult {
  const control = controlVariant(flag.variants);
  if (control)
    return {
      variantKey: control.key,
      value: control.value,
      reason: "DISABLED",
      reasonDetail: "Flag is disabled, returning control",
    };
  return {
    variantKey: "default",
    value: flag.defaultValue ?? null,
    reason: "DISABLED",
    reasonDetail: "Flag is disabled, returning default",
  };
}

export async function evaluateFlag(
  flag: ParsedFeatureFlag,
  targetingKey: string,
  context?: OfrepContext,
): Promise<EvaluationResult> {
  const { variants, targetingRules, segments: segmentIds } = flag;
  const bucket = bucketFor(flag.key, targetingKey);

  for (const rule of targetingRules) {
    if (rule.variantKey == null) continue;
    if (
      matches(
        rule.operator,
        resolveAttribute(rule.attribute, targetingKey, context),
        rule.value,
      )
    ) {
      const variant = variants.find((v) => v.key === rule.variantKey);
      if (variant) {
        return {
          variantKey: variant.key,
          value: variant.value,
          reason: "TARGETING_MATCH",
          reasonDetail: `Matched targeting rule: ${rule.attribute} ${rule.operator} ${rule.value}`,
        };
      }
    }
  }

  const eligibilityRules = targetingRules.filter(
    (rule) => rule.variantKey == null,
  );
  if (eligibilityRules.length > 0) {
    const eligible = eligibilityRules.some((rule) =>
      matches(
        rule.operator,
        resolveAttribute(rule.attribute, targetingKey, context),
        rule.value,
      ),
    );
    if (!eligible) {
      return {
        ...disabledResult(flag),
        reason: "TARGETING_MATCH",
        reasonDetail: "Outside experiment audience",
      };
    }
  }

  for (const segmentId of segmentIds) {
    const segment = await segmentDAO.findById(segmentId);
    if (!segment) continue;

    const rules =
      typeof segment.rules === "string"
        ? (JSON.parse(segment.rules) as TargetingRule[])
        : ((segment.rules ?? []) as TargetingRule[]);
    const allMatched =
      rules.length > 0 &&
      rules.every(
        (rule) =>
          matches(
            rule.operator,
            resolveAttribute(rule.attribute, targetingKey, context),
            rule.value,
          ),
      );

    if (allMatched) {
      return weightedVariant(
        flag,
        variants,
        bucket,
        "SPLIT",
        `Matched segment: ${segment.name}`,
      );
    }
  }

  if (flag.rolloutPercentage < 100 && bucket >= flag.rolloutPercentage) {
    return disabledResult(flag);
  }

  return weightedVariant(
    flag,
    variants,
    bucket,
    "SPLIT",
    "Weighted random assignment",
  );
}

export async function evaluateWithAssignment(
  flag: ParsedFeatureFlag,
  targetingKey: string,
  context?: OfrepContext,
): Promise<EvaluationResult & { assignmentId?: string }> {
  if (!flag.experiment?.enabled) {
    return await evaluateFlag(flag, targetingKey, context);
  }

  const existing = await experimentAssignmentDAO.findByFlagAndUser(
    flag.id,
    targetingKey,
  );
  if (existing) {
    const variant = flag.variants.find((v) => v.key === existing.variantKey);
    return {
      variantKey: existing.variantKey,
      value: variant?.value ?? null,
      reason: "SPLIT",
      reasonDetail: "Stored assignment",
      assignmentId: existing.id,
    };
  }

  const result = await evaluateFlag(flag, targetingKey, context);
  const created = await experimentAssignmentDAO.create({
    flagId: flag.id,
    userId: targetingKey,
    variantKey: result.variantKey,
    context: JSON.stringify(context ?? {}),
  });
  if (created.variantKey !== result.variantKey) {
    const variant = flag.variants.find((v) => v.key === created.variantKey);
    return {
      variantKey: created.variantKey,
      value: variant?.value ?? null,
      reason: "SPLIT",
      reasonDetail: "Stored assignment",
      assignmentId: created.id,
    };
  }
  return { ...result, assignmentId: created.id };
}
