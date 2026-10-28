import { useCallback, useEffect, useState } from "react";
import { api, PAGE_SIZE } from "../lib/api";

export interface SourceMapRecord {
  id: string;
  projectId: string;
  appId: string;
  release: string;
  dist: string | null;
  filename: string;
  createdAt: string;
}

// POST /:id returns { ...record, token } — the raw token only at creation
// and rotation; it is hashed at rest.
export interface SourceMapTokenRecord {
  id: string;
  name: string;
  projectId: string;
  appId: string;
  tokenPrefix: string;
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  token?: string;
}

export interface ResolvedPosition {
  filename: string;
  release: string;
  line: number;
  column: number;
  original: {
    source: string;
    line: number;
    column: number;
    contextLine: string | null;
    preContext: string[];
    postContext: string[];
  };
}

export function useSourceMaps(projectId: string | undefined) {
  const [artifacts, setArtifacts] = useState<SourceMapRecord[] | null>(null);
  const [tokens, setTokens] = useState<SourceMapTokenRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    setLoading(true);
    Promise.all([
      api["api/admin/source-maps"].get({ query: { projectId, limit: PAGE_SIZE } }),
      api["api/admin/source-map-tokens"].get({ query: { projectId, limit: PAGE_SIZE } }),
    ]).then(([mapsRes, tokensRes]) => {
      if (!alive) return;
      setArtifacts(mapsRes.error ? [] : (mapsRes.data as { data: SourceMapRecord[] }).data);
      setTokens(tokensRes.error ? [] : (tokensRes.data as { data: SourceMapTokenRecord[] }).data);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [projectId, tick]);

  const deleteArtifact = useCallback(async (artifactId: string) => {
    const res = await api["api/admin/source-maps"][artifactId].delete();
    if (res.error) throw new Error("Failed to delete artifact");
    reload();
  }, [reload]);

  const createToken = useCallback(async (draft: { name: string; appId?: string; expiresAt?: string }) => {
    const res = await api["api/admin/source-map-tokens"].post({
      name: draft.name.trim(),
      projectId: projectId!,
      appId: draft.appId,
      expiresAt: draft.expiresAt?.trim() || undefined,
    });
    if (res.error) throw new Error("Failed to create upload token");
    reload();
    // The raw token is shown once, at creation.
    return (res.data as SourceMapTokenRecord).token ?? null;
  }, [projectId, reload]);

  const rotateToken = useCallback(async (tokenId: string) => {
    const res = await api["api/admin/source-map-tokens"][tokenId].rotate.post();
    if (res.error) throw new Error("Failed to rotate upload token");
    reload();
    return (res.data as SourceMapTokenRecord).token ?? null;
  }, [reload]);

  const revokeToken = useCallback(async (tokenId: string) => {
    const res = await api["api/admin/source-map-tokens"][tokenId].delete();
    if (res.error) throw new Error("Failed to revoke upload token");
    reload();
  }, [reload]);

  const resolvePosition = useCallback(async (input: { release: string; filename: string; line: number; column: number }): Promise<ResolvedPosition | null> => {
    const res = await api["api/admin/source-maps"].resolve.post({ projectId: projectId!, ...input });
    if (res.error) return null;
    return (res.data as ResolvedPosition) ?? null;
  }, [projectId]);

  return { artifacts, tokens, loading, reload, deleteArtifact, createToken, rotateToken, revokeToken, resolvePosition };
}