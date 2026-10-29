import { useCallback, useEffect, useState } from "react";
import { api, PAGE_SIZE } from "../lib/api";

export interface ReleaseRecord {
  id: string;
  appId: string;
  version: string;
  ref: string | null;
  url: string | null;
  owner: string | null;
  status: string;
  firstSeen: string | null;
  lastSeen: string | null;
  eventCount: number;
  latestEventId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReleaseIssueMetric {
  fingerprint: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  isNew: boolean;
  isRegressed: boolean;
}

// GET /:id/summary spreads the release with the ClickHouse issue metrics.
export interface ReleaseSummary extends ReleaseRecord {
  issueCount: number;
  newIssueCount: number;
  regressedIssueCount: number;
  issues: ReleaseIssueMetric[];
}

export function useReleases(appId: string | undefined) {
  const [releases, setReleases] = useState<ReleaseRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!appId) return;
    let alive = true;
    setLoading(true);
    api["api/admin/releases"]
      .get({ query: { appId, limit: PAGE_SIZE } })
      .then((res: { error?: unknown; data?: unknown }) => {
        if (!alive) return;
        setReleases(
          res.error ? [] : (res.data as { data: ReleaseRecord[] }).data,
        );
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [appId, tick]);

  const createRelease = useCallback(
    async (draft: {
      version: string;
      ref?: string;
      url?: string;
      owner?: string;
    }) => {
      const res = await api["api/admin/releases"].post({
        appId,
        version: draft.version.trim(),
        ref: draft.ref?.trim() || undefined,
        url: draft.url?.trim() || undefined,
        owner: draft.owner?.trim() || undefined,
      });
      if (res.error) throw new Error("Failed to create release");
      reload();
    },
    [appId, reload],
  );

  const finalizeRelease = useCallback(
    async (releaseId: string) => {
      const res = await api["api/admin/releases"][releaseId].finalize.post();
      if (res.error) throw new Error("Failed to finalize release");
      reload();
    },
    [reload],
  );

  const deleteRelease = useCallback(
    async (releaseId: string) => {
      const res = await api["api/admin/releases"][releaseId].delete();
      if (res.error) throw new Error("Failed to delete release");
      reload();
    },
    [reload],
  );

  const loadSummary = useCallback(
    async (releaseId: string): Promise<ReleaseSummary | null> => {
      const res = await api["api/admin/releases"][releaseId].summary.get();
      if (res.error) return null;
      return (res.data as ReleaseSummary) ?? null;
    },
    [],
  );

  return {
    releases,
    loading,
    reload,
    createRelease,
    finalizeRelease,
    deleteRelease,
    loadSummary,
  };
}
