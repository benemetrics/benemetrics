import { db } from "../index.ts";
import { projects } from "../schema/projects.ts";
import { eq } from "drizzle-orm";
import { notFound, conflict } from "../../backend/errors.ts";
import { crypto } from "../../backend/utils/crypto.ts";

export const projectDAO = {
  async create(data: { name: string; description?: string }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    
    const result = await db
      .insert(projects)
      .values({
        id,
        name: data.name,
        slug,
        description: data.description ?? "",
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning();

    if (result.length === 0) {
      throw conflict(`Project with slug "${slug}" already exists`);
    }
    return result[0];
  },

  async findById(id: string) {
    const result = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
    return result[0];
  },

  async findByIdOrThrow(id: string) {
    const project = await this.findById(id);
    if (!project) throw notFound("Project", id);
    return project;
  },

  async findBySlug(slug: string) {
    const result = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    return result[0];
  },

  async list(options: { page?: number; limit?: number } = {}) {
    const page = options.page ?? 1;
    const limit = Math.min(options.limit ?? 20, 100);
    const offset = (page - 1) * limit;

    const [data, totalResult] = await Promise.all([
      db.select().from(projects).limit(limit).offset(offset).orderBy(projects.createdAt),
      db.$count(projects),
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

  async updateOrThrow(id: string, patch: Partial<{ name: string; description: string }>) {
    const now = new Date().toISOString();
    const result = await db
      .update(projects)
      .set({ ...patch, updatedAt: now })
      .where(eq(projects.id, id))
      .returning();

    if (result.length === 0) throw notFound("Project", id);
    return result[0];
  },

  async delete(id: string) {
    const result = await db.delete(projects).where(eq(projects.id, id)).returning();
    return result.length > 0;
  },
};