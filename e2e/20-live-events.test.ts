/**
 * E2E Test: live event WebSocket feed (/events/live/feed)
 *
 * The backend fan-out mirrors the NATS stream (a dedicated live consumer
 * broadcasts every message):
 *   - every published envelope is pushed to connected clients
 *   - a retried (duplicate) event id is broadcast again like any other
 *     message; the store collapses duplicates, the feed mirrors the stream
 *   - "clear" is broadcast so clients can refresh
 *   - once admin auth is enforced the upgrade requires a token, which
 *     may arrive as ?token= (browsers cannot set WS headers)
 * Starts a real server on an ephemeral port for testing.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import app from "../backend/index";

let baseUrl = "";
let wsBaseUrl = "";
let server: any;

const ADMIN_TOKEN = "Bearer e2e-admin-token";

const uniq = () => Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
const hexEventId = () => crypto.randomUUID().replaceAll("-", "");

beforeAll(() => {
  app.listen(0);
  server = (app as any).server;
  baseUrl = `http://localhost:${server.port}`;
  wsBaseUrl = `ws://localhost:${server.port}`;
});

afterAll(() => {
  server?.stop(true);
});

async function apiRequest(method: string, path: string, body?: unknown): Promise<Response> {
  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", Authorization: ADMIN_TOKEN },
  };
  if (body !== undefined) options.body = JSON.stringify(body);
  return fetch(`${baseUrl}${path}`, options);
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

interface LiveApp {
  projectId: string;
  id: string;
  ingestKey: string;
  publicKey: string;
}

async function makeApp(): Promise<LiveApp> {
  const project = await json<{ id: string }>(
    await apiRequest("POST", "/api/admin/projects", { name: `LiveProj-${uniq()}` }),
  );
  const appRecord = await json<{ id: string; ingestKey: string; publicKey: string }>(
    await apiRequest("POST", `/api/admin/projects/${project.id}/apps`, {
      name: `LiveApp-${uniq()}`,
    }),
  );
  return { projectId: project.id, ...appRecord };
}

async function ingestEvent(app: LiveApp, event: Record<string, unknown>): Promise<Response> {
  return fetch(
    `${baseUrl}/api/${app.ingestKey}/store/?sentry_key=${encodeURIComponent(app.publicKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    },
  );
}

interface LiveMessage {
  type: "event" | "clear";
  id?: string;
  projectId?: string;
  appId?: string;
  receivedAt?: string;
  itemTypes?: string[];
  kind?: string;
}

class LiveFeed {
  readonly messages: LiveMessage[] = [];
  private readonly ws: WebSocket;

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (messageEvent: MessageEvent) => {
      try {
        this.messages.push(JSON.parse(String(messageEvent.data)) as LiveMessage);
      } catch {
        // Ignore malformed frames.
      }
    });
  }

  close(): void {
    this.ws.close();
  }

  count(predicate: (message: LiveMessage) => boolean): number {
    return this.messages.filter(predicate).length;
  }

  async waitFor(
    predicate: (message: LiveMessage) => boolean,
    timeoutMs = 5000,
  ): Promise<LiveMessage> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const match = this.messages.find(predicate);
      if (match) return match;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(
      `Timed out waiting for a live message. Received: ${JSON.stringify(this.messages)}`,
    );
  }
}

// The suite runs with ADMIN_TOKEN configured (see e2e/preload.ts), so the
// upgrade always carries the token as ?token= (browsers cannot set WS headers).
async function connectLive(
  path = `/events/live/feed?token=${encodeURIComponent("e2e-admin-token")}`,
): Promise<LiveFeed> {
  const ws = new WebSocket(`${wsBaseUrl}${path}`);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket connect timed out")), 5000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("WebSocket connect failed"));
    });
  });

  // Let the server's `open` handler register the client before ingesting.
  await new Promise((resolve) => setTimeout(resolve, 50));
  return new LiveFeed(ws);
}

async function expectUpgradeRejected(path: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`${wsBaseUrl}${path}`);
    const timer = setTimeout(
      () => reject(new Error("WebSocket upgrade was neither accepted nor rejected")),
      5000,
    );
    const settle = () => {
      clearTimeout(timer);
      resolve();
    };
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      ws.close();
      reject(new Error("WebSocket upgrade unexpectedly accepted"));
    });
    ws.addEventListener("error", settle);
    ws.addEventListener("close", settle);
  });
}

describe("live event WebSocket feed", () => {
  it("pushes newly stored events to connected clients", async () => {
    const appRecord = await makeApp();
    const feed = await connectLive();
    try {
      const eventId = hexEventId();
      const response = await ingestEvent(appRecord, {
        event_id: eventId,
        message: "live feed test",
      });
      expect(response.status).toBe(200);

      const message = await feed.waitFor(
        (candidate) => candidate.type === "event" && candidate.id === eventId,
      );
      expect(message.projectId).toBe(appRecord.projectId);
      expect(message.appId).toBe(appRecord.id);
      expect(message.kind).toBe("store");
      expect(message.itemTypes).toContain("event");
      expect(typeof message.receivedAt).toBe("string");
    } finally {
      feed.close();
    }
  });

  it("broadcasts every published message for an event id", async () => {
    const appRecord = await makeApp();
    const feed = await connectLive();
    try {
      const eventId = hexEventId();
      const event = { event_id: eventId, message: "duplicate once" };

      expect((await ingestEvent(appRecord, event)).status).toBe(200);
      await feed.waitFor((candidate) => candidate.type === "event" && candidate.id === eventId);

      // The feed mirrors the stream: a retry publishes again and is
      // broadcast again. Duplicates collapse in the store
      // (ReplacingMergeTree), not in the live feed.
      expect((await ingestEvent(appRecord, event)).status).toBe(200);
      const start = Date.now();
      while (
        feed.count((candidate) => candidate.type === "event" && candidate.id === eventId) < 2 &&
        Date.now() - start < 5000
      ) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(feed.count((candidate) => candidate.type === "event" && candidate.id === eventId)).toBe(2);
    } finally {
      feed.close();
    }
  });

  it("broadcasts clear so clients can refresh", async () => {
    const feed = await connectLive();
    try {
      const response = await apiRequest("POST", "/events/clear");
      expect(response.status).toBe(200);
      await feed.waitFor((candidate) => candidate.type === "clear");
    } finally {
      feed.close();
    }
  });

  it("requires the configured admin token on the WebSocket upgrade", async () => {
    await expectUpgradeRejected("/events/live/feed");

    const feed = await connectLive(
      `/events/live/feed?token=${encodeURIComponent("e2e-admin-token")}`,
    );
    feed.close();
  });
});
