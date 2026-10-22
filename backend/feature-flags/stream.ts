import { Elysia } from "elysia";
import { type as arktype } from "arktype";
import { featureFlagDAO, type FlagScope } from "db/dao/feature-flags";
import { requireDsnKey, scopeOf } from "./dsn";
import { subscribeFlagChanges, subscribeRemoteFlagChanges, type FlagChangeEvent } from "./events";

interface StreamClient {
  flags: string[] | null;
  send: (event: string, data: unknown) => void;
}

const clients = new Set<StreamClient>();

const HEARTBEAT_MS = 20_000;

async function fullSnapshot(scope: FlagScope): Promise<unknown[]> {
  const flags: unknown[] = [];
  let cursor: string | undefined;
  do {
    const page = await featureFlagDAO.list({
      cursor,
      limit: 100,
      projectId: scope.projectId ?? null,
      appId: scope.appId ?? null,
    });
    flags.push(...page.data);
    cursor = page.data.length === 100 ? page.data[page.data.length - 1]!.id : undefined;
  } while (cursor);
  return flags;
}

// Fan-out lives in the bus subscription: every route handler only has to
// register its stream client and send the initial snapshot.
subscribeFlagChanges((event: FlagChangeEvent) => {
  for (const client of clients) {
    if (client.flags !== null && !client.flags.includes(event.flagKey)) continue;
    client.send("configuration_changed", {
      flagKey: event.flagKey,
      change: event.type,
      flag: event.flag,
    });
  }
});

subscribeRemoteFlagChanges();

export const flagsStreamRoutes = new Elysia({ prefix: "api/sentry/flags" })
  .get(
    "/stream",
    async ({ query: { flags }, request }) => {
      const app = await requireDsnKey(request);
      const scope = scopeOf(app);
      const flagKeys = flags?.split(",").map((key) => key.trim()).filter(Boolean) ?? null;
      let client: StreamClient | null = null;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      const stream = new ReadableStream<Uint8Array>({ async start(controller) {
        clients.add(client = { flags: flagKeys, send: (event, data) => controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) });
        const snapshot = flagKeys === null
          ? await fullSnapshot(scope)
          : (await Promise.all(flagKeys.map((key) => featureFlagDAO.findByKeyForScope(key, scope)))).filter((flag) => flag != null);
        client.send("snapshot", { flags: snapshot });
        heartbeat = setInterval(() => {
          try {
            controller.enqueue(new TextEncoder().encode(": ping\n\n"));
          } catch {
            // The client is gone; the cancel handler cleans up.
          }
        }, HEARTBEAT_MS);
      }, cancel() { if (heartbeat) clearInterval(heartbeat); if (client) clients.delete(client); } });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
    },
    { query: arktype({ flags: "string?" }) },
  );
