import { Elysia } from "elysia";
import { type as arktype } from "arktype";
import { readEventsTtl, setEventsTtl, type TtlUnit } from "../clickhouse";
import { readBucketTtl, setBucketTtl } from "../s3-ttl";
import { badRequest } from "../errors";

const MAX_AMOUNT = 1200;

// ── oidc surface: the admin reads and writes ─────────────
export const settingsRoutes = new Elysia({ prefix: "/api/admin/settings" })
  .get("/events-ttl", async () => ({
    events: readEventsTtl(),
    s3: readBucketTtl(),
  }))
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
      const unit = body.unit as TtlUnit;
      return {
        events: await setEventsTtl(body.amount, unit),
        s3: await setBucketTtl(body.amount, unit),
      };
    },
    {
      body: arktype({
        amount: "number",
        unit: "'day' | 'week' | 'month' | 'year'",
      }),
    },
  );
