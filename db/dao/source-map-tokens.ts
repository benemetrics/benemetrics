import { db } from "../index.ts";
import { sourceMapTokens } from "../schema/source-map-tokens.ts";
import { eq, desc } from "drizzle-orm";
import { notFound, conflict } from "../../backend/errors.ts";
import { crypto } from "../../backend/utils/crypto.ts";

function generateToken(): { token: string; tokenHash: string; tokenPrefix: string } {
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const tokenPrefix = token.slice(0, 8);
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  return { token, tokenHash, tokenPrefix };
}

export const sourceMapTokenDAO = {
  async create(data: {
    name: string;
    projectId: string;
    appId: string;
    environmentId: string;
    createdBy: string;
    expiresAt?: string;
  }) {
    const { token, tokenHash, tokenPrefix } = generateToken();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const result = await db
      .insert(sourceMapTokens)
      .values({
        id,
        projectId: data.projectId,
        appId: data.appId,
        environmentId: data.environmentId,
        tokenHash,
        tokenPrefix,
        name: data.name,
        createdBy: data.createdBy,
        createdAt: now,
        expiresAt: data.expiresAt ?? null,
      })
      .onConflictDoNothing()
      .returning();

    if (result.length === 0) {
      throw conflict("Token creation failed");
    }
    return { token, record: result[0] };
  },

  async findById(id: string) {
    const result = await db.select().from(sourceMapTokens).where(eq(sourceMapTokens.id, id)).limit(1);
    return result[0];
  },

  async findByIdOrThrow(id: string) {
    const token = await this.findById(id);
    if (!token) throw new Error("Token not found");
    return token;
  },

  async findByHash(tokenHash: string) {
    const result = await db
      .select()
      .from(sourceMapTokens)
      .where(eq(sourceMapTokens.tokenHash, tokenHash))
      .limit(1);
    return result[0];
  },

  async list(options: { projectId?: string; environmentId?: string; page?: number; limit?: number } = {}) {
    const page = options.page ?? 1;
    const limit = Math.min(options.limit ?? 20, 100);
    const offset = (page - 1) * limit;

    let query = db.select().from(sourceMapTokens);

    if (options.projectId) {
      query = query.where(eq(sourceMapTokens.projectId, options.projectId));
    }
    if (options.environmentId) {
      query = query.where(eq(sourceMapTokens.environmentId, options.environmentId));
    }

    const [data, totalResult] = await Promise.all([
      query.limit(limit).offset(offset).orderBy(desc(sourceMapTokens.createdAt)),
      db.$count(sourceMapTokens),
    ]);

    return {
      data,
      pagination: {
        page: options.page ?? 1,
        limit: Math.min(options.limit ?? 20, 100),
        total: totalResult,
        totalPages: Math.ceil(totalResult / Math.min(options.limit ?? 20, 100)),
      },
    };
  },

  async rotate(id: string) {
    const { token, tokenHash, tokenPrefix } = generateToken();
    const now = new Date().toISOString();

    const result = await db
      .update(sourceMapTokens)
      .set({
        tokenHash,
        tokenPrefix,
        revokedAt: now,
        createdAt: now,
      })
      .where(eq(sourceMapTokens.id, id))
      .returning();

    if (result.length === 0) return null;
    return { token, record: result[0] };
  },

  async revoke(id: string) {
    const now = new Date().toISOString();
    const result = await db
      .update(sourceMapTokens)
      .set({ revokedAt: now })
      .where(eq(sourceMapTokens.id, id))
      .returning();
    return result.length > 0;
  },
};