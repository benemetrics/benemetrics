/**
 * Shared helpers for in-process API tests.
 *
 * Requests go straight through `app.handle(new Request(...))`: no listener,
 * no port, no teardown. Suites that need a real HTTP listener or a browser
 * — SDK-driven tests, WebView UI tests — keep using `e2e/test-helpers.ts`.
 * (The live-feed hop drives a real WebSocket client from here; it needs no
 * listener, only the NATS broker.)
 */

import app from "../index";
import { findStoredEventById } from "../events-store";
import type { StoredEvent } from "../protocol/events";
import { connect, type NatsConnection } from "@nats-io/transport-node";
import { jetstreamManager } from "@nats-io/jetstream";

/** Canonical origin for in-process requests; DSN hosts derive from it. */
export const TEST_ORIGIN = "http://test.local";

app.store.adminTokenHash = await Bun.password.hash("e2e-admin-token");

export const ADMIN_TOKEN = "API-Key e2e-admin-token";

export const ADMIN_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  Authorization: ADMIN_TOKEN,
};

/** fetch-shaped, but routed through `app.handle` (no network). */
export function handleFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  if (input instanceof Request) return app.handle(input);

  // No network hop means no automatic Host header; set it so request-derived
  // values (e.g. app DSN hosts) stay consistent with the URL the test used.
  const url = new URL(String(input), TEST_ORIGIN);
  const headers = new Headers(init?.headers);
  if (!headers.has("host")) headers.set("host", url.host);
  return app.handle(new Request(url, { ...init, headers }));
}

export interface TestApp {
  baseUrl: string;
  dsn: string;
  projectId: string;
  appId: string;
  ingestKey: string;
  publicKey: string;
}

/** Provisions a project + app through the admin API (no server started). */
export async function startTestApp(): Promise<TestApp> {
  const projectResponse = await handleFetch(`${TEST_ORIGIN}/api/admin/projects`, {
    method: "POST",
    headers: ADMIN_HEADERS,
    body: JSON.stringify({ name: `E2E Project ${crypto.randomUUID().slice(0, 8)}` }),
  });
  if (!projectResponse.ok) {
    throw new Error(`Failed to create test project: ${projectResponse.status}`);
  }
  const project = (await projectResponse.json()) as { id: string };

  const appResponse = await handleFetch(`${TEST_ORIGIN}/api/admin/projects/${project.id}/apps`, {
    method: "POST",
    headers: ADMIN_HEADERS,
    body: JSON.stringify({ name: "E2E App" }),
  });
  if (!appResponse.ok) {
    throw new Error(`Failed to create test app: ${appResponse.status}`);
  }
  const created = (await appResponse.json()) as {
    id: string;
    number: number;
    ingestKey: string;
    publicKey: string;
  };

  return {
    baseUrl: TEST_ORIGIN,
    dsn: `http://${created.publicKey}@${new URL(TEST_ORIGIN).host}/${created.number}`,
    projectId: project.id,
    appId: created.id,
    ingestKey: created.ingestKey,
    publicKey: created.publicKey,
  };
}

/** Polls `fn` until `predicate` passes; returns the last observed value. */
export async function waitFor<T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 5000,
): Promise<T> {
  const start = Date.now();
  let last!: T;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (predicate(last)) return last;
    await Bun.sleep(100);
  }
  return last;
}

/**
 * Polls ClickHouse until the stored event is visible. Ingestion is a
 * publish: the engine consumer inserts asynchronously.
 */
export async function waitForStoredEvent(
  eventId: string,
  timeoutMs = 10000,
): Promise<StoredEvent> {
  const stored = await waitFor(
    () => findStoredEventById(eventId),
    (value) => value !== undefined,
    timeoutMs,
  );
  if (!stored) throw new Error(`Event ${eventId} did not land in ClickHouse`);
  return stored;
}

/** Polls an admin GET until it succeeds (event reads lag behind ingestion). */
export async function waitForApiGet<T>(path: string, timeoutMs = 10000): Promise<T> {
  const response = await waitFor(
    () => handleFetch(`${TEST_ORIGIN}${path}`, { headers: ADMIN_HEADERS }),
    (result) => result.status === 200,
    timeoutMs,
  );
  if (!response.ok) {
    throw new Error(`GET ${path} did not succeed: ${response.status}`);
  }
  return (await response.json()) as T;
}

/** The JetStream stream/consumers the suite relies on (backend/nats.ts). */
export const TEST_STREAM = "SENTRIES";
export const TEST_EVENTS_SUBJECT = "sentry.events";
export const TEST_METRICS_SUBJECT = "sentry.metrics";

/** Connects to the broker the backend uses (the suite requires NATS). */
export async function connectTestNats(): Promise<NatsConnection> {
  return connect({ servers: process.env.NATS_SERVERS || "nats://localhost:4222" });
}

/**
 * Waits until a durable consumer has acknowledged up to `streamSeq` and
 * has nothing pending — i.e. the hop that consumes the message is done.
 * A pull consumer may not have pulled yet, so the ack floor is checked
 * together with the pending count.
 */
export async function waitForConsumerAck(
  consumer: string,
  streamSeq: number,
  timeoutMs = 10000,
): Promise<void> {
  const nats = await connectTestNats();
  try {
    const manager = await jetstreamManager(nats);
    await waitFor(
      async () => {
        const info = await manager.consumers.info(TEST_STREAM, consumer);
        return (
          info.ack_floor.stream_seq >= streamSeq && (info.num_ack_pending ?? 0) === 0
        );
      },
      (done) => done,
      timeoutMs,
    );
  } finally {
    await nats.close();
  }
}
