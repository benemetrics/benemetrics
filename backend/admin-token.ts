// The admin credential: in-memory only, generated on first use, rotated
// daily by the Elysia cron in backend/index.ts. Fetched on every request so
// an in-flight rotation never serves a stale value.
let adminToken: string | undefined;

export function currentAdminToken(): string {
  if (!adminToken) adminToken = crypto.randomUUID();
  return adminToken;
}

export function rotateAdminToken(): string {
  adminToken = crypto.randomUUID();
  return adminToken;
}
