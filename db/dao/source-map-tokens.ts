import { db } from "db";
import {
  sourceMapTokens,
  type SourceMapToken,
  type SourceMapTokenInsert,
} from "db/schema/source-map-tokens";
import { and, desc, eq } from "drizzle-orm";
import { internalError, notFound } from "backend/errors";

// Raw tokens are only ever returned at creation/rotation time;
// at rest we keep the SHA-256 hash plus a short display prefix.
export function generateUploadToken(): {
  raw: string;
  hash: string;
  prefix: string;
} {
  const raw = "smt_" + crypto.randomUUID().replace(/-/g, "");
  const hash = new Bun.CryptoHasher("sha256").update(raw).digest("hex");
  return { raw, hash, prefix: raw.slice(0, 10) };
}

export function hashUploadToken(raw: string): string {
  return new Bun.CryptoHasher("sha256").update(raw).digest("hex");
}

type TokenCreateInput = Omit<
  SourceMapTokenInsert,
  "id" | "tokenHash" | "tokenPrefix" | "createdAt"
>;

export const sourceMapTokenDAO = {
  create: async (data: TokenCreateInput) => {
    const { raw, hash, prefix } = generateUploadToken();
    const [record] = await db
      .insert(sourceMapTokens)
      .values({
        ...data,
        id: crypto.randomUUID(),
        tokenHash: hash,
        tokenPrefix: prefix,
        createdAt: new Date().toISOString(),
      })
      .returning();
    if (!record) {
      throw internalError("Failed to create source map token");
    }
    return { token: raw, record };
  },

  findById: async (id: string): Promise<SourceMapToken | undefined> =>
    (
      await db
        .select()
        .from(sourceMapTokens)
        .where(eq(sourceMapTokens.id, id))
        .limit(1)
    )[0],

  findByIdOrThrow: async (id: string) => {
    const token = await sourceMapTokenDAO.findById(id);
    if (!token) throw notFound("Upload token", id);
    return token;
  },

  findByHash: async (hash: string): Promise<SourceMapToken | undefined> =>
    (
      await db
        .select()
        .from(sourceMapTokens)
        .where(eq(sourceMapTokens.tokenHash, hash))
        .limit(1)
    )[0],

  // Rotation replaces the hash; the previous raw token stops
  // working immediately.
  rotate: async (id: string) => {
    const { raw, hash, prefix } = generateUploadToken();
    const rows = await db
      .update(sourceMapTokens)
      .set({ tokenHash: hash, tokenPrefix: prefix, revokedAt: null })
      .where(eq(sourceMapTokens.id, id))
      .returning();
    return rows[0] ? { token: raw, record: rows[0]! } : null;
  },

  list: async (options: {
    projectId?: string;
    environmentId?: string;
    page?: number;
    limit?: number;
  }) => {
    const page = options.page ?? 1;
    const limit = options.limit ?? 20;
    const offset = (page - 1) * limit;
    const conditions = [
      ...(options.projectId
        ? [eq(sourceMapTokens.projectId, options.projectId)]
        : []),
      ...(options.environmentId
        ? [eq(sourceMapTokens.environmentId, options.environmentId)]
        : []),
    ];
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, total] = await Promise.all([
      db
        .select()
        .from(sourceMapTokens)
        .where(where)
        .orderBy(desc(sourceMapTokens.createdAt))
        .limit(limit)
        .offset(offset),
      db.$count(sourceMapTokens, where),
    ]);

    return {
      data: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  },

  // Soft revoke: keeps the audit trail, invalidates the token.
  revoke: async (id: string) =>
    (
      await db
        .update(sourceMapTokens)
        .set({ revokedAt: new Date().toISOString() })
        .where(eq(sourceMapTokens.id, id))
        .returning()
    )[0],

  delete: async (id: string) => {
    const deleted = await db
      .delete(sourceMapTokens)
      .where(eq(sourceMapTokens.id, id))
      .returning({ id: sourceMapTokens.id });
    return deleted.length > 0;
  },

  deleteByApp: async (appId: string) => {
    await db.delete(sourceMapTokens).where(eq(sourceMapTokens.appId, appId));
  },
};
