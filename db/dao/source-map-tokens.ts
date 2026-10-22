import { db } from "db";
import {
  sourceMapTokens,
  type SourceMapTokenInsert,
} from "db/schema/source-map-tokens";
import { and, desc, eq, isNull } from "drizzle-orm";
import { internalError, notFound } from "backend/errors";
import type { SourceMapTokenResponse } from "backend/protocol/source-map";
import { cursorAfter, cursorLimit } from "./cursor";

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

export function hashUploadToken(raw: string): string {
  return new Bun.CryptoHasher("sha256").update(raw).digest("hex");
}

type TokenCreateInput = Omit<
  SourceMapTokenInsert,
  "id" | "tokenHash" | "tokenPrefix" | "createdAt"
>;

// `tokenHash` never leaves the DAO: the response projection leaves it out
// so no caller can accidentally serialize the secret.
const tokenFields = {
  id: sourceMapTokens.id,
  name: sourceMapTokens.name,
  projectId: sourceMapTokens.projectId,
  appId: sourceMapTokens.appId,
  environmentId: sourceMapTokens.environmentId,
  tokenPrefix: sourceMapTokens.tokenPrefix,
  createdBy: sourceMapTokens.createdBy,
  createdAt: sourceMapTokens.createdAt,
  lastUsedAt: sourceMapTokens.lastUsedAt,
  expiresAt: sourceMapTokens.expiresAt,
  revokedAt: sourceMapTokens.revokedAt,
};

// Upload authentication only needs the token's scope and validity window.
export interface SourceMapTokenAuthRecord {
  id: string;
  projectId: string;
  appId: string;
  environmentId: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

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
      .returning(tokenFields);
    if (!record) {
      throw internalError("Failed to create source map token");
    }
    return { token: raw, record };
  },

  findById: async (id: string): Promise<SourceMapTokenResponse | undefined> =>
    (
      await db
        .select(tokenFields)
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
  findByHash: async (
    hash: string,
  ): Promise<SourceMapTokenAuthRecord | undefined> =>
    (
      await db
        .select({
          id: sourceMapTokens.id,
          projectId: sourceMapTokens.projectId,
          appId: sourceMapTokens.appId,
          environmentId: sourceMapTokens.environmentId,
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
    const rows = await db
      .update(sourceMapTokens)
      .set({ tokenHash: hash, tokenPrefix: prefix })
      .where(eq(sourceMapTokens.id, id))
      .returning(tokenFields);
    return rows[0] ? { token: raw, record: rows[0]! } : null;
  },

  list: async (options: {
    projectId?: string;
    environmentId?: string;
    includeRevoked?: boolean;
    cursor?: string;
    limit?: number;
  }) => {
    const limit = cursorLimit(options.limit);
    const conditions = [
      ...(options.projectId
        ? [eq(sourceMapTokens.projectId, options.projectId)]
        : []),
      ...(options.environmentId
        ? [eq(sourceMapTokens.environmentId, options.environmentId)]
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
      .select(tokenFields)
      .from(sourceMapTokens)
      .where(where)
      .orderBy(desc(sourceMapTokens.createdAt), desc(sourceMapTokens.id))
      .limit(limit);

    return { data };
  },

  // Best-effort bookkeeping for the admin token list: the last time the
  // token authenticated a source map upload request.
  touchLastUsed: async (id: string) => {
    await db
      .update(sourceMapTokens)
      .set({ lastUsedAt: new Date().toISOString() })
      .where(eq(sourceMapTokens.id, id));
  },

  // Soft revoke: keeps the audit trail, invalidates the token.
  revoke: async (id: string): Promise<void> => {
    await db
      .update(sourceMapTokens)
      .set({ revokedAt: new Date().toISOString() })
      .where(eq(sourceMapTokens.id, id));
  },

  delete: async (id: string) => {
    const deleted = await db
      .delete(sourceMapTokens)
      .where(eq(sourceMapTokens.id, id))
      .returning({ id: sourceMapTokens.id });
    return deleted.length > 0;
  },
};
