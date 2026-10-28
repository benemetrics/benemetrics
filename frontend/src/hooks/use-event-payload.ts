import { useEffect, useState } from "react";
import { api } from "../lib/api";

// GET /events/:eventId returns the parsed event payload directly (not wrapped
// in { data }), with frames symbolicated best-effort on the backend.
export function useEventPayload(eventId: string | undefined) {
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const reload = () => setReloadTick((t) => t + 1);

  useEffect(() => {
    if (!eventId) return;
    let alive = true;
    setLoading(true);
    setNotFound(false);
    api["events"][eventId].get().then((res: { error?: unknown; data?: unknown; status?: number }) => {
      if (!alive) return;
      if (res.error) {
        if ((res.status ?? 500) === 404) setNotFound(true);
        setPayload(null);
      } else {
        setPayload(res.data as Record<string, unknown>);
      }
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [eventId, reloadTick]);

  return { payload, loading, notFound, reload };
}
