import { db } from "db";
import {
  sourceMapTokens,
  tokenPublicFields,
  type SourceMapTokenInsert,
} from "db/schema/source-map-tokens";
import { and, desc, eq, isNull } from "drizzle-orm";
import { internalError, notFound } from "backend/errors";
import { cursorLimit } from "./cursor";

// Raw tokens are only ever returned at creation/rotation time;
// at rest we keep the SHA-256 hash plus a short display prefix.
export function generateUploadToken(): {
  raw: string;
  hash: string;
  prefix: string;
} {
  const raw = "smt_" + crypto.randomUUID().replace(/-/g, "");
  const hash = new Bun.CryptoHasher("sha256").update(raw).digest("hex");
  return { raw, hash, prefix: raw.slice(0, 8) };
}

export const sourceMapTokenDAO = {
  create: async (
    data: Omit<SourceMapTokenInsert, "tokenHash" | "tokenPrefix">,
  ) => {
    const { raw, hash, prefix } = generateUploadToken();
    const [record] = await db
      .insert(sourceMapTokens)
      .values({
        ...data,
        tokenHash: hash,
        tokenPrefix: prefix,
      })
      .returning(tokenPublicFields);
    if (!record) throw internalError("Failed to create source map token");
    return { token: raw, record };
  },

  findById: async (id: (typeof sourceMapTokens)["id"]) =>
    (
      await db
        .select(tokenPublicFields)
        .from(sourceMapTokens)
        .where(eq(sourceMapTokens.id, id))
        .limit(1)
    )[0],

  findByIdOrThrow: async (id: string) => {
    const token = await sourceMapTokenDAO.findById(id);
    if (!token) throw notFound("Upload token", id);
    return token;
  },

  // Only the auth path looks a token up by hash; the hash itself never
  // needs to leave the database.
  findByHash: async (hash: (typeof sourceMapTokens)["tokenHash"]) =>
    (
      await db
        .select({
          id: sourceMapTokens.id,
          projectId: sourceMapTokens.projectId,
          appId: sourceMapTokens.appId,
          expiresAt: sourceMapTokens.expiresAt,
          revokedAt: sourceMapTokens.revokedAt,
        })
        .from(sourceMapTokens)
        .where(eq(sourceMapTokens.tokenHash, hash))
        .limit(1)
    )[0],

  // Rotation keeps a revoked token revoked.
  rotate: async (id: string) => {
    const { raw, hash, prefix } = generateUploadToken();
    const [updated] = await db
      .update(sourceMapTokens)
      .set({ tokenHash: hash, tokenPrefix: prefix })
      .where(eq(sourceMapTokens.id, id))
      .returning(tokenPublicFields);
    if (!updated) throw notFound("Upload token", id);
    return { ...updated, token: raw };
  },

  list: async (options: {
    projectId?: string;
    includeRevoked?: boolean;
    cursor?: string;
    limit?: number;
  }) => {
    const limit = cursorLimit(options.limit);
    const conditions = [
      ...(options.projectId
        ? [eq(sourceMapTokens.projectId, options.projectId)]
        : []),
      ...(options.includeRevoked ? [] : [isNull(sourceMapTokens.revokedAt)]),
    ];
    const { condition, empty } = await cursorAfter(
      sourceMapTokens,
      sourceMapTokens.id,
      sourceMapTokens.createdAt,
      options.cursor,
    );
    if (empty) return { data: [] };
    if (condition) conditions.push(condition);
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const data = await db
      .select(tokenPublicFields)
      .from(sourceMapTokens)
      .where(where)
      .orderBy(desc(sourceMapTokens.createdAt), desc(sourceMapTokens.id))
      .limit(limit);

    return { data };
  },

  // Best-effort bookkeeping for the admin token list: the last time the
  // token authenticated a source map upload request.
  touchLastUsed: async (id: string) =>
    await db
      .update(sourceMapTokens)
      .set({ lastUsedAt: new Date().toISOString() })
      .where(eq(sourceMapTokens.id, id)),

  delete: (id: string) =>
    db.delete(sourceMapTokens).where(eq(sourceMapTokens.id, id)),
};
