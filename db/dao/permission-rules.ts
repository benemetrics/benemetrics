import { db } from "../index.ts";
import { permissionRules } from "../schema/permission-rules.ts";
import { eq, desc } from "drizzle-orm";
import { notFound, conflict } from "../../backend/errors.ts";
import { crypto } from "../../backend/utils/crypto.ts";

export const permissionRuleDAO = {
  async create(data: {
    groupName: string;
    environments?: string[];
    appPrefixes?: string[];
    isEnabled?: boolean;
  }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const result = await db
      .insert(permissionRules)
      .values({
        id,
        groupName: data.groupName.toLowerCase(),
        environments: JSON.stringify(data.environments ?? []),
        appPrefixes: JSON.stringify(data.appPrefixes ?? []),
        isEnabled: data.isEnabled ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();

    if (result.length === 0) {
      throw conflict(`Permission rule for group "${data.groupName}" already exists`);
    }
    return result[0];
  },

  async findById(id: string) {
    const result = await db.select().from(permissionRules).where(eq(permissionRules.id, id)).limit(1);
    return result[0];
  },

  async findByIdOrThrow(id: string) {
    const rule = await this.findById(id);
    if (!rule) throw notFound("PermissionRule", id);
    return rule;
  },

  async list() {
    const result = await db.select().from(permissionRules).orderBy(desc(permissionRules.createdAt));
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
      .update(permissionRules)
      .set(updateData)
      .where(eq(permissionRules.id, id))
      .returning();

    if (result.length === 0) throw notFound("PermissionRule", id);
    return result[0];
  },

  async delete(id: string) {
    const result = await db.delete(permissionRules).where(eq(permissionRules.id, id)).returning();
    return result.length > 0;
  },
};