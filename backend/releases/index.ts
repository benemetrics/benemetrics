import { Elysia } from "elysia";
import { type as arktype } from "arktype";
import { appDAO } from "db/dao/project";
import { releaseDAO } from "db/dao/releases";
import { listClickHouseEventsForProject } from "../clickhouse";
import { computeIssueMetrics } from "./metrics";
import { resolveAdminId } from "../auth";

// ── oidc surface: the admin reads and writes ─────────────
export const releaseRoutes = new Elysia({ prefix: "/api/admin/releases" })
  .resolve(resolveAdminId)
  .post(
    "/",
    async ({ body }) => {
      await appDAO.findByIdOrThrow(body.appId);
      return releaseDAO.create({ appId: body.appId, version: body.version, ref: body.ref ?? null, url: body.url ?? null, owner: body.owner ?? null, status: body.status ?? "draft" });
    },
    {
      body: arktype({
        appId: "string.uuid",
        version: "string",
        ref: "string?",
        url: "string?",
        owner: "string?",
        status: "'draft' | 'finalized'?",
      }),
    },
  )
  .get(
    "/",
    async ({ query }) => {
      if (query.appId) await appDAO.findByIdOrThrow(query.appId);

      return releaseDAO.list({
        appId: query.appId,
        cursor: query.cursor,
        limit: query.limit,
      });
    },
    {
      query: arktype({
        appId: "string.uuid?",
        cursor: "string?",
        limit: "string.integer.parse?",
      }),
    },
  )
  .get(
    "/:id",
    async ({ params: { id } }) => releaseDAO.findByIdOrThrow(id),
    {
      params: arktype({ id: "string.uuid" }),
    },
  )
  .patch(
    "/:id",
    async ({ params: { id }, body }) => {
      const current = await releaseDAO.findByIdOrThrow(id);
      return releaseDAO.updateOrThrow(id, { ref: body.ref ?? current.ref, url: body.url ?? current.url, owner: body.owner ?? current.owner, status: body.status ?? current.status });
    },
    {
      params: arktype({ id: "string.uuid" }),
      body: arktype({
        ref: "string?",
        url: "string?",
        owner: "string?",
        status: "'draft' | 'finalized'?",
      }),
    },
  )
  .delete(
    "/:id",
    async ({ params: { id } }) => {
      await releaseDAO.delete(id);
      return { success: true };
    },
    {
      params: arktype({ id: "string.uuid" }),
    },
  )
  .post(
    "/:id/finalize",
    async ({ params: { id } }) => {
      await releaseDAO.findByIdOrThrow(id);
      const finalized = await releaseDAO.updateOrThrow(id, { status: "finalized" });
      return finalized;
    },
    {
      params: arktype({ id: "string.uuid" }),
    },
  )
  .get(
    "/:id/summary",
    async ({ params: { id } }) => {
      const release = await releaseDAO.findByIdOrThrow(id);
      const app = await appDAO.findByIdOrThrow(release.appId);

      const events = await listClickHouseEventsForProject(app.projectId);
      const issueMetrics = computeIssueMetrics(events, release.version);

      return { ...release, ...issueMetrics };
    },
    {
      params: arktype({ id: "string.uuid" }),
    },
  );
