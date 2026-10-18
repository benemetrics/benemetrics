import { Elysia } from "elysia";
import { type } from "arktype";
import { eventsStore } from "../events-store.ts";
import { requireReadAccess, scopedViewFor } from "../permissions.ts";
import { notFound } from "../errors.ts";

function adminAuthEnforced() { return !!process.env.ADMIN_TOKEN || !!process.env.OIDC_ISSUER || !!process.env.OAUTH_ISSUER || process.env.NODE_ENV === "production"; }

export const eventsRoutes = new Elysia({ prefix: "events" })
  .onBeforeHandle(async ({ request }) => {
    if (!adminAuthEnforced()) return;
    await requireReadAccess(request);
  })
  .get(
    "/",
    async ({ query, request }) => {
      const view = await scopedViewFor(request);
      const projectId = view?.projectIds.size === 1 ? Array.from(view.projectIds)[0] : query.projectId;
      const appId = view?.appIds.size === 1 ? Array.from(view.appIds)[0] : query.appId;

      const result = await eventsStore.list({ projectId, appId, page: query.page, limit: query.limit });
      return result;
    },
    { query: type({ projectId: "string.uuid?", environmentId: "string.uuid?", appId: "string.uuid?", page: "string.integer.parse?", limit: "string.integer.parse?" }) }
  )
  .get(
    "/:eventId",
    async ({ params: { eventId }, request }) => {
      const view = await scopedViewFor(request);
      const event = await eventsStore.get(eventId);
      if (!event) throw notFound("Event", eventId);
      if (view && !view.appIds.has(event.appId)) throw notFound("Event", eventId);
      return event;
    },
    { params: type({ eventId: "string" }) }
  );