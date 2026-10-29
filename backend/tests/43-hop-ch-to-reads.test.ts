/**
 * Hop 4 — ClickHouse -> API reads.
 *
 * Rows are seeded directly (bypassing ingestion entirely); the events
 * API must serve them: list with project/app filters and pagination,
 * detail by id, and 404 for unknown ids.
 */

import { describe, it, expect } from "bun:test";
import { insertClickHouseEvents } from "../clickhouse";
import {
  ADMIN_HEADERS,
  handleFetch as fetch,
  startTestApp,
  TEST_ORIGIN,
  waitForApiGet,
} from "./test-helpers";

async function seedEvent(
  app: { projectId: string; appId: string },
  eventId: string,
  message: string,
  receivedAt: string,
): Promise<void> {
  await insertClickHouseEvents([
    {
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
      receivedAt,
    },
  ]);
}

interface ListBody {
  data: Array<{
    id: string;
    receivedAt: string;
    itemTypes: string[];
    event: { message?: string } | null;
  }>;
}

describe("Hop 4: ClickHouse -> reads", () => {
  it("serves directly seeded rows in the list, by id, and 404s unknowns", async () => {
    const app = await startTestApp();
    const secondApp = (await (
      await fetch(`${TEST_ORIGIN}/api/admin/projects/${app.projectId}/apps`, {
        method: "POST",
        headers: ADMIN_HEADERS,
        body: JSON.stringify({ name: "Hop 4 Second App" }),
      })
    ).json()) as { id: string };

    const now = Date.now();
    const oldest = crypto.randomUUID();
    const newest = crypto.randomUUID();
    const other = crypto.randomUUID();
    await seedEvent(
      app,
      oldest,
      "seeded oldest",
      new Date(now - 120_000).toISOString(),
    );
    await seedEvent(
      app,
      newest,
      "seeded newest",
      new Date(now - 60_000).toISOString(),
    );
    await seedEvent(
      { projectId: app.projectId, appId: secondApp.id },
      other,
      "seeded other app",
      new Date(now - 30_000).toISOString(),
    );

    const list = (await (
      await fetch(`${TEST_ORIGIN}/events?projectId=${app.projectId}&limit=10`, {
        headers: ADMIN_HEADERS,
      })
    ).json()) as ListBody;
    expect(list.data).toHaveLength(3);
    // Newest first.
    expect(list.data.map((item) => item.id)).toEqual([other, newest, oldest]);
    const newestItem = list.data.find((item) => item.id === newest)!;
    expect(newestItem.event?.message).toBe("seeded newest");
    expect(newestItem.itemTypes).toEqual(["event"]);

    const scoped = (await (
      await fetch(
        `${TEST_ORIGIN}/events?projectId=${app.projectId}&appId=${app.appId}&limit=10`,
        {
          headers: ADMIN_HEADERS,
        },
      )
    ).json()) as ListBody;
    expect(scoped.data).toHaveLength(2);
    expect(scoped.data.map((item) => item.id)).toEqual([newest, oldest]);

    // A `since` bounds the window in time: the event older than the cutoff
    // drops out, the rest stay.
    const since = (await (
      await fetch(
        `${TEST_ORIGIN}/events?projectId=${app.projectId}&limit=10&since=${encodeURIComponent(new Date(now - 90_000).toISOString())}`,
        { headers: ADMIN_HEADERS },
      )
    ).json()) as ListBody;
    expect(since.data).toHaveLength(2);
    expect(since.data.map((item) => item.id)).toEqual([other, newest]);

    const paged = (await (
      await fetch(`${TEST_ORIGIN}/events?projectId=${app.projectId}&limit=2`, {
        headers: ADMIN_HEADERS,
      })
    ).json()) as ListBody;
    expect(paged.data).toHaveLength(2);

    const cursor = paged.data[paged.data.length - 1]!.id;
    const nextPage = (await (
      await fetch(
        `${TEST_ORIGIN}/events?projectId=${app.projectId}&limit=2&cursor=${cursor}`,
        { headers: ADMIN_HEADERS },
      )
    ).json()) as ListBody;
    expect(nextPage.data).toHaveLength(1);
    expect(nextPage.data[0]!.id).not.toBe(cursor);

    const detail = await waitForApiGet<{ event_id: string; message?: string }>(
      `/events/${newest}`,
    );
    // The detail route returns the event payload itself.
    expect(detail.event_id).toBe(newest);
    expect(detail.message).toBe("seeded newest");

    const missing = await fetch(
      `${TEST_ORIGIN}/events/${crypto.randomUUID()}`,
      {
        headers: ADMIN_HEADERS,
      },
    );
    expect(missing.status).toBe(404);
  });
});
