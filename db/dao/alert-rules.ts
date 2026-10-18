import { db } from "../index.ts";
import { alertRules } from "../schema/alert-rules.ts";
import { eq, desc, or } from "drizzle-orm";
import { notFound, conflict } from "../../backend/errors.ts";
import { crypto } from "../../backend/utils/crypto.ts";

export const alertRuleDAO = {
  async create(data: {
    name: string;
    trigger: string;
    metric?: string;
    operator?: string;
    threshold?: number;
    windowSeconds?: number;
    cooldownSeconds?: number;
    channelIds?: string[];
    measurement?: string;
    appId?: string;
  }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const result = await db
      .insert(alertRules)
      .values({
        id,
        name: data.name,
        trigger: data.trigger,
        metric: data.metric ?? null,
        operator: data.operator ?? null,
        threshold: data.threshold ?? null,
        windowSeconds: data.windowSeconds ?? null,
        cooldownSeconds: data.cooldownSeconds ?? 3600,
        channelIds: JSON.stringify(data.channelIds ?? []),
        measurement: data.measurement ?? null,
        appId: data.appId ?? null,
        isEnabled: 1,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();

    if (result.length === 0) {
      throw conflict(`Alert rule with name "${data.name}" already exists in this scope`);
    }
    return result[0];
  },

  async findById(id: string) {
    const result = await db.select().from(alertRules).where(eq(alertRules.id, id)).limit(1);
    return result[0];
  },

  async findByIdOrThrow(id: string) {
    const rule = await this.findById(id);
    if (!rule) throw new Error("Alert rule not found");
    return rule;
  },

  async list(options: { appId?: string; page?: number; limit?: number } = {}) {
    const page = options.page ?? 1;
    const limit = Math.min(options.limit ?? 20, 100);
    const offset = (page - 1) * limit;

    let query = db.select().from(alertRules);

    if (options.appId) {
      query = query.where(eq(alertRules.appId, options.appId));
    } else {
      query = query.where(eq(alertRules.appId, null));
    }

    const [data, totalResult] = await Promise.all([
      query.limit(limit).offset(offset).orderBy(desc(alertRules.createdAt)),
      db.$count(alertRules),
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

  async updateOrThrow(id: string, patch: Partial<{
    name: string;
    trigger: string;
    metric: string;
    operator: string;
    threshold: number;
    windowSeconds: number;
    cooldownSeconds: number;
    channelIds: string[];
    measurement: string;
    isEnabled: number;
  }>) {
    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = { updatedAt: now };

    if (patch.name !== undefined) updateData.name = patch.name;
    if (patch.trigger !== undefined) updateData.trigger = patch.trigger;
    if (patch.metric !== undefined) updateData.metric = patch.metric;
    if (patch.operator !== undefined) updateData.operator = patch.operator;
    if (patch.threshold !== undefined) updateData.threshold = patch.threshold;
    if (patch.windowSeconds !== undefined) updateData.windowSeconds = patch.windowSeconds;
    if (patch.cooldownSeconds !== undefined) updateData.cooldownSeconds = patch.cooldownSeconds;
    if (patch.channelIds !== undefined) updateData.channelIds = JSON.stringify(patch.channelIds);
    if (patch.measurement !== undefined) updateData.measurement = patch.measurement;
    if (patch.isEnabled !== undefined) updateData.isEnabled = patch.isEnabled;

    const result = await db
      .update(alertRules)
      .set(updateData)
      .where(eq(alertRules.id, id))
      .returning();

    if (result.length === 0) throw new Error("Alert rule not found");
    return result[0];
  },

  async delete(id: string) {
    const result = await db.delete(alertRules).where(eq(alertRules.id, id)).returning();
    return result.length > 0;
  },

  async touchTriggered(id: string, triggeredAt: string) {
    const result = await db
      .update(alertRules)
      .set({ lastTriggeredAt: triggeredAt, updatedAt: new Date().toISOString() })
      .where(eq(alertRules.id, id))
      .returning();
    return result[0];
  },
};