import { Elysia } from "elysia";
import { badRequest, notFound } from "backend/errors";
import { type as arktype } from "arktype";
import type {
  EvaluationItem,
  EvaluationRequest,
  FeatureFlagVariant,
  TargetingRule,
} from "backend/protocol/feature-flags";
import { featureFlagDAO } from "db/dao/feature-flags";
import { requireDsnKey, scopeOf } from "./dsn";
import { segmentDAO } from "db/dao/segments";
import { experimentAssignmentDAO } from "db/dao/experiment-assignments";
import { experimentMetricDAO } from "db/dao/experiment-metrics";
import { db } from "db";
import { type ParsedFeatureFlag } from "./service";
import { publishFlagChange } from "./events";

export type { ParsedFeatureFlag } from "./service";

export type EvaluationResult = {
  variantKey: string;
  value: unknown;
  reason: string;
};

function resolveAttribute(
  attribute: string,
  user: unknown,
  context: unknown,
): unknown {
  const [root, ...path] = attribute.split(".");
  let value: unknown =
    root === "user" ? user : root === "context" ? context : undefined;

  for (const key of path) {
    if (typeof value !== "object" || value === null) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
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

function bucketFor(flagKey: string, userId: string): number {
  let hash = 0x811c9dc5;
  const input = `${flagKey}:${userId}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 100;
}

function weightedVariant(
  variants: FeatureFlagVariant[],
  bucket: number,
  reason: string,
  defaultValue?: unknown,
): EvaluationResult {
  let cumulative = 0;
  for (const variant of variants) {
    cumulative += variant.weight;
    if (bucket < cumulative) {
      return { variantKey: variant.key, value: variant.value, reason };
    }
  }
  if (defaultValue !== undefined) {
    return { variantKey: "default", value: defaultValue, reason };
  }
  const fallback = variants[0];
  return fallback
    ? { variantKey: fallback.key, value: fallback.value, reason }
    : { variantKey: "default", value: null, reason: "No variants configured" };
}

export function controlVariant(
  variants: FeatureFlagVariant[],
): FeatureFlagVariant | undefined {
  return variants.find((v) => v.key === "control") ?? variants[0];
}

export async function evaluateFlag(
  flag: ParsedFeatureFlag,
  user: EvaluationRequest["user"],
  context?: EvaluationRequest["context"],
): Promise<EvaluationResult> {
  const { variants, targetingRules, segments: segmentIds } = flag;
  const bucket = bucketFor(flag.key, user.id);

  for (const rule of targetingRules) {
    if (rule.variantKey == null) continue;
    if (
      matches(
        rule.operator,
        resolveAttribute(rule.attribute, user, context),
        rule.value,
      )
    ) {
      const variant = variants.find((v) => v.key === rule.variantKey);
      if (variant) {
        return {
          variantKey: variant.key,
          value: variant.value,
          reason: `Matched targeting rule: ${rule.attribute} ${rule.operator} ${rule.value}`,
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
        resolveAttribute(rule.attribute, user, context),
        rule.value,
      ),
    );
    if (!eligible) {
      const control = controlVariant(variants);
      return {
        variantKey: control?.key ?? "default",
        value: control?.value ?? null,
        reason: "Outside experiment audience",
      };
    }
  }

  for (const segmentId of segmentIds) {
    const segment = await segmentDAO.findById(segmentId);
    if (!segment) continue;

    const rules = (segment.rules ?? []) as TargetingRule[];
    const allMatched =
      rules.length > 0 &&
      rules.every((rule) =>
        matches(
          rule.operator,
          resolveAttribute(rule.attribute, user, context),
          rule.value,
        ),
      );

    if (allMatched) {
      return weightedVariant(
        variants,
        bucket,
        `Matched segment: ${segment.name}`,
        flag.defaultValue,
      );
    }
  }

  if (flag.rolloutPercentage < 100 && bucket >= flag.rolloutPercentage) {
    const control = controlVariant(variants);
    if (control) {
      return {
        variantKey: control.key,
        value: control.value,
        reason: "Default (outside rollout percentage)",
      };
    }
  }

  return weightedVariant(
    variants,
    bucket,
    "Weighted random assignment",
    flag.defaultValue,
  );
}

export async function evaluateWithAssignment(
  flag: ParsedFeatureFlag,
  user: EvaluationRequest["user"],
  context?: EvaluationRequest["context"],
): Promise<EvaluationResult & { assignmentId?: string }> {
  if (!flag.experiment?.enabled) {
    return await evaluateFlag(flag, user, context);
  }

  const existing = await experimentAssignmentDAO.findByFlagAndUser(
    flag.id,
    user.id,
  );
  if (existing) {
    const variant = flag.variants.find((v) => v.key === existing.variantKey);
    if (variant) {
      return {
        variantKey: variant.key,
        value: variant.value,
        reason: "Stored assignment",
        assignmentId: existing.id,
      };
    }
    return {
      variantKey: existing.variantKey,
      value: null,
      reason: "Stored assignment (variant removed)",
      assignmentId: existing.id,
    };
  }

  const result = await evaluateFlag(flag, user, context);
  const created = await experimentAssignmentDAO.create({
    flagId: flag.id,
    userId: user.id,
    variantKey: result.variantKey,
    context: JSON.stringify(context ?? {}),
  });
  if (created.variantKey !== result.variantKey) {
    const variant = flag.variants.find((v) => v.key === created.variantKey);
    return {
      variantKey: created.variantKey,
      value: variant?.value ?? null,
      reason: "Stored assignment",
      assignmentId: created.id,
    };
  }
  return { ...result, assignmentId: created.id };
}

export const evaluationRoutes = new Elysia({ prefix: "api/sentry/flags" })
  .post(
    "/evaluate",
    async ({ body, request }) => {
      const app = await requireDsnKey(request);
      const scope = scopeOf(app);
      const evaluations = await Promise.all(
        body.flags.map(async (flagKey): Promise<EvaluationItem> => {
          const flag = await featureFlagDAO.findByKeyForScope(flagKey, scope);
          if (!flag)
            return {
              flagKey,
              variantKey: "default",
              value: null,
              reason: "Feature flag not found",
              errorCode: "FLAG_NOT_FOUND",
            };
          const control = controlVariant(flag.variants as FeatureFlagVariant[]);
          if (flag.status !== "active")
            return {
              flagKey,
              variantKey: control?.key ?? "default",
              value: control?.value ?? null,
              reason: `Flag is ${flag.status}, returning default`,
              errorCode: null,
            };
          return {
            flagKey,
            ...(await evaluateWithAssignment(flag, body.user, body.context)),
            errorCode: null,
          };
        }),
      );
      return { evaluations, evaluatedAt: new Date().toISOString() };
    },
    {
      body: arktype({
        user: {
          id: "string >= 1",
          email: "string?",
          name: "string?",
          custom: "Record<string, unknown>?",
        },
        context: "Record<string, unknown>?",
        flags: "string[] >= 1",
      }),
    },
  )
  .post(
    "/experiment/track",
    async ({ body, request }) => {
      const app = await requireDsnKey(request);
      const flag = await featureFlagDAO.findByKeyForScope(
        body.flagKey,
        scopeOf(app),
      );
      if (!flag) throw notFound("Feature flag", body.flagKey);
      const assignment = await experimentAssignmentDAO.findByFlagAndUser(
        flag.id,
        body.userId,
      );
      if (!assignment)
        throw badRequest(`No assignment for user: ${body.userId}`);
      const value = body.value ?? 1;
      const pause = (flag.experiment?.guardrailMetrics ?? []).some(
        (guardrail) =>
          guardrail.metric === body.metric &&
          guardrail.action === "pause" &&
          value > guardrail.threshold,
      );
      // The metric row and the auto-pause are one unit: a crash between
      // them would leave a breaching metric with the flag still active.
      const paused = await db.transaction(async (tx) => {
        await experimentMetricDAO.record(
          {
            flagId: flag.id,
            variantKey: assignment.variantKey,
            userId: body.userId,
            metricName: body.metric,
            value,
          },
          tx,
        );
        if (!pause) return null;
        return featureFlagDAO.updateOrThrow(
          flag.id,
          { status: "paused", updatedAt: new Date().toISOString() },
          tx,
        );
      });
      if (paused) {
        await publishFlagChange({
          type: "status",
          flagKey: paused.key,
          flag: paused,
        });
      }
      return {
        success: true,
        flagKey: body.flagKey,
        variantKey: assignment.variantKey,
        assignmentId: assignment.id,
      };
    },
    {
      body: arktype({
        flagKey: "string",
        userId: "string",
        metric: "string",
        value: "number?",
      }),
    },
  );
