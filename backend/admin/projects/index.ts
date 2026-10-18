import { Elysia } from "elysia";
import { type } from "arktype";
import { projectDAO } from "../../../db/dao/projects.ts";
import { appDAO } from "../../../db/dao/apps.ts";
import { environmentDAO } from "../../../db/dao/environments.ts";
import { crypto } from "../../utils/crypto.ts";

export const projectRoutes = new Elysia({ prefix: "projects" })
  .post(
    "/",
    async ({ body }) => {
      return await projectDAO.create({ name: body.name, description: body.description });
    },
    { body: type({ name: "string", description: "string?" }) }
  )
  .get(
    "/",
    async ({ query }) => await projectDAO.list({ page: query.page, limit: query.limit }),
    { query: type({ page: "string.integer.parse?", limit: "string.integer.parse?" }) }
  )
  .get(
    "/:id",
    async ({ params: { id } }) => {
      const project = await projectDAO.findByIdOrThrow(id);
      const { data: apps } = await appDAO.listByProject(id);
      return { ...project, apps };
    },
    { params: type({ id: "string.uuid" }) }
  )
  .delete(
    "/:id",
    async ({ params: { id } }) => {
      await projectDAO.delete(id);
      return { success: true };
    },
    { params: type({ id: "string.uuid" }) }
  )
  .post(
    "/:id/duplicate",
    async ({ params: { id }, body }) => {
      const project = await projectDAO.findByIdOrThrow(id);
      const newProject = await projectDAO.create({ name: body.name ?? `${project.name} (copy)`, description: body.description });
      // Would also duplicate environments and apps
      return newProject;
    },
    { params: type({ id: "string.uuid" }), body: type({ name: "string?", description: "string?" }) }
  )
  .get(
    "/:id/apps",
    async ({ params: { id }, query }) => await appDAO.listByProject(id, { page: query.page, limit: query.limit }),
    { params: type({ id: "string.uuid" }), query: type({ page: "string.integer.parse?", limit: "string.integer.parse?" }) }
  )
  .post(
    "/:id/apps",
    async ({ params: { id }, body }) => {
      const project = await projectDAO.findByIdOrThrow(id);
      let environmentId: string;

      if (body.environment) {
        const env = await environmentDAO.findByProjectAndSlug(id, body.environment) ||
          await environmentDAO.create({ projectId: id, name: body.environment });
        environmentId = env.id;
      } else {
        const defaultEnv = await environmentDAO.findDefaultByProject(id);
        environmentId = defaultEnv!.id;
      }

      const app = await appDAO.create({
        projectId: id,
        environmentId,
        name: body.name,
        platform: body.platform,
      });

      return { ...app, dsn: `http://${app.publicKey}@localhost/${app.number}` };
    },
    {
      body: type({
        name: "string",
        platform: "string?",
        environment: "string?",
      }),
    }
  );