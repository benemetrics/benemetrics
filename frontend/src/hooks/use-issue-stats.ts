import { useEffect, useState } from "react";
import { api } from "../lib/api";

// `enabled` keeps the per-row sparklines bounded: only the first page of
// issues fetches its trend (each is a separate ClickHouse query).
export function useIssueStats(issueId: string | undefined, enabled = true) {
  const [points, setPoints] = useState<number[] | null>(null);
  const [userTotal, setUserTotal] = useState<number | null>(null);

  useEffect(() => {
    if (!issueId || !enabled) return;
    let alive = true;
    api["api/admin/issues"][issueId].stats
      .get()
      .then((res: { error?: unknown; data?: unknown }) => {
        if (!alive || res.error) return;
        const data = res.data as {
          points: { eventCount: number; userCount: number }[];
          totals?: { userCount?: number };
        };
        setPoints(data.points.map((p) => p.eventCount));
        setUserTotal(data.totals?.userCount ?? null);
      });
    return () => {
      alive = false;
    };
  }, [issueId, enabled]);

  return { points, userTotal };
}
