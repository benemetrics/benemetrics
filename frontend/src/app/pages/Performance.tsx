import { useEffect, useMemo, useState } from "react";
import { ScreenIntro } from "../ScreenIntro";
import { useWorkspace } from "../WorkspaceContext";
import { AGGREGATE_EVENT_LIMIT, listEvents } from "../../lib/api";
import { formatMs, POLL_INTERVAL_MS, percentile } from "../../lib/utils";

interface SpanRow {
  name: string;
  op: string | null;
  durationMs: number;
  status: string | null;
}

interface MeasurementSample {
  value: number;
  unit?: string;
}

interface TxRow {
  id: string;
  name: string;
  durationMs: number;
  status: string | null;
  traceId: string | null;
  op: string | null;
  receivedAt: string;
  spans: SpanRow[];
  measurements: Record<string, MeasurementSample>;
}

/** Apdex target: requests at or below this duration are "satisfied". */
const APDEX_THRESHOLD_MS = 300;

interface VitalDefinition {
  key: string;
  label: string;
  thresholds: [number, number];
}

const VITAL_DEFINITIONS: VitalDefinition[] = [
  { key: "lcp", label: "LCP", thresholds: [2500, 4000] },
  { key: "inp", label: "INP", thresholds: [200, 500] },
  { key: "cls", label: "CLS", thresholds: [0.1, 0.25] },
  { key: "fcp", label: "FCP", thresholds: [1800, 3000] },
  { key: "ttfb", label: "TTFB", thresholds: [800, 1800] },
];

interface VitalStat {
  key: string;
  label: string;
  median: number;
  unit?: string;
  rating: "good" | "improvement" | "poor";
  widthPct: number;
  samples: number;
}

function formatVital(value: number, unit?: string): string {
  if (unit?.includes("milli")) return formatMs(value);
  if (unit === "second") return `${value.toFixed(2)}s`;
  return value < 1 ? value.toFixed(3) : value.toFixed(2);
}

interface TxAggregate {
  name: string;
  count: number;
  avgMs: number;
  p95Ms: number;
  failurePct: number | null;
}

interface StoredEvent {
  id: string;
  itemTypes: string[];
  transaction: Record<string, unknown> | null;
  receivedAt: string;
}

function toTxRow(id: string, tx: Record<string, unknown> | null, receivedAt: string): TxRow | null {
  if (!tx || typeof tx !== "object") return null;
  const start = typeof tx.start_timestamp === "number" ? tx.start_timestamp : null;
  const end = typeof tx.timestamp === "number" ? tx.timestamp : null;
  const durationSec =
    typeof tx.duration === "number"
      ? tx.duration
      : start != null && end != null
        ? end - start
        : null;
  const rawSpans = Array.isArray(tx.spans) ? (tx.spans as Array<Record<string, unknown>>) : [];
  const spans: SpanRow[] = rawSpans
    .map((span) => {
      const spanStart = typeof span?.start_timestamp === "number" ? span.start_timestamp : null;
      const spanEnd = typeof span?.timestamp === "number" ? span.timestamp : null;
      const dur = spanStart != null && spanEnd != null ? (spanEnd - spanStart) * 1000 : null;
      if (dur == null) return null;
      return {
        name: String(span.name ?? "unknown"),
        op: typeof span.op === "string" ? span.op : null,
        durationMs: dur,
        status: typeof span.status === "string" ? span.status : null,
      } satisfies SpanRow;
    })
    .filter((span): span is SpanRow => span !== null);
  const contexts = tx.contexts as { trace?: { op?: string } } | undefined;
  const rawMeasurements =
    tx.measurements && typeof tx.measurements === "object"
      ? (tx.measurements as Record<string, { value?: unknown; unit?: unknown }>)
      : {};
  const measurements: Record<string, MeasurementSample> = {};
  for (const [key, sample] of Object.entries(rawMeasurements)) {
    if (typeof sample?.value === "number" && Number.isFinite(sample.value)) {
      measurements[key] = {
        value: sample.value,
        unit: typeof sample.unit === "string" ? sample.unit : undefined,
      };
    }
  }
  return {
    id,
    name: String(tx.transaction ?? "unknown"),
    durationMs: durationSec != null ? durationSec * 1000 : Number.NaN,
    status: typeof tx.status === "string" ? tx.status : null,
    traceId: typeof tx.trace_id === "string" ? tx.trace_id : null,
    op: contexts?.trace?.op ?? null,
    receivedAt,
    spans,
    measurements,
  };
}

