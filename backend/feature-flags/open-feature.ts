import { Elysia, sse } from "elysia";
import { type as arktype } from "arktype";
import { badRequest, notFound } from "backend/errors";
import { FLAG_CHANGE_SUBJECT, FLAG_PING, nats } from "../nats";
import { db } from "db";
import { featureFlagDAO } from "db/dao/feature-flags";
import { experimentAssignmentDAO } from "db/dao/feature-flags/experiment-assignments";
import { experimentMetricDAO } from "db/dao/feature-flags/experiment-metrics";
import { segmentDAO } from "db/dao/feature-flags/segments";
import type {
  FeatureFlagVariant,
  OfrepBulkEvaluationSuccess,
  OfrepEvaluationFailure,
  OfrepEvaluationSuccess,
  TargetingRule,
} from "backend/protocol/feature-flags";
import { parseFlag, type ParsedFeatureFlag } from "./service";
import { cron } from '@elysia/cron'

export type { ParsedFeatureFlag } from "./service";

// ── Flag-change event bus ─────────────────────────────────────────────

export interface FlagChangeEvent {
  type: "create" | "update" | "status" | "delete";
  flagKey: string;
  flag?: unknown;
}


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
  reasonDetail: string;
};

function resolveAttribute(
  attribute: string,
  targetingKey: string,
  context: Record<string, unknown> | undefined,
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
      return { variantKey: variant.key, value: variant.value, reason, reasonDetail };
    }
  }
  const fallback = variants[0];
  if (fallback) {
    return { variantKey: fallback.key, value: fallback.value, reason, reasonDetail };
  }
  return { variantKey: "default", value: flag.defaultValue ?? null, reason, reasonDetail };
}

export function controlVariant(
  variants: FeatureFlagVariant[],
): FeatureFlagVariant | undefined {
  return variants.find((v) => v.key === "control") ?? variants[0];
}

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
  context?: Record<string, unknown>,
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
  context?: Record<string, unknown>,
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

/** One flag evaluation in the OFREP wire shape. */
function toEntry(
  flag: ParsedFeatureFlag,
  result: {
    variantKey: string;
    value: unknown;
    reason: OfrepEvaluationSuccess["reason"];
  },
): OfrepEvaluationSuccess {
  return {
    key: flag.key,
    value: result.value,
    reason: result.reason,
    variant: result.variantKey,
    metadata: { flagType: flag.type },
  };
}

function evaluationFailure(
  key: string,
  errorCode: OfrepEvaluationFailure["errorCode"] | "FLAG_NOT_FOUND",
  status: number,
  errorDetails?: string,
): Response {
  return Response.json({ key, errorCode, errorDetails }, { status });
}

async function evaluateOne(
  row: Record<string, unknown>,
  targetingKey: string,
  context?: Record<string, unknown>,
): Promise<OfrepEvaluationSuccess> {
  const flag = parseFlag(row as never);
  if (flag.status !== "active") return toEntry(flag, disabledResult(flag));
  return toEntry(
    flag,
    await evaluateWithAssignment(flag, targetingKey, context as never),
  );
}

/** The configuration ETag plus the latest change timestamp (unix seconds). */
async function scopeState(): Promise<{ etag: string; lastModified: number }> {
  const flags = await featureFlagDAO.listForScope(null);
  const payload = flags
    .map((flag) => `${flag.id}:${flag.status}:${flag.updatedAt}`)
    .sort()
    .join("|");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload),
  );
  const etag = `"${Array.from(new Uint8Array(digest).slice(0, 16))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}"`;
  const lastModified = flags.reduce((max, flag) => {
    const seconds = Math.floor(Date.parse(flag.updatedAt) / 1000);
    return Number.isFinite(seconds) ? Math.max(max, seconds) : max;
  }, 0);
  return { etag, lastModified };
}

