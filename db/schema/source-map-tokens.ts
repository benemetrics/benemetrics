import {
  pgTable,
  text,
  index,
} from "drizzle-orm/pg-core";
import { isoTimestamp } from "./timestamps";

// CI upload token for source maps (sentry-cli / SENTRY_AUTH_TOKEN).
// Scoped to one project + environment; only the SHA-256 hash of the
// raw token is ever stored. The raw token is returned once at creation
// (and once per rotation).
export const sourceMapTokens = pgTable(
  "source_map_tokens",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    appId: text("app_id").notNull(),
    environmentId: text("environment_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    name: text("name").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: isoTimestamp("created_at").notNull(),
    lastUsedAt: isoTimestamp("last_used_at"),
    expiresAt: isoTimestamp("expires_at"),
    revokedAt: isoTimestamp("revoked_at"),
  },
  (table) => ({
    projectIdIdx: index("source_map_tokens_project_id_idx").on(table.projectId),
    appIdIdx: index("source_map_tokens_app_id_idx").on(table.appId),
    environmentIdIdx: index("source_map_tokens_environment_id_idx").on(
      table.environmentId,
    ),
    tokenHashIdx: index("source_map_tokens_hash_idx").on(table.tokenHash),
  }),
);

export type SourceMapToken = typeof sourceMapTokens.$inferSelect;
export type SourceMapTokenInsert = typeof sourceMapTokens.$inferInsert;
