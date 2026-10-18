import { db } from "../index.ts";
import { permissionUsers } from "../schema/permission-users.ts";
import { eq, desc } from "drizzle-orm";
import { notFound, conflict } from "../../backend/errors.ts";
import { crypto } from "../../backend/utils/crypto.ts";

export const permissionUserDAO = {
  async create(data: {
    email: string;
    environments?: string[];
    appPrefixes?: string[];
    isEnabled?: boolean;
  }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const result = await db
      .insert(permissionUsers)
      .values({
        id,
        email: data.email.toLowerCase(),
        environments: JSON.stringify(data.environments ?? []),
        appPrefixes: JSON.stringify(data.appPrefixes ?? []),
        isEnabled: data.isEnabled ?? 1,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();

    if (result.length === 0) {
      throw conflict(`Permission user with email "${data.email}" already exists`);
    }
    return result[0];
  },

  async findById(id: string) {
    const result = await db.select().from(permissionUsers).where(eq(permissionUsers.id, id)).limit(1);
    return result[0];
  },

  async findByIdOrThrow(id: string) {
    const user = await this.findById(id);
    if (!user) throw notFound("PermissionUser", id);
    return user;
  },

  async findByEmail(email: string) {
    const result = await db
      .select()
      .from(permissionUsers)
      .where(eq(permissionUsers.email, email.toLowerCase()))
      .limit(1);
    return result[0];
  },

  async list() {
    const result = await db.select().from(permissionUsers).orderBy(desc(permissionUsers.createdAt));
    return result;
  },

  async updateOrThrow(id: string, patch: Partial<{
    environments: string[];
    appPrefixes: string[];
    isEnabled: number;
  }>) {
    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = { updatedAt: now };

    if (patch.environments !== undefined) updateData.environments = JSON.stringify(patch.environments);
    if (patch.appPrefixes !== undefined) updateData.appPrefixes = JSON.stringify(patch.appPrefixes);
    if (patch.isEnabled !== undefined) updateData.isEnabled = patch.isEnabled;

    const result = await db
      .update(permissionUsers)
      .set(updateData)
      .where(eq(permissionUsers.id, id))
      .returning();

    if (result.length === 0) throw notFound("PermissionUser", id);
    return result[0];
  },

  async delete(id: string) {
    const result = await db.delete(permissionUsers).where(eq(permissionUsers.id, id)).returning();
    return result.length > 0;
  },
};