import type {
  ExperimentConfig,
  FeatureFlagStatus,
  FeatureFlagType,
  FeatureFlagVariant,
  TargetingRule,
} from "backend/protocol/feature-flags";
import { db } from "db";
import { featureFlags } from "db/schema/feature-flags";
import { experimentAssignments } from "db/schema/experiment-assignments";
import { experimentMetrics } from "db/schema/experiment-metrics";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import type { PgInsertValue } from "drizzle-orm/pg-core";
import { conflict, notFound } from "backend/errors";
import { uniqueViolationConstraint } from "db/pg-errors";
import type { Executor } from "./executor";
import { cursorAfter, cursorLimit } from "./cursor";

const KEY_CONSTRAINT = "feature_flags_scope_key_idx";

export interface FlagScope {
  /** The project scope. */
  projectId?: string | null;
  /** The app scope — the narrowest. */
  appId?: string | null;
}

// The API exposes the JSON columns decoded and the enum-ish text columns
// typed, so the DAO returns the protocol shape directly.
const featureFlagFields = {
  id: featureFlags.id,
  key: featureFlags.key,
  name: featureFlags.name,
  description: featureFlags.description,
  type: sql<FeatureFlagType>`${featureFlags.type}`,
  defaultValue: featureFlags.defaultValue,
  variants: sql<FeatureFlagVariant[]>`${featureFlags.variants}::jsonb`,
  targetingRules: sql<TargetingRule[]>`${featureFlags.targetingRules}::jsonb`,
  segments: sql<string[]>`${featureFlags.segments}::jsonb`,
  status: sql<FeatureFlagStatus>`${featureFlags.status}`,
  rolloutPercentage: featureFlags.rolloutPercentage,
  projectId: featureFlags.projectId,
  appId: featureFlags.appId,
  experiment: sql<ExperimentConfig | null>`${featureFlags.experiment}::jsonb`,
  updatedAt: featureFlags.updatedAt,
};

export const featureFlagDAO = {
  create: async (
    data: Omit<PgInsertValue<typeof featureFlags>, "id"> & { id?: string },
  ) => {
    const [row] = await db
      .insert(featureFlags)
      .values({ ...data, id: data.id ?? crypto.randomUUID() })
      .onConflictDoNothing()
      .returning(featureFlagFields);
    if (!row) {
      throw conflict(`Feature flag key already exists: ${data.key}`);
    }
    return row;
  },

  findById: (id: string) =>
    db
      .select(featureFlagFields)
      .from(featureFlags)
      .where(eq(featureFlags.id, id))
      .limit(1)
      .then(([row]) => row),

  findByIdOrThrow: async (id: string) => {
    const flag = await featureFlagDAO.findById(id);
    if (!flag) throw notFound("Feature flag", id);
    return flag;
  },

  findByKey: (key: string) =>
    db
      .select(featureFlagFields)
      .from(featureFlags)
      .where(eq(featureFlags.key, key))
      .limit(1)
      .then(([row]) => row),

  /**
   * The flag that applies to a scope: the app's own, else the project's,
   * else the unscoped one (the narrower wins).
   */
  findByKeyForScope: async (key: string, scope: FlagScope) => {
    const { projectId = null, appId = null } = scope;
    const scopes = [
      appId ? eq(featureFlags.appId, appId) : null,
      projectId ? eq(featureFlags.projectId, projectId) : null,
      and(isNull(featureFlags.projectId), isNull(featureFlags.appId)),
    ].filter(
      (condition): condition is NonNullable<typeof condition> =>
        condition !== null,
    );

    const [row] = await db
      .select(featureFlagFields)
      .from(featureFlags)
      .where(and(eq(featureFlags.key, key), or(...scopes)))
      .orderBy(
        // The app scope first, the project scope next, the unscoped last.
        sql`case when ${featureFlags.appId} is not null then 0 when ${featureFlags.projectId} is not null then 1 else 2 end`,
      )
      .limit(1);
    return row;
  },

  updateOrThrow: async (
    id: string,
    obj: Partial<typeof featureFlags.$inferInsert>,
    executor: Executor = db,
  ) => {
    try {
      const [row] = await executor
        .update(featureFlags)
        .set(obj)
        .where(eq(featureFlags.id, id))
        .returning(featureFlagFields);
      if (!row) throw notFound("Feature flag", id);
      return row;
    } catch (err) {
      if (uniqueViolationConstraint(err) === KEY_CONSTRAINT) {
        throw conflict(`Feature flag key already exists: ${obj.key}`);
      }
      throw err;
    }
  },

  list: async (options: {
    cursor?: string;
    limit?: number;
    status?: FeatureFlagStatus;
    type?: string;
    search?: string;
    projectId?: string | null;
    appId?: string | null;
  }) => {
    const limit = cursorLimit(options.limit);

    const conditions = [];
    if (options.status)
      conditions.push(eq(featureFlags.status, options.status));
    if (options.type) conditions.push(eq(featureFlags.type, options.type));
    if (options.projectId !== undefined && options.projectId !== null) {
      conditions.push(eq(featureFlags.projectId, options.projectId));
    }
    if (options.appId !== undefined && options.appId !== null) {
      conditions.push(eq(featureFlags.appId, options.appId));
    }
    if (options.search) {
      const searchTerm = `%${options.search.toLowerCase()}%`;
      conditions.push(
        or(
          sql`lower(${featureFlags.key}) like ${searchTerm}`,
          sql`lower(${featureFlags.name}) like ${searchTerm}`,
        ),
      );
    }

    const { condition, empty } = await cursorAfter(
      featureFlags,
      featureFlags.id,
      featureFlags.updatedAt,
      options.cursor,
    );
    if (empty) return { data: [] };
    if (condition) conditions.push(condition);

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const data = await db
      .select(featureFlagFields)
      .from(featureFlags)
      .where(whereClause)
      .orderBy(desc(featureFlags.updatedAt), desc(featureFlags.id))
      .limit(limit);

    return { data };
  },

  delete: async (id: string) => {
    await Promise.all([
      db
        .delete(experimentAssignments)
        .where(eq(experimentAssignments.flagId, id)),
      db.delete(experimentMetrics).where(eq(experimentMetrics.flagId, id)),
    ]);
    await db.delete(featureFlags).where(eq(featureFlags.id, id));
  },
};
