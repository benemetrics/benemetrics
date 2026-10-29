import {
  pgTable,
  text,
  integer,
  index,
  uniqueIndex,
  uuid,
  boolean,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";
import { isoTimestamp } from "./timestamps";
import { projects } from "./project";
import { apps } from "./app";

// A group rule: every identity whose token carries the group gets the scope.
// The group name is the provider's claim value, stored lowercased.
export const permissionRules = pgTable(
  "permission_rules",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    name: text("name").notNull(),
    group: text("group"),
    // The scope lists are JSON text: the projects the group sees and the
    // app-name prefixes that match apps wherever they live.
    projectFixes: text("project_fixes").notNull().default("[]"),
    appFixes: text("app_fixes").notNull().default("[]"),
    isEnabled: boolean("is_enabled").notNull().default(false),
    canWrite: boolean("can_write").notNull().default(false),
    createdAt: isoTimestamp("created_at")
      .notNull()
      .default(sql`now()`),
    updatedAt: isoTimestamp("updated_at")
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => sql`now()`),
  },
  (table) => ({
    nameUnique: uniqueIndex().on(table.name),
  }),
);

// An identity grant: one identity id gets the scope, whatever its groups.
// It wins over the group rules when it is enabled.
export const permissionGrants = pgTable(
  "permission_grants",
  {
    id: uuid("id").default(`uuidv7()`).primaryKey(),
    // The resolved identity id (`<issuer>-<subject>`).
    identityId: text("identity_id").notNull(),
    // A display label for the admin UI; the identity id stays the key.
    label: text("label"),

    projectFixes: text("project_fixes").notNull().default("[]"),
    appFixes: text("app_fixes").notNull().default("[]"),
    isEnabled: boolean("is_enabled").notNull().default(false),
    canWrite: boolean("can_write").notNull().default(false),
    createdAt: isoTimestamp("created_at")
      .notNull()
      .default(sql`now()`),
    updatedAt: isoTimestamp("updated_at")
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => sql`now()`),
  },
  (table) => ({
    identityUnique: uniqueIndex().on(
      table.identityId,
    ),
  }),
);

export const permissionsProjectApp = pgTable("permissions", {
  permissionGrant: permissionGrants.id,
  projectId: projects.id,
  appId: apps.id,
});

export type PermissionRuleRow = typeof permissionRules.$inferSelect;
export type PermissionRuleInsert = typeof permissionRules.$inferInsert;
export type PermissionGrantRow = typeof permissionGrants.$inferSelect;
export type PermissionGrantInsert = typeof permissionGrants.$inferInsert;
