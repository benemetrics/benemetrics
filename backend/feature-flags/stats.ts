export interface VariantStatsInput {
  key: string;
  name: string;
  participants: number;
  conversions: number;
}

export interface VariantStats {
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

export interface Recommendation {
  winner?: string;
  confidence: "high" | "medium" | "low";
  action: "implement" | "continue";
}

const Z_SCORES: Record<number, number> = {
  0.9: 1.645,
  0.95: 1.96,
  0.99: 2.576,
};

function zScoreFor(confidenceLevel: number): number {
  return Z_SCORES[confidenceLevel] ?? 1.96;
}

function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-(z * z) / 2);
  const p =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

export function twoProportionZTest(
  control: VariantStatsInput,
  treatment: VariantStatsInput,
): { z: number; pValue: number } {
  if (control.participants === 0 || treatment.participants === 0) {
    return { z: 0, pValue: 1 };
  }
  const p1 = control.conversions / control.participants;
  const p2 = treatment.conversions / treatment.participants;
  const pooled =
    (control.conversions + treatment.conversions) /
    (control.participants + treatment.participants);
  const se = Math.sqrt(
    pooled *
      (1 - pooled) *
      (1 / control.participants + 1 / treatment.participants),
  );
  if (se === 0) return { z: 0, pValue: 1 };
  const z = (p2 - p1) / se;
  return { z, pValue: 2 * (1 - normalCdf(Math.abs(z))) };
}

export function wilsonInterval(
  conversions: number,
  participants: number,
  confidenceLevel = 0.95,
): [number, number] {
  if (participants === 0) return [0, 0];
  const z = zScoreFor(confidenceLevel);
  const z2 = z * z;
  const p = conversions / participants;
  const denom = 1 + z2 / participants;
  const center = (p + z2 / (2 * participants)) / denom;
  const margin =
    (z * Math.sqrt((p * (1 - p) + z2 / (4 * participants)) / participants)) /
    denom;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

export function buildVariantStats(
  input: VariantStatsInput,
  confidenceLevel = 0.95,
): VariantStats {
  const conversionRate =
    input.participants === 0 ? 0 : input.conversions / input.participants;
  return {
    ...input,
    conversionRate,
    confidenceInterval: wilsonInterval(
      input.conversions,
      input.participants,
      confidenceLevel,
    ),
  };
}

export function buildRecommendation(
  variants: VariantStats[],
  controlKey: string,
  minimumSampleSize: number,
): Recommendation {
  const control = variants.find((v) => v.key === controlKey);
  const candidates = variants.filter(
    (v) =>
      v.key !== controlKey &&
      v.isSignificant === true &&
      (v.relativeImprovement ?? 0) > 0 &&
      v.participants >= minimumSampleSize,
  );
  if (candidates.length === 0) {
    return { confidence: "low", action: "continue" };
  }
  const winner = candidates.reduce((best, v) =>
    (v.relativeImprovement ?? 0) > (best.relativeImprovement ?? 0) ? v : best,
  );
  return {
    winner: winner.key,
    confidence: (winner.pValue ?? 1) < 0.01 ? "high" : "medium",
    action: "implement",
  };
}
