import type {
  ExperimentConfig,
  FeatureFlagStatus,
  FeatureFlagVariant,
  TargetingRule,
} from "backend/protocol/dsn";
import { db } from "db";
import { parseJson } from "db/json";
import { featureFlags } from "db/schema/feature-flags";
import { and, desc, eq, or, sql } from "drizzle-orm";
import type { PgInsertValue } from "drizzle-orm/pg-core";
import { conflict, notFound } from "backend/errors";

type FeatureFlagRow = typeof featureFlags.$inferSelect;

// JSON columns are stored as text; expose them as parsed values to callers.
function toFeatureFlag(row: FeatureFlagRow) {
  return {
    ...row,
    variants: parseJson<FeatureFlagVariant[]>(row.variants, []),
    targetingRules: parseJson<TargetingRule[]>(row.targetingRules, []),
    segments: parseJson<string[]>(row.segments, []),
    experiment: parseJson<ExperimentConfig | null>(row.experiment, null),
  };
}

export const featureFlagDAO = {
  create: async (data: Omit<PgInsertValue<typeof featureFlags>, "id"> & { id?: string }) => {
    const [row] = await db
      .insert(featureFlags)
      .values({ ...data, id: data.id ?? crypto.randomUUID() })
      .onConflictDoNothing({ target: featureFlags.key })
      .returning();
    if (!row) {
      throw conflict(`Feature flag key already exists: ${data.key}`);
    }
    return toFeatureFlag(row);
  },

  findById: async (id: string) => {
    const [row] = await db.select().from(featureFlags).where(eq(featureFlags.id, id)).limit(1);
    return row ? toFeatureFlag(row) : undefined;
  },

  findByIdOrThrow: async (id: string) => {
    const flag = await featureFlagDAO.findById(id);
    if (!flag) throw notFound("Feature flag", id);
    return flag;
  },

  findByKey: async (key: string) => {
    const [row] = await db.select().from(featureFlags).where(eq(featureFlags.key, key)).limit(1);
    return row ? toFeatureFlag(row) : undefined;
  },

  findByKeyOrThrow: async (key: string) => {
    const flag = await featureFlagDAO.findByKey(key);
    if (!flag) throw notFound("Feature flag", key);
    return flag;
  },

  updateOrThrow: async (id: string, obj: Partial<typeof featureFlags.$inferInsert>) => {
    const [row] = await db.update(featureFlags).set(obj).where(eq(featureFlags.id, id)).returning();
    if (!row) throw notFound("Feature flag", id);
    return toFeatureFlag(row);
  },

  list: async (options: {
    page: number;
    limit: number;
    status?: FeatureFlagStatus;
    type?: string;
    search?: string;
  }) => {
    const offset = (options.page - 1) * options.limit;

    const conditions = [];
    if (options.status) conditions.push(eq(featureFlags.status, options.status));
    if (options.type) conditions.push(eq(featureFlags.type, options.type));
    if (options.search) {
      const searchTerm = `%${options.search.toLowerCase()}%`;
      conditions.push(
        or(
          sql`lower(${featureFlags.key}) like ${searchTerm}`,
          sql`lower(${featureFlags.name}) like ${searchTerm}`,
        ),
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, total] = await Promise.all([
      db
        .select()
        .from(featureFlags)
        .where(whereClause)
        .orderBy(desc(featureFlags.updatedAt))
        .limit(options.limit)
        .offset(offset),
      db.$count(featureFlags, whereClause),
    ]);

    return { total, data: rows.map(toFeatureFlag) };
  },

  delete: async (id: string) => await db.delete(featureFlags).where(eq(featureFlags.id, id)),
};
