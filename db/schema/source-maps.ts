import { pgTable, text, index, uuid } from "drizzle-orm/pg-core";
import { isoTimestamp } from "./timestamps";
import { sql } from "drizzle-orm/sql";
import { apps } from "./apps";

export const sourceMaps = pgTable(
  "source_maps",
  {
    id: uuid("id")
      .default(sql`uuidv7()`)
      .primaryKey(),
    appId: uuid("app_id")
      .references(() => apps.id, { onDelete: 'cascade' })
      .notNull(),
    release: text("release").notNull(),
    dist: text("dist"),
    filename: text("filename").notNull(),
    mapJson: text("map_json").notNull(),
    createdAt: isoTimestamp("created_at")
      .default(sql`now()`)
      .notNull(),
    updatedAt: isoTimestamp("updated_at")
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => sql`now()`),
  },
  (table) => [index().on(table.appId)],
);

export const artifactPublicFields = {
  id: sourceMaps.id,
  appId: sourceMaps.appId,
  release: sourceMaps.release,
  dist: sourceMaps.dist,
  name: sourceMaps.filename,
  size: sql<number>`octet_length(${sourceMaps.mapJson})`,
  createdAt: sourceMaps.createdAt,
  updatedAt: sourceMaps.updatedAt,
};

export type SourceMap = typeof sourceMaps.$inferSelect;
export type SourceMapInsert = typeof sourceMaps.$inferInsert;

// CI upload token for source maps (sentry-cli / SENTRY_AUTH_TOKEN).
// Scoped to one project + environment; only the SHA-256 hash of the
// raw token is ever stored. The raw token is returned once at creation
// (and once per rotation).
export const sourceMapTokens = pgTable(
  "source_map_tokens",
  {
    id: uuid("id")
      .default(sql`uuidv7()`)
      .primaryKey(),
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    tokenHash: text("token_hash").notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    name: text("name").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: isoTimestamp("created_at")
      .default(sql`now()`)
      .notNull(),
    lastUsedAt: isoTimestamp("last_used_at"),
    expiresAt: isoTimestamp("expires_at"),
    revokedAt: isoTimestamp("revoked_at"),
  },
  (t) => [index().on(t.appId), index().on(t.tokenHash)],
);

export const tokenPublicFields = {
  id: sourceMapTokens.id,
  name: sourceMapTokens.name,
  appId: sourceMapTokens.appId,
  tokenPrefix: sourceMapTokens.tokenPrefix,
  createdBy: sourceMapTokens.createdBy,
  createdAt: sourceMapTokens.createdAt,
  lastUsedAt: sourceMapTokens.lastUsedAt,
  expiresAt: sourceMapTokens.expiresAt,
  revokedAt: sourceMapTokens.revokedAt,
};

export type SourceMapToken = typeof sourceMapTokens.$inferSelect;
export type SourceMapTokenInsert = typeof sourceMapTokens.$inferInsert;

