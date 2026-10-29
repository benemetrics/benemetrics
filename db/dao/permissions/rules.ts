import { db } from "db";
import { permissionRules } from "db/schema/permissions";
import { desc, eq } from "drizzle-orm";
import { conflict, internalError, notFound } from "backend/errors";
import { cursorAfter, cursorLimit } from "../cursor";

export interface PermissionRuleRecord {
  id: string;
  name: string;
  projectIds: string[];
  appPrefixes: string[];
  isEnabled: boolean;
  updatedAt: string;
}

export interface PermissionRuleInput {
  name: string;
  projectIds: string[];
  appPrefixes: string[];
  isEnabled?: boolean;
}

const ruleFields = {
  id: permissionRules.id,
  name: permissionRules.name,
  projectIds: permissionRules.projectIds,
  appPrefixes: permissionRules.appPrefixes,
  isEnabled: permissionRules.isEnabled,
  updatedAt: permissionRules.updatedAt,
};

function parseList(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function toRecord(row: {
  id: string;
  name: string;
  projectIds: string;
  appPrefixes: string;
  isEnabled: number;
  updatedAt: string;
}): PermissionRuleRecord {
  return {
    id: row.id,
    name: row.name,
    projectIds: parseList(row.projectIds),
    appPrefixes: parseList(row.appPrefixes),
    isEnabled: row.isEnabled === 1,
    updatedAt: row.updatedAt,
  };
}

export const permissionRuleDAO = {
  create: async (input: PermissionRuleInput): Promise<PermissionRuleRecord> => {
    const [row] = await db
      .insert(permissionRules)
      .values({
        name: input.name.toLowerCase(),
        projectIds: JSON.stringify(input.projectIds),
        appPrefixes: JSON.stringify(input.appPrefixes),
      })
      .onConflictDoNothing({ target: permissionRules.name })
      .returning(ruleFields);
    if (!row) {
      throw conflict(`Permission rule already exists: ${input.name}`);
    }
    return toRecord(row);
  },

  findById: async (id: string): Promise<PermissionRuleRecord | undefined> => {
    const [row] = await db
      .select(ruleFields)
      .from(permissionRules)
      .where(eq(permissionRules.id, id))
      .limit(1);
    return row ? toRecord(row) : undefined;
  },

  findByIdOrThrow: async (id: string): Promise<PermissionRuleRecord> => {
    const rule = await permissionRuleDAO.findById(id);
    if (!rule) throw notFound("Permission rule", id);
    return rule;
  },

  findByName: async (
    name: string,
  ): Promise<PermissionRuleRecord | undefined> => {
    const [row] = await db
      .select(ruleFields)
      .from(permissionRules)
      .where(eq(permissionRules.name, name.toLowerCase()))
      .limit(1);
    return row ? toRecord(row) : undefined;
  },

  list: async (options?: { cursor?: string; limit?: number }) => {
    const limit = cursorLimit(options?.limit);
    const { condition, empty } = await cursorAfter(
      permissionRules,
      permissionRules.id,
      permissionRules.id,
      options?.cursor,
    );
    if (empty) return { data: [] };

    const data = await db
      .select(ruleFields)
      .from(permissionRules)
      .where(condition)
      .orderBy(desc(permissionRules.id))
      .limit(limit);

    return { data: data.map(toRecord) };
  },

  updateOrThrow: async (
    id: string,
    data: Partial<PermissionRuleInput>,
  ): Promise<PermissionRuleRecord> => {
    const [row] = await db
      .update(permissionRules)
      .set({
        ...(data.name !== undefined ? { name: data.name.toLowerCase() } : {}),
        ...(data.projectIds !== undefined
          ? { projectIds: JSON.stringify(data.projectIds) }
          : {}),
        ...(data.appPrefixes !== undefined
          ? { appPrefixes: JSON.stringify(data.appPrefixes) }
          : {}),
        ...(data.isEnabled !== undefined
          ? { isEnabled: data.isEnabled ? 1 : 0 }
          : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(permissionRules.id, id))
      .returning(ruleFields);
    if (!row) {
      throw notFound("Permission rule", id);
    }
    return toRecord(row);
  },

  delete: async (id: string): Promise<void> => {
    const deleted = await db
      .delete(permissionRules)
      .where(eq(permissionRules.id, id))
      .returning({ id: permissionRules.id });
    if (deleted.length === 0) {
      throw internalError(`Failed to delete permission rule ${id}`);
    }
  },
};
