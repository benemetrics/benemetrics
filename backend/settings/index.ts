import { Elysia } from "elysia";
import { type as arktype } from "arktype";
import { readEventsTtl, setEventsTtl, type TtlUnit } from "../clickhouse";
import { badRequest } from "../errors";
import { resolveAdminId } from "../auth";

const MAX_AMOUNT = 1200;

// The value is read back from the table definition, so the admin sees what the store enforces.
// ── oidc surface: the admin reads and writes ─────────────
export const settingsRoutes = new Elysia({ prefix: "/api/admin/settings" })
  .resolve(resolveAdminId)
  .get("/events-ttl", async () => readEventsTtl())
  .put(
    "/events-ttl",
    async ({ body }) => {
      if (
        !Number.isInteger(body.amount) ||
        body.amount < 0 ||
        body.amount > MAX_AMOUNT
      ) {
        throw badRequest(
          `"amount" must be an integer between 0 and ${MAX_AMOUNT}`,
        );
      }
      return await setEventsTtl(body.amount, body.unit as TtlUnit);
    },
    {
      body: arktype({
        amount: "number",
        unit: "'day' | 'week' | 'month' | 'year'",
      }),
    },
  );
