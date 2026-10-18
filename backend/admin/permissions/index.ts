import { Elysia } from "elysia";
import { type } from "arktype";
import { permissionRuleDAO } from "../../../db/dao/permission-rules.ts";
import { permissionUserDAO } from "../../../db/dao/permission-users.ts";

export const permissionRoutes = new Elysia({ prefix: "permissions" })
  .get(
    "/",
    async () => {
      const [rules, users] = await Promise.all([permissionRuleDAO.list(), permissionUserDAO.list()]);
      return { rules, users };
    }
  )
  .post(
    "/rules",
    async ({ body }) => await permissionRuleDAO.create({
      groupName: body.groupName,
      environments: body.environments,
      appPrefixes: body.appPrefixes,
      isEnabled: body.isEnabled,
    }),
    { body: type({ groupName: "string", environments: "string[]?", appPrefixes: "string[]?", isEnabled: "boolean?" }) }
  )
  .patch(
    "/rules/:id",
    async ({ params: { id }, body }) => await permissionRuleDAO.updateOrThrow(id, {
      environments: body.environments,
      appPrefixes: body.appPrefixes,
      isEnabled: body.isEnabled !== undefined ? (body.isEnabled ? 1 : 0) : undefined,
    }),
    { params: type({ id: "string.uuid" }), body: type({ environments: "string[]?", appPrefixes: "string[]?", isEnabled: "boolean?" }) }
  )
  .delete(
    "/rules/:id",
    async ({ params: { id } }) => { await permissionRuleDAO.delete(id); return { success: true }; },
    { params: type({ id: "string.uuid" }) }
  )
  .post(
    "/users",
    async ({ body }) => await permissionUserDAO.create({
      email: body.email,
      environments: body.environments,
      appPrefixes: body.appPrefixes,
      isEnabled: body.isEnabled ? 1 : 0,
    }),
    { body: type({ email: "string", environments: "string[]?", appPrefixes: "string[]?", isEnabled: "boolean?" }) }
  )
  .patch(
    "/users/:id",
    async ({ params: { id }, body }) => await permissionUserDAO.updateOrThrow(id, {
      environments: body.environments,
      appPrefixes: body.appPrefixes,
      isEnabled: body.isEnabled !== undefined ? (body.isEnabled ? 1 : 0) : undefined,
    }),
    { params: type({ id: "string.uuid" }), body: type({ environments: "string[]?", appPrefixes: "string[]?", isEnabled: "boolean?" }) }
  )
  .delete(
    "/users/:id",
    async ({ params: { id } }) => { await permissionUserDAO.delete(id); return { success: true }; },
    { params: type({ id: "string.uuid" }) }
  );