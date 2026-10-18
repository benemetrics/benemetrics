import {
  pgTable,
  text,
  integer,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";

// Read permissions for OIDC/OAuth2 users.
//
// `permission_rules` maps an identity-provider group to a read scope:
// environment names and app-name prefixes. `permission_users` is the
// whitelist — an email whose scope overrides whatever the user's groups
// would grant. Group names and emails are stored lowercased (matching is
// case-insensitive), which is also what makes the unique indexes
// race-safe. Scope lists are JSON arrays stored as text, like the other
// JSON columns in this schema. Management is admin-token-only; with no
// matching grant the UI prompts for the admin token.

export const permissionRules = pgTable("permission_rules", {
  id: text("id").primaryKey(),
  groupName: text("group_name").notNull(),
  environments: text("environments").notNull().default("[]"),
  appPrefixes: text("app_prefixes").notNull().default("[]"),
  isEnabled: integer("is_enabled").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  groupNameUnique: uniqueIndex("permission_rules_group_name_idx").on(table.groupName),
}));

export const permissionUsers = pgTable("permission_users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  environments: text("environments").notNull().default("[]"),
  appPrefixes: text("app_prefixes").notNull().default("[]"),
  isEnabled: integer("is_enabled").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  emailUnique: uniqueIndex("permission_users_email_idx").on(table.email),
}));

export type PermissionRule = typeof permissionRules.$inferSelect;
export type PermissionRuleInsert = typeof permissionRules.$inferInsert;
export type PermissionUser = typeof permissionUsers.$inferSelect;
export type PermissionUserInsert = typeof permissionUsers.$inferInsert;
