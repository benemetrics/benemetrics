/**
 * The limiter's knobs, read at call time so a suite can set them per file
 * (the same way the e2e toggles the OIDC env) without a restart.
 *
 * The per-key rate and the notification settings are NOT here: they live in
 * the `rate_limit_settings` row (panel-managed) and the per-app override.
 */

export interface RateLimitConfig {
  /** Per-source bucket (client/unknown class only), events/s. */
  perIpPerSecond: number;
  /** Per-fingerprint bucket (client class only), events/s. */
  perFingerprintPerSecond: number;
  /** Process-wide ingress ceiling, events/s. */
  globalPerSecond: number;
  /** The burst is the rate times these seconds. */
  burstSeconds: number;
  /** The default envelope cap (streamed in `readBody`). */
  maxEnvelopeBytes: number;
  /** The gzip-bomb cap in `readBody`. */
  maxDecompressedBytes: number;
  /** Replaces both caps when an attachment/replay item is declared. */
  maxLargeEnvelopeBytes: number;
  /** The OTLP body cap. */
  maxOtlpBytes: number;
  /** The item-count cap per envelope. */
  maxEnvelopeItems: number;
  /** The item-count cap for replay envelopes. */
  maxReplayItems: number;
  /** The span-count cap per OTLP request. */
  maxOtlpSpans: number;
  /** Read `X-Forwarded-For` / `X-Real-IP` from the proxy. */
  trustProxy: boolean;
  /** How long an auto-block lasts. */
  blockTtlHours: number;
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function boolEnv(name: string): boolean {
  const raw = process.env[name];
  if (raw === undefined) return false;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

const MIB = 1024 * 1024;

export function rateLimitConfig(): RateLimitConfig {
  return {
    perIpPerSecond: numberEnv("INGEST_RATE_LIMIT_PER_IP_PER_SEC", 10),
    perFingerprintPerSecond: numberEnv("INGEST_RATE_LIMIT_PER_FP_PER_SEC", 5),
    globalPerSecond: numberEnv("INGEST_RATE_LIMIT_GLOBAL_PER_SEC", 200),
    burstSeconds: numberEnv("INGEST_RATE_LIMIT_BURST_SECONDS", 2),
    maxEnvelopeBytes: numberEnv("INGEST_MAX_ENVELOPE_BYTES", MIB),
    maxDecompressedBytes: numberEnv("INGEST_MAX_DECOMPRESSED_BYTES", 4 * MIB),
    maxLargeEnvelopeBytes: numberEnv("INGEST_MAX_LARGE_ENVELOPE_BYTES", 20 * MIB),
    maxOtlpBytes: numberEnv("INGEST_MAX_OTLP_BYTES", 4 * MIB),
    maxEnvelopeItems: numberEnv("INGEST_MAX_ENVELOPE_ITEMS", 100),
    maxReplayItems: numberEnv("INGEST_MAX_REPLAY_ITEMS", 500),
    maxOtlpSpans: numberEnv("INGEST_MAX_OTLP_SPANS", 1000),
    trustProxy: boolEnv("TRUST_PROXY"),
    blockTtlHours: numberEnv("INGEST_BLOCK_TTL_HOURS", 24),
  };
}

/** Test hook: the config is read per call, so nothing is cached to reset. */
export function resetRateLimitConfig(): void {
  // Intentionally empty — the knobs are read at call time.
}
