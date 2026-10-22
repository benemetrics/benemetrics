import { db } from "db";
import { permissionGrants } from "db/schema/permissions";
import { desc, eq } from "drizzle-orm";
import { conflict, internalError, notFound } from "backend/errors";
import { cursorAfter, cursorLimit } from "./cursor";

export interface PermissionGrantRecord {
  id: string;
  identityId: string;
  label: string | null;
  environments: string[];
  appPrefixes: string[];
  isEnabled: boolean;
  /** The identity may perform the admin writes. */
  canWrite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PermissionGrantInput {
  identityId: string;
  label?: string | null;
  environments: string[];
  appPrefixes: string[];
  isEnabled?: boolean;
  canWrite?: boolean;
}

const grantFields = {
  id: permissionGrants.id,
  identityId: permissionGrants.identityId,
  label: permissionGrants.label,
  environments: permissionGrants.environments,
  appPrefixes: permissionGrants.appPrefixes,
  isEnabled: permissionGrants.isEnabled,
  canWrite: permissionGrants.canWrite,
  createdAt: permissionGrants.createdAt,
  updatedAt: permissionGrants.updatedAt,
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
  identityId: string;
  label: string | null;
  environments: string;
  appPrefixes: string;
  isEnabled: number;
  canWrite: number;
  createdAt: string;
  updatedAt: string;
}): PermissionGrantRecord {
  return {
    id: row.id,
    identityId: row.identityId,
    label: row.label,
    environments: parseList(row.environments),
    appPrefixes: parseList(row.appPrefixes),
    isEnabled: row.isEnabled === 1,
    canWrite: row.canWrite === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const permissionGrantDAO = {
  create: async (input: PermissionGrantInput): Promise<PermissionGrantRecord> => {
    const now = new Date().toISOString();
    const [row] = await db
      .insert(permissionGrants)
      .values({
        id: crypto.randomUUID(),
        identityId: input.identityId,
        label: input.label ?? null,
        environments: JSON.stringify(input.environments),
        appPrefixes: JSON.stringify(input.appPrefixes),
        isEnabled: input.isEnabled === false ? 0 : 1,
        canWrite: input.canWrite === true ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: permissionGrants.identityId })
      .returning(grantFields);
    if (!row) {
      throw conflict(`Permission grant already exists: ${input.identityId}`);
    }
    return toRecord(row);
  },

  findById: async (id: string): Promise<PermissionGrantRecord | undefined> => {
    const [row] = await db
      .select(grantFields)
      .from(permissionGrants)
      .where(eq(permissionGrants.id, id))
      .limit(1);
    return row ? toRecord(row) : undefined;
  },

  findByIdOrThrow: async (id: string): Promise<PermissionGrantRecord> => {
    const grant = await permissionGrantDAO.findById(id);
    if (!grant) throw notFound("Permission grant", id);
    return grant;
  },

  findByIdentityId: async (
    identityId: string,
  ): Promise<PermissionGrantRecord | undefined> => {
    const [row] = await db
      .select(grantFields)
      .from(permissionGrants)
      .where(eq(permissionGrants.identityId, identityId))
      .limit(1);
    return row ? toRecord(row) : undefined;
  },

  list: async (options?: { cursor?: string; limit?: number }) => {
    const limit = cursorLimit(options?.limit);
    const { condition, empty } = await cursorAfter(
      permissionGrants,
      permissionGrants.id,
      permissionGrants.createdAt,
      options?.cursor,
    );
    if (empty) return { data: [] };

    const data = await db
      .select(grantFields)
      .from(permissionGrants)
      .where(condition)
      .orderBy(desc(permissionGrants.createdAt), desc(permissionGrants.id))
      .limit(limit);

    return { data: data.map(toRecord) };
  },

  updateOrThrow: async (
    id: string,
    data: Partial<PermissionGrantInput>,
  ): Promise<PermissionGrantRecord> => {
    const [row] = await db
      .update(permissionGrants)
      .set({
        ...(data.identityId !== undefined
          ? { identityId: data.identityId }
          : {}),
        ...(data.label !== undefined ? { label: data.label } : {}),
        ...(data.environments !== undefined
          ? { environments: JSON.stringify(data.environments) }
          : {}),
        ...(data.appPrefixes !== undefined
          ? { appPrefixes: JSON.stringify(data.appPrefixes) }
          : {}),
        ...(data.isEnabled !== undefined
          ? { isEnabled: data.isEnabled ? 1 : 0 }
          : {}),
        ...(data.canWrite !== undefined
          ? { canWrite: data.canWrite ? 1 : 0 }
          : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(permissionGrants.id, id))
      .returning(grantFields);
    if (!row) {
      throw notFound("Permission grant", id);
    }
    return toRecord(row);
  },

  delete: async (id: string): Promise<void> => {
    const deleted = await db
      .delete(permissionGrants)
      .where(eq(permissionGrants.id, id))
      .returning({ id: permissionGrants.id });
    if (deleted.length === 0) {
      throw internalError(`Failed to delete permission grant ${id}`);
    }
  },
};