function ifNoneMatched(request: Request, etag: string): boolean {
  return !!request.headers
    .get("If-None-Match")
    ?.split(",")
    .some((value) => value.trim().replace(/^W\//, "") === etag);
}

// ── OpenFeature / OFREP evaluation surface (unauthenticated) ──────────

export const openFeatureRoutes = new Elysia({ prefix: "/ofrep/v1" })
  .use(
    cron({
			name: 'heartbeat',
			pattern: '*/20 * * * * *',
			run() {
				nats.publish(FLAG_PING)
			}
		})
  )
  .post(
    "/evaluate/flags/:key",
    async ({ params: { key }, body }) => {
      const row = await featureFlagDAO.findByKeyForScope(key, null);
      if (!row) {
        return evaluationFailure(
          key,
          "FLAG_NOT_FOUND",
          404,
          `Flag '${key}' was not found`,
        );
      }
      const context = body.context ?? {};
      const targetingKey =
        typeof context.targetingKey === "string" ? context.targetingKey : "";
      if (!targetingKey) {
        return evaluationFailure(
          key,
          "TARGETING_KEY_MISSING",
          400,
          "The evaluation context requires a targetingKey",
        );
      }
      return Response.json(
        await evaluateOne(
          row as Record<string, unknown>,
          targetingKey,
          context,
        ),
      );
    },
    {
      params: arktype({ key: "string >= 1" }),
      body: arktype({ context: "Record<string, unknown>?" }),
    },
  )
  .post(
    "/evaluate/flags",
    async ({ body, request, set }) => {
      const context = body.context;
      const targetingKey =
        typeof context?.targetingKey === "string" ? context.targetingKey : "";
      const state = await scopeState();
      if (ifNoneMatched(request, state.etag)) {
        set.status = 304;
        set.headers["ETag"] = state.etag;
        return;
      }
      const rows = await featureFlagDAO.listForScope(null);
      const flags = await Promise.all(
        rows.map((row) =>
          evaluateOne(
            row as Record<string, unknown>,
            targetingKey,
            context,
          ),
        ),
      );
      set.headers["ETag"] = state.etag;
      set.headers["Cache-Control"] = "no-cache";
      const response: OfrepBulkEvaluationSuccess = {
        flags,
        metadata: { version: state.etag },
        eventStreams: [
          {
            type: "sse",
            url: `/ofrep/v1/events`,
            inactivityDelaySec: 120,
          },
        ],
      };
      return response;
    },
    { body: arktype({ context: "Record<string, unknown>?" }) },
  )
  .get(
    "/events",
    async function* () {
      nats.subscribe(FLAG_PING) {
        yield sse({ event: 'PING' });
      }

      nats.subscribe(FLAG_CHANGE_SUBJECT)
      yield sse({
        event: 'refetchEvaluation',
        data: { flagConfigLastModified: new Date().toISOString() },
      });
    },
    {},
  );

// ── Experiment tracking (OFREP has no metric concept; retained separately) ─

export const trackRoutes = new Elysia({ prefix: "api/sentry/flags" }).post(
  "/experiment/track",
  async ({ body }) => {
    const flag = await featureFlagDAO.findByKeyForScope(body.flagKey, null);
    if (!flag) throw notFound("Feature flag", body.flagKey);
    const experiment = flag.experiment
      ? (JSON.parse(flag.experiment) as {
          guardrailMetrics?: Array<{
            metric: string;
            threshold: number;
            action: "pause" | "alert";
          }>;
        })
      : null;
    const assignment = await experimentAssignmentDAO.findByFlagAndUser(
      flag.id,
      body.userId,
    );
    if (!assignment)
      throw badRequest(`No assignment for user: ${body.userId}`);
    const value = body.value ?? 1;
    const pause = (experiment?.guardrailMetrics ?? []).some(
      (guardrail) =>
        guardrail.metric === body.metric &&
        guardrail.action === "pause" &&
        value > guardrail.threshold,
    );
    const paused = await db.transaction(async (tx) => {
      await experimentMetricDAO.record({
        flagId: flag.id,
        variantKey: assignment.variantKey,
        userId: body.userId,
        metricName: body.metric,
        value,
      });
      if (!pause) return null;
      return featureFlagDAO.updateOrThrow(flag.id, {
        status: "paused",
        updatedAt: new Date().toISOString(),
      });
    });
    if (paused) await nats.publish(FLAG_CHANGE_SUBJECT)
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
