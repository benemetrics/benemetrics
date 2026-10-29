import { db } from "db";
import {
  assignmentPublicFields,
  experimentAssignments,
} from "db/schema/feature-flags";
import { countDistinct, desc, eq, and, lt, sql } from "drizzle-orm";
import { internalError } from "backend/errors";
import { cursorLimit } from "../cursor";
import { whereNotNull } from "db/utils";

export interface VariantCount {
  variantKey: string;
  count: number;
}

export const experimentAssignmentDAO = {
  create: async (data: {
    flagId: string;
    userId: string;
    variantKey: string;
    context: string;
    id?: string;
    assignedAt?: string;
  }) => {
    const [row] = await db
      .insert(experimentAssignments)
      .values({
        ...data,
        assignedAt: data.assignedAt ?? new Date().toISOString(),
      })
      // (flagId, userId) is unique: concurrent evaluations of the
      // same user must not create a second assignment (or 500).
      .onConflictDoNothing({
        target: [experimentAssignments.flagId, experimentAssignments.userId],
      })
      .returning(assignmentPublicFields);
    if (row) return row;

    const existing = await experimentAssignmentDAO.findByFlagAndUser(
      data.flagId,
      data.userId,
    );
    if (!existing) {
      throw internalError("Failed to create experiment assignment");
    }
    return existing;
  },

  findByFlagAndUser: (flagId: string, userId: string) =>
    db
      .select(assignmentPublicFields)
      .from(experimentAssignments)
      .where(
        and(
          eq(experimentAssignments.flagId, flagId),
          eq(experimentAssignments.userId, userId),
        ),
      )
      .limit(1)
      .then(([row]) => row),

  listByFlag: async (
    flagId: string,
    options: {
      cursor?: string;
      limit?: number;
      variantKey?: string;
      search?: string;
    },
  ) => {
    const limit = cursorLimit(options.limit);

    const conditions = [eq(experimentAssignments.flagId, flagId)];
    if (options.variantKey) {
      conditions.push(eq(experimentAssignments.variantKey, options.variantKey));
    }
    if (options.search) {
      conditions.push(
        sql`lower(${experimentAssignments.userId}) like ${`%${options.search.toLowerCase()}%`}`,
      );
    }
    if (options.cursor) {
      conditions.push(lt(experimentAssignments.id, options.cursor));
    }

    const data = await db
      .select(assignmentPublicFields)
      .from(experimentAssignments)
      .where(and(...conditions))
      .orderBy(
        desc(experimentAssignments.assignedAt),
        desc(experimentAssignments.id),
      )
      .limit(limit);

    return data;
  },

  countByVariant: (flagId: string): Promise<VariantCount[]> =>
    db
      .select({
        variantKey: experimentAssignments.variantKey,
        count: countDistinct(experimentAssignments.userId),
      })
      .from(experimentAssignments)
      .where(
        and(
          eq(experimentAssignments.flagId, flagId),
        ),
      )
      .groupBy(experimentAssignments.variantKey),
};
