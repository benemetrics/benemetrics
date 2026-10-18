import { db } from "../index.ts";
import { featureFlags } from "../schema/feature-flags.ts";
import { eq, desc, ilike, or } from "drizzle-orm";
import { notFound, conflict } from "../../backend/errors.ts";
import { crypto } from "../../backend/utils/crypto.ts";

export const featureFlagDAO = {
  async create(data: {
    key: string;
    name: string;
    description?: string;
    type: string;
    defaultValue: string | number | boolean;
    variants?: unknown[];
    targetingRules?: unknown[];
    segments?: string[];
    experiment?: unknown | null;
    rolloutPercentage?: number;
  }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const variants = data.variants ?? (
      data.type === "boolean"
        ? [{ key: "control", name: "Control", value: false, weight: 50 }, { key: "treatment", name: "Treatment", value: true, weight: 50 }]
        : [{ key: "default", name: "Default", value: data.defaultValue, weight: 100 }]
    );

    const result = await db
      .insert(featureFlags)
      .values({
        id,
        key: data.key,
        name: data.name,
        description: data.description ?? "",
        type: data.type,
        defaultValue: String(data.defaultValue),
        variants: JSON.stringify(variants),
        targetingRules: JSON.stringify(data.targetingRules ?? []),
        segments: JSON.stringify(data.segments ?? []),
        status: "draft",
        rolloutPercentage: data.rolloutPercentage ?? 100,
        experiment: data.experiment ? JSON.stringify(data.experiment) : null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();

    if (result.length === 0) {
      throw conflict(`Feature flag with key "${data.key}" already exists`);
    }
    return result[0];
  },

  async findById(id: string) {
    const result = await db.select().from(featureFlags).where(eq(featureFlags.id, id)).limit(1);
    return result[0];
  },

  async findByIdOrThrow(id: string) {
    const flag = await this.findById(id);
    if (!flag) throw notFound("FeatureFlag", id);
    return flag;
  },

  async findByKey(key: string) {
    const result = await db.select().from(featureFlags).where(eq(featureFlags.key, key)).limit(1);
    return result[0];
  },

  async list(options: {
    page?: number;
    limit?: number;
    status?: string;
    type?: string;
    search?: string;
  } = {}) {
    const page = options.page ?? 1;
    const limit = Math.min(options.limit ?? 20, 100);
    const offset = (page - 1) * limit;

    let query = db.select().from(featureFlags);

    const conditions = [];
    if (options.status) conditions.push(eq(featureFlags.status, options.status));
    if (options.type) conditions.push(eq(featureFlags.type, options.type));
    if (options.search) {
      conditions.push(or(ilike(featureFlags.key, `%${options.search}%`), ilike(featureFlags.name, `%${options.search}%`)));
    }

    if (conditions.length > 0) {
      query = query.where(or(...conditions));
    }

    const [data, totalResult] = await Promise.all([
      query.limit(limit).offset(offset).orderBy(desc(featureFlags.createdAt)),
      db.$count(featureFlags),
    ]);

    return {
      data,
      pagination: {
        page,
        limit,
        total: totalResult,
        totalPages: Math.ceil(totalResult / limit),
      },
    };
  },

  async updateOrThrow(id: string, patch: Partial<{
    name: string;
    description: string;
    type: string;
    defaultValue: string | number | boolean;
    variants: unknown[];
    targetingRules: unknown[];
    segments: string[];
    experiment: unknown | null;
    rolloutPercentage: number;
  }>) {
    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = { updatedAt: now };

    if (patch.name !== undefined) updateData.name = patch.name;
    if (patch.description !== undefined) updateData.description = patch.description;
    if (patch.type !== undefined) updateData.type = patch.type;
    if (patch.defaultValue !== undefined) updateData.defaultValue = String(patch.defaultValue);
    if (patch.variants !== undefined) updateData.variants = JSON.stringify(patch.variants);
    if (patch.targetingRules !== undefined) updateData.targetingRules = JSON.stringify(patch.targetingRules);
    if (patch.segments !== undefined) updateData.segments = JSON.stringify(patch.segments);
    if (patch.experiment !== undefined) updateData.experiment = patch.experiment ? JSON.stringify(patch.experiment) : null;
    if (patch.rolloutPercentage !== undefined) updateData.rolloutPercentage = patch.rolloutPercentage;

    const result = await db
      .update(featureFlags)
      .set(updateData)
      .where(eq(featureFlags.id, id))
      .returning();

    if (result.length === 0) throw notFound("FeatureFlag", id);
    return result[0];
  },

  async updateStatus(id: string, status: string) {
    const now = new Date().toISOString();
    const result = await db
      .update(featureFlags)
      .set({ status, updatedAt: now })
      .where(eq(featureFlags.id, id))
      .returning();

    if (result.length === 0) throw notFound("FeatureFlag", id);
    return result[0];
  },

  async delete(id: string) {
    const flag = await this.findByIdOrThrow(id);
    if (flag.status !== "draft") {
      throw new Error("Only draft flags can be deleted");
    }
    const result = await db.delete(featureFlags).where(eq(featureFlags.id, id)).returning();
    return result.length > 0;
  },
};