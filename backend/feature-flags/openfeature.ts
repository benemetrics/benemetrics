import { Elysia } from "elysia";
import { type as arktype } from "arktype";
import { featureFlagDAO } from "db/dao/feature-flags";
import { requireDsnKey, scopeOf } from "./dsn";
import { controlVariant, evaluateWithAssignment } from "./evaluation";
import type { FeatureFlagVariant } from "backend/protocol/feature-flags";

export const flagsV1Routes = new Elysia({ prefix: "v1/flags" }).post(
  "/:key",
  async ({ params: { key }, body, request }) => {
    const app = await requireDsnKey(request);
    const flag = await featureFlagDAO.findByKeyForScope(key, scopeOf(app));
    if (!flag)
      return {
        variant: "default",
        value: null,
        reason: "Feature flag not found",
        errorCode: "FLAG_NOT_FOUND",
      };
    const control = controlVariant(flag.variants as FeatureFlagVariant[]);
    if (flag.status !== "active")
      return {
        variant: control?.key ?? "default",
        value: control?.value ?? null,
        reason: `Flag is ${flag.status}, returning default`,
      };
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
