import { Elysia, sse } from "elysia";
import { type as arktype } from "arktype";
import type {
  OfrepBulkEvaluationSuccess,
  OfrepEvaluationFailure,
  OfrepEvaluationSuccess,
} from "backend/protocol/feature-flags";
import { featureFlagDAO } from "db/dao/feature-flags";
import type { FeatureFlag } from "db/schema/feature-flags";
import { requireOfrepKey, scopeOf } from "./dsn";
import { disabledResult, evaluateWithAssignment } from "./evaluate";
import { parseFlag, type ParsedFeatureFlag } from "./service";
import {
  subscribeFlagChanges,
  subscribeRemoteFlagChanges,
  type FlagChangeEvent,
} from "./events";

const HEARTBEAT_SECONDS_MS = 20_000;

function toEntry(
  flag: ParsedFeatureFlag,
  result: {
    variantKey: string;
    value: unknown;
    reason: OfrepEvaluationSuccess["reason"];
  },
): OfrepEvaluationSuccess {
  return {
    key: flag.key,
    value: result.value,
    reason: result.reason,
    variant: result.variantKey,
    metadata: { flagType: flag.type },
  };
}

function evaluationFailure(
  key: string,
  errorCode: OfrepEvaluationFailure["errorCode"] | "FLAG_NOT_FOUND",
  status: number,
  errorDetails?: string,
): Response {
  return Response.json({ key, errorCode, errorDetails }, { status });
}

async function evaluateOne(
  row: FeatureFlag,
  targetingKey: string,
  context?: Record<string, unknown>,
): Promise<OfrepEvaluationSuccess> {
  const flag = parseFlag(row);
  if (flag.status !== "active") return toEntry(flag, disabledResult(flag));
  return toEntry(
    flag,
    await evaluateWithAssignment(flag, targetingKey, context as never),
  );
}

/** The scope's configuration ETag plus the latest change timestamp (unix seconds). */
async function scopeState(scope: {
  projectId: string | null;
}): Promise<{ etag: string; lastModified: number }> {
  const flags = await featureFlagDAO.listForScope(scope);
  const payload = flags
    .map((flag) => `${flag.id}:${flag.status}:${flag.updatedAt}`)
    .sort()
    .join("|");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload),
  );
  const etag = `"${Array.from(new Uint8Array(digest).slice(0, 16))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}"`;
  const lastModified = flags.reduce((max, flag) => {
    const seconds = Math.floor(Date.parse(flag.updatedAt) / 1000);
    return Number.isFinite(seconds) ? Math.max(max, seconds) : max;
  }, 0);
  return { etag, lastModified };
}

function ifNoneMatched(request: Request, etag: string): boolean {
  return !!request.headers
    .get("If-None-Match")
    ?.split(",")
    .some((value) => value.trim().replace(/^W\//, "") === etag);
}

/**
 * One connection's change queue: flag-change events for its scope. `next`
 * resolves null after the timeout — that is the heartbeat tick.
 */
function newDeltaQueue(scope: { projectId: string | null }) {
  const queued: FlagChangeEvent[] = [];
  const waiters = new Set<() => void>();
  const unsubscribe = subscribeFlagChanges((event) => {
    const flag = event.flag as { projectId?: string | null } | undefined;
    if (flag?.projectId != null && flag.projectId !== scope.projectId) return;
    queued.push(event);
    for (const waiter of waiters) waiter();
    waiters.clear();
  });
  return {
    next: (timeoutMs: number) =>
      new Promise((resolve) => {
        const pop = () => {
          waiters.delete(pop);
          clearTimeout(timer);
          resolve(queued.shift() ?? null);
        };
        const timer = setTimeout(() => {
          waiters.delete(pop);
          resolve(null);
        }, timeoutMs);
        waiters.add(pop);
        if (queued.length > 0) pop();
      }),
    close: () => {
      unsubscribe();
      for (const waiter of waiters) waiter();
      waiters.clear();
    },
  };
}

subscribeRemoteFlagChanges();

export const ofrepRoutes = new Elysia({ prefix: "/ofrep/v1" })
  // Server-side providers: one flag, per-request context.
  .post(
    "/evaluate/flags/:key",
    async ({ params: { key }, body, request }) => {
      const app = await requireOfrepKey(request);
      const row = await featureFlagDAO.findByKeyForScope(key, scopeOf(app));
      if (!row) {
        return evaluationFailure(
          key,
          "FLAG_NOT_FOUND",
          404,
          `Flag '${key}' was not found`,
        );
      }
      const context = body.context ?? {};
      const targetingKey =
        typeof context.targetingKey === "string" ? context.targetingKey : "";
      if (!targetingKey) {
        return evaluationFailure(
          key,
          "TARGETING_KEY_MISSING",
          400,
          "The evaluation context requires a targetingKey",
        );
      }
      return Response.json(
        await evaluateOne(row, targetingKey, context),
      );
    },
    {
      params: arktype({ key: "string >= 1" }),
      body: arktype({ context: "Record<string, unknown>?" }),
    },
  )
  // Client-side providers: all flags, static context, ETag-cached.
  .post(
    "/evaluate/flags",
    async ({ body, request, set }) => {
      const app = await requireOfrepKey(request);
      const scope = scopeOf(app);
      const context = body.context;
      const targetingKey =
        typeof context?.targetingKey === "string" ? context.targetingKey : "";
      const state = await scopeState(scope);
      if (ifNoneMatched(request, state.etag)) {
        set.status = 304;
        set.headers["ETag"] = state.etag;
        return;
      }
      const rows = await featureFlagDAO.listForScope(scope);
      const flags = await Promise.all(
        rows.map((row) =>
          evaluateOne(row, targetingKey, context),
        ),
      );
      set.headers["ETag"] = state.etag;
      set.headers["Cache-Control"] = "no-cache";
      const response: OfrepBulkEvaluationSuccess = {
        flags,
        metadata: { version: state.etag },
        eventStreams: [
          {
            type: "sse",
            url: `/ofrep/v1/events?api_key=${encodeURIComponent(app.publicKey)}`,
            inactivityDelaySec: 120,
          },
        ],
      };
      return response;
    },
    { body: arktype({ context: "Record<string, unknown>?" }) },
  )
  // Change notifications: the payload tells providers to re-fetch.
  .get(
    "/events",
    async function* ({ query, request }) {
      const app = await requireOfrepKey(request, query);
      const scope = scopeOf(app);
      const queue = newDeltaQueue(scope);
      let seq = 0;
      try {
        yield sse({ retry: 15_000 });
        while (true) {
          const event = await queue.next(HEARTBEAT_SECONDS_MS);
          if (!event) {
            // The spec: providers ignore unknown payload types.
            yield sse({ event: "ping", data: { type: "ping" } });
            continue;
          }
          const state = await scopeState(scope);
          yield sse({
            event: "message",
            id: String(++seq),
            data: {
              type: "refetchEvaluation",
              etag: state.etag,
              lastModified: state.lastModified,
            },
          });
        }
      } finally {
        queue.close();
      }
    },
    { query: arktype({ api_key: "string?", sentry_key: "string?" }) },
  );
