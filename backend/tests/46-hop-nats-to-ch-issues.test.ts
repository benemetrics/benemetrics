/**
 * Hop 5 — NATS -> ClickHouse issue index (the drill-down source).
 *
 * The digests the ingest handler attached to the message land in the
 * derived `sentry_issue_events` index, so the issue's occurrences and
 * stats are read from ClickHouse instead of re-fingerprinting the events.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import type { NatsConnection } from "@nats-io/transport-node";
import { jetstream as createJetstream, type JetStreamClient } from "@nats-io/jetstream";
import { clickHouseIssueFingerprintsByLevel } from "../clickhouse";
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

beforeAll(async () => {
  nats = await connectTestNats();
  jetstream = createJetstream(nats);
});

afterAll(async () => {
  await nats.close();
});

function publishEventMessage(message: Record<string, unknown>) {
  return jetstream.publish(
    TEST_EVENTS_SUBJECT,
    new TextEncoder().encode(JSON.stringify(message)),
  );
}

function digest(eventId: string, fingerprint: string) {
  return {
    eventId,
    fingerprint,
    title: "Error: boom",
    culprit: "app.js:12",
    level: "error",
    type: "error",
    release: "1.2.3",
    environment: "production",
    user: "u-1",
  };
}

async function findIssueId(
  appId: string,
  fingerprint: string,
): Promise<string | undefined> {
  const response = await fetch(`${TEST_ORIGIN}/api/admin/issues?query=${encodeURIComponent(`app:${appId}`)}`, {
    headers: ADMIN_HEADERS,
  });
  const issues = (
    (await response.json()) as { data: Array<{ id: string; fingerprint: string }> }
  ).data;
  return issues.find((entry) => entry.fingerprint === fingerprint)?.id;
}

describe("Hop 5: NATS -> ClickHouse issue index", () => {
  it("indexes the digests and serves the occurrences and the stats", async () => {
    const app = await startTestApp();
    const eventId = crypto.randomUUID();
    const fingerprint = `Error@app.js:boom-${eventId}`;

    await publishEventMessage({
      id: eventId,
      projectId: app.projectId,
      appId: app.appId,
      envelopeHeader: JSON.stringify({ event_id: eventId }),
      envelopeItems: JSON.stringify([]),
      issueEvents: JSON.stringify([digest(eventId, fingerprint)]),
      receivedAt: new Date().toISOString(),
      type: "store",
    });

    // The index is filled asynchronously by the ClickHouse engine.
    const page = await waitFor(
      async () => {
        const issueId = await findIssueId(app.appId, fingerprint);
        if (!issueId) return undefined;
        const response = await fetch(
          `${TEST_ORIGIN}/api/admin/issues/${issueId}/events`,
          { headers: ADMIN_HEADERS },
        );
        return (await response.json()) as { data: Array<{ eventId: string }> };
      },
      (result) => result !== undefined && result.data.length > 0,
      15000,
    );

    expect(page!.data).toHaveLength(1);
    expect(page!.data[0]!.eventId).toBe(eventId);

    const issueId = (await findIssueId(app.appId, fingerprint))!;
    const stats = (await (
      await fetch(`${TEST_ORIGIN}/api/admin/issues/${issueId}/stats`, {
        headers: ADMIN_HEADERS,
      })
    ).json()) as {
      stepSeconds: number;
      points: Array<{ eventCount: number; userCount: number }>;
      totals: { eventCount: number; userCount: number };
    };

    expect(stats.totals.eventCount).toBe(1);
    expect(stats.totals.userCount).toBe(1);
    expect(stats.points.length).toBeGreaterThan(0);
    expect(stats.stepSeconds).toBeGreaterThan(0);
  }, 30000);

  it("filters the issues by the level, the user and the tag", async () => {
    const app = await startTestApp();
    const eventId = crypto.randomUUID();
    const fingerprint = `Error@app.js:tagged-${eventId}`;

    await publishEventMessage({
      id: eventId,
      projectId: app.projectId,
      appId: app.appId,
      envelopeHeader: JSON.stringify({ event_id: eventId }),
      envelopeItems: JSON.stringify([]),
      issueEvents: JSON.stringify([
        { ...digest(eventId, fingerprint), level: "warning", user: "u-gold", tags: { tier: "gold" } },
      ]),
      receivedAt: new Date().toISOString(),
      type: "store",
    });

    // The index is filled asynchronously by the ClickHouse engine.
    await waitFor(
      async () =>
        clickHouseIssueFingerprintsByLevel({
          level: "warning",
          appIds: [app.appId],
        }),
      (fingerprints) => fingerprints.includes(fingerprint),
      15000,
    );

    const withFilter = async (query: string): Promise<Array<{ fingerprint: string }>> => {
      const response = await fetch(
        `${TEST_ORIGIN}/api/admin/issues?query=${encodeURIComponent(query)}`,
        { headers: ADMIN_HEADERS },
      );
      expect(response.status).toBe(200);
      return (
        (await response.json()) as { data: Array<{ fingerprint: string }> }
      ).data;
    };

    // The level, the user and the tag match any occurrence.
    const byLevel = await withFilter(`level:warning app:${app.appId}`);
    expect(byLevel.some((entry) => entry.fingerprint === fingerprint)).toBe(true);

    const byUser = await withFilter(`user:u-gold app:${app.appId}`);
    expect(byUser.some((entry) => entry.fingerprint === fingerprint)).toBe(true);

    const byTag = await withFilter(`tag:tier:gold app:${app.appId}`);
    expect(byTag.some((entry) => entry.fingerprint === fingerprint)).toBe(true);

    // A tag that does not match excludes the issue.
    const byOtherTag = await withFilter(`tag:tier:silver app:${app.appId}`);
    expect(byOtherTag.some((entry) => entry.fingerprint === fingerprint)).toBe(false);
  }, 30000);
});
