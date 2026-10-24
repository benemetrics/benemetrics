import { Elysia } from "elysia";

// The admin credential as global Elysia state: generated at boot, mutated
// in place per request, rotated daily by the cron in backend/index.ts.
export const adminTokenStore = new Elysia({ name: "admin-token" }).state(
  "adminToken",
  crypto.randomUUID() as string,
);