function aggregate(rows: TxRow[]): TxAggregate[] {
  const byName = new Map<string, TxRow[]>();
  for (const row of rows) {
    const list = byName.get(row.name) ?? [];
    list.push(row);
    byName.set(row.name, list);
  }
  return [...byName.entries()]
    .map(([name, list]) => {
      const durations = list.map((row) => row.durationMs).filter((duration) => !Number.isNaN(duration));
      const known = list.filter((row) => row.status != null);
      const failed = known.filter((row) => row.status !== "ok").length;
      return {
        name,
        count: list.length,
        avgMs: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : Number.NaN,
        p95Ms: percentile(durations, 95) ?? Number.NaN,
        failurePct: known.length ? Math.round((failed / known.length) * 100) : null,
      };
    })
    .sort((a, b) => (Number.isNaN(b.p95Ms) ? -1 : b.p95Ms) - (Number.isNaN(a.p95Ms) ? -1 : a.p95Ms));
}

function seriesToPath(values: number[], width: number, height: number): string {
  if (values.length === 0) return "";
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values.map((value, index) => {
    const x = index * step;
    const y = height - (value / max) * (height - 6);
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  return points.join(" ");
}

export function Performance() {
  const { project, environment, application } = useWorkspace();
  const projectId = project?.id;
  const environmentId = environment?.id;
  const applicationId = application?.id;
  const [allTx, setAllTx] = useState<TxRow[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await listEvents({
          projectId,
          environmentId,
          appId: applicationId,
          limit: AGGREGATE_EVENT_LIMIT,
        });
        const events = ((result?.data as { data?: StoredEvent[] })?.data ?? []) as StoredEvent[];
        const mapped = events
          .filter((event) => event.itemTypes?.includes("transaction"))
          .map((event) => toTxRow(event.id, event.transaction, event.receivedAt))
          .filter((row): row is TxRow => row !== null);
        if (!cancelled) {
          setAllTx(mapped);
          setStatus("ready");
        }
      } catch {
        // keep the last transactions on fetch failure, but stop the loading state
        if (!cancelled) setStatus((current) => (current === "ready" ? current : "error"));
      }
    };
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectId, environmentId, applicationId]);

  const durations = useMemo(
    () => allTx.map((row) => row.durationMs).filter((duration) => !Number.isNaN(duration)),
    [allTx],
  );
  const p75 = percentile(durations, 75);
  const p50 = percentile(durations, 50);
  const knownStatus = allTx.filter((row) => row.status != null);
  const failureRate = knownStatus.length
    ? Math.round((knownStatus.filter((row) => row.status !== "ok").length / knownStatus.length) * 100)
    : null;
  // Observed window: from the oldest stored trace to now, capped at 24h.
  const observedWindowMinutes = useMemo(() => {
    const times = allTx
      .map((row) => Date.parse(row.receivedAt))
      .filter((time) => !Number.isNaN(time));
    if (times.length === 0) return null;
    return Math.max(1, Math.min(24 * 60, (Date.now() - Math.min(...times)) / 60000));
  }, [allTx]);
  const windowLabel =
    observedWindowMinutes == null
      ? ""
      : observedWindowMinutes >= 24 * 60 - 1
        ? "over the last 24h"
        : `over the last ${Math.max(1, Math.round(observedWindowMinutes))} min`;
  const throughput =
    durations.length > 0 && observedWindowMinutes
      ? (durations.length / observedWindowMinutes).toFixed(1)
      : null;
  const slowestMs = durations.length ? Math.max(...durations) : null;
  const p75Gauge =
    p75 != null && slowestMs != null && slowestMs > 0
      ? Math.max(4, Math.min(100, Math.round((p75 / slowestMs) * 100)))
      : 4;
  const aggregates = useMemo(() => aggregate(allTx), [allTx]);
  const latencyPath = useMemo(
    () => seriesToPath(durations.slice(-60), 700, 210),
    [durations],
  );
  const maxP95 = aggregates.length > 0 ? Math.max(...aggregates.map((row) => row.p95Ms), 1) : 1;
  const apdex = useMemo(() => {
    if (durations.length === 0) return null;
    const satisfied = durations.filter((duration) => duration <= APDEX_THRESHOLD_MS).length;
    const tolerating = durations.filter(
      (duration) => duration > APDEX_THRESHOLD_MS && duration <= APDEX_THRESHOLD_MS * 4,
    ).length;
    return (satisfied + tolerating / 2) / durations.length;
  }, [durations]);
  const webVitals = useMemo<VitalStat[]>(() => {
    const samples = new Map<string, MeasurementSample[]>();
    for (const row of allTx) {
      for (const [key, sample] of Object.entries(row.measurements)) {
        const list = samples.get(key) ?? [];
        list.push(sample);
        samples.set(key, list);
      }
    }
    return VITAL_DEFINITIONS.map(({ key, label, thresholds }): VitalStat | null => {
      const list = samples.get(key) ?? [];
      if (list.length === 0) return null;
      const median = percentile(
        list.map((sample) => sample.value),
        50,
      );
      if (median == null) return null;
      const rating =
        median <= thresholds[0] ? "good" : median <= thresholds[1] ? "improvement" : "poor";
      return {
        key,
        label,
        median,
        unit: list[0]?.unit,
        rating,
        widthPct: Math.max(4, Math.min(100, Math.round((median / (thresholds[1] * 1.5)) * 100))),
        samples: list.length,
      };
    }).filter((item): item is VitalStat => item !== null);
  }, [allTx]);

  return (
    <div className="screen-stack">
      <ScreenIntro
        eyebrow="APPLICATION PERFORMANCE"
        title="Performance"
        subtitle="Track latency, throughput, and user experience across every service."
      />

      {status !== "ready" || allTx.length === 0 ? (
        <article className="panel" style={{ padding: "48px", textAlign: "center" }}>
          <div className="panel-title">
            {status === "loading"
              ? "Loading transactions…"
              : status === "error"
                ? "Could not load transactions"
                : "No transactions in this window"}
          </div>
          <div className="panel-subtitle">
            {status === "loading"
              ? "Fetching the latest stored traces"
              : status === "error"
                ? "Check the backend connection and try again"
                : "Send traces with performance monitoring enabled (tracesSampleRate > 0) and they will show up here."}
          </div>
        </article>
      ) : (
        <>
          <section className="performance-metrics">
            <div className="performance-card">
              <span>P75 latency</span>
              <strong>{p75 != null ? formatMs(p75) : "—"}</strong>
              <small className="good">P50 {p50 != null ? formatMs(p50) : "—"}</small>
              <div className="metric-gauge">
                <i className="gauge-info" style={{ width: `${p75Gauge}%` }}></i>
              </div>
            </div>
            <div className="performance-card">
              <span>Throughput</span>
              <strong>{throughput ?? "—"}</strong>
              <small>
                tx/min {windowLabel} · {aggregates.length} services
              </small>
            </div>
            <div className="performance-card">
              <span>Failure rate</span>
              <strong>{failureRate != null ? `${failureRate}%` : "—"}</strong>
              <small className={failureRate != null && failureRate > 0 ? "bad" : "good"}>
                {knownStatus.length} with status
              </small>
              <div className="metric-gauge">
                <i
                  className="gauge-bad"
                  style={{ width: `${failureRate ?? 0}%` }}
                ></i>
              </div>
            </div>
            <div className="performance-card">
              <span>Apdex</span>
              <strong
                className={
                  apdex == null ? undefined : apdex >= 0.9 ? "good" : apdex >= 0.7 ? "warn" : "bad"
                }
              >
                {apdex != null ? apdex.toFixed(2) : "—"}
              </strong>
              <small>
                threshold {APDEX_THRESHOLD_MS} ms · {durations.length} sample
                {durations.length === 1 ? "" : "s"}
              </small>
              <div className="metric-gauge">
                <i
                  className={
                    apdex == null || apdex >= 0.9
                      ? "gauge-good"
                      : apdex >= 0.7
                        ? "gauge-info"
                        : "gauge-bad"
                  }
                  style={{ width: `${apdex != null ? Math.max(2, Math.round(apdex * 100)) : 0}%` }}
                ></i>
              </div>
            </div>
          </section>

          <section className="performance-layout">
            <article className="panel performance-chart">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Request latency</div>
                  <div className="panel-subtitle">
                    The last {Math.min(60, durations.length)} stored transactions, oldest to newest
                  </div>
                </div>
                <div className="legend">
                  <span>
                    <i className="violet-dot"></i>Duration
                  </span>
                </div>
              </div>
              <div className="latency-chart">
                <div className="latency-labels">
                  <span>{slowestMs != null ? formatMs(slowestMs) : ""}</span>
                  <span></span>
                  <span></span>
                  <span></span>
                  <span>0ms</span>
                </div>
                <div className="latency-plot">
                  <div className="grid-lines">
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                  </div>
                  <svg viewBox="0 0 700 210" preserveAspectRatio="none">
                    <path className="p95-line" d={latencyPath} />
                  </svg>
                  <div className="x-labels">
                    <span>oldest</span>
                    <span>newest</span>
                  </div>
                </div>
              </div>
            </article>

            <article className="panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Slowest transactions</div>
                  <div className="panel-subtitle">Ranked by P95 latency</div>
                </div>
                <div className="legend">
                  <span>P95</span>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {aggregates.slice(0, 5).map((tx) => {
                  const width = Math.max(4, Math.min(100, Math.round((tx.p95Ms / maxP95) * 100)));
                  return (
                    <div
                      key={tx.name}
                      className="vital-row"
                      style={{ gridTemplateColumns: "1fr auto" }}
                    >
                      <div>
                        <strong>{tx.name}</strong>
                        <span>
                          {tx.count} tx · avg {formatMs(tx.avgMs)}
                        </span>
                      </div>
                      <b style={{ color: "var(--ink)" }}>{formatMs(tx.p95Ms)}</b>
                      <div className="vital-bar">
                        <i style={{ width: `${width}%` }}></i>
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          </section>

          <article className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Web vitals</div>
                <div className="panel-subtitle">
                  Core Web Vitals reported by browser transactions
                </div>
              </div>
            </div>
            {webVitals.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {webVitals.map((vital) => (
                  <div className="vital-row" key={vital.key}>
                    <div>
                      <strong>{vital.label}</strong>
                      <span>
                        P50 · {vital.samples} sample{vital.samples === 1 ? "" : "s"}
                      </span>
                    </div>
                    <b className={vital.rating}>{formatVital(vital.median, vital.unit)}</b>
                    <div className="vital-bar">
                      <i className={vital.rating} style={{ width: `${vital.widthPct}%` }}></i>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="panel-subtitle" style={{ padding: "0 17px 17px" }}>
                No browser measurements in this window — send transactions from a web app with
                Web Vitals instrumentation to see LCP, INP, and CLS here.
              </div>
            )}
          </article>

          <article className="panel service-table">
            <div className="list-screen-head">
              <strong>Service</strong>
              <span>Requests</span>
              <span>P95 latency</span>
              <span>Failure rate</span>
            </div>
            {aggregates.map((tx) => (
              <div className="list-screen-row" key={tx.name}>
                <strong>
                  <i className="service-status"></i>
                  {tx.name}
                </strong>
                <span>{tx.count}</span>
                <span>{formatMs(tx.p95Ms)}</span>
                <span>{tx.failurePct != null ? `${tx.failurePct}%` : "no status"}</span>
              </div>
            ))}
          </article>
        </>
      )}
    </div>
  );
}
