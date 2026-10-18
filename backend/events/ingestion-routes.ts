import { Elysia } from "elysia";
import { type } from "arktype";
import { badRequest } from "../errors.ts";
import { resolveAuthorizedApp, readBody, dispatchIngestedEvent } from "./ingestion.ts";
import { parseEnvelope, extractEventId, convertSpanToTransaction } from "./utils.ts";
import { offloadReplayItems } from "./offload.ts";
import { extractMetricSamples } from "../metrics/samples.ts";
import { crypto } from "../utils/crypto.ts";
import { appDAO } from "db/dao/project";

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
    { params: type({ projectId: "string" }) },
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
    { params: type({ projectId: "string" }) },
  );