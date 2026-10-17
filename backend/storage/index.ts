import { Elysia, file } from "elysia";
import { type as arktype } from "arktype";
import { S3Client } from "bun";
import { mkdir, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { adminAuthEnforced, validateAdminAuth } from "../auth";
import { notFound, unauthorized } from "../errors";

// Object storage holds the large envelope items that would otherwise be
// duplicated in Postgres (`envelope_items` + `raw`) and in the
// best-effort ClickHouse copy — today the replay recording segments.
// Two interchangeable backends:
//
// - an S3-compatible service, used whenever `S3_BUCKET` is configured
//   (Bun's native S3 client; `S3_*` env vars with `AWS_*` fallbacks);
// - a directory on local disk (`LOCAL_STORAGE_DIR`, default `./.storage`)
//   otherwise, so recordings never sit in Postgres even without S3 and
//   can be fetched back over HTTP via `storageRoutes` below.
//
// The write path never decides failure policy; callers
// (backend/events/offload.ts) keep the payload inline when a write throws.

export type StorageBackend = "s3" | "local";

interface S3Config {
  bucket: string;
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
}

// Bun falls back from S3_* to AWS_* env vars; mirror that here so the
// explicit client below sees the same configuration.
function readS3Config(): S3Config | null {
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

// Storage configuration is read per call (not at module load) so the
// backend switches without process restarts and tests can point it at a
// stub endpoint or a temp directory.
export function activeStorageBackend(): StorageBackend {
  return readS3Config() ? "s3" : "local";
}

export function localStorageDir(): string {
  return resolve(process.env.LOCAL_STORAGE_DIR || "./.storage");
}

// Resolves an object key below the local storage directory; null when the
// key would escape it (or is empty). Keys are built from sanitized ids,
// but never trust them with paths — the HTTP route uses this too.
export function resolveLocalObjectPath(key: string): string | null {
  const root = localStorageDir();
  const full = resolve(root, key);
  const relativePath = relative(root, full);
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return null;
  }
  return full;
}

async function putObjectS3(
  config: S3Config,
  key: string,
  body: string,
): Promise<void> {
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

async function putObjectLocal(key: string, body: string): Promise<void> {
  const full = resolveLocalObjectPath(key);
  if (!full) {
    throw new Error(`Object key escapes the local storage directory: ${key}`);
  }

  await mkdir(dirname(full), { recursive: true });

  // Keys are write-once; write to a temp name and rename so a crash or a
  // concurrent reader never sees a truncated object under the final key.
  const temporary = `${full}.${crypto.randomUUID()}.tmp`;
  try {
    await Bun.write(temporary, body);
    await rename(temporary, full);
  } catch (err) {
    await unlink(temporary).catch(() => {});
    throw err;
  }
}

// Writes one JSON object and reports the backend that accepted it so the
// caller can record it in the stored pointer.
export async function putObject(
  key: string,
  body: string,
): Promise<StorageBackend> {
  const config = readS3Config();
  if (config) {
    await putObjectS3(config, key, body);
    return "s3";
  }

  await putObjectLocal(key, body);
  return "local";
}

// Serves offloaded objects straight from the local storage directory
// (`GET /storage/<key>`, the `key` of a `{ storage: "local" }` pointer).
// Only meaningful while the local backend is active: with S3 configured
// the objects live in the bucket and this surface stays off. Guarded like
// the other UI surfaces — open in local dev/test, admin token once
// `adminAuthEnforced()`.
export const storageRoutes = new Elysia({ prefix: "storage" })
  .onBeforeHandle(({ request }) => {
    if (!adminAuthEnforced()) return;
    const auth = validateAdminAuth(request);
    if (!auth.valid) {
      throw unauthorized(auth.error);
    }
  })
  .get(
    "/*",
    async ({ params }) => {
      const key = params["*"];
      if (activeStorageBackend() !== "local") {
        throw notFound("Stored object", key);
      }

      const objectPath = resolveLocalObjectPath(key);
      if (!objectPath || !(await Bun.file(objectPath).exists())) {
        throw notFound("Stored object", key);
      }

      return file(objectPath);
    },
    { params: arktype({ "*": "string" }) },
  );
