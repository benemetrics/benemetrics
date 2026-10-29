import { Elysia } from "elysia";
import { type as arktype } from "arktype";
import { badRequest } from "backend/errors";
import {
  dispatchIngestedEvent,
  resolveAuthorizedApp,
} from "../events/ingestion";
import { extractMetricSamples } from "../metrics/samples";
import { convertOtlpToEnvelopes } from "./convert";
import { assertDeclaredSize, assertSpanCount } from "../ratelimit/hygiene";
import { rateLimitConfig } from "../ratelimit/config";

const otlpTracesBody = arktype({
  resourceSpans: "unknown[]",
});

export const otlpRoutes = new Elysia({ prefix: "api" }).post(
  "/:projectId/otlp/v1/traces",
  async ({ request, params: { projectId }, body }) => {
    const app = await resolveAuthorizedApp(request, projectId);
    // Elysia parses the body before the handler runs; the declared size
    // is checked here and the server-wide cap bounds the rest.
    assertDeclaredSize(request, rateLimitConfig().maxOtlpBytes, "OTLP request");
    const envelopes = convertOtlpToEnvelopes(JSON.stringify(body));
    if (!envelopes) throw badRequest("Invalid OTLP traces payload");
    assertSpanCount(envelopes.length);
    const receivedAt = new Date().toISOString();
    const ids = envelopes.map((envelope) => envelope.id);
    await Promise.all(
      envelopes.map((envelope) =>
        dispatchIngestedEvent(
          app,
          {
            id: envelope.id,
            projectId: app.projectId,
            appId: app.id,
            envelopeHeader: envelope.envelopeHeader,
            envelopeItems: envelope.envelopeItems,
            receivedAt,
            type: "envelope",
          },
          extractMetricSamples({
            projectId: app.projectId,
            appId: app.id,
            eventId: envelope.id,
            items: envelope.items,
            receivedAt,
          }),
        ),
      ),
    );
    return { ids };
  },
  {
    params: arktype({ projectId: "string" }),
    body: otlpTracesBody,
  },
);
