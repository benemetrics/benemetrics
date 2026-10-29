import { db } from "db";
import { releasePublicFields, releases, type Release, type ReleaseInsert } from "db/schema/releases";
import { and, desc, eq, sql } from "drizzle-orm";
import { conflict, notFound } from "backend/errors";
import { cursorLimit } from "../cursor";

// Every release field is part of the API response; the projection keeps
// the response shape stable if the table grows more columns.



export const releaseDAO = {
  create: async (data: ReleaseInsert) => {
    const [created] = await db
      .insert(releases)
      .values(data)
      .onConflictDoNothing({ target: [releases.appId, releases.version] })
      .returning(releasePublicFields)
    if (!created) throw conflict(`Release already exists for app: ${data.version}`);
    return created;
  },

  findById: (id: string) => db
      .select(releasePublicFields)
      .from(releases)
      .where(eq(releases.id, id))
      .limit(1)
      .then(([row]) => row),

  findByIdOrThrow: async (id: string) => {
    const release = await releaseDAO.findById(id);
    if (!release) throw notFound("Release", id);
    return release;
  },

  findByAppAndVersion: (
    appId: string,
    version: string,
  ) => db
      .select(releasePublicFields)
      .from(releases)
      .where(and(eq(releases.appId, appId), eq(releases.version, version)))
      .limit(1)
      .then(([row]) => row),

  findByAppAndVersionOrThrow: async (appId: string, version: string) => {
    const release = await releaseDAO.findByAppAndVersion(appId, version);
    if (!release) throw notFound("Release", version);
    return release;
  },

  // Used where a release is provisioned implicitly (sentry-cli
  // "releases new", source map upload).
  findOrCreate: async (data: ReleaseInsert) => {
    const created = await releaseDAO.create(data);
    if (created) return created;
    return releaseDAO.findByAppAndVersionOrThrow(data.appId, data.version);
  },

  // Records an ingested event against its release: creates the release
  // row on first sight, then maintains lastSeen / eventCount /
  // latestEventId on every subsequent event.
  recordEvent: async (
    appId: string,
    version: string,
    event: { eventId: string; at: string },
  ): Promise<Release> => {
    const now = new Date().toISOString();
    const [row] = await db
      .insert(releases)
      .values({
        appId,
        version,
        firstSeen: event.at,
        lastSeen: event.at,
        eventCount: 1,
        latestEventId: event.eventId,
      })
      .onConflictDoUpdate({
        target: [releases.appId, releases.version],
        set: {
          firstSeen: sql`case when ${releases.firstSeen} is null or ${event.at} < ${releases.firstSeen} then ${event.at} else ${releases.firstSeen} end`,
          lastSeen: sql`case when ${releases.lastSeen} is null or ${event.at} > ${releases.lastSeen} then ${event.at} else ${releases.lastSeen} end`,
          eventCount: sql`${releases.eventCount} + 1`,
          latestEventId: sql`case when ${releases.lastSeen} is null or ${event.at} > ${releases.lastSeen} then ${event.eventId} else ${releases.latestEventId} end`,
          updatedAt: now,
        },
        // Redelivered events must not be counted twice.
        where: sql`${releases.latestEventId} is distinct from ${event.eventId}`,
      })
      .returning(releasePublicFields);
    if (row) return row;
    return releaseDAO.findByAppAndVersionOrThrow(appId, version);
  },

  list: async (options: {
    appId?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ data: Release[] }> => {
    const limit = cursorLimit(options.limit);
    // Releases without an event yet fall back to the creation time, which is
    // encoded in the uuidv7 id, so the keyset order matches the coalesced
    // sort expression exactly.
    const sort = sql`coalesce(${releases.lastSeen}, ${releases.id})`;
    const scope = options.appId ? eq(releases.appId, options.appId) : undefined;
    const { condition, empty } = await cursorAfter(
      releases,
      releases.id,
      sort,
      options.cursor,
    );
    if (empty) return { data: [] };
    const where =
      scope && condition ? and(scope, condition) : (scope ?? condition);

    const data = await db
      .select(releasePublicFields)
      .from(releases)
      .where(where)
      .orderBy(desc(sort), desc(releases.id))
      .limit(limit);

    return { data };
  },

  updateOrThrow: async (id: string, data: Partial<ReleaseInsert>) => {
    const updated = (
      await db
        .update(releases)
        .set({ ...data, updatedAt: new Date().toISOString() })
        .where(eq(releases.id, id))
        .returning(releasePublicFields)
    )[0];
    if (!updated) throw notFound("Release", id);
    return updated;
  },

  delete: async (id: string) => {
    const deleted = await db
      .delete(releases)
      .where(eq(releases.id, id))
      .returning({ id: releases.id });
    return deleted.length > 0;
  },
};
