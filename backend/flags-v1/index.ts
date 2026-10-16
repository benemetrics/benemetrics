import { Elysia } from "elysia";
import { type as arktype } from "arktype";
import { featureFlagDAO } from "db/dao/feature-flags";
import {
  controlVariant,
  evaluateWithAssignment,
} from "../evaluation";
import type { FeatureFlagVariant } from "../protocol/dsn";

// OpenFeature Web Flag Evaluation API ("OpenFlag") adapter.
// Speaks the OpenFlag wire format — one flag per request,
// targeted by `targetingKey` — on top of the same evaluation
// engine the Sentry-style batch endpoint uses.
//
// Response: { variant, value, reason, errorCode? } with
// OpenFeature error codes (e.g. FLAG_NOT_FOUND).
export const flagsV1Routes = new Elysia({ prefix: "v1/flags" })
  .post(
    "/:key",
    async ({ params: { key }, body }) => {
      const flag = await featureFlagDAO.findByKey(key);
      if (!flag) {
        return {
          variant: "default",
          value: null,
          reason: "Feature flag not found",
          errorCode: "FLAG_NOT_FOUND",
        };
      }

      const variants = flag.variants as FeatureFlagVariant[];
      if (flag.status !== "active") {
        const control = controlVariant(variants);
        return {
          variant: control?.key ?? "default",
          value: control?.value ?? null,
          reason: `Flag is ${flag.status}, returning default`,
        };
      }

      const result = await evaluateWithAssignment(
        flag,
        { id: body.targetingKey },
        body.context,
      );
      return {
        variant: result.variantKey,
        value: result.value,
        reason: result.reason,
      };
    },
    {
      params: arktype({ key: "string" }),
      body: arktype({
        targetingKey: "string",
        context: "Record<string, unknown>?",
      }),
    },
  );
