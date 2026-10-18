import { db } from "../index.ts";
import { alertIncidents } from "../schema/alert-incidents.ts";
import { eq, desc } from "drizzle-orm";
import { crypto } from "../../backend/utils/crypto.ts";

export const alertIncidentDAO = {
  async create(data: {
    ruleId: string;
    appId?: string;
    trigger: string;
    issueFingerprint?: string;
    metric?: string;
    value?: number;
    threshold?: number;
    status?: string;
  }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const result = await db
      .insert(alertIncidents)
      .values({
        id,
        ruleId: data.ruleId,
        appId: data.appId ?? null,
        trigger: data.trigger,
        issueFingerprint: data.issueFingerprint ?? null,
        metric: data.metric ?? null,
        value: data.value ?? null,
        threshold: data.threshold ?? null,
        status: data.status ?? "firing",
        triggeredAt: now,
        resolvedAt: null,
      })
      .returning();

    return result[0];
  },

  async findById(id: string) {
    const result = await db.select().from(alertIncidents).where(eq(alertIncidents.id, id)).limit(1);
    return result[0];
  },

  async list(options: { appId?: string; page?: number; limit?: number } = {}) {
    const page = options.page ?? 1;
    const limit = Math.min(options.limit ?? 20, 100);
    const offset = (page - 1) * limit;

    let query = db.select().from(alertIncidents);

    if (options.appId) {
      query = query.where(eq(alertIncidents.appId, options.appId));
    }

    const [data, totalResult] = await Promise.all([
      query.limit(limit).offset(offset).orderBy(desc(alertIncidents.triggeredAt)),
      db.$count(alertIncidents),
    ]);

    return {
      data,
      pagination: {
        page: options.page ?? 1,
        limit: Math.min(options.limit ?? 20, 100),
        total: totalResult,
        totalPages: Math.ceil(totalResult / Math.min(options.limit ?? 20, 100)),
      },
    };
  },

  async resolveOpen(ruleId: string) {
    const now = new Date().toISOString();
    const result = await db
      .update(alertIncidents)
      .set({ status: "resolved", resolvedAt: now })
      .where(eq(alertIncidents.ruleId, ruleId))
      .returning();
    return result;
  },

  async findLastForIssue(ruleId: string, fingerprint: string) {
    const result = await db
      .select()
      .from(alertIncidents)
      .where(eq(alertIncidents.ruleId, ruleId))
      .where(eq(alertIncidents.issueFingerprint, fingerprint))
      .orderBy(desc(alertIncidents.triggeredAt))
      .limit(1);
    return result[0];
  },
};