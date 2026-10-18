/**
 * Hop 3 — NATS -> Postgres side effects (issues + alerts).
 *
 * The side-effects consumer applies one-shot, race-safe transitions: a
 * redelivered message never creates a second issue nor re-fires a
 * `new_issue` alert. No event payload is stored in Postgres — the issue
 * row and the incident are the only observable side effects.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import type { JetStreamClient, NatsConnection } from "nats";
import { EVENTS_CONSUMER } from "../backend/nats";
import {
  ADMIN_HEADERS,
  connectTestNats,
  handleFetch as fetch,
  startTestApp,
  TEST_EVENTS_SUBJECT,
  TEST_ORIGIN,
  waitFor,
  waitForConsumerAck,
} from "./test-helpers";

let nats: NatsConnection;
let jetstream: JetStreamClient;
let webhookServer: any;
let webhookUrl = "";
const webhookCalls: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  nats = await connectTestNats();
  jetstream = nats.jetstream();
  webhookServer = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const body = await request.json().catch(() => ({}));
      webhookCalls.push(body as Record<string, unknown>);
      return Response.json({ ok: true });
    },
  });
  webhookUrl = `http://localhost:${webhookServer.port}/hook`;
});

afterAll(async () => {
  webhookServer.stop();
  await nats.close();
});

function publishEventMessage(message: Record<string, unknown>) {
  return jetstream.publish(TEST_EVENTS_SUBJECT, new TextEncoder().encode(JSON.stringify(message)));
}

async function listIssues(appId: string): Promise<
  Array<{ id: string; fingerprint: string; status: string }>
> {
  const response = await fetch(`${TEST_ORIGIN}/api/admin/issues?appId=${appId}`, {
    headers: ADMIN_HEADERS,
  });
  return ((await response.json()) as { data: Array<{ id: string; fingerprint: string; status: string }> })
    .data;
}

describe("Hop 3: NATS -> Postgres", () => {
  it("creates the issue and fires the new_issue alert exactly once", async () => {
    const app = await startTestApp();
    const message = `hop three ${crypto.randomUUID()}`;

    const channel = (await (
      await fetch(`${TEST_ORIGIN}/api/admin/alerting/channels`, {
        method: "POST",
        headers: ADMIN_HEADERS,
        body: JSON.stringify({
          name: `hop3-channel-${crypto.randomUUID().slice(0, 8)}`,
          type: "webhook",
          config: { url: webhookUrl },
          appId: app.appId,
        }),
      })
    ).json()) as { id: string };
    const ruleName = `hop3 rule ${crypto.randomUUID().slice(0, 8)}`;
    await fetch(`${TEST_ORIGIN}/api/admin/alerting/rules`, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({
        name: ruleName,
        trigger: "new_issue",
        cooldownSeconds: 0,
        channelIds: [channel.id],
        appId: app.appId,
      }),
    });

    const eventId = crypto.randomUUID();
    const eventMessage = {
      id: eventId,
      projectId: app.projectId,
      appId: app.appId,
      envelopeHeader: JSON.stringify({ event_id: eventId }),
      envelopeItems: JSON.stringify([
        {
          header: { type: "event", length: 0 },
          payload: { event_id: eventId, level: "error", message, environment: "test" },
        },
      ]),
      receivedAt: new Date().toISOString(),
      type: "store",
    };

    const first = await publishEventMessage(eventMessage);

    const issues = await waitFor(
      () => listIssues(app.appId),
      (data) => data.length === 1,
    );
    expect(issues[0]!.fingerprint).toBe(`msg:${message}`);
    expect(issues[0]!.status).toBe("unresolved");
    await waitForConsumerAck(EVENTS_CONSUMER, first.seq);

    await waitFor(
      () => Promise.resolve(webhookCalls.filter((body) => body.ruleName === ruleName)),
      (calls) => calls.length === 1,
    );

    // A redelivery of the identical message must not create a second
    // issue nor re-fire the one-shot new_issue alert.
    const second = await publishEventMessage(eventMessage);
    await waitForConsumerAck(EVENTS_CONSUMER, second.seq);
    await Bun.sleep(500);

    expect(await listIssues(app.appId)).toHaveLength(1);
    expect(webhookCalls.filter((body) => body.ruleName === ruleName)).toHaveLength(1);
    const incidents = (await (
      await fetch(`${TEST_ORIGIN}/api/admin/alerting/incidents?appId=${app.appId}`, {
        headers: ADMIN_HEADERS,
      })
    ).json()) as { data: Array<{ trigger: string }> };
    expect(incidents.data).toHaveLength(1);
    expect(incidents.data[0]!.trigger).toBe("new_issue");
  });
});
