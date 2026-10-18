import { pgTable, text, integer, index, uniqueIndex } from "drizzle-orm/pg-core";

export const permissionUsers = pgTable(
  "permission_users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    environments: text("environments").notNull().default("[]"),
    appPrefixes: text("app_prefixes").notNull().default("[]"),
    isEnabled: integer("is_enabled").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    emailUnique: uniqueIndex("permission_users_email_unique").on(table.email),
  }),
);

export type PermissionUser = typeof permissionUsers.$inferSelect;
export type PermissionUserInsert = typeof permissionUsers.$inferInsert;