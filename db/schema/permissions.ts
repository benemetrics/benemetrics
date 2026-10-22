import { pgTable, text, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";
import { isoTimestamp } from "./timestamps";

// A group rule: every identity whose token carries the group gets the scope.
// The group name is the provider's claim value, stored lowercased.
export const permissionRules = pgTable(
  "permission_rules",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    // The scope lists are JSON text.
    environments: text("environments").notNull().default("[]"),
    appPrefixes: text("app_prefixes").notNull().default("[]"),
    isEnabled: integer("is_enabled").notNull().default(1),
    createdAt: isoTimestamp("created_at").notNull().default(sql`now()`),
    updatedAt: isoTimestamp("updated_at").notNull().default(sql`now()`),
  },
  (table) => ({
    nameUnique: uniqueIndex("permission_rules_name_idx").on(table.name),
  }),
);

// An identity grant: one identity id gets the scope, whatever its groups.
// It wins over the group rules when it is enabled.
export const permissionGrants = pgTable(
  "permission_grants",
  {
    id: text("id").primaryKey(),
    // The resolved identity id (`<issuer>-<subject>`).
    identityId: text("identity_id").notNull(),
    // A display label for the admin UI; the identity id stays the key.
    label: text("label"),
    environments: text("environments").notNull().default("[]"),
    appPrefixes: text("app_prefixes").notNull().default("[]"),
    isEnabled: integer("is_enabled").notNull().default(1),
    // A writer may perform the admin writes; a reader may not.
    canWrite: integer("can_write").notNull().default(0),
    createdAt: isoTimestamp("created_at").notNull().default(sql`now()`),
    updatedAt: isoTimestamp("updated_at").notNull().default(sql`now()`),
  },
  (table) => ({
    identityUnique: uniqueIndex("permission_grants_identity_id_idx").on(
      table.identityId,
    ),
  }),
);

// Every permission change is recorded: who did it, what changed and the
// state before and after.
export const permissionAudit = pgTable(
  "permission_audit",
  {
    id: text("id").primaryKey(),
    // The admin identity that made the change.
    actorId: text("actor_id").notNull(),
    // "rule" | "grant"
    target: text("target").notNull(),
    targetId: text("target_id").notNull(),
    // "create" | "update" | "delete"
    action: text("action").notNull(),
    // The state before and after the change (JSON text).
    before: text("before").notNull().default("null"),
    after: text("after").notNull().default("null"),
    createdAt: isoTimestamp("created_at").notNull().default(sql`now()`),
  },
  (table) => ({
    targetIdx: index("permission_audit_target_idx").on(table.target, table.targetId),
    createdAtIdx: index("permission_audit_created_at_idx").on(table.createdAt),
  }),
);

export type PermissionRuleRow = typeof permissionRules.$inferSelect;
export type PermissionRuleInsert = typeof permissionRules.$inferInsert;
export type PermissionGrantRow = typeof permissionGrants.$inferSelect;
export type PermissionGrantInsert = typeof permissionGrants.$inferInsert;
export type PermissionAuditRow = typeof permissionAudit.$inferSelect;
export type PermissionAuditInsert = typeof permissionAudit.$inferInsert;
