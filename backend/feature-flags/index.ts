import { Elysia } from "elysia";
import { badRequest } from "backend/errors";
import { type as arktype } from "arktype";
import { featureFlagDAO } from "db/dao/feature-flags";
import { appDAO, projectDAO } from "db/dao/project";
import { publishFlagChange } from "./events";
import {
  experimentConfigSchema,
  flagVariantSchema,
  targetingRuleSchema,
} from "backend/protocol/feature-flags";
import { resolveAdminId } from "../auth";

// The other surfaces of the domain: the admin experiment routes, the SDK
// evaluation endpoints, the SSE stream and the OpenFeature endpoint.
export { experimentRoutes } from "./experiments";
export { evaluationRoutes } from "./evaluation";
export { flagsStreamRoutes } from "./stream";
export { flagsV1Routes } from "./openfeature";
export { publishFlagChange, subscribeFlagChanges } from "./events";

const variantsSchema = flagVariantSchema.array().atLeastLength(1).optional();
const targetingRulesSchema = targetingRuleSchema.array().optional();

// The weight sum cannot be expressed in the schema.
function assertVariants(variants: Array<{ weight: number }>): void {
  const total = variants.reduce((sum, variant) => sum + variant.weight, 0);
  if (total !== 100) {
    throw badRequest(`Variant weights must sum to 100 (got ${total})`);
  }
}

function assertRuleAttributes(rules: Array<{ attribute: string }>): void {
  for (const rule of rules) {
    const root = rule.attribute.split(".")[0];
    if (root !== "user" && root !== "context") {
      throw badRequest(
        `Targeting rule attribute must start with "user." or "context." (got "${rule.attribute}")`,
      );
    }
  }
}

