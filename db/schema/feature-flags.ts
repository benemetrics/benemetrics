import {
  pgTable,
  text,
  integer,
  index,
  uniqueIndex,
  uuid,
  real,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";
import { isoTimestamp } from "./timestamps";
import { projects } from "./project";

export const featureFlags = pgTable(
  "feature_flags",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description").default(""),
    type: text("type").notNull(),
    defaultValue: text("default_value").notNull(),
    variants: text("variants").notNull().default("[]"),
    targetingRules: text("targeting_rules").notNull().default("[]"),
    segments: text("segments").notNull().default("[]"),
    status: text("status").notNull().default("draft"),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: 'cascade' }),
    rolloutPercentage: integer("rollout_percentage").notNull().default(100),
    experiment: text("experiment"),
    updatedAt: isoTimestamp("updated_at")
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => sql`now()`),
  },
  (table) => [
    index().on(table.key),
    index().on(table.status),
    index().on(table.projectId), 
  ],
);

export type FeatureFlag = typeof featureFlags.$inferSelect;

export const userFeatureFlagAssigment = pgTable(
  "user_feature_flags_assigment",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    flagId: uuid("flag_id").notNull().references(() => featureFlags.id, { onDelete: 'cascade' }),
    userId: uuid("user_id").notNull(),
    variantKey: text("variant_key").notNull(),
    context: text("context").notNull().default("{}"),
    assignedAt: isoTimestamp("assigned_at").notNull(),
  },
  (table) => [
    uniqueIndex().on(
      table.flagId,
      table.userId,
    ),
    index().on(table.flagId),
    index().on(table.userId)
  ],
);

export type ExperimentAssignment = typeof userFeatureFlagAssigment.$inferSelect;

export const segments = pgTable("segments", {
  id: uuid("id")
    .default(sql`uuidv7()`)
    .primaryKey(),
  name: text("name").notNull(),
  description: text("description").default(""),
  rules: text("rules").notNull().default("[]"),
});

export type Segment = typeof segments.$inferSelect;

export const featureFlagMetrics = pgTable(
  "experiment_metrics",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    flagId: uuid("flag_id").notNull().references(() => featureFlags.id, { onDelete: 'cascade' }),
    variantKey: text("variant_key").notNull(),
    userId: text("user_id").notNull(),
    metricName: text("metric_name").notNull(),
    value: real("value").notNull().default(1),
    recordedAt: isoTimestamp("recorded_at").notNull(),
  },
  (table) => [
    index().on(
      table.flagId,
      table.metricName,
    ),
    index().on(table.flagId)
  ],
);

export type ExperimentMetric = typeof featureFlagMetrics.$inferSelect;