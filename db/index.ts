import { drizzle } from "drizzle-orm/postgres-js";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";
import * as schema from "./schema/index.ts";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

let dbInstance: ReturnType<typeof drizzle> | ReturnType<typeof drizzlePglite> | null = null;

async function getDb() {
  if (dbInstance) return dbInstance;

  if (process.env.DATABASE_URL) {
    const client = postgres(process.env.DATABASE_URL, { prepare: false });
    dbInstance = drizzle(client, { schema });
    await migrate(dbInstance, { migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), "migrations") });
  } else if (process.env.NODE_ENV === "test") {
    const client = new PGlite(":memory:");
    dbInstance = drizzlePglite(client, { schema });
    await migratePglite(dbInstance, { migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), "migrations") });
  } else {
    const client = new PGlite("./.pglite");
    dbInstance = drizzlePglite(client, { schema });
    await migratePglite(dbInstance, { migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), "migrations") });
  }

  return dbInstance;
}

// Create a proper proxy that forwards all properties
const db = new Proxy({} as any, {
  get(target, prop) {
    if (!dbInstance) {
      throw new Error("Database not initialized. Call getDb() first.");
    }
    return (dbInstance as any)[prop];
  },
}) as any;

export { db };
export { schema } from "./schema/index.ts";
export { getDb };