import { Elysia } from "elysia";
import { type as arktype } from "arktype";
import { appDAO } from "db/dao/project";
import { releaseDAO } from "db/dao/releases";
import { storedEventDAO } from "db/dao/stored-event";
import { computeIssueMetrics } from "./metrics";
import type { Release } from "db/schema/releases";

function toReleaseResponse(release: Release) {
  return {
    id: release.id,
    appId: release.appId,
    version: release.version,
    ref: release.ref,
    url: release.url,
    owner: release.owner,
    status: release.status,
    firstSeen: release.firstSeen,
    lastSeen: release.lastSeen,
    eventCount: release.eventCount,
    latestEventId: release.latestEventId,
    createdAt: release.createdAt,
    updatedAt: release.updatedAt,
  };
}

// Releases are normally auto-created by ingestion (see events/index.ts).
export const releaseRoutes = new Elysia({ prefix: "releases" })
  .post(
    "/",
    async ({ body }) => {
      await appDAO.findByIdOrThrow(body.appId);

      const release = await releaseDAO.create({
        appId: body.appId,
        version: body.version,
        ref: body.ref ?? null,
        url: body.url ?? null,
        owner: body.owner ?? null,
        status: body.status ?? "draft",
      });

      return toReleaseResponse(release);
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

      const { data, pagination } = await releaseDAO.list({
        appId: query.appId,
        page: query.page,
        limit: query.limit,
      });

      return { data: data.map(toReleaseResponse), pagination };
    },
    {
      query: arktype({
        appId: "string.uuid?",
        page: "string.integer.parse?",
        limit: "string.integer.parse?",
      }),
    },
  )
  .get(
    "/:id",
    async ({ params: { id } }) => {
      const release = await releaseDAO.findByIdOrThrow(id);
      return toReleaseResponse(release);
    },
    {
      params: arktype({ id: "string.uuid" }),
    },
  )
  .patch(
    "/:id",
    async ({ params: { id }, body }) => {
      await releaseDAO.findByIdOrThrow(id);

      const updated = await releaseDAO.updateOrThrow(id, {
        ...(body.ref !== undefined ? { ref: body.ref } : {}),
        ...(body.url !== undefined ? { url: body.url } : {}),
        ...(body.owner !== undefined ? { owner: body.owner } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      });

      return toReleaseResponse(updated);
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
      await releaseDAO.findByIdOrThrow(id);
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
      return toReleaseResponse(finalized);
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

      const events = await storedEventDAO.listByProject(app.projectId);
      const issueMetrics = computeIssueMetrics(events, release.version);

      return { ...toReleaseResponse(release), ...issueMetrics };
    },
    {
      params: arktype({ id: "string.uuid" }),
    },
  );
