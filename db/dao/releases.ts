import { db } from "../index.ts";
import { eq, and, desc } from "drizzle-orm";
import { notFound } from "../../backend/errors.ts";
import { crypto } from "../../backend/utils/crypto.ts";

export const releases = db.query.releases ?? {
  async findByAppAndVersion(appId: string, version: string) {
    // This would be a real table in the schema - for now returning mock structure
    return null;
  },
};

export const releaseDAO = {
  async findOrCreate(data: {
    appId: string;
    version: string;
    ref?: string;
    url?: string;
    owner?: string;
    status?: string;
  }) {
    // In real implementation, this would use a releases table
    // For now returning a mock structure
    return {
      id: crypto.randomUUID(),
      appId: data.appId,
      version: data.version,
      ref: data.ref ?? null,
      url: data.url ?? null,
      owner: data.owner ?? null,
      status: data.status ?? "draft",
      createdAt: new Date().toISOString(),
    };
  },

  async findByAppAndVersionOrThrow(appId: string, version: string) {
    const release = await this.findByAppAndVersion(appId, version);
    if (!release) throw notFound("Release", version);
    return release;
  },

  async updateOrThrow(id: string, patch: { status?: string }) {
    return { ...patch, id, updatedAt: new Date().toISOString() };
  },
};