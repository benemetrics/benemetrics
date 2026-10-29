import { db } from "db";
import { experimentAssignments } from "db/schema/experiment-assignments";
import { countDistinct, desc, eq, and, sql } from "drizzle-orm";
import { internalError } from "backend/errors";
import { cursorAfter, cursorLimit } from "./cursor";

// Sticky-assignment lookups only need the variant identity.
const assignmentLookupFields = {
  id: experimentAssignments.id,
  variantKey: experimentAssignments.variantKey,
  assignedAt: experimentAssignments.assignedAt,
};

// The experiment users endpoint lists the participant's id (stored as
// userId), its stored variant, and the context snapshot.
const assignmentListFields = {
  userId: experimentAssignments.userId,
  variantKey: experimentAssignments.variantKey,
  context: sql<unknown>`${experimentAssignments.context}::jsonb`,
  assignedAt: experimentAssignments.assignedAt,
};

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
      .returning(assignmentLookupFields);
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

  findByFlagAndUser: async (flagId: string, userId: string) =>
    (
      await db
        .select(assignmentLookupFields)
        .from(experimentAssignments)
        .where(
          and(
            eq(experimentAssignments.flagId, flagId),
            eq(experimentAssignments.userId, userId),
          ),
        )
        .limit(1)
    )[0],

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

    const { condition, empty } = await cursorAfter(
      experimentAssignments,
      experimentAssignments.id,
      experimentAssignments.assignedAt,
      options.cursor,
    );
    if (empty) return { data: [] };
    if (condition) conditions.push(condition);

    const data = await db
      .select(assignmentListFields)
      .from(experimentAssignments)
      .where(and(...conditions))
      .orderBy(
        desc(experimentAssignments.assignedAt),
        desc(experimentAssignments.id),
      )
      .limit(limit);

    return { data };
  },

  countByVariant: async (flagId: string): Promise<VariantCount[]> =>
    db
      .select({
        variantKey: experimentAssignments.variantKey,
        count: countDistinct(experimentAssignments.userId),
      })
      .from(experimentAssignments)
      .where(eq(experimentAssignments.flagId, flagId))
      .groupBy(experimentAssignments.variantKey),
};
