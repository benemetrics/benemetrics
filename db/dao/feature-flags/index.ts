import type {
  ExperimentConfig,
  FeatureFlagStatus,
  FeatureFlagType,
  FeatureFlagVariant,
  TargetingRule,
} from "backend/protocol/feature-flags";
import { db } from "db";
import {
  featureFlags,
  featureFlagPublicFields,
  userFeatureFlagAssigment as experimentAssignments,
  featureFlagMetrics as experimentMetrics,
} from "db/schema/feature-flags";
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { PgInsertValue } from "drizzle-orm/pg-core";
import { conflict, notFound } from "backend/errors";
import { uniqueViolationConstraint } from "db/pg-errors";
import { cursorLimit } from "../cursor";
import { whereNotNull } from "db/utils";

const KEY_CONSTRAINT = "feature_flags_scope_key_idx";

export interface FlagScope {
  /** The project scope. */
  projectId?: string | null;
  /** The app scope — the narrowest. */
  appId?: string | null;
}

export const featureFlagDAO = {
  create: async (
    data: Omit<PgInsertValue<typeof featureFlags>, "id"> & { id?: string },
  ) => {
    const [row] = await db
      .insert(featureFlags)
      .values({ ...data })
      .onConflictDoNothing()
      .returning(featureFlagPublicFields);
    if (!row) {
      throw conflict(`Feature flag key already exists: ${data.key}`);
    }
    return row;
  },

  findById: (id: string) =>
    db
      .select(featureFlagPublicFields)
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
      .select(featureFlagPublicFields)
      .from(featureFlags)
      .where(eq(featureFlags.key, key))
      .limit(1)
      .then(([row]) => row),

  /**
   * The flag that applies to a scope: the project's, else the unscoped one
   * (the narrower wins).
   */
  findByKeyForScope: async (key: string, scope: FlagScope) => {
    const { projectId = null } = scope;
    const scopes = [
      projectId ? eq(featureFlags.projectId, projectId) : null,
      and(isNull(featureFlags.projectId)),
    ].filter(
      (condition): condition is NonNullable<typeof condition> =>
        condition !== null,
    );

    const [row] = await db
      .select(featureFlagPublicFields)
      .from(featureFlags)
      .where(and(eq(featureFlags.key, key), or(...scopes)))
      .orderBy(
        // The project scope first, the unscoped last.
        sql`case when ${featureFlags.projectId} is not null then 0 else 1 end`,
      )
      .limit(1);
    return row;
  },

  updateOrThrow: async (
    id: string,
    obj: Partial<typeof featureFlags.$inferInsert>,
  ) => {
    try {
      const [row] = await db
        .update(featureFlags)
        .set(obj)
        .where(eq(featureFlags.id, id))
        .returning(featureFlagPublicFields);
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
    if (options.search) {
      const searchTerm = `%${options.search.toLowerCase()}%`;
      conditions.push(
        or(
          sql`lower(${featureFlags.key}) like ${searchTerm}`,
          sql`lower(${featureFlags.name}) like ${searchTerm}`,
        ),
      );
    }
    if (options.cursor) {
      conditions.push(lt(featureFlags.id, options.cursor));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const data = await db
      .select(featureFlagPublicFields)
      .from(featureFlags)
      .where(whereClause)
      .orderBy(desc(featureFlags.updatedAt), desc(featureFlags.id))
      .limit(limit);

    return data;
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
