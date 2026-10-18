import { Elysia } from "elysia";
import { type } from "arktype";
import { featureFlagDAO } from "../../db/dao/feature-flags.ts";
import { segmentDAO } from "../../db/dao/segments.ts";
import { experimentAssignmentDAO } from "../../db/dao/experiment-assignments.ts";
import { experimentMetricDAO } from "../../db/dao/experiment-metrics.ts";

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

function weightedVariant(variants: Array<{ key: string; name: string; value: unknown; weight: number }>, bucket: number, reason: string) {
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

function controlVariant(variants: Array<{ key: string; name: string; value: unknown; weight: number }>) {
  return variants.find((v) => v.key === "control") ?? variants[0];
}

async function evaluateFlag(flag: any, user: any, context?: any): Promise<{ variantKey: string; value: unknown; reason: string }> {
  const { variants, targetingRules, segments: segmentIds, rolloutPercentage } = flag;
  const bucket = bucketFor(flag.key, user.id);

  for (const rule of targetingRules) {
    if (rule.variantKey == null) continue;
    if (matches(rule.operator, resolveAttribute(rule.attribute, user, context), rule.value)) {
      const variant = variants.find((v: any) => v.key === rule.variantKey);
      if (variant) {
        return { variantKey: variant.key, value: variant.value, reason: `Matched targeting rule: ${rule.attribute} ${rule.operator} ${rule.value}` };
      }
    }
  }

  const eligibilityRules = targetingRules.filter((rule: any) => rule.variantKey == null);
  if (eligibilityRules.length > 0) {
    const eligible = eligibilityRules.some((rule: any) =>
      matches(rule.operator, resolveAttribute(rule.attribute, user, context), rule.value)
    );
    if (!eligible) {
      const control = controlVariant(variants);
      return { variantKey: control?.key ?? "default", value: control?.value ?? null, reason: "Outside experiment audience" };
    }
  }

  for (const segmentId of segmentIds) {
    const segment = await segmentDAO.findById(segmentId);
    if (!segment) continue;

    const rules = (segment.rules ?? []) as any[];
    const allMatched = rules.every((rule: any) =>
      matches(rule.operator, resolveAttribute(rule.attribute, user, context), rule.value)
    );

    if (allMatched) {
      return weightedVariant(variants, bucket, `Matched segment: ${segment.name}`);
    }
  }

  if (rolloutPercentage < 100 && bucket >= rolloutPercentage) {
    const control = controlVariant(variants);
    if (control) {
      return { variantKey: control.key, value: control.value, reason: "Default (outside rollout percentage)" };
    }
  }

  return weightedVariant(variants, bucket, "Weighted random assignment");
}

async function evaluateWithAssignment(flag: any, user: any, context?: any) {
  if (!flag.experiment?.enabled) {
    return await evaluateFlag(flag, user, context);
  }

  const existing = await experimentAssignmentDAO.findByFlagAndUser(flag.id, user.id);
  if (existing) {
    const variant = flag.variants.find((v: any) => v.key === existing.variantKey);
    if (variant) {
      return { variantKey: variant.key, value: variant.value, reason: "Stored assignment", assignmentId: existing.id };
    }
    return { variantKey: existing.variantKey, value: null, reason: "Stored assignment (variant removed)", assignmentId: existing.id };
  }

  const result = await evaluateFlag(flag, user, context);
  const created = await experimentAssignmentDAO.create({ flagId: flag.id, userId: user.id, variantKey: result.variantKey, context: JSON.stringify(context ?? {}) });
  if (created.variantKey !== result.variantKey) {
    const variant = flag.variants.find((v: any) => v.key === created.variantKey);
    return { variantKey: created.variantKey, value: variant?.value ?? null, reason: "Stored assignment", assignmentId: created.id };
  }
  return { ...result, assignmentId: created.id };
}

function toEvaluationItem(flagKey: string, result: any) {
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
          const variants = flag.variants;
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

        evaluations.push(toEvaluationItem(flagKey, await evaluateWithAssignment(flag, body.user, body.context)));
      }

      return { evaluations, evaluatedAt: new Date().toISOString() };
    },
    {
      body: type({
        user: { id: "string", email: "string?", name: "string?", custom: "Record<string, unknown>?" },
        context: "Record<string, unknown>?",
        flags: "string[]",
      }),
    }
  )
  .post(
    "/experiment/track",
    async ({ body }) => {
      const flag = await featureFlagDAO.findByKeyOrThrow(body.flagKey);

      const assignment = await experimentAssignmentDAO.findByFlagAndUser(flag.id, body.userId);
      if (!assignment) {
        throw new Error(`No assignment for user: ${body.userId}`);
      }

      await experimentMetricDAO.record({
        flagId: flag.id,
        variantKey: assignment.variantKey,
        userId: body.userId,
        metricName: body.metric,
        value: body.value ?? 1,
      });

      const pauseTriggered = (flag.experiment?.guardrailMetrics ?? []).some(
        (guardrail: any) =>
          guardrail.metric === body.metric &&
          guardrail.action === "pause" &&
          body.value != null &&
          body.value > guardrail.threshold
      );

      if (pauseTriggered) {
        await featureFlagDAO.updateOrThrow(flag.id, { status: "paused", updatedAt: new Date().toISOString() });
      }

      return { success: true, flagKey: body.flagKey, variantKey: assignment.variantKey, assignmentId: assignment.id };
    },
    { body: type({ flagKey: "string", userId: "string", metric: "string", value: "number?" }) }
  )
  .get(
    "/stream",
    async ({ query: { flags } }) => {
      const flagKeys = flags?.split(",").map((key: string) => key.trim()).filter(Boolean) ?? null;
      // SSE implementation would go here
      return new Response("SSE stream not fully implemented", { status: 501 });
    },
    { query: type({ flags: "string?" }) }
  );