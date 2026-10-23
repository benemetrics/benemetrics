import { Elysia } from "elysia";
import { type as arktype } from "arktype";
import { ApiError, ErrorCode, badRequest, notFound } from "backend/errors";
import { appDAO } from "db/dao/project";
import type { SentryEventMessage } from "../protocol/events";
import { listStoredEvents, findStoredEventByIdOrThrow } from "../events-store";
import {
  parseEnvelope,
  parseStoredEnvelope,
  extractEventId,
  normalizeTransactionPayload,
  convertSpanToTransaction,
} from "./utils";
import { extractMetricSamples } from "../metrics/samples";
import { extractIssueDigests } from "../issues/grouping";
import {
  dispatchIngestedEvent,
  markIngested,
  readBody,
  resolveAuthorizedApp,
  wasRecentlyIngested,
} from "./ingestion";
import { offloadReplayItems } from "./offload";
import { resolveAdminId } from "../auth";
import { assertDeclaredSize, assertItemCount } from "../ratelimit/hygiene";
import { rateLimitConfig } from "../ratelimit/config";
import { scopedViewFor } from "../permissions/engine";
import { s3 } from "../storage";
import { replayObjectPrefix } from "./offload";
import { symbolicateEventPayload } from "../source-maps/resolver";

async function symbolicateBestEffort(projectId: string, payload: unknown): Promise<void> {
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

// One page of replay segments. The object keys embed the segment start
// time, so a `startAfter` cursor walks the session in playback order
// without reading a single object — the frontend streams the presigned
// URLs straight from S3 into an rrweb player.
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;
const URL_TTL_SECONDS = 900;

// ── oidc surface: the event reads ──────────────────────────────
export const eventsRoutes = new Elysia({ prefix: "events" })
  .resolve(resolveAdminId)
  .get(
    "/",
    async ({ query, request, isAdmin, adminScope }) => {
      // The filter belongs in the query: an unknown app or environment
      // yields an empty list, not a lookup and a 404.
      let appIds: string[] | undefined;
      if (query.appId) appIds = [query.appId];
      else if (query.environmentId) {
        appIds = (await appDAO.listByEnvironment(query.environmentId)).map((app) => app.id);
      }
      const view = await scopedViewFor({ request, isAdmin, adminScope });
      if (view) {
        const visible = [...view.appIds];
        appIds = appIds ? appIds.filter((id) => visible.includes(id)) : visible;
      }
      const { data } = await listStoredEvents({
        cursor: query.cursor,
        limit: query.limit,
        projectId: query.projectId,
        appIds,
        since: query.since,
      });
      return {
        data: await Promise.all(
          data.map(async (stored) => {
            const parsed = parseStoredEnvelope(stored);
            const items = parsed
              ? parsed.items.map((item) =>
                  item.header.type === "span"
                    ? convertSpanToTransaction(item.header, item.payload)
                    : item,
                )
              : [];
            const pick = (type: string) => items.find((item) => item.header.type === type);
            const event = pick("event")
              ? normalizeTransactionPayload(pick("event")!.payload)
              : null;
            const transaction = pick("transaction")
              ? normalizeTransactionPayload(pick("transaction")!.payload)
              : null;
            await Promise.all([
              symbolicateBestEffort(stored.projectId, event),
              symbolicateBestEffort(stored.projectId, transaction),
            ]);
            return {
              id: stored.id,
              receivedAt: stored.receivedAt,
              itemTypes: items.map((item) => item.header.type),
              event,
              transaction,
              feedback:
                items.find(
                  (item) => item.header.type === "feedback" || item.header.type === "user_feedback",
                )?.payload ?? null,
            };
          }),
        ),
      };
    },
    {
      query: arktype({
        cursor: "string?",
        limit: "string.integer.parse?",
        since: "string?",
        projectId: "string?",
        environmentId: "string.uuid?",
        appId: "string.uuid?",
      }),
    },
  )
  .get(
    "/:eventId",
    async ({ params: { eventId }, request, isAdmin, adminScope }) => {
      const view = await scopedViewFor({ request, isAdmin, adminScope });
      const stored = await findStoredEventByIdOrThrow(eventId);
      if (view && stored.appId && !view.appIds.has(stored.appId)) {
        throw notFound("Event", eventId);
      }
      const parsed = parseStoredEnvelope(stored);
      if (!parsed) throw new ApiError(ErrorCode.NOT_FOUND, "Invalid envelope");
      const eventItem = parsed.items.find((item) => item.header.type === "event");
      const feedbackItem = parsed.items.find(
        (item) => item.header.type === "feedback" || item.header.type === "user_feedback",
      );
      if (!eventItem && feedbackItem) return feedbackItem.payload;
      const payload = normalizeTransactionPayload(
        eventItem?.payload || parsed.items[0]?.payload || {},
      );
      await symbolicateBestEffort(stored.projectId, payload);
      return payload;
    },
    { params: arktype({ eventId: "string" }) },
  );

// ── oidc surface: the replay segments ─────────────────────────
export const replayRoutes = new Elysia({ prefix: "/api/admin/events" }).resolve(resolveAdminId).get(
  "/:eventId/replay/:replayId",
  async ({ params: { eventId, replayId }, query }) => {
    const stored = await findStoredEventByIdOrThrow(eventId);
    // Ingestion always writes under a resolved app; an event without one
    // can never have segments.
    if (!stored.appId) throw notFound("Replay segments", replayId);
    const prefix = replayObjectPrefix({
      projectId: stored.projectId,
      appId: stored.appId,
      replayId,
    });
    const cursor = query.cursor;
    if (cursor && !cursor.startsWith(prefix)) throw badRequest("Invalid replay cursor");
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);

    try {
      const page = await s3.list({
        prefix,
        maxKeys: limit,
        ...(cursor ? { startAfter: cursor } : {}),
      });
      const contents = page.contents ?? [];
      const nextCursor = page.isTruncated ? (contents.at(-1)?.key ?? null) : null;
      return {
        replayId,
        available: true,
        expiresAt: new Date(Date.now() + URL_TTL_SECONDS * 1000).toISOString(),
        segments: contents.map((entry) => ({
          key: entry.key,
          url: s3.presign(entry.key, { expiresIn: URL_TTL_SECONDS }),
          bytes: entry.size ?? 0,
        })),
        nextCursor,
        hasMore: nextCursor !== null,
      };
    } catch {
      return {
        replayId,
        available: false,
        expiresAt: null,
        segments: [],
        nextCursor: null,
        hasMore: false,
      };
    }
  },
  {
    params: arktype({ eventId: "string", replayId: "string" }),
    query: arktype({
      cursor: "string?",
      limit: "string.integer.parse?",
    }),
  },
);

