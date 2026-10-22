import {
  pgTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";
import { isoTimestamp } from "./timestamps";

// A release is a deployable version of an app. It is normally
// auto-created when the first event carrying its version is
// ingested; metrics (firstSeen/lastSeen/eventCount/latestEventId)
// are maintained on every matching event.
export const releases = pgTable(
  "releases",
  {
    id: text("id").primaryKey(),
    appId: text("app_id").notNull(),
    version: text("version").notNull(),
    ref: text("ref"),
    url: text("url"),
    owner: text("owner"),
    status: text("status").notNull().default("draft"),
    firstSeen: isoTimestamp("first_seen"),
    lastSeen: isoTimestamp("last_seen"),
    eventCount: integer("event_count").notNull().default(0),
    latestEventId: text("latest_event_id"),
    createdAt: isoTimestamp("created_at").notNull().default(sql`now()`),
    updatedAt: isoTimestamp("updated_at").notNull().default(sql`now()`),
  },
  (table) => ({
    appIdIdx: index("releases_app_id_idx").on(table.appId),
    lastSeenIdx: index("releases_last_seen_idx").on(table.lastSeen),
    appVersionUnique: uniqueIndex("releases_app_version_idx").on(
      table.appId,
      table.version,
    ),
  }),
);

export type Release = typeof releases.$inferSelect;
export type ReleaseInsert = typeof releases.$inferInsert;
