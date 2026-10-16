import { db } from "db";
import { experimentAssignments } from "db/schema/experiment-assignments";
import { countDistinct, desc, eq, and, sql } from "drizzle-orm";
import { internalError } from "backend/errors";

type AssignmentRow = typeof experimentAssignments.$inferSelect;

export interface AssignmentRecord {
  id: string;
  flagId: string;
  userId: string;
  variantKey: string;
  context: unknown;
  assignedAt: string;
}

export interface VariantCount {
  variantKey: string;
  count: number;
}

function toAssignment(row: AssignmentRow): AssignmentRecord {
  let context: unknown = {};
  try {
    context = row.context ? JSON.parse(row.context) : {};
  } catch {
    context = {};
  }
  return { ...row, context };
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
        id: data.id ?? crypto.randomUUID(),
        assignedAt: data.assignedAt ?? new Date().toISOString(),
      })
      // (flagId, userId) is unique: concurrent evaluations of the
      // same user must not create a second assignment (or 500).
      .onConflictDoNothing({
        target: [experimentAssignments.flagId, experimentAssignments.userId],
      })
      .returning();
    if (row) return toAssignment(row);

    const existing = await experimentAssignmentDAO.findByFlagAndUser(
      data.flagId,
      data.userId,
    );
    if (!existing) {
      throw internalError("Failed to create experiment assignment");
    }
    return existing;
  },

  findByFlagAndUser: async (flagId: string, userId: string) => {
    const [row] = await db
      .select()
      .from(experimentAssignments)
      .where(
        and(
          eq(experimentAssignments.flagId, flagId),
          eq(experimentAssignments.userId, userId),
        ),
      )
      .limit(1);
    return row ? toAssignment(row) : undefined;
  },

  listByFlag: async (
    flagId: string,
    options: {
      page: number;
      limit: number;
      variantKey?: string;
      search?: string;
    },
  ): Promise<{ total: number; data: AssignmentRecord[] }> => {
    const offset = (options.page - 1) * options.limit;

    const conditions = [eq(experimentAssignments.flagId, flagId)];
    if (options.variantKey) {
      conditions.push(eq(experimentAssignments.variantKey, options.variantKey));
    }
    if (options.search) {
      conditions.push(
        sql`lower(${experimentAssignments.userId}) like ${`%${options.search.toLowerCase()}%`}`,
      );
    }

    const [rows, total] = await Promise.all([
      db
        .select()
        .from(experimentAssignments)
        .where(and(...conditions))
        .orderBy(desc(experimentAssignments.assignedAt))
        .limit(options.limit)
        .offset(offset),
      db.$count(experimentAssignments, and(...conditions)),
    ]);

    return { total, data: rows.map(toAssignment) };
  },

  countByVariant: async (
    flagId: string,
  ): Promise<VariantCount[]> => {
    const rows = await db
      .select({
        variantKey: experimentAssignments.variantKey,
        count: countDistinct(experimentAssignments.userId),
      })
      .from(experimentAssignments)
      .where(eq(experimentAssignments.flagId, flagId))
      .groupBy(experimentAssignments.variantKey);
    return rows;
  },
};
