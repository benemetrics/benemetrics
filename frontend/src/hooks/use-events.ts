import { useEffect, useState } from "react";
import { api, PAGE_SIZE, feedCredential } from "../lib/api";
import { subscribeLiveFeed, type LiveEventItem, type LiveFeedStatus } from "../lib/live-events";
import { useAppRecord } from "./app-record-context";

export interface EventRecord {
  id: string;
  receivedAt: string;
  itemTypes: string[];
  event: Record<string, unknown> | null;
  transaction: Record<string, unknown> | null;
  feedback: Record<string, unknown> | null;
}

export function useEvents(projectId: string | undefined, appId: string | undefined) {
  const [events, setEvents] = useState<EventRecord[] | null>(null);
  const [error, setError] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState<LiveFeedStatus>("closed");
  const [reloadTick, setReloadTick] = useState(0);
  const reload = () => setReloadTick((t) => t + 1);

  useEffect(() => {
    if (!projectId || !appId) return;
    let alive = true;
    setLoading(true);
    api["events"].get({ query: { appId, limit: PAGE_SIZE } }).then((res: { error?: unknown; data?: unknown; status?: number }) => {
      if (!alive) return;
      if (res.error) {
        setError(res.status ?? 500);
        setEvents(null);
      } else {
        setError(null);
        setEvents((res.data as { data: EventRecord[] }).data);
      }
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [projectId, appId, reloadTick]);

  // The browser subscribes to the app's shard itself — no backend fanout.
  // The callout grants exactly this shard to the credential it verifies.
  const appNumber = useAppRecord()?.number;
  useEffect(() => {
    if (!appId || appNumber === undefined) return;
    const close = subscribeLiveFeed(
      {
        onStatus: setLive,
        onItem: (item: LiveEventItem) => {
          if (item.appId !== appId) return;
          setEvents((prev) =>
            prev?.some((e) => e.id === item.id) ? prev : [item as EventRecord, ...(prev ?? [])],
          );
        },
      },
      { appNumber, authToken: feedCredential() ?? undefined },
    );
    return close;
  }, [appId, appNumber]);

  return { events, error, loading, live, reload };
}
