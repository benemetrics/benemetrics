import { S3Client } from "bun";

// S3-compatible object storage holds the large envelope items that would
// otherwise be duplicated in Postgres (`envelope_items` + `raw`) and in
// the best-effort ClickHouse copy — today the replay recording segments.
// Like ClickHouse it is an optional backend: without `S3_BUCKET` the
// offload is disabled and payloads stay inline. This module never
// decides failure policy; callers (backend/events/offload.ts) keep the
// payload inline when an upload throws.

interface ObjectStoreConfig {
  bucket: string;
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
}

// Bun falls back from S3_* to AWS_* env vars; mirror that here so the
// explicit client below sees the same configuration.
function readConfig(): ObjectStoreConfig | null {
  const bucket = process.env.S3_BUCKET || process.env.AWS_BUCKET;
  if (!bucket) return null;

  return {
    bucket,
    endpoint: process.env.S3_ENDPOINT || process.env.AWS_ENDPOINT,
    region: process.env.S3_REGION || process.env.AWS_REGION,
    accessKeyId: process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey:
      process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.S3_SESSION_TOKEN || process.env.AWS_SESSION_TOKEN,
  };
}

export function isObjectStoreEnabled(): boolean {
  return readConfig() !== null;
}

// Uploads one JSON object. Configuration is read per call (not at module
// load) so the store can be enabled or disabled without process restarts
// and tests can point it at a local endpoint.
export async function putObject(key: string, body: string): Promise<void> {
  const config = readConfig();
  if (!config) {
    throw new Error("Object store is not configured (set S3_BUCKET)");
  }

  const client = new S3Client({
    bucket: config.bucket,
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    ...(config.region ? { region: config.region } : {}),
    ...(config.accessKeyId ? { accessKeyId: config.accessKeyId } : {}),
    ...(config.secretAccessKey ? { secretAccessKey: config.secretAccessKey } : {}),
    ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
  });
  await client.write(key, body, { type: "application/json" });
}
