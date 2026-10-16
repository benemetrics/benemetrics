import { Elysia } from "elysia";
import { internalError, unauthorized } from "backend/errors";
import { type as arktype } from "arktype";
import { dsnDAO } from "db/dao/dsn";
import { adminAuthEnforced, validateAdminAuth } from "../auth";

const PROTOCOL = "https";

function toDsnResponse(record: {
  id: string;
  projectId: string;
  publicKey: string;
  host: string;
  protocol: string;
  createdAt: string;
}) {
  return {
    dsn: `${record.protocol}://${record.publicKey}@${record.host}/${record.projectId}`,
    projectId: record.projectId,
    publicKey: record.publicKey,
    host: record.host,
    protocol: record.protocol,
    id: record.id,
    createdAt: record.createdAt,
  };
}

export const dsnRoutes = new Elysia({ prefix: "api/dsn" })
  .onBeforeHandle(({ request }) => {
    if (!adminAuthEnforced()) return;
    const auth = validateAdminAuth(request);
    if (!auth.valid) {
      throw unauthorized(auth.error);
    }
  })
  .post(
    "/create",
    async ({ body }) => {
      const [record] = await dsnDAO.upsert({
        projectId: body.projectId,
        publicKey: body.publicKey || crypto.randomUUID(),
        host: body.host,
        protocol: PROTOCOL,
      });
      if (!record) throw internalError("Failed to store DSN");
      return toDsnResponse(record);
    },
    {
      body: arktype({
        projectId: "string",
        host: "string",
        publicKey: "string?",
      }),
    },
  )
  .get(
    "/:projectId",
    async ({ params: { projectId } }) => {
      const record = await dsnDAO.findByProjectIdOrThrow(projectId);
      return toDsnResponse(record);
    },
    {
      params: arktype({ projectId: "string" }),
    },
  )
  .post(
    "/generate",
    async ({ body }) => {
      const [record] = await dsnDAO.upsert({
        projectId: body.projectId,
        publicKey: crypto.randomUUID(),
        host: body.host,
        protocol: PROTOCOL,
      });
      if (!record) throw internalError("Failed to store DSN");
      return toDsnResponse(record);
    },
    {
      body: arktype({
        projectId: "string",
        host: "string",
      }),
    },
  );
