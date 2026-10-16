import { Elysia } from "elysia";
import { type as arktype } from "arktype";
import { featureFlagDAO } from "db/dao/feature-flags";
import { subscribeFlagChanges, type FlagChangeEvent } from "backend/flags-events";

interface StreamClient {
  flags: string[] | null;
  send: (event: string, data: unknown) => void;
  close: () => void;
}

const clients = new Set<StreamClient>();

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

async function sendSnapshot(
  send: (event: string, data: unknown) => void,
  flagKeys: string[] | null,
): Promise<void> {
  const flags = [];
  if (flagKeys === null) {
    const { data } = await featureFlagDAO.list({ page: 1, limit: 100 });
    flags.push(...data);
  } else {
    for (const key of flagKeys) {
      const flag = await featureFlagDAO.findByKey(key);
      if (flag) flags.push(flag);
    }
  }
  send("snapshot", { flags });
}

export const flagsStreamRoutes = new Elysia({ prefix: "api/sentry/flags" })
  .get(
    "/stream",
    ({ query: { flags } }) => {
      const flagKeys =
        flags?.split(",").map((key) => key.trim()).filter(Boolean) ?? null;

      let clientRef: StreamClient | null = null;
      let heartbeat: ReturnType<typeof setInterval> | undefined;

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoder = new TextEncoder();
          const close = () => {
            if (heartbeat) clearInterval(heartbeat);
            if (clientRef) clients.delete(clientRef);
            clientRef = null;
          };
          const send = (event: string, data: unknown) => {
            if (!clientRef) return;
            try {
              controller.enqueue(
                encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
              );
            } catch {
              close();
            }
          };

          heartbeat = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(": ping\n\n"));
            } catch {
              close();
            }
          }, 20000);

          clientRef = { flags: flagKeys, send, close };
          clients.add(clientRef);
          await sendSnapshot(send, flagKeys);
        },
        cancel() {
          if (clientRef) clientRef.close();
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    },
    { query: arktype({ flags: "string?" }) },
  );
