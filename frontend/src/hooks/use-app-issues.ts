import { useEffect, useState, useCallback } from "react";
import { api, PAGE_SIZE, feedCredential } from "../lib/api";
import { subscribeLiveFeed, type LiveEventItem, type LiveFeedStatus } from "../lib/live-events";
import { useAppRecord } from "./app-record-context";

export type IssueStatus = "unresolved" | "resolved" | "ignored";

export interface IssueSummary {
  id: string;
  fingerprint: string;
  title: string;
  culprit: string | null;
  level: string;
  type: "error" | "message";
  status: IssueStatus;
  eventCount: number;
  userCount: number;
  tags: Record<string, string> | null;
  firstSeen: string;
  lastSeen: string;
}

// The backend has no `is:ignored` — "ignored" is a UI-only state, so its
// count is always 0 and its list is always empty.
function statusList(status: IssueStatus, appId: string) {
  if (status === "ignored") return Promise.resolve([] as IssueSummary[]);
  return api["api/admin/issues"]
    .get({ query: { query: `app:${appId} is:${status}`, sort: "new", limit: PAGE_SIZE } })
    .then((res: { error?: unknown; data?: unknown }) =>
      res.error ? null : (res.data as { data: IssueSummary[] }).data,
    );
}

export function useAppIssues(projectId: string | undefined, appId: string | undefined) {
  const [issues, setIssues] = useState<IssueSummary[] | null>(null);
  const [error, setError] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState<LiveFeedStatus>("closed");
  const [reloadTick, setReloadTick] = useState(0);

  const load = useCallback(async () => {
    if (!projectId || !appId) return;
    let alive = true;
    setLoading(true);
    const [unresolved, resolved] = await Promise.all([statusList("unresolved", appId), statusList("resolved", appId)]);
    if (!alive) return;
    if (unresolved === null || resolved === null) {
      setError(500);
      setIssues(null);
    } else {
      setError(null);
      setIssues([...unresolved, ...resolved]);
    }
    setLoading(false);
  }, [projectId, appId]);

  useEffect(() => {
    load();
  }, [load, reloadTick]);

  // Issues are derived from events by the side-effects consumer, so a live
  // event for this app means the issue list may have changed. Debounce so
  // a burst of events refreshes once. The subscription is the app's shard.
  const appNumber = useAppRecord()?.number;
  useEffect(() => {
    if (!appId || appNumber === undefined) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const close = subscribeLiveFeed(
      {
        onStatus: setLive,
        onItem: (item: LiveEventItem) => {
          if (item.appId !== appId) return;
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => setReloadTick((t) => t + 1), 1000);
        },
      },
      { appNumber, authToken: feedCredential() ?? undefined },
    );
    return () => {
      if (timer) clearTimeout(timer);
      close();
    };
  }, [appId, appNumber]);

  // The backend contract carries only unresolved/resolved (protocol/issues.ts);
  // "ignored" is a UI-only state and never hits the API.
  const updateIssueStatus = useCallback(
    async (issueId: string, status: "unresolved" | "resolved"): Promise<boolean> => {
      const res = await api["api/admin/issues"][issueId].patch({ status });
      if (res.error) return false;
      setIssues((prev) => prev?.map((i) => (i.id === issueId ? { ...i, status } : i)) ?? prev);
      return true;
    },
    [],
  );

  return { issues, error, loading, live, reload: load, updateIssueStatus };
}