// ── oidc surface: the admin reads and writes ─────────────
export const featureFlagRoutes = new Elysia({ prefix: "/api/admin/feature-flags" })
  .resolve(resolveAdminId)
  .post(
    "/",
    async ({ body }) => {
      const variants = body.variants?.length ? body.variants : body.type === "boolean" ? [{ key: "control", name: "Control", value: false, weight: 50 }, { key: "treatment", name: "Treatment", value: true, weight: 50 }] : [{ key: "default", name: "Default", value: body.defaultValue, weight: 100 }];
      assertVariants(variants);
      assertRuleAttributes(body.targetingRules ?? []);
      // The flag belongs to a project, optionally narrowed to one of its apps.
      await projectDAO.findByIdOrThrow(body.projectId);
      if (body.appId) {
        const app = await appDAO.findByIdOrThrow(body.appId);
        if (app.projectId !== body.projectId) {
          throw badRequest("The app does not belong to the project");
        }
      }
      const created = await featureFlagDAO.create({ key: body.key, name: body.name, description: body.description ?? "", type: body.type, defaultValue: String(body.defaultValue), variants: JSON.stringify(variants), targetingRules: JSON.stringify(body.targetingRules ?? []), segments: JSON.stringify(body.segments ?? []), status: "draft", rolloutPercentage: body.rolloutPercentage ?? 100, experiment: body.experiment != null ? JSON.stringify(body.experiment) : null, projectId: body.projectId, appId: body.appId ?? null });
      await publishFlagChange({ type: "create", flagKey: created.key, flag: created });
      return created;
    },
    {
      body: arktype({
        key: "string",
        name: "string",
        description: "string?",
        type: "'boolean' | 'string' | 'number' | 'json'",
        defaultValue: "string | number | boolean",
        variants: variantsSchema,
        targetingRules: targetingRulesSchema,
        segments: "string[]?",
        experiment: experimentConfigSchema.optional(),
        rolloutPercentage: "0 <= number.integer <= 100?",
        projectId: "string.uuid",
        appId: "string.uuid?",
      }),
    },
  )
  .get(
    "/",
    async ({ query }) => {
      if (query.projectId) await projectDAO.findByIdOrThrow(query.projectId);
      if (query.appId) await appDAO.findByIdOrThrow(query.appId);
      return featureFlagDAO.list({ cursor: query.cursor, limit: query.limit, status: query.status, type: query.type, search: query.search, projectId: query.projectId ?? null, appId: query.appId ?? null });
    },
    {
      query: arktype({
        cursor: "string?",
        limit: "string.integer.parse?",
        status: "'draft' | 'active' | 'paused' | 'archived'?",
        type: "'boolean' | 'string' | 'number' | 'json'?",
        search: "string?",
        projectId: "string.uuid?",
        appId: "string.uuid?",
      }),
    },
  )
  .get("/:id", async ({ params: { id } }) => featureFlagDAO.findByIdOrThrow(id), {
    params: arktype({ id: "string.uuid" }),
  })
  .patch(
    "/:id",
    async ({ params: { id }, body }) => {
      if (body.variants !== undefined) assertVariants(body.variants);
      if (body.targetingRules !== undefined) assertRuleAttributes(body.targetingRules);
      // Only user-facing configuration is patchable; internal columns
      // (id, createdAt, updatedAt) cannot be set by the client. Status
      // changes go through /:id/status.
      const updated = await featureFlagDAO.updateOrThrow(id, {
        ...(body.key !== undefined ? { key: body.key } : {}),
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.type !== undefined ? { type: body.type } : {}),
        ...(body.defaultValue !== undefined
          ? { defaultValue: String(body.defaultValue) }
          : {}),
        ...(body.variants !== undefined
          ? { variants: JSON.stringify(body.variants) }
          : {}),
        ...(body.targetingRules !== undefined
          ? { targetingRules: JSON.stringify(body.targetingRules) }
          : {}),
        ...(body.segments !== undefined
          ? { segments: JSON.stringify(body.segments) }
          : {}),
        ...(body.experiment !== undefined
          ? {
              experiment:
                body.experiment == null ? null : JSON.stringify(body.experiment),
            }
          : {}),
        ...(body.rolloutPercentage !== undefined
          ? { rolloutPercentage: body.rolloutPercentage }
          : {}),
        updatedAt: new Date().toISOString(),
      });
      await publishFlagChange({ type: "update", flagKey: updated.key, flag: updated });
      return updated;
    },
    {
      params: arktype({ id: "string.uuid" }),
      body: arktype({
        key: "string?",
        name: "string?",
        description: "string?",
        type: "'boolean' | 'string' | 'number' | 'json'?",
        defaultValue: "(string | number | boolean)?",
        variants: variantsSchema,
        targetingRules: targetingRulesSchema,
        segments: "string[]?",
        experiment: experimentConfigSchema.optional(),
        rolloutPercentage: "0 <= number.integer <= 100?",
      }),
    },
  )
  .post(
    "/:id/status",
    async ({ params: { id }, body }) => {
      const current = await featureFlagDAO.findByIdOrThrow(id);
      if (current.status === "archived" && body.status !== "archived") {
        throw badRequest("Archived flags cannot change status");
      }
      const updated = await featureFlagDAO.updateOrThrow(id, { status: body.status, updatedAt: new Date().toISOString() });
      await publishFlagChange({ type: "status", flagKey: updated.key, flag: updated });
      return updated;
    },
    {
      params: arktype({ id: "string.uuid" }),
      body: arktype({ status: '"draft" | "active" | "paused" | "archived"' }),
    },
  )
  .delete(
    "/:id",
    async ({ params: { id } }) => {
      const flag = await featureFlagDAO.findById(id);
      if (!flag) return { success: true };
      if (flag.status !== "draft") throw badRequest("Only draft flags can be deleted");
      await featureFlagDAO.delete(id);
      await publishFlagChange({ type: "delete", flagKey: flag.key });
      return { success: true };
    },
    {
      params: arktype({ id: "string.uuid" }),
    },
  );
