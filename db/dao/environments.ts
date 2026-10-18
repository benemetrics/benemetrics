import { db } from "../index.ts";
import { environments } from "../schema/environments.ts";
import { eq, and, desc } from "drizzle-orm";
import { notFound, conflict } from "../../backend/errors.ts";
import { crypto } from "../../backend/utils/crypto.ts";

export const environmentDAO = {
  async create(data: {
    projectId: string;
    name: string;
    slug?: string;
    isDefault?: boolean;
  }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const slug = data.slug ?? data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

    // Check if slug exists in project
    const existing = await db
      .select()
      .from(environments)
      .where(and(eq(environments.projectId, data.projectId), eq(environments.slug, slug)))
      .limit(1);

    if (existing.length > 0) {
      throw conflict(`Environment with slug "${slug}" already exists in this project`);
    }

    // If this is the first environment or isDefault is true, set as default
    let isDefault = data.isDefault ?? false;
    if (isDefault) {
      // Demote previous default
      await db
        .update(environments)
        .set({ isDefault: 0, updatedAt: now })
        .where(and(eq(environments.projectId, data.projectId), eq(environments.isDefault, 1)));
    } else {
      // Check if this is the first environment
      const count = await db.$count(environments, eq(environments.projectId, data.projectId));
      if (count === 0) {
        isDefault = true;
      }
    }

    const result = await db
      .insert(environments)
      .values({
        id,
        projectId: data.projectId,
        name: data.name,
        slug,
        isDefault: isDefault ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();

    if (result.length === 0) {
      throw conflict("Environment creation failed");
    }
    return result[0];
  },

  async findById(id: string) {
    const result = await db.select().from(environments).where(eq(environments.id, id)).limit(1);
    return result[0];
  },

  async findByIdOrThrow(id: string) {
    const env = await this.findById(id);
    if (!env) throw notFound("Environment", id);
    return env;
  },

  async findByProjectAndSlug(projectId: string, slug: string) {
    const result = await db
      .select()
      .from(environments)
      .where(and(eq(environments.projectId, projectId), eq(environments.slug, slug)))
      .limit(1);
    return result[0];
  },

  async findDefaultByProject(projectId: string) {
    const result = await db
      .select()
      .from(environments)
      .where(and(eq(environments.projectId, projectId), eq(environments.isDefault, 1)))
      .limit(1);
    return result[0];
  },

  async listByProject(projectId: string, options: { page?: number; limit?: number } = {}) {
    const page = options.page ?? 1;
    const limit = Math.min(options.limit ?? 20, 100);
    const offset = (page - 1) * limit;

    const [data, totalResult] = await Promise.all([
      db
        .select()
        .from(environments)
        .where(eq(environments.projectId, projectId))
        .limit(limit)
        .offset(offset)
        .orderBy(desc(environments.createdAt)),
      db.$count(environments, eq(environments.projectId, projectId)),
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

  async updateOrThrow(id: string, patch: Partial<{ name: string; slug: string; isDefault: boolean }>) {
    const now = new Date().toISOString();
    const env = await this.findByIdOrThrow(id);

    // Handle slug change
    if (patch.slug && patch.slug !== env.slug) {
      const existing = await db
        .select()
        .from(environments)
        .where(and(eq(environments.projectId, env.projectId), eq(environments.slug, patch.slug)))
        .limit(1);
      if (existing.length > 0) {
        throw conflict(`Environment with slug "${patch.slug}" already exists`);
      }
    }

    // Handle default promotion
    if (patch.isDefault === true && !env.isDefault) {
      await db
        .update(environments)
        .set({ isDefault: 0, updatedAt: now })
        .where(and(eq(environments.projectId, env.projectId), eq(environments.isDefault, 1)));
    }

    const result = await db
      .update(environments)
      .set({
        ...patch,
        isDefault: patch.isDefault !== undefined ? (patch.isDefault ? 1 : 0) : env.isDefault,
        updatedAt: now,
      })
      .where(eq(environments.id, id))
      .returning();

    if (result.length === 0) throw notFound("Environment", id);

    // If we demoted the default, promote the oldest remaining
    if (env.isDefault && patch.isDefault === false) {
      const oldest = await db
        .select()
        .from(environments)
        .where(and(eq(environments.projectId, env.projectId), eq(environments.id, id)))
        .orderBy(environments.createdAt)
        .limit(1);

      if (oldest.length > 0) {
        await db
          .update(environments)
          .set({ isDefault: 1, updatedAt: now })
          .where(eq(environments.id, oldest[0].id));
      }
    }

    return result[0];
  },

  async delete(id: string) {
    const env = await this.findByIdOrThrow(id);
    const wasDefault = env.isDefault === 1;
    const projectId = env.projectId;

    const result = await db.delete(environments).where(eq(environments.id, id)).returning();
    const deleted = result.length > 0;

    if (deleted && wasDefault) {
      // Promote oldest remaining environment
      const oldest = await db
        .select()
        .from(environments)
        .where(eq(environments.projectId, projectId))
        .orderBy(environments.createdAt)
        .limit(1);

      if (oldest.length > 0) {
        await db
          .update(environments)
          .set({ isDefault: 1, updatedAt: new Date().toISOString() })
          .where(eq(environments.id, oldest[0].id));
      }
    }

    return deleted;
  },

  async deleteByProject(projectId: string) {
    const result = await db.delete(environments).where(eq(environments.projectId, projectId)).returning();
    return result.length;
  },
};