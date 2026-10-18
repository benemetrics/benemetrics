import { db } from "../index.ts";
import { experimentAssignments } from "../schema/experiment-assignments.ts";
import { eq, and, desc, count } from "drizzle-orm";
import { crypto } from "../../backend/utils/crypto.ts";

export const experimentAssignmentDAO = {
  async create(data: {
    flagId: string;
    userId: string;
    variantKey: string;
    context?: Record<string, unknown>;
  }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const result = await db
      .insert(experimentAssignments)
      .values({
        id,
        flagId: data.flagId,
        userId: data.userId,
        variantKey: data.variantKey,
        context: JSON.stringify(data.context ?? {}),
        assignedAt: now,
      })
      .onConflictDoNothing()
      .returning();

    return result[0] ?? null;
  },

  async findByFlagAndUser(flagId: string, userId: string) {
    const result = await db
      .select()
      .from(experimentAssignments)
      .where(and(eq(experimentAssignments.flagId, flagId), eq(experimentAssignments.userId, userId)))
      .limit(1);
    return result[0];
  },

  async listByFlag(flagId: string, options: {
    page?: number;
    limit?: number;
    variantKey?: string;
    search?: string;
  } = {}) {
    const page = options.page ?? 1;
    const limit = Math.min(options.limit ?? 20, 100);
    const offset = (page - 1) * limit;

    let query = db.select().from(experimentAssignments).where(eq(experimentAssignments.flagId, flagId));

    if (options.variantKey) {
      query = query.where(eq(experimentAssignments.variantKey, options.variantKey));
    }

    const [data, totalResult] = await Promise.all([
      query.limit(limit).offset(offset).orderBy(desc(experimentAssignments.assignedAt)),
      db.$count(experimentAssignments, eq(experimentAssignments.flagId, flagId)),
    ]);

    return {
      total: totalResult,
      data,
      pagination: {
        page: options.page ?? 1,
        limit: Math.min(options.limit ?? 20, 100),
        total: totalResult,
        totalPages: Math.ceil(totalResult / Math.min(options.limit ?? 20, 100)),
      },
    };
  },

  async countByVariant(flagId: string) {
    const result = await db
      .select({ variantKey: experimentAssignments.variantKey, count: count() })
      .from(experimentAssignments)
      .where(eq(experimentAssignments.flagId, flagId))
      .groupBy(experimentAssignments.variantKey);
    return result;
  },
};