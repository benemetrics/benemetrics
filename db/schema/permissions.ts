import {
  pgTable,
  text,
  index,
  uniqueIndex,
  uuid,
  boolean,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";
import { isoTimestamp } from "./timestamps";
import { projects } from "./project";

// A group rule: every identity whose token carries the group gets the scope.
// The group name is the provider's claim value, stored lowercased.
export const permissionRules = pgTable(
  "permission_rules",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    name: text("name").notNull(),
    group: text("group").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(false),
    canWrite: boolean("can_write").notNull().default(false),
    updatedAt: isoTimestamp("updated_at")
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => sql`now()`),
  },
  (table) => [
    uniqueIndex().on(table.name),
  ],
);

// An identity grant: one identity id gets the scope, whatever its groups.
// It wins over the group rules when it is enabled.
export const permissionGrants = pgTable(
  "permission_grants",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    // The resolved identity id (`<issuer>-<subject>`).
    identityId: text("identity_id").notNull(),
    // A display label for the admin UI; the identity id stays the key.
    label: text("label"),
    isEnabled: boolean("is_enabled").notNull().default(false),
    canWrite: boolean("can_write").notNull().default(false),
    updatedAt: isoTimestamp("updated_at")
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => sql`now()`),
  },
  (table) => [
    uniqueIndex().on(table.identityId),
  ],
);

export const permissionsGrantsProjects = pgTable(
  "permission_grants_projects",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    permissionGrantId: uuid("permission_grant_id").notNull().references(() => permissionGrants.id),
    projectId: uuid("project_id").notNull().references(() => projects.id),
  }
)

export const permissionsRulesProjects = pgTable(
  "permission_rules_projects",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    permissionRuleId: uuid("permission_rule_id").notNull().references(() => permissionRules.id),
    projectId: uuid("project_id").notNull().references(() => projects.id),
  }
)

export type PermissionRuleRow = typeof permissionRules.$inferSelect;
export type PermissionRuleInsert = typeof permissionRules.$inferInsert;
export type PermissionGrantRow = typeof permissionGrants.$inferSelect;
export type PermissionGrantInsert = typeof permissionGrants.$inferInsert;

export const permissionRulePublicFields = {
  id: permissionRules.id,
  name: permissionRules.name,
  isEnabled: permissionRules.isEnabled,
  canWrite: permissionRules.canWrite,
  updatedAt: permissionRules.updatedAt,
};

export const permissionGrantPublicFields = {
  id: permissionGrants.id,
  identityId: permissionGrants.identityId,
  label: permissionGrants.label,
  isEnabled: permissionGrants.isEnabled,
  canWrite: permissionGrants.canWrite,
  updatedAt: permissionGrants.updatedAt,
};
