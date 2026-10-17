import { Elysia } from "elysia";
import { badRequest } from "backend/errors";
import { type as arktype } from "arktype";
import { featureFlagDAO } from "db/dao/feature-flags";
import { computeResults } from "backend/experiments/service";
import { publishFlagChange } from "backend/flags-events";
import type { ExperimentConfig, FeatureFlagVariant } from "backend/protocol/dsn";

async function updateExperimentStatus(
  flagId: string,
  status: NonNullable<ExperimentConfig["status"]>,
) {
  const flag = await featureFlagDAO.findByIdOrThrow(flagId);
  const experiment = flag.experiment ?? { enabled: false };
  const updated = await featureFlagDAO.updateOrThrow(flagId, {
    experiment: JSON.stringify({ ...experiment, status }),
    updatedAt: new Date().toISOString(),
  });
  publishFlagChange({ type: "status", flagKey: updated.key, flag: updated });
  return updated;
}

export const experimentRoutes = new Elysia({ prefix: "experiments" })
  .post(
    "/:flagId/start",
    async ({ params: { flagId } }) =>
      updateExperimentStatus(flagId, "running"),
    { params: arktype({ flagId: "string.uuid" }) },
  )
  .post(
    "/:flagId/stop",
    async ({ params: { flagId } }) =>
      updateExperimentStatus(flagId, "completed"),
    { params: arktype({ flagId: "string.uuid" }) },
  )
  .post(
    "/:flagId/promote",
    async ({ params: { flagId } }) => {
      const flag = await featureFlagDAO.findByIdOrThrow(flagId);
      const results = await computeResults(flag);

      if (!results.recommendation.winner) {
        throw badRequest("No significant winner to promote yet");
      }

      const winnerKey = results.recommendation.winner;
      const variants = (flag.variants as FeatureFlagVariant[]).map((variant) => ({
        ...variant,
        weight: variant.key === winnerKey ? 100 : 0,
      }));
      const winner = variants.find((v) => v.key === winnerKey);

      const updated = await featureFlagDAO.updateOrThrow(flagId, {
        variants: JSON.stringify(variants),
        defaultValue: String(winner?.value ?? ""),
        rolloutPercentage: 100,
        updatedAt: new Date().toISOString(),
      });
      publishFlagChange({ type: "update", flagKey: updated.key, flag: updated });
      return updated;
    },
    { params: arktype({ flagId: "string.uuid" }) },
  );
