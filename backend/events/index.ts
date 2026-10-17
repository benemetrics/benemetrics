import { Elysia } from "elysia";
import { ApiError, ErrorCode, badRequest, unauthorized } from "backend/errors";
import { type as arktype } from "arktype";
import { appDAO } from "db/dao/project";
import { environmentDAO } from "db/dao/environments";
import type { StoredEvent } from "db/schema/stored-event";
import { adminAuthEnforced, validateAdminAuth, validateAdminToken } from "../auth";
import { publishEvent, type SentryEventMessage } from "../nats";
import { applyEventMessage } from "../events-consumer";
import { listStoredEvents, findStoredEventByIdOrThrow } from "../events-store";
import { addLiveClient, removeLiveClient } from "../live-events";
import { parseEnvelope, parseStoredEnvelope, extractEventId, normalizeTransactionPayload, convertSpanToTransaction } from "./utils";
import { dispatchIngestedEvent, readBody, resolveAuthorizedApp } from "./ingestion";
import { offloadReplayItems } from "./offload";
import { symbolicateEventPayload } from "../source-maps/resolver";

// Symbolication never fails the read.
async function symbolicateBestEffort(
  projectId: string,
  payload: unknown,
): Promise<void> {
  try {
    if (!payload || typeof payload !== "object") return;
    const release = (payload as Record<string, unknown>).release;
    await symbolicateEventPayload(
      projectId,
      typeof release === "string" ? release : null,
      payload as Record<string, unknown>,
    );
  } catch (e) {
    console.error("[source-maps] symbolication failed:", e);
  }
}

async function summarizeStoredEvent(stored: StoredEvent) {
  const parsed = parseStoredEnvelope(stored);
  if (!parsed) {
    return {
      id: stored.id,
      receivedAt: stored.receivedAt,
      itemTypes: [] as string[],
      event: null,
      transaction: null,
      feedback: null,
    };
  }

  const convertedItems = parsed.items.map((item) =>
    item.header.type === "span" ? convertSpanToTransaction(item.header, item.payload) : item,
  );

  const eventItem = convertedItems.find((item) => item.header.type === "event");
  const transactionItem = convertedItems.find((item) => item.header.type === "transaction");
  const feedbackItem = convertedItems.find(
    (item) => item.header.type === "feedback" || item.header.type === "user_feedback",
  );

  const event = eventItem ? normalizeTransactionPayload(eventItem.payload) : null;
  const transaction = transactionItem
    ? normalizeTransactionPayload(transactionItem.payload)
    : null;

  await symbolicateBestEffort(stored.projectId, event);
  await symbolicateBestEffort(stored.projectId, transaction);

  return {
    id: stored.id,
    receivedAt: stored.receivedAt,
    itemTypes: convertedItems.map((item) => item.header.type),
    event,
    transaction,
    feedback: feedbackItem ? feedbackItem.payload : null,
  };
}

export const eventsRoutes = new Elysia({ prefix: "events" })
  // The UI surface is open while running locally without an identity
  // provider; it requires admin credentials in production or once
  // ADMIN_TOKEN / OIDC / OAuth is configured.
  .onBeforeHandle(({ request }) => {
    if (!adminAuthEnforced()) return;
    if (request.headers.get("upgrade")?.toLowerCase() === "websocket") return;
    const auth = validateAdminAuth(request);
    if (!auth.valid) {
      throw unauthorized(auth.error);
    }
  })
  .get(
    "/",
    async ({ query: { page, limit, projectId, environmentId, appId } }) => {
      // Application scope is the most specific filter; environment scope
      // resolves to the apps created inside it, following the
      // project -> environment -> app hierarchy.
      let appIds: string[] | undefined;
      if (appId) {
        await appDAO.findByIdOrThrow(appId);
        appIds = [appId];
      } else if (environmentId) {
        await environmentDAO.findByIdOrThrow(environmentId);
        const apps = await appDAO.listByEnvironment(environmentId);
        appIds = apps.map((app) => app.id);
      }

      // ClickHouse serves this list when it is available; Postgres
      // otherwise (see backend/events-store.ts).
      const { data, pagination } = await listStoredEvents({
        page: page ?? undefined,
        limit: limit ?? undefined,
        projectId,
        appIds,
      });

      const items = await Promise.all(data.map(summarizeStoredEvent));
      return { data: items, pagination };
    },
    {
      query: arktype({
        page: "string.integer.parse?",
        limit: "string.integer.parse?",
        projectId: "string?",
        environmentId: "string.uuid?",
        appId: "string.uuid?",
      }),
    },
  )
  .post("/clear", async () => {
    const message: SentryEventMessage = {
      id: "clear-all",
      projectId: "*",
      envelopeHeader: "{}",
      envelopeItems: "[]",
      raw: "",
      receivedAt: new Date().toISOString(),
      type: "clear",
    };

    // NATS-first: without NATS, apply it in-process.
    if (await publishEvent(message)) return { success: true };

    await applyEventMessage(message);
    return { success: true };
  })
  .get(
    "/:eventId",
    async ({ params: { eventId } }) => {
      const stored = await findStoredEventByIdOrThrow(eventId);

      const parsed = parseStoredEnvelope(stored);
      if (!parsed) throw new ApiError(ErrorCode.NOT_FOUND, "Invalid envelope");

      const eventItem = parsed.items.find((item) => item.header.type === "event");
      if (eventItem) {
        const event = normalizeTransactionPayload(eventItem.payload);
        await symbolicateBestEffort(stored.projectId, event);
        return event;
      }

      const feedbackItem = parsed.items.find(
        (item) => item.header.type === "feedback" || item.header.type === "user_feedback",
      );
      if (feedbackItem) return feedbackItem.payload;

      const firstItem = parsed.items[0]?.payload || {};
      const transaction = normalizeTransactionPayload(firstItem);
      await symbolicateBestEffort(stored.projectId, transaction);
      return transaction;
    },
    { params: arktype({ eventId: "string" }) },
  )
  // Live event feed for UI clients. Events are pushed here as soon as
  // they are stored — by the NATS live consumer when the broker is up,
  // or directly by the ingestion fallback otherwise.
  .ws("/live/feed", {
    beforeHandle({ request }) {
      if (!adminAuthEnforced()) return;
      // Browsers cannot set Authorization headers on WebSocket
      // upgrades, so the admin token may also arrive as `?token=`.
      const token =
        new URL(request.url).searchParams.get("token") ??
        request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
      const auth = validateAdminToken(token);
      if (!auth.valid) {
        throw unauthorized(auth.error);
      }
    },
    open(ws) {
      addLiveClient(ws);
    },
    close(ws) {
      removeLiveClient(ws);
    },
  });

export const ingestionRoutes = new Elysia({ prefix: "api" })
  .post(
    "/:projectId/envelope/",
    async ({ request, params: { projectId } }) => {
      const app = await resolveAuthorizedApp(request, projectId);

      const rawBody = await readBody(request);
      const parsed = parseEnvelope(rawBody);
      if (!parsed) throw badRequest("Invalid envelope format");

      const convertedItems = parsed.items.map((item) =>
        item.header.type === "span" ? convertSpanToTransaction(item.header, item.payload) : item,
      );
      const convertedParsed = { header: parsed.header, items: convertedItems };

      const eventId = extractEventId(convertedParsed);
      const { items: storedItems, offloaded } = await offloadReplayItems(convertedItems, {
        projectId: app.projectId,
        appId: app.id,
        messageId: eventId,
      });
      const envelopeHeader = JSON.stringify(convertedParsed.header);
      const envelopeItems = JSON.stringify(storedItems);
      const receivedAt = new Date().toISOString();
      const message: SentryEventMessage = {
        id: eventId,
        projectId: app.projectId,
        appId: app.id,
        envelopeHeader,
        envelopeItems,
        // `raw` repeats every payload; once the recordings live in the
        // object store, storing the body again would re-inflate the row.
        raw: offloaded > 0 ? "" : rawBody,
        receivedAt,
        type: "envelope",
      };

      // NATS-first: without NATS it is applied in-process.
      await dispatchIngestedEvent(message);
      return { id: eventId };
    },
    { params: arktype({ projectId: "string" }) },
  )
  .post(
    "/:projectId/store/",
    async ({ request, params: { projectId } }) => {
      const app = await resolveAuthorizedApp(request, projectId);

      const rawBody = await request.text();
      let event: { event_id?: string };
      try {
        event = JSON.parse(rawBody);
      } catch {
        throw badRequest("Invalid JSON");
      }

      const eventId = event.event_id || crypto.randomUUID();
      const envelopeHeader = JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() });
      const envelopeItems = JSON.stringify([
        { header: { type: "event", content_type: "application/json", length: rawBody.length }, payload: event },
      ]);
      const receivedAt = new Date().toISOString();
      const message: SentryEventMessage = {
        id: eventId,
        projectId: app.projectId,
        appId: app.id,
        envelopeHeader,
        envelopeItems,
        raw: rawBody,
        receivedAt,
        type: "store",
      };

      // NATS-first: without NATS it is applied in-process.
      await dispatchIngestedEvent(message);
      return { id: eventId };
    },
    { params: arktype({ projectId: "string" }) },
  );
