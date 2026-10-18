import { Elysia } from "elysia";
import { type } from "arktype";
import { clickhouseClient } from "../../clickhouse.ts";

export const settingsRoutes = new Elysia({ prefix: "settings" })
  .get(
    "/events-ttl",
    async () => {
      const result = await clickhouseClient.query({
        query: "SELECT name, create_table_query FROM system.tables WHERE name = 'sentry_events' AND database = currentDatabase()",
      });
      const table = await result.json();
      if (!table[0]) throw new Error("sentry_events table not found");

      const createQuery = table[0].create_table_query;
      const ttlMatch = createQuery.match(/TTL\s+(.+?)\s*$/i);
      const expression = ttlMatch ? ttlMatch[1].trim() : null;

      let interval = { amount: 1, unit: "MONTH" };
      if (expression) {
        const match = expression.match(/toIntervalMonth\((\d+)\)/i);
        if (match) {
          interval = { amount: parseInt(match[1]), unit: "MONTH" };
        }
      }

      return { table: "sentry_events", expression, interval };
    }
  )
  .put(
    "/events-ttl",
    async ({ body }) => {
      const amount = body.amount;
      const unit = body.unit.toUpperCase();
      if (amount <= 0 || amount > 10000) throw new Error("Invalid amount");
      if (!["SECOND", "MINUTE", "HOUR", "DAY", "WEEK", "MONTH", "YEAR"].includes(unit)) throw new Error("Invalid unit");

      await clickhouseClient.exec({
        query: `ALTER TABLE sentry_events MODIFY TTL toDateTime(receivedAt) + toInterval${unit}(${amount})`,
      });

      // Re-read
      const result = await clickhouseClient.query({
        query: "SELECT create_table_query FROM system.tables WHERE name = 'sentry_events' AND database = currentDatabase()",
      });
      const table = await result.json();
      const createQuery = table[0].create_table_query;
      const ttlMatch = createQuery.match(/TTL\s+(.+?)\s*$/i);
      const expression = ttlMatch ? ttlMatch[1].trim() : null;
      return { table: "sentry_events", expression, interval: { amount, unit } };
    },
    { body: type({ amount: "number", unit: "'SECOND' | 'MINUTE' | 'HOUR' | 'DAY' | 'WEEK' | 'MONTH' | 'YEAR'" }) }
  );