// ── dsn surface: the SDK ingestion ────────────────────────────
export const ingestionRoutes = new Elysia({ prefix: "api" })
  .post(
    "/:projectId/envelope/",
    async ({ request, params: { projectId } }) => {
      const app = await resolveAuthorizedApp(request, projectId);
      assertDeclaredSize(request, rateLimitConfig().maxLargeEnvelopeBytes, "Envelope");
      const parsed = parseEnvelope(await readBody(request));
      if (!parsed) throw badRequest("Invalid envelope format");
      assertItemCount(parsed.items.length, "Envelope");
      const items = parsed.items.map((item) =>
        item.header.type === "span" ? convertSpanToTransaction(item.header, item.payload) : item,
      );
      const eventId = extractEventId({ header: parsed.header, items });
      // A retried event id is answered without the object-store write and
      // the publish: the id is the idempotency key.
      if (wasRecentlyIngested(eventId)) return { id: eventId };
      const message: SentryEventMessage = {
        id: eventId,
        projectId: app.projectId,
        appId: app.id,
        envelopeHeader: JSON.stringify(parsed.header),
        envelopeItems: JSON.stringify(
          await offloadReplayItems(items, {
            projectId: app.projectId,
            appId: app.id,
            messageId: eventId,
          }),
        ),
        issueEvents: JSON.stringify(extractIssueDigests(items)),
        receivedAt: new Date().toISOString(),
        type: "envelope",
      };
      await dispatchIngestedEvent(
        message,
        extractMetricSamples({
          projectId: app.projectId,
          appId: app.id,
          eventId,
          items,
          receivedAt: message.receivedAt,
        }),
      );
      markIngested(eventId);
      return { id: eventId };
    },
    { params: arktype({ projectId: "string" }) },
  )
  .post(
    "/:projectId/store/",
    async ({ request, params: { projectId } }) => {
      const app = await resolveAuthorizedApp(request, projectId);
      assertDeclaredSize(request, rateLimitConfig().maxLargeEnvelopeBytes, "Store payload");
      const rawBody = await request.text();
      let event: { event_id?: string } = {};
      try {
        event = JSON.parse(rawBody);
      } catch {
        throw badRequest("Invalid JSON");
      }
      const eventId = event.event_id || crypto.randomUUID();
      const items = [
        {
          header: {
            type: "event" as const,
            content_type: "application/json",
            length: rawBody.length,
          },
          payload: event,
        },
      ];
      if (wasRecentlyIngested(eventId)) return { id: eventId };
      const message: SentryEventMessage = {
        id: eventId,
        projectId: app.projectId,
        appId: app.id,
        envelopeHeader: JSON.stringify({
          event_id: eventId,
          sent_at: new Date().toISOString(),
        }),
        envelopeItems: JSON.stringify(items),
        issueEvents: JSON.stringify(extractIssueDigests(items)),
        receivedAt: new Date().toISOString(),
        type: "store",
      };
      await dispatchIngestedEvent(
        message,
        extractMetricSamples({
          projectId: app.projectId,
          appId: app.id,
          eventId,
          items,
          receivedAt: message.receivedAt,
        }),
      );
      markIngested(eventId);
      return { id: eventId };
    },
    { params: arktype({ projectId: "string" }) },
  );
