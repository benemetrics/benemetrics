import { useEffect, useState, useCallback } from "react";
import { api, PAGE_SIZE } from "../lib/api";
import { subscribeSubject, type LiveFeedStatus } from "../lib/live-events";

export interface FlagRecord {
  id: string;
  key: string;
  name: string;
  description: string;
  type: string;
  defaultValue: unknown;
  variants: Array<{
    key: string;
    name: string;
    value: unknown;
    weight: number;
  }>;
  targetingRules: Array<{
    id?: string;
    attribute: string;
    operator: string;
    value: unknown;
    variantKey?: string;
  }>;
  status: "draft" | "active" | "paused" | "archived";
  rolloutPercentage: number;
  experiment?: {
    enabled: boolean;
    status?: string;
    primaryMetric?: string;
  } | null;
  projectId: string | null;
  appId: string | null;
  updatedAt: string;
}

// Per-variant outcomes from GET /api/admin/experiments/:flagId/results.
// Only flags with an enabled experiment carry real outcome numbers; the
// rest render dashes instead of invented metrics.
export interface ExperimentResultRecord {
  variants: Array<{
    key: string;
    participants: number;
    conversions: number;
    conversionRate: number;
    relativeImprovement?: number;
    isSignificant?: boolean;
  }>;
  recommendation: {
    winner?: string;
    confidence: "high" | "medium" | "low";
    action: "implement" | "continue";
  };
}

// The change event mirrors backend/feature-flags/events.ts (FlagChangeEvent);
// `flag` is the full row when it still exists (create/update/status).
interface FlagChangeEventMessage {
  type?: string;
  flagKey?: string;
  flag?: { appId?: string; id?: string } | null;
}

export function useFlags(
  projectId: string | undefined,
  appId: string | undefined,
) {
  const [flags, setFlags] = useState<FlagRecord[] | null>(null);
  const [results, setResults] = useState<
    Record<string, ExperimentResultRecord>
  >({});
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState<LiveFeedStatus>("closed");
  const [reloadTick, setReloadTick] = useState(0);

  const load = useCallback(async () => {
    if (!projectId || !appId) return;
    let alive = true;
    setLoading(true);
    const res = await api["api/admin/feature-flags"].get({
      query: { appId, limit: PAGE_SIZE },
    });
    if (!alive) return;
    if (res.error) {
      setFlags(null);
    } else {
      const list = (res.data as { data: FlagRecord[] }).data;
      setFlags(list);
      // Outcomes exist only for flags running an experiment.
      const experimentFlags = list.filter((f) => f.experiment?.enabled);
      const entries = await Promise.all(
        experimentFlags.map(async (f) => {
          const r = await api["api/admin/experiments"][f.id]["results"].get();
          return [
            f.id,
            r.error ? null : (r.data as ExperimentResultRecord),
          ] as const;
        }),
      );
      if (!alive) return;
      setResults(
        Object.fromEntries(
          entries.filter(
            (entry): entry is readonly [string, ExperimentResultRecord] =>
              entry[1] !== null,
          ),
        ),
      );
    }
    setLoading(false);
  }, [projectId, appId]);

  useEffect(() => {
    load();
  }, [load, reloadTick]);

  // Another instance (or another browser) changed a flag; refresh the list.
  useEffect(() => {
    if (!appId) return;
    const close = subscribeSubject("sentry.flags.changed", {
      onStatus: setLive,
      onMessage: (payload: string) => {
        try {
          const event = JSON.parse(payload) as FlagChangeEventMessage;
          const flag = event.flag ?? null;
          // A delete carries only the key; a change to a flag we hold for
          // this app (or a delete of one) is relevant.
          const relevant = flag
            ? flag.appId === appId
            : event.type === "delete" &&
              (flags?.some((f) => f.key === event.flagKey) ?? false);
          if (relevant) setReloadTick((t) => t + 1);
        } catch {
          // not a flag change event
        }
      },
    });
    return close;
  }, [appId, flags]);

  const setStatus = useCallback(
    async (flagId: string, status: FlagRecord["status"]) => {
      const res = await api["api/admin/feature-flags"][flagId]["status"].post({
        status,
      });
      if (res.error) return false;
      setFlags(
        (prev) =>
          prev?.map((f) => (f.id === flagId ? { ...f, status } : f)) ?? prev,
      );
      return true;
    },
    [],
  );

  const setRollout = useCallback(
    async (flagId: string, rolloutPercentage: number) => {
      const res = await api["api/admin/feature-flags"][flagId].patch({
        rolloutPercentage,
      });
      if (res.error) return false;
      setFlags(
        (prev) =>
          prev?.map((f) =>
            f.id === flagId ? { ...f, rolloutPercentage } : f,
          ) ?? prev,
      );
      return true;
    },
    [],
  );

  const setTargetingRules = useCallback(
    async (
      flagId: string,
      rules: Array<{
        attribute: string;
        operator: string;
        value: unknown;
        variantKey?: string;
      }>,
    ) => {
      const res = await api["api/admin/feature-flags"][flagId].patch({
        targetingRules: rules,
      });
      if (res.error) return false;
      setFlags(
        (prev) =>
          prev?.map((f) =>
            f.id === flagId ? { ...f, targetingRules: rules } : f,
          ) ?? prev,
      );
      return true;
    },
    [],
  );

  return {
    flags,
    results,
    loading,
    live,
    reload: load,
    setStatus,
    setRollout,
    setTargetingRules,
  };
}
