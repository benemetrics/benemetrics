import { Elysia } from "elysia";
import { badRequest } from "backend/errors";
import { type as arktype } from "arktype";
import { featureFlagDAO } from "db/dao/feature-flags";
import { publishFlagChange } from "backend/flags-events";

export const featureFlagRoutes = new Elysia({ prefix: "feature-flags" })
  .post(
    "/",
    async ({ body }) => {
      const variants = body.variants?.length
        ? body.variants
        : body.type === "boolean"
          ? [
              { key: "control", name: "Control", value: false, weight: 50 },
              { key: "treatment", name: "Treatment", value: true, weight: 50 },
            ]
          : [{ key: "default", name: "Default", value: body.defaultValue, weight: 100 }];

      const created = await featureFlagDAO.create({
        key: body.key,
        name: body.name,
        description: body.description ?? "",
        type: body.type,
        defaultValue: String(body.defaultValue),
        variants: JSON.stringify(variants),
        targetingRules: JSON.stringify(body.targetingRules ?? []),
        segments: JSON.stringify(body.segments ?? []),
        status: "draft",
        rolloutPercentage: 100,
        experiment: body.experiment != null ? JSON.stringify(body.experiment) : null,
      });

      publishFlagChange({ type: "create", flagKey: created.key, flag: created });
      return created;
    },
    {
      body: arktype({
        key: "string",
        name: "string",
        description: "string?",
        type: "'boolean' | 'string' | 'number' | 'json'",
        defaultValue: "string | number | boolean",
        variants: "Array?",
        targetingRules: "Array?",
        segments: "Array?",
        experiment: "unknown?",
      }),
    },
  )
  .get(
    "/",
    async ({ query: { page = 1, limit = 20, status: flagStatus, type, search } }) => {
      const { total, data } = await featureFlagDAO.list({
        page,
        limit,
        status: flagStatus,
        type,
        search,
      });
      return {
        data,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    },
    {
      query: arktype({
        page: "string.integer.parse?",
        limit: "string.integer.parse?",
        status: "'draft' | 'active' | 'paused' | 'archived'?",
        type: "string?",
        search: "string?",
      }),
    },
  )
  .get("/:id", async ({ params: { id } }) => featureFlagDAO.findByIdOrThrow(id), {
    params: arktype({ id: "string.uuid" }),
  })
  .patch(
    "/:id",
    async ({ params: { id }, body }) => {
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
      publishFlagChange({ type: "update", flagKey: updated.key, flag: updated });
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
        variants: "Array?",
        targetingRules: "Array?",
        segments: "Array?",
        experiment: "unknown?",
        rolloutPercentage: "0 <= number.integer <= 100?",
      }),
    },
  )
  .post(
    "/:id/status",
    async ({ params: { id }, body }) => {
      const updated = await featureFlagDAO.updateOrThrow(id, {
        status: body.status,
        updatedAt: new Date().toISOString(),
      });
      publishFlagChange({ type: "status", flagKey: updated.key, flag: updated });
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
      const flag = await featureFlagDAO.findByIdOrThrow(id);

      if (flag.status !== "draft")
        throw badRequest("Only draft flags can be deleted");

      await featureFlagDAO.delete(id);
      publishFlagChange({ type: "delete", flagKey: flag.key });
      return { success: true };
    },
    {
      params: arktype({ id: "string.uuid" }),
    },
  );
