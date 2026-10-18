import { pgTable, text, integer, index, uniqueIndex } from "drizzle-orm/pg-core";

export const permissionRules = pgTable(
  "permission_rules",
  {
    id: text("id").primaryKey(),
    groupName: text("group_name").notNull(),
    environments: text("environments").notNull().default("[]"),
    appPrefixes: text("app_prefixes").notNull().default("[]"),
    isEnabled: integer("is_enabled").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    groupNameUnique: uniqueIndex("permission_rules_group_name_unique").on(table.groupName),
  }),
);

export type PermissionRule = typeof permissionRules.$inferSelect;
export type PermissionRuleInsert = typeof permissionRules.$inferInsert;