import { Elysia } from "elysia";
import { type } from "arktype";
import { featureFlagDAO } from "../../db/dao/feature-flags.ts";
import { segmentDAO } from "../../db/dao/segments.ts";
import { crypto } from "../utils/crypto.ts";

const VariantSchema = type({
  key: "string",
  name: "string",
  value: "unknown",
  weight: "number",
});

const TargetingRuleSchema = type({
  attribute: "string",
  operator: "string",
  value: "unknown",
  variantKey: "string?",
});

export const featureFlagRoutes = new Elysia({ prefix: "feature-flags" })
  .post(
    "/",
    async ({ body }) => {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      const variants = body.variants ?? (
        body.type === "boolean"
          ? [{ key: "control", name: "Control", value: false, weight: 50 }, { key: "treatment", name: "Treatment", value: true, weight: 50 }]
          : [{ key: "default", name: "Default", value: body.defaultValue, weight: 100 }]
      );

      const result = await featureFlagDAO.create({
        ...body,
        variants,
        targetingRules: body.targetingRules ?? [],
        segments: body.segments ?? [],
        experiment: body.experiment ?? null,
        rolloutPercentage: body.rolloutPercentage ?? 100,
      });

      return result;
    },
    {
      body: type({
        key: "string",
        name: "string",
        description: "string?",
        type: "'boolean' | 'string' | 'number' | 'json'",
        defaultValue: "string | number | boolean",
        variants: VariantSchema.array().optional(),
        targetingRules: TargetingRuleSchema.array().optional(),
        segments: "string[]?",
        experiment: "unknown?",
        rolloutPercentage: "number?",
      }),
    }
  )
  .get(
    "/",
    async ({ query }) => {
      const { data, pagination } = await featureFlagDAO.list({
        status: query.status,
        type: query.type,
        search: query.search,
        page: query.page,
        limit: query.limit,
      });
      return { data, pagination };
    },
    {
      query: type({
        status: "'draft' | 'active' | 'paused' | 'archived'?",
        type: "'boolean' | 'string' | 'number' | 'json'?",
        search: "string?",
        page: "string.integer.parse?",
        limit: "string.integer.parse?",
      }),
    }
  )
  .get(
    "/:id",
    async ({ params: { id } }) => {
      return await featureFlagDAO.findByIdOrThrow(id);
    },
    { params: type({ id: "string.uuid" }) }
  )
  .patch(
    "/:id",
    async ({ params: { id }, body }) => {
      return await featureFlagDAO.updateOrThrow(id, body);
    },
    {
      params: type({ id: "string.uuid" }),
      body: type({
        name: "string?",
        description: "string?",
        type: "'boolean' | 'string' | 'number' | 'json'?",
        defaultValue: "string | number | boolean?",
        variants: VariantSchema.array().optional(),
        targetingRules: TargetingRuleSchema.array().optional(),
        segments: "string[]?",
        experiment: "unknown?",
        rolloutPercentage: "number?",
      }),
    }
  )
  .post(
    "/:id/status",
    async ({ params: { id }, body }) => {
      return await featureFlagDAO.updateStatus(id, body.status);
    },
    {
      params: type({ id: "string.uuid" }),
      body: type({ status: "'draft' | 'active' | 'paused' | 'archived'" }),
    }
  )
  .delete(
    "/:id",
    async ({ params: { id } }) => {
      await featureFlagDAO.delete(id);
      return { success: true };
    },
    { params: type({ id: "string.uuid" }) }
  );