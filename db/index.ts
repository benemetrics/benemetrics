import { PGlite } from "@electric-sql/pglite";
import { drizzle as pgliteDrizzle } from "drizzle-orm/pglite";
import { migrate as pgliteMigrate } from "drizzle-orm/pglite/migrator";
import { drizzle as pgDrizzle } from "drizzle-orm/bun-sql";
import { migrate as pgMigrate } from "drizzle-orm/bun-sql/migrator";
import { projects, apps, featureFlags, segments, releases, experimentAssignments, experimentMetrics, alertChannels, alertRules, alertIncidents, sourceMapTokens, sourceMaps } from "./schema/index";

type Database = ReturnType<typeof pgliteDrizzle>;

const MIGRATIONS_FOLDER = `${import.meta.dir}/migrations`;
const DEV_DATA_DIR = "./.pglite";
const PGLITE_CLIENT_KEY = Symbol.for("sentry.db.pgliteClient");

let pgliteClient: PGlite | null = null;

function getDevPgliteClient(): PGlite {
  const slot = globalThis as unknown as Record<PropertyKey, unknown>;
  const cached = slot[PGLITE_CLIENT_KEY] as PGlite | undefined;
  if (cached && !cached.closed) return cached;

  const client = new PGlite({ dataDir: DEV_DATA_DIR });
  slot[PGLITE_CLIENT_KEY] = client;
  return client;
}

async function createTestDatabase(): Promise<Database> {
  const client = new PGlite();
  pgliteClient = client;

  const db = pgliteDrizzle({ client });
  await pgliteMigrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

async function createDevDatabase(): Promise<Database> {
  const client = getDevPgliteClient();
  pgliteClient = client;

  const db = pgliteDrizzle({ client });
  await pgliteMigrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

async function createPostgresDatabase(url: string): Promise<Database> {
  const db = pgDrizzle(url);
  await pgMigrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db as unknown as Database;
}

async function getDbInstance(): Promise<Database> {
  if (process.env.NODE_ENV === "test") return createTestDatabase();
  if (process.env.DATABASE_URL) return createPostgresDatabase(process.env.DATABASE_URL);
  return createDevDatabase();
}

export const db: Database = await getDbInstance();

export async function closeDb(): Promise<void> {
  if (!pgliteClient) return;
  const client = pgliteClient;
  pgliteClient = null;
  await client.close();
}

export { projects, apps, featureFlags, segments, releases, experimentAssignments, experimentMetrics, alertChannels, alertRules, alertIncidents, sourceMapTokens, sourceMaps };
