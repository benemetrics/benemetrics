import { Elysia } from "elysia";
import { ApiError, ErrorCode, badRequest, unauthorized } from "backend/errors";
import { type as arktype } from "arktype";
import { appDAO } from "db/dao/project";
import { environmentDAO } from "db/dao/environments";
import type { StoredEvent } from "../protocol/events";
import { adminAuthEnforced, validateAdminAuth } from "../auth";
import { type SentryEventMessage } from "../nats";
import { listStoredEvents, findStoredEventByIdOrThrow } from "../events-store";
import { parseEnvelope, parseStoredEnvelope, extractEventId, normalizeTransactionPayload, convertSpanToTransaction } from "./utils";
import { extractMetricSamples } from "../metrics/samples";
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

      // ClickHouse is the events store; the reads go through the facade
      // in backend/events-store.ts.
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
      receivedAt: new Date().toISOString(),
      type: "clear",
    };

    // The side-effects consumer truncates the ClickHouse events and the
    // derived issue state; publishing keeps the clear ordered after the
    // events that preceded it.
    await dispatchIngestedEvent(message);
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
  );
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
      const storedItems = await offloadReplayItems(convertedItems, {
        projectId: app.projectId,
        appId: app.id,
        messageId: eventId,
      });
      const envelopeHeader = JSON.stringify(convertedParsed.header);
      const envelopeItems = JSON.stringify(storedItems);
      const receivedAt = new Date().toISOString();
      const samples = extractMetricSamples({
        projectId: app.projectId,
        appId: app.id,
        eventId,
        items: convertedItems,
        receivedAt,
      });
      const message: SentryEventMessage = {
        id: eventId,
        projectId: app.projectId,
        appId: app.id,
        envelopeHeader,
        envelopeItems,
        receivedAt,
        type: "envelope",
      };

      // Publishes to NATS; a broker failure answers 503 — no in-process
      // fallback (ClickHouse ingests from the stream).
      await dispatchIngestedEvent(message, samples);
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
      const items = [
        { header: { type: "event" as const, content_type: "application/json", length: rawBody.length }, payload: event },
      ];
      const envelopeItems = JSON.stringify(items);
      const receivedAt = new Date().toISOString();
      const samples = extractMetricSamples({
        projectId: app.projectId,
        appId: app.id,
        eventId,
        items,
        receivedAt,
      });
      const message: SentryEventMessage = {
        id: eventId,
        projectId: app.projectId,
        appId: app.id,
        envelopeHeader,
        envelopeItems,
        receivedAt,
        type: "store",
      };

      // Publishes to NATS; a broker failure answers 503 — no in-process
      // fallback (ClickHouse ingests from the stream).
      await dispatchIngestedEvent(message, samples);
      return { id: eventId };
    },
    { params: arktype({ projectId: "string" }) },
  );
