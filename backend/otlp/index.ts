import { Elysia } from "elysia";
import { badRequest } from "backend/errors";
import { type as arktype } from "arktype";
import type { SentryEventMessage } from "../nats";
import { dispatchIngestedEvent, resolveAuthorizedApp } from "../events/ingestion";
import { convertOtlpToEnvelopes } from "./convert";

// OTLP/HTTP traces ingestion (JSON encoding only).
const otlpTracesBody = arktype({
  resourceSpans: "unknown[]",
});

export const otlpRoutes = new Elysia({ prefix: "api" })
  .post(
    "/:projectId/otlp/v1/traces",
    async ({ request, params: { projectId }, body }) => {
      const app = await resolveAuthorizedApp(request, projectId);

      const raw = JSON.stringify(body);
      const envelopes = convertOtlpToEnvelopes(raw);
      if (!envelopes) {
        throw badRequest("Invalid OTLP traces payload");
      }

      const receivedAt = new Date().toISOString();
      const ids: string[] = [];
      for (const envelope of envelopes) {
        const message: SentryEventMessage = {
          id: envelope.id,
          projectId: app.projectId,
          appId: app.id,
          envelopeHeader: envelope.envelopeHeader,
          envelopeItems: envelope.envelopeItems,
          receivedAt,
          type: "envelope",
        };

        await dispatchIngestedEvent(message);
        ids.push(envelope.id);
      }

      return { ids };
    },
    {
      params: arktype({ projectId: "string" }),
      body: otlpTracesBody,
    },
  );
