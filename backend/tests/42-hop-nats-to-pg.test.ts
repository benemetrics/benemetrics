/**
 * Hop 3 — NATS -> Postgres side effects (issues + alerts).
 *
 * The side-effects consumer applies one-shot, race-safe transitions: a
 * redelivered message never creates a second issue nor re-fires a
 * `new_issue` alert. No event payload is stored in Postgres — the issue
 * row and the incident are the only observable side effects.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import type { NatsConnection } from "@nats-io/transport-node";
import {
  jetstream as createJetstream,
  type JetStreamClient,
} from "@nats-io/jetstream";
import {
  ADMIN_HEADERS,
  connectTestNats,
  handleFetch as fetch,
  startTestApp,
  TEST_EVENTS_SUBJECT,
  TEST_ORIGIN,
  waitFor,
} from "./test-helpers";

let nats: NatsConnection;
let jetstream: JetStreamClient;
let webhookServer: any;
let webhookUrl = "";
const webhookCalls: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  nats = await connectTestNats();
  jetstream = createJetstream(nats);
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
  return jetstream.publish(
    TEST_EVENTS_SUBJECT,
    new TextEncoder().encode(JSON.stringify(message)),
  );
}

async function listIssues(
  appId: string,
): Promise<
  Array<{ id: string; fingerprint: string; status: string; eventCount: number }>
> {
  const response = await fetch(
    `${TEST_ORIGIN}/api/admin/issues?query=${encodeURIComponent(`app:${appId}`)}`,
    {
      headers: ADMIN_HEADERS,
    },
  );
  return (
    (await response.json()) as {
      data: Array<{
        id: string;
        fingerprint: string;
        status: string;
        eventCount: number;
      }>;
    }
  ).data;
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
          payload: {
            event_id: eventId,
            level: "error",
            message,
            environment: "test",
          },
        },
      ]),
      receivedAt: new Date().toISOString(),
      type: "store",
    };

    await publishEventMessage(eventMessage);

    const issues = await waitFor(
      () => listIssues(app.appId),
      (data) => data.length === 1,
    );
    expect(issues[0]!.fingerprint).toBe(`msg:${message}`);
    expect(issues[0]!.status).toBe("unresolved");

    await waitFor(
      () =>
        Promise.resolve(
          webhookCalls.filter((body) => body.ruleName === ruleName),
        ),
      (calls) => calls.length === 1,
    );

    // A duplicate delivery of the identical message must not create a
    // second issue nor re-fire the one-shot new_issue alert.
    await publishEventMessage(eventMessage);
    await Bun.sleep(500);

    expect(await listIssues(app.appId)).toHaveLength(1);
    expect(
      webhookCalls.filter((body) => body.ruleName === ruleName),
    ).toHaveLength(1);
    const incidents = (await (
      await fetch(
        `${TEST_ORIGIN}/api/admin/alerting/incidents?appId=${app.appId}`,
        {
          headers: ADMIN_HEADERS,
        },
      )
    ).json()) as { data: Array<{ trigger: string }> };
    expect(incidents.data).toHaveLength(1);
    expect(incidents.data[0]!.trigger).toBe("new_issue");

    // The message-id guard keeps the counter at 1.
    const afterRedelivery = await listIssues(app.appId);
    expect(afterRedelivery).toHaveLength(1);
    expect(afterRedelivery[0]!.eventCount).toBe(1);
  });

  it("counts every item of a fingerprint in the message", async () => {
    const app = await startTestApp();
    const message = `hop three occurrences ${crypto.randomUUID()}`;
    const eventId = crypto.randomUUID();

    // Two items, one fingerprint: the transition fires once, the counter
    // grows by the occurrence count.
    await publishEventMessage({
      id: eventId,
      projectId: app.projectId,
      appId: app.appId,
      envelopeHeader: JSON.stringify({ event_id: eventId }),
      envelopeItems: JSON.stringify([
        {
          header: { type: "event", length: 0 },
          payload: { event_id: eventId, level: "error", message },
        },
        {
          header: { type: "event", length: 0 },
          payload: { event_id: eventId, level: "error", message },
        },
      ]),
      receivedAt: new Date().toISOString(),
      type: "store",
    });

    const issues = await waitFor(
      () => listIssues(app.appId),
      (data) => data.length === 1 && data[0]!.eventCount === 2,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.eventCount).toBe(2);
    expect(issues[0]!.fingerprint).toBe(`msg:${message}`);
  });

  it("increments event_count for a later occurrence of the same fingerprint", async () => {
    const app = await startTestApp();
    const message = `hop three again ${crypto.randomUUID()}`;

    const publish = async () => {
      const eventId = crypto.randomUUID();
      await publishEventMessage({
        id: eventId,
        projectId: app.projectId,
        appId: app.appId,
        envelopeHeader: JSON.stringify({ event_id: eventId }),
        envelopeItems: JSON.stringify([
          {
            header: { type: "event", length: 0 },
            payload: { event_id: eventId, level: "error", message },
          },
        ]),
        receivedAt: new Date().toISOString(),
        type: "store",
      });
    };

    await publish();
    await waitFor(
      () => listIssues(app.appId),
      (data) => data.length === 1 && data[0]!.eventCount === 1,
    );

    // A distinct message for the same fingerprint is a real occurrence.
    await publish();
    const issues = await waitFor(
      () => listIssues(app.appId),
      (data) => data.length === 1 && data[0]!.eventCount === 2,
    );
    expect(issues[0]!.eventCount).toBe(2);
  });

  it("sorts the issues by the distinct-user count synced from the index", async () => {
    const app = await startTestApp();
    const base = crypto.randomUUID();
    const publish = async (fingerprint: string, user: string | null) => {
      const eventId = crypto.randomUUID();
      await publishEventMessage({
        id: eventId,
        projectId: app.projectId,
        appId: app.appId,
        envelopeHeader: JSON.stringify({ event_id: eventId }),
        envelopeItems: JSON.stringify([]),
        issueEvents: JSON.stringify([
          {
            eventId,
            fingerprint,
            title: `Error ${base}`,
            culprit: "app.js:1",
            level: "error",
            type: "error",
            release: "1.0.0",
            environment: "test",
            user,
          },
        ]),
        receivedAt: new Date().toISOString(),
        type: "store",
      });
    };

    // Fingerprint A sees three distinct users; B one; C none.
    const fingerprintA = `usersA ${base}`;
    const fingerprintB = `usersB ${base}`;
    const userless = `usersC ${base}`;
    for (const user of ["u-1", "u-2", "u-3"]) await publish(fingerprintA, user);
    await publish(fingerprintB, "u-1");
    await publish(userless, null);

    const page = await waitFor(
      async () => {
        const response = await fetch(
          `${TEST_ORIGIN}/api/admin/issues?sort=users&query=${encodeURIComponent(`app:${app.appId}`)}`,
          { headers: ADMIN_HEADERS },
        );
        return (await response.json()) as {
          meta: { sort: string };
          data: Array<{ fingerprint: string; userCount: number }>;
        };
      },
      // The read syncs the counts and then orders on them; the sync is a
      // set value, so a repeat read converges even if the index lags.
      (result) => {
        if (result.meta.sort !== "users") return false;
        if (result.data.length < 3) return false;
        return result.data.some(
          (row) => row.fingerprint === fingerprintA && row.userCount === 3,
        );
      },
      20000,
    );
    expect(page.meta.sort).toBe("users");
    const byFingerprint = new Map(
      page.data.map((row) => [row.fingerprint, row.userCount]),
    );
    expect(byFingerprint.get(fingerprintA)).toBe(3);
    expect(byFingerprint.get(fingerprintB)).toBe(1);
    expect(byFingerprint.get(userless)).toBe(0);
    // The most-users issue comes first.
    expect(page.data[0]!.fingerprint).toBe(fingerprintA);
  });
});
