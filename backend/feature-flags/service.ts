import type {
  ExperimentConfig,
  ExperimentResults,
  FeatureFlagVariant,
  TargetingRule,
} from "backend/protocol/feature-flags";
import type { FeatureFlag } from "db/schema/feature-flags";
import { experimentAssignmentDAO } from "db/dao/experiment-assignments";
import { experimentMetricDAO } from "db/dao/experiment-metrics";
import {
  buildRecommendation,
  buildVariantStats,
  twoProportionZTest,
} from "./stats";

export type ParsedFeatureFlag = Omit<
  FeatureFlag,
  "variants" | "targetingRules" | "segments" | "experiment"
> & {
  variants: FeatureFlagVariant[];
  targetingRules: TargetingRule[];
  segments: string[];
  experiment: ExperimentConfig | null;
};

function controlKeyOf(variants: FeatureFlagVariant[]): string {
  const control = variants.find((v) => v.key === "control") ?? variants[0];
  return control?.key ?? "control";
}

export async function computeResults(
  flag: ParsedFeatureFlag,
): Promise<ExperimentResults> {
  const experiment = flag.experiment ?? { enabled: false };
  const confidenceLevel = experiment.confidenceLevel ?? 0.95;
  const minimumSampleSize = experiment.minimumSampleSize ?? 0;
  const primaryMetric = experiment.primaryMetric ?? "conversion";

  const [participants, conversions] = await Promise.all([
    experimentAssignmentDAO.countByVariant(flag.id),
    experimentMetricDAO.countByVariant(flag.id, primaryMetric),
  ]);

  const participantMap = new Map(
    participants.map((row) => [row.variantKey, row.count]),
  );
  const conversionMap = new Map(
    conversions.map((row) => [row.variantKey, row.count]),
  );

  const controlKey = controlKeyOf(flag.variants);
  const variantInputs = flag.variants.map((variant) => ({
    key: variant.key,
    name: variant.name,
    participants: participantMap.get(variant.key) ?? 0,
    conversions: conversionMap.get(variant.key) ?? 0,
  }));

  const controlInput =
    variantInputs.find((v) => v.key === controlKey) ?? variantInputs[0];
  const stats = variantInputs.map((input) =>
    buildVariantStats(input, confidenceLevel),
  );

  for (const stat of stats) {
    if (stat.key === controlKey || !controlInput) continue;
    const { pValue } = twoProportionZTest(controlInput, stat);
    stat.pValue = pValue;
    stat.isSignificant = pValue < 1 - confidenceLevel;
    const controlRate =
      controlInput.participants === 0
        ? 0
        : controlInput.conversions / controlInput.participants;
    stat.relativeImprovement =
      controlRate === 0
        ? stat.conversionRate > 0
          ? 1
          : 0
        : (stat.conversionRate - controlRate) / controlRate;
  }

  return {
    featureFlagId: flag.id,
    experiment: {
      enabled: experiment.enabled,
      hypothesis: experiment.hypothesis,
      primaryMetric,
      status: experiment.status ?? "running",
    },
    variants: stats,
    recommendation: buildRecommendation(stats, controlKey, minimumSampleSize),
  };
}
