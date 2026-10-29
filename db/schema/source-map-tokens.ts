import { pgTable, text, index, uuid } from "drizzle-orm/pg-core";
import { isoTimestamp } from "./timestamps";
import { apps } from ".";
import { sql } from "drizzle-orm/sql";

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
      .references(() => apps.id),
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
