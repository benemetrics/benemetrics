import { useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";

export interface IssueDetail {
  id: string;
  appId: string;
  fingerprint: string;
  title: string;
  culprit: string | null;
  level: string;
  type: "error" | "message";
  firstRelease: string | null;
  lastRelease: string | null;
  status: "unresolved" | "resolved";
  eventCount: number;
  userCount: number;
  tags: Record<string, string> | null;
  firstSeen: string;
  lastSeen: string;
  latestEventId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function useIssue(issueId: string | undefined) {
  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);
  const reload = () => setReloadTick((t) => t + 1);

  useEffect(() => {
    if (!issueId) return;
    let alive = true;
    setLoading(true);
    setNotFound(false);
    api["api/admin/issues"][issueId]
      .get()
      .then((res: { error?: unknown; data?: unknown; status?: number }) => {
        if (!alive) return;
        if (res.error) {
          if ((res.status ?? 500) === 404) setNotFound(true);
          else setIssue(null);
        } else {
          setIssue(res.data as IssueDetail);
        }
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [issueId, reloadTick]);

  // The backend contract carries only unresolved/resolved (protocol/issues.ts).
  const updateStatus = useCallback(
    async (status: "unresolved" | "resolved"): Promise<boolean> => {
      if (!issueId) return false;
      const res = await api["api/admin/issues"][issueId].patch({ status });
      if (res.error) return false;
      setIssue((prev) => (prev ? { ...prev, status } : prev));
      return true;
    },
    [issueId],
  );

  return { issue, notFound, loading, reload, updateStatus };
}
