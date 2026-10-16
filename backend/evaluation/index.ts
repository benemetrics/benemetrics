import { Elysia } from "elysia";
import { badRequest, notFound } from "backend/errors";
import { type as arktype } from "arktype";
import type {
  EvaluationRequest,
  EvaluationResponse,
  EvaluationItem,
  FeatureFlagVariant,
  TargetingRule,
} from "../protocol/dsn";
import { featureFlagDAO } from "db/dao/feature-flags";
import { segmentDAO } from "db/dao/segments";
import { experimentAssignmentDAO } from "db/dao/experiment-assignments";
import { experimentMetricDAO } from "db/dao/experiment-metrics";
import { computeResults, type ParsedFeatureFlag } from "backend/experiments/service";

export type { ParsedFeatureFlag } from "backend/experiments/service";

type EvaluationResult = { variantKey: string; value: unknown; reason: string };

type ParsedSegment = { name: string; rules: TargetingRule[] };

function resolveAttribute(attribute: string, user: unknown, context: unknown): unknown {
  const [root, ...path] = attribute.split(".");
  let value: unknown = root === "user" ? user : root === "context" ? context : undefined;

  for (const key of path) {
    if (typeof value !== "object" || value === null) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function matches(operator: string, userValue: unknown, ruleValue: unknown): boolean {
  switch (operator) {
    case "equals": return userValue === ruleValue;
    case "not_equals": return userValue !== ruleValue;
    case "contains": return String(userValue).includes(String(ruleValue));
    case "not_contains": return !String(userValue).includes(String(ruleValue));
    case "starts_with": return String(userValue).startsWith(String(ruleValue));
    case "ends_with": return String(userValue).endsWith(String(ruleValue));
    case "in": return Array.isArray(ruleValue) && ruleValue.includes(userValue);
    case "not_in": return Array.isArray(ruleValue) && !ruleValue.includes(userValue);
    case "greater_than": return Number(userValue) > Number(ruleValue);
    case "less_than": return Number(userValue) < Number(ruleValue);
    case "greater_than_or_equal": return Number(userValue) >= Number(ruleValue);
    case "less_than_or_equal": return Number(userValue) <= Number(ruleValue);
    default: return false;
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

function weightedVariant(variants: FeatureFlagVariant[], bucket: number, reason: string): EvaluationResult {
  let cumulative = 0;
  for (const variant of variants) {
    cumulative += variant.weight;
    if (bucket < cumulative) {
      return { variantKey: variant.key, value: variant.value, reason };
    }
  }
  const fallback = variants[0];
  return fallback
    ? { variantKey: fallback.key, value: fallback.value, reason }
    : { variantKey: "default", value: null, reason: "No variants configured" };
}

export function controlVariant(variants: FeatureFlagVariant[]): FeatureFlagVariant | undefined {
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
    if (matches(rule.operator, resolveAttribute(rule.attribute, user, context), rule.value)) {
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

  const eligibilityRules = targetingRules.filter((rule) => rule.variantKey == null);
  if (eligibilityRules.length > 0) {
    const eligible = eligibilityRules.some((rule) =>
      matches(rule.operator, resolveAttribute(rule.attribute, user, context), rule.value),
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
    const allMatched = rules.every((rule) =>
      matches(rule.operator, resolveAttribute(rule.attribute, user, context), rule.value),
    );

    if (allMatched) {
      return weightedVariant(variants, bucket, `Matched segment: ${segment.name}`);
    }
  }

  if (flag.rolloutPercentage < 100 && bucket >= flag.rolloutPercentage) {
    const control = controlVariant(variants);
    if (control) {
      return { variantKey: control.key, value: control.value, reason: "Default (outside rollout percentage)" };
    }
  }

  return weightedVariant(variants, bucket, "Weighted random assignment");
}

export async function evaluateWithAssignment(
  flag: ParsedFeatureFlag,
  user: EvaluationRequest["user"],
  context?: EvaluationRequest["context"],
): Promise<EvaluationResult & { assignmentId?: string }> {
  if (!flag.experiment?.enabled) {
    return await evaluateFlag(flag, user, context);
  }

  const existing = await experimentAssignmentDAO.findByFlagAndUser(flag.id, user.id);
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
    // The stored variant was removed from the flag: keep the user's
    // stable assignment rather than inserting a duplicate row.
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
    // A concurrent evaluation won the race: report the stored one.
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

function toEvaluationItem(
  flagKey: string,
  result: EvaluationResult & { assignmentId?: string },
): EvaluationItem {
  return { flagKey, ...result, errorCode: null };
}

export const evaluationRoutes = new Elysia({ prefix: "api/sentry/flags" })
  .post(
    "/evaluate",
    async ({ body }) => {
      const evaluations = [];

      for (const flagKey of body.flags) {
        const flag = await featureFlagDAO.findByKey(flagKey);
        if (!flag) {
          evaluations.push({
            flagKey,
            variantKey: "default",
            value: null,
            reason: "Feature flag not found",
            errorCode: "FLAG_NOT_FOUND",
          });
          continue;
        }

        if (flag.status !== "active") {
          const variants = flag.variants as FeatureFlagVariant[];
          const control = controlVariant(variants);
          evaluations.push({
            flagKey,
            variantKey: control?.key ?? "default",
            value: control?.value ?? null,
            reason: `Flag is ${flag.status}, returning default`,
            errorCode: null,
          });
          continue;
        }

        evaluations.push(
          toEvaluationItem(
            flagKey,
            await evaluateWithAssignment(flag, body.user, body.context),
          ),
        );
      }

      const response: EvaluationResponse = {
        evaluations,
        evaluatedAt: new Date().toISOString(),
      };

      return response;
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
    async ({ body }) => {
      const flag = await featureFlagDAO.findByKeyOrThrow(body.flagKey);

      const assignment = await experimentAssignmentDAO.findByFlagAndUser(flag.id, body.userId);
      if (!assignment) {
        throw badRequest(`No assignment for user: ${body.userId}`);
      }

      await experimentMetricDAO.record({
        flagId: flag.id,
        variantKey: assignment.variantKey,
        userId: body.userId,
        metricName: body.metric,
        value: body.value ?? 1,
      });

      const pauseTriggered = (flag.experiment?.guardrailMetrics ?? []).some(
        (guardrail) =>
          guardrail.metric === body.metric &&
          guardrail.action === "pause" &&
          body.value != null &&
          body.value > guardrail.threshold,
      );
      if (pauseTriggered) {
        await featureFlagDAO.updateOrThrow(flag.id, {
          status: "paused",
          updatedBy: "experiment-guardrail",
          updatedAt: new Date().toISOString(),
        });
      }

      return { success: true, flagKey: body.flagKey, variantKey: assignment.variantKey, assignmentId: assignment.id };
    },
    {
      body: arktype({
        flagKey: "string",
        userId: "string",
        metric: "string",
        value: "number?",
      }),
    },
  )
  .get(
    "/:id/experiment/results",
    async ({ params: { id } }) => {
      const flag = await featureFlagDAO.findByIdOrThrow(id);
      return computeResults(flag);
    },
    { params: arktype({ id: "string.uuid" }) },
  )
  .get(
    "/:id/users",
    async ({ params: { id }, query: { page = 1, limit = 20, variantKey, search } }) => {
      const flag = await featureFlagDAO.findByIdOrThrow(id);
      const { total, data } = await experimentAssignmentDAO.listByFlag(flag.id, {
        page,
        limit,
        variantKey,
        search,
      });
      const counts = await experimentAssignmentDAO.countByVariant(flag.id);

      const variants: Record<string, { userCount: number; users: unknown[] }> = {};
      for (const variant of flag.variants as FeatureFlagVariant[]) {
        const pageItems = data
          .filter((assignment) => assignment.variantKey === variant.key)
          .map((assignment) => ({
            id: assignment.userId,
            variantKey: assignment.variantKey,
            assignedAt: assignment.assignedAt,
            context: assignment.context,
          }));
        variants[variant.key] = {
          userCount: counts.find((row) => row.variantKey === variant.key)?.count ?? 0,
          users: pageItems,
        };
      }

      return {
        featureFlagId: flag.id,
        variants,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    },
    {
      params: arktype({ id: "string.uuid" }),
      query: arktype({
        page: "string.integer.parse?",
        limit: "string.integer.parse?",
        variantKey: "string?",
        search: "string?",
      }),
    },
  )
  .get(
    "/:id/user/:userId",
    async ({ params: { id, userId } }) => {
      const flag = await featureFlagDAO.findByIdOrThrow(id);
      const assignment = await experimentAssignmentDAO.findByFlagAndUser(flag.id, userId);
      if (!assignment) {
        throw notFound("Assignment for user", userId);
      }
      const variant = (flag.variants as FeatureFlagVariant[]).find(
        (v) => v.key === assignment.variantKey,
      );
      return {
        featureFlagId: flag.id,
        userId,
        variantKey: assignment.variantKey,
        variantValue: variant?.value ?? null,
        reason: "Stored assignment",
        evaluatedAt: assignment.assignedAt,
      };
    },
    { params: arktype({ id: "string.uuid", userId: "string" }) },
  );
