import { pgTable, text, integer, index, uniqueIndex } from "drizzle-orm/pg-core";

export const featureFlags = pgTable(
  "feature_flags",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").default(""),
    type: text("type").notNull(),
    defaultValue: text("default_value").notNull(),
    variants: text("variants").notNull().default("[]"),
    targetingRules: text("targeting_rules").notNull().default("[]"),
    segments: text("segments").notNull().default("[]"),
    status: text("status").notNull().default("draft"),
    rolloutPercentage: integer("rollout_percentage").notNull().default(100),
    experiment: text("experiment"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    keyIdx: index("feature_flags_key_idx").on(table.key),
    statusIdx: index("feature_flags_status_idx").on(table.status),
  }),
);

export type FeatureFlag = typeof featureFlags.$inferSelect;
export type FeatureFlagInsert = typeof featureFlags.$inferInsert;