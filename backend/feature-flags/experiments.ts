import { Elysia } from "elysia";
import { type as arktype } from "arktype";
import { featureFlagDAO } from "db/dao/feature-flags";
import { experimentAssignmentDAO } from "db/dao/experiment-assignments";
import { badRequest, notFound } from "backend/errors";
import { computeResults } from "./service";
import { publishFlagChange } from "./events";
import type { FeatureFlagVariant } from "backend/protocol/feature-flags";
import { resolveAdminId } from "../auth";

// ── oidc surface: the admin reads and writes ─────────────
export const experimentRoutes = new Elysia({ prefix: "/api/admin/experiments" })
  .resolve(resolveAdminId)
  .post(
    "/:flagId/start",
    async ({ params: { flagId } }) => {
      const flag = await featureFlagDAO.findByIdOrThrow(flagId);
      const updated = await featureFlagDAO.updateOrThrow(flagId, {
        experiment: JSON.stringify({
          ...(flag.experiment ?? { enabled: false }),
          status: "running",
        }),
        updatedAt: new Date().toISOString(),
      });
      await publishFlagChange({
        type: "status",
        flagKey: updated.key,
        flag: updated,
      });
      return updated;
    },
    { params: arktype({ flagId: "string.uuid" }) },
  )
  .post(
    "/:flagId/stop",
    async ({ params: { flagId } }) => {
      const flag = await featureFlagDAO.findByIdOrThrow(flagId);
      const updated = await featureFlagDAO.updateOrThrow(flagId, {
        experiment: JSON.stringify({
          ...(flag.experiment ?? { enabled: false }),
          status: "completed",
        }),
        updatedAt: new Date().toISOString(),
      });
      await publishFlagChange({
        type: "status",
        flagKey: updated.key,
        flag: updated,
      });
      return updated;
    },
    { params: arktype({ flagId: "string.uuid" }) },
  )
  .post(
    "/:flagId/promote",
    async ({ params: { flagId } }) => {
      const flag = await featureFlagDAO.findByIdOrThrow(flagId);
      const { recommendation } = await computeResults(flag);
      if (!recommendation.winner)
        throw badRequest("No significant winner to promote yet");
      const winnerKey = recommendation.winner;
      const variants = (flag.variants as FeatureFlagVariant[]).map(
        (variant) => ({
          ...variant,
          weight: variant.key === winnerKey ? 100 : 0,
        }),
      );
      const updated = await featureFlagDAO.updateOrThrow(flagId, {
        variants: JSON.stringify(variants),
        defaultValue: String(
          variants.find((variant) => variant.key === winnerKey)?.value ?? "",
        ),
        rolloutPercentage: 100,
        updatedAt: new Date().toISOString(),
      });
      await publishFlagChange({
        type: "update",
        flagKey: updated.key,
        flag: updated,
      });
      return updated;
    },
    { params: arktype({ flagId: "string.uuid" }) },
  )
  // The experiment Results Dashboard read: per-variant participants,
  // conversions, Wilson confidence interval and z-test p-value, plus the
  // recommendation. Admin-only: the participant data is not public.
  .get(
    "/:flagId/results",
    async ({ params: { flagId } }) =>
      computeResults(await featureFlagDAO.findByIdOrThrow(flagId)),
    { params: arktype({ flagId: "string.uuid" }) },
  )
  .get(
    "/:flagId/users",
    async ({ params: { flagId }, query }) => {
      const flag = await featureFlagDAO.findByIdOrThrow(flagId);
      const [{ data }, counts] = await Promise.all([
        experimentAssignmentDAO.listByFlag(flag.id, {
          cursor: query.cursor,
          limit: query.limit,
          variantKey: query.variantKey,
          search: query.search,
        }),
        experimentAssignmentDAO.countByVariant(flag.id),
      ]);
      const variants = Object.fromEntries(
        (flag.variants as FeatureFlagVariant[]).map((variant) => [
          variant.key,
          {
            userCount:
              counts.find((row) => row.variantKey === variant.key)?.count ?? 0,
            users: data
              .filter((assignment) => assignment.variantKey === variant.key)
              .map((assignment) => ({
                id: assignment.userId,
                variantKey: assignment.variantKey,
                assignedAt: assignment.assignedAt,
                context: assignment.context,
              })),
          },
        ]),
      );
      return { featureFlagId: flag.id, variants };
    },
    {
      params: arktype({ flagId: "string.uuid" }),
      query: arktype({
        cursor: "string?",
        limit: "string.integer.parse?",
        variantKey: "string?",
        search: "string?",
      }),
    },
  )
  .get(
    "/:flagId/users/:userId",
    async ({ params: { flagId, userId } }) => {
      const flag = await featureFlagDAO.findByIdOrThrow(flagId);
      const assignment = await experimentAssignmentDAO.findByFlagAndUser(
        flag.id,
        userId,
      );
      if (!assignment) throw notFound("Assignment for user", userId);
      const variant = (flag.variants as FeatureFlagVariant[]).find(
        (entry) => entry.key === assignment.variantKey,
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
    { params: arktype({ flagId: "string.uuid", userId: "string" }) },
  );
