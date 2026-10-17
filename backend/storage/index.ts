import { Elysia, file } from "elysia";
import { type as arktype } from "arktype";
import { S3Client } from "bun";
import { mkdir, readdir, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
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

function makeS3Client(config: S3Config): S3Client {
  return new S3Client({
    bucket: config.bucket,
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    ...(config.region ? { region: config.region } : {}),
    ...(config.accessKeyId ? { accessKeyId: config.accessKeyId } : {}),
    ...(config.secretAccessKey ? { secretAccessKey: config.secretAccessKey } : {}),
    ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
  });
}

async function putObjectS3(
  config: S3Config,
  key: string,
  body: string,
): Promise<void> {
  const client = makeS3Client(config);
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

// Writes one JSON object to the configured backend. The backend is not
// reported back: readers resolve keys against the active configuration,
// so switching backends means migrating the objects with them.
export async function putObject(
  key: string,
  body: string,
): Promise<void> {
  const config = readS3Config();
  if (config) {
    await putObjectS3(config, key, body);
    return;
  }

  await putObjectLocal(key, body);
}

// Reads one object back. Keys address the backend active at read time
// (never the one that wrote them); a missing object is `null` rather than
// an error so callers can treat absence as data.
export async function getObjectText(key: string): Promise<string | null> {
  const config = readS3Config();
  if (config) {
    const object = makeS3Client(config).file(key);
    if (!(await object.exists())) return null;
    return await object.text();
  }

  const full = resolveLocalObjectPath(key);
  if (!full) return null;
  const object = Bun.file(full);
  if (!(await object.exists())) return null;
  return await object.text();
}

// Lists object keys under a prefix (one replay's segment directory). Keys
// come back sorted so callers get a deterministic order; the local backend
// skips the temp names an interrupted write may leave behind.
export async function listObjectKeys(
  prefix: string,
  limit = 1000,
): Promise<string[]> {
  const config = readS3Config();
  if (config) {
    const client = makeS3Client(config);
    const keys: string[] = [];
    let continuationToken: string | undefined;
    while (keys.length < limit) {
      const page = await client.list({
        prefix,
        maxKeys: Math.min(1000, limit - keys.length),
        ...(continuationToken ? { continuationToken } : {}),
      });
      for (const object of page.contents ?? []) {
        if (object.key) keys.push(object.key);
      }
      if (!page.isTruncated || !page.nextContinuationToken) break;
      continuationToken = page.nextContinuationToken;
    }
    return keys.sort();
  }

  const root = localStorageDir();
  const directory = resolveLocalObjectPath(prefix);
  if (!directory) return [];

  const keys: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // an absent directory lists as empty
    }
    for (const entry of entries) {
      if (keys.length >= limit) return;
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile() || entry.name.endsWith(".tmp")) continue;
      keys.push(relative(root, full).split(sep).join("/"));
    }
  };

  await walk(directory);
  return keys.sort();
}

// Serves offloaded objects straight from the local storage directory
// (`GET /storage/<key>`, the `key` of an offloaded item payload). Only
// meaningful while the local backend is active: with S3 configured the
// objects live in the bucket and this surface stays off. Guarded like the
// other UI surfaces — open in local dev/test, admin token once
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
