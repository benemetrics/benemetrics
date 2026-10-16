import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  // Point at the barrel: globbing ./db/schema would load every table twice
  // (once via the file itself, once via the re-export).
  schema: "./db/schema/index.ts",
  out: "./db/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL || "postgresql://postgres:mysecretpassword@localhost:5432/sentry",
  },
});