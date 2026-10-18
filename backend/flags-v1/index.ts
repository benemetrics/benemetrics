import { Elysia } from "elysia";
import { type } from "arktype";
import { featureFlagDAO } from "../../db/dao/feature-flags.ts";
import { evaluateWithAssignment, controlVariant } from "../evaluation/index.ts";

export const flagsV1Routes = new Elysia({ prefix: "v1/flags" })
  .post(
    "/:key",
    async ({ params: { key }, body }) => {
      const flag = await featureFlagDAO.findByKey(key);
      if (!flag) {
        return { variant: "default", value: null, reason: "Feature flag not found", errorCode: "FLAG_NOT_FOUND" };
      }

      const variants = flag.variants;
      if (flag.status !== "active") {
        const control = controlVariant(variants);
        return { variant: control?.key ?? "default", value: control?.value ?? null, reason: `Flag is ${flag.status}, returning default` };
      }

      const result = await evaluateWithAssignment(flag, { id: body.targetingKey }, body.context);
      return { variant: result.variantKey, value: result.value, reason: result.reason };
    },
    {
      params: type({ key: "string" }),
      body: type({ targetingKey: "string", context: "Record<string, unknown>?" }),
    }
  );