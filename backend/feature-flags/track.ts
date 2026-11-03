import { Elysia } from "elysia";
import { type as arktype } from "arktype";
import { badRequest, notFound } from "backend/errors";
import { featureFlagDAO } from "db/dao/feature-flags";
import { db } from "db";
import { experimentAssignmentDAO } from "db/dao/feature-flags/experiment-assignments";
import { experimentMetricDAO } from "db/dao/feature-flags/experiment-metrics";
import { requireDsnKey, scopeOf } from "./dsn";
import { publishFlagChange } from "./events";

// The experiment surface: DSN-guarded metric tracking with guardrail
// auto-pause. OFREP has no metric concept, so this endpoint stays.
export const trackRoutes = new Elysia({ prefix: "api/sentry/flags" }).post(
  "/experiment/track",
  async ({ body, request }) => {
    const app = await requireDsnKey(request);
    const flag = await featureFlagDAO.findByKeyForScope(
      body.flagKey,
      scopeOf(app),
    );
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
    if (!assignment) throw badRequest(`No assignment for user: ${body.userId}`);
    const value = body.value ?? 1;
    const pause = (experiment?.guardrailMetrics ?? []).some(
      (guardrail) =>
        guardrail.metric === body.metric &&
        guardrail.action === "pause" &&
        value > guardrail.threshold,
    );
    // The metric row and the auto-pause are one unit: a crash between
    // them would leave a breaching metric with the flag still active.
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
