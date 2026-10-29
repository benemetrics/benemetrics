import {
  pgTable,
  text,
  integer,
  index,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";
import { isoTimestamp } from "./timestamps";
import { apps } from "./apps";

// A release is a deployable version of an app. It is normally
// auto-created when the first event carrying its version is
// ingested; metrics (firstSeen/lastSeen/eventCount/latestEventId)
// are maintained on every matching event.
export const releases = pgTable(
  "releases",
  {
    id: uuid("id")
      .default(sql`uuidv7()`)
      .primaryKey(),
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    version: text("version").notNull(),
    firstSeen: isoTimestamp("first_seen"),
    lastSeen: isoTimestamp("last_seen"),
    eventCount: integer("event_count").notNull().default(0),
    latestEventId: text("latest_event_id"),
    createdAt: isoTimestamp("created_at")
      .notNull()
      .default(sql`now()`),
    updatedAt: isoTimestamp("updated_at")
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => sql`now()`),
  },
  (table) => [index().on(table.appId)],
);

export type Release = typeof releases.$inferSelect;
export type ReleaseInsert = typeof releases.$inferInsert;

export const releasePublicFields = {
  id: releases.id,
  appId: releases.appId,
  version: releases.version,
  firstSeen: releases.firstSeen,
  lastSeen: releases.lastSeen,
  eventCount: releases.eventCount,
  latestEventId: releases.latestEventId,
  createdAt: releases.createdAt,
  updatedAt: releases.updatedAt,
};
