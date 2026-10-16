import { db } from "db";
import { dsnRecords, type DsnRecord } from "db/schema/dsn";
import { eq } from "drizzle-orm";
import { notFound } from "backend/errors";

export const dsnDAO = {
  findById: async (id: string): Promise<DsnRecord | undefined> =>
    (
      await db
        .select()
        .from(dsnRecords)
        .where(eq(dsnRecords.id, id))
        .limit(1)
    )[0],

  findByProjectId: async (projectId: string): Promise<DsnRecord | undefined> =>
    (
      await db
        .select()
        .from(dsnRecords)
        .where(eq(dsnRecords.projectId, projectId))
        .limit(1)
    )[0],

  // One DSN record per project: re-creating or rotating replaces the
  // stored key.
  upsert: (data: {
    projectId: string;
    publicKey: string;
    host: string;
    protocol: string;
  }) =>
    db
      .insert(dsnRecords)
      .values({ ...data, id: crypto.randomUUID(), createdAt: new Date().toISOString() })
      .onConflictDoUpdate({
        target: dsnRecords.projectId,
        set: { publicKey: data.publicKey, host: data.host, protocol: data.protocol },
      })
      .returning(),

  findByIdOrThrow: async (id: string) => {
    const record = await dsnDAO.findById(id);
    if (!record) throw notFound("DSN", id);
    return record;
  },

  findByProjectIdOrThrow: async (projectId: string) => {
    const record = await dsnDAO.findByProjectId(projectId);
    if (!record) throw notFound("DSN for project", projectId);
    return record;
  },

  deleteByProject: async (projectId: string) => {
    await db.delete(dsnRecords).where(eq(dsnRecords.projectId, projectId));
  },

  delete: async (id: string) => {
    const deleted = await db
      .delete(dsnRecords)
      .where(eq(dsnRecords.id, id))
      .returning({ id: dsnRecords.id });
    return deleted.length > 0;
  },
};