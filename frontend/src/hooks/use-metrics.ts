import { useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";
import { subscribeSubject, type LiveFeedStatus } from "../lib/live-events";

export interface MetricPoint {
  bucketStart: string;
  count: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface MetricSeries {
  metric: string;
  unit: string;
  points: MetricPoint[];
}

// The sample payload mirrors backend/protocol/metrics.ts (MetricSample).
interface MetricSample {
  appId?: string;
  metric?: string;
}

const RELOAD_DEBOUNCE_MS = 500;

export function useMetrics(
  appId: string | undefined,
  metric: string = "error_count",
) {
  const [series, setSeries] = useState<MetricSeries | null>(null);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState<LiveFeedStatus>("closed");

  const load = useCallback(async () => {
    if (!appId) return;
    let alive = true;
    setLoading(true);
    const res = await api["api/admin/metrics"]["series"].get({
      query: { metric, appId },
    });
    if (!alive) return;
    if (res.error) {
      setSeries(null);
    } else {
      setSeries(res.data as MetricSeries);
    }
    setLoading(false);
  }, [appId, metric]);

  useEffect(() => {
    load();
  }, [load]);

  // A matching sample on the metrics subject means the series shifted;
  // debounce so a batch of samples refreshes once.
  useEffect(() => {
    if (!appId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const close = subscribeSubject("sentry.metrics", {
      onStatus: setLive,
      onMessage: (payload: string) => {
        const matches = payload
          .split("\n")
          .filter(Boolean)
          .some((line) => {
            try {
              const sample = JSON.parse(line) as MetricSample;
              return sample.appId === appId && sample.metric === metric;
            } catch {
              return false;
            }
          });
        if (matches) {
          if (timer) clearTimeout(timer);
          timer = setTimeout(load, RELOAD_DEBOUNCE_MS);
        }
      },
    });
    return () => {
      if (timer) clearTimeout(timer);
      close();
    };
  }, [appId, metric, load]);

  return { series, loading, live, reload: load };
}
