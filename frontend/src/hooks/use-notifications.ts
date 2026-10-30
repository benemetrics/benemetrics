import { useCallback, useEffect, useState } from "react";
import { api, isHttpError, PAGE_SIZE } from "../lib/api";

export interface NotificationDeadLetter {
  seq: number;
  notification: Record<string, unknown>;
  channel: Record<string, unknown>;
  attempts: number;
  error: string;
  failedAt: string;
}

/** Polls the admin DLQ endpoint and re-fetches on demand. */
export function useNotifications() {
  const [letters, setLetters] = useState<NotificationDeadLetter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    let alive = true;
    setLoading(true);
    try {
      const res = await api["api/admin/notifications"]["dlq"].get({
        query: { limit: String(PAGE_SIZE) },
      });
      if (!alive) return;
      if (isHttpError(res)) {
        setError("Failed to read the notification dead-letter queue.");
        setLetters([]);
      } else {
        setLetters((res as { data: NotificationDeadLetter[] }).data);
        setError(null);
      }
    } catch {
      setError("Failed to read the notification dead-letter queue.");
      setLetters([]);
    } finally {
      if (alive) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Poll: the DLQ is a JetStream stream, not a database table, so the
    // UI polls for new dead letters instead of subscribing to a feed.
    const timer = setInterval(load, 10_000);
    return () => clearInterval(timer);
  }, [load]);

  const dismiss = useCallback(
    async (seq: number) => {
      const res = await api["api/admin/notifications"]["dlq"][
        String(seq)
      ].delete({});
      if (isHttpError(res)) return false;
      setLetters((current) => current.filter((l) => l.seq !== seq));
      return true;
    },
    [],
  );

  return { letters, loading, error, reload: load, dismiss };
}
