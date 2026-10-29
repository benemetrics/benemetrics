import { db } from "db";
import { permissionAudit } from "db/schema/permissions";
import { and, desc, eq } from "drizzle-orm";
import { cursorAfter, cursorLimit } from "./cursor";

export type PermissionAuditTarget = "rule" | "grant";
export type PermissionAuditAction = "create" | "update" | "delete";

export interface PermissionAuditRecord {
  id: string;
  actorId: string;
  target: PermissionAuditTarget;
  targetId: string;
  action: PermissionAuditAction;
  before: unknown;
  after: unknown;
  createdAt: string;
}

const auditFields = {
  id: permissionAudit.id,
  actorId: permissionAudit.actorId,
  target: permissionAudit.target,
  targetId: permissionAudit.targetId,
  action: permissionAudit.action,
  before: permissionAudit.before,
  after: permissionAudit.after,
  createdAt: permissionAudit.createdAt,
};

function parseState(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toRecord(row: {
  id: string;
  actorId: string;
  target: string;
  targetId: string;
  action: string;
  before: string;
  after: string;
  createdAt: string;
}): PermissionAuditRecord {
  return {
    id: row.id,
    actorId: row.actorId,
    target: row.target as PermissionAuditTarget,
    targetId: row.targetId,
    action: row.action as PermissionAuditAction,
    before: parseState(row.before),
    after: parseState(row.after),
    createdAt: row.createdAt,
  };
}

export const permissionAuditDAO = {
  /**
   * Records a permission change. A failed audit write must not fail the
   * mutation that was already committed, so the caller logs the error.
   */
  record: async (entry: {
    actorId: string;
    target: PermissionAuditTarget;
    targetId: string;
    action: PermissionAuditAction;
    before?: unknown;
    after?: unknown;
  }): Promise<PermissionAuditRecord | undefined> => {
    const [row] = await db
      .insert(permissionAudit)
      .values({
        actorId: entry.actorId,
        target: entry.target,
        targetId: entry.targetId,
        action: entry.action,
        before: JSON.stringify(entry.before ?? null),
        after: JSON.stringify(entry.after ?? null),
      })
      .returning(auditFields);
    return row ? toRecord(row) : undefined;
  },

  list: async (options?: {
    cursor?: string;
    limit?: number;
    target?: PermissionAuditTarget;
  }) => {
    const limit = cursorLimit(options?.limit);
    const { condition, empty } = await cursorAfter(
      permissionAudit,
      permissionAudit.id,
      permissionAudit.createdAt,
      options?.cursor,
    );
    if (empty) return { data: [] };
    const scope = options?.target
      ? eq(permissionAudit.target, options.target)
      : undefined;
    const where =
      scope && condition ? and(scope, condition) : (scope ?? condition);

    const data = await db
      .select(auditFields)
      .from(permissionAudit)
      .where(where)
      .orderBy(desc(permissionAudit.createdAt), desc(permissionAudit.id))
      .limit(limit);

    return { data: data.map(toRecord) };
  },
};
