import { useEffect, useMemo, useState } from "react";
import { ScreenIntro } from "../ScreenIntro.tsx";
import { useWorkspace } from "../WorkspaceContext.tsx";
import {
  fetchMetricBreakdown,
  fetchMetricSeries,
  fetchMetricSummary,
  formatMetricValue,
  metricUnit,
  MOBILE_MEASUREMENTS,
  MOBILE_STARTS,
  rateMetric,
  WEB_VITALS,
  type MetricBand,
  type MetricBreakdownRow,
  type MetricRating,
  type MetricSeriesPoint,
} from "../../lib/metrics.ts";
import { formatMs, POLL_INTERVAL_MS } from "../../lib/utils.ts";

// The performance dashboard reads the metrics API (the raw samples in
// ClickHouse), never a slice of stored events: the window summary is a
// single-bucket series (exact quantiles), the chart plots the duration
// P95 per bucket, and the latency tables are the duration breakdown per
// transaction name.

const WINDOW_HOURS = 6;
const WINDOW_MINUTES = WINDOW_HOURS * 60;
const WINDOW_SECONDS = WINDOW_MINUTES * 60;
const WINDOW_LABEL = `the last ${WINDOW_HOURS}h`;
const CHART_STEP_SECONDS = 60;
const CHART_WIDTH = 700;
const CHART_HEIGHT = 210;
const BREAKDOWN_LIMIT = 10;

/** Metrics fetched as exact window summaries (one bucket each). */
const SUMMARY_METRICS = [
  "duration",
  ...WEB_VITALS.map((vital) => vital.metric),
  ...MOBILE_STARTS.map((start) => start.metric),
  ...MOBILE_MEASUREMENTS.map((measurement) => measurement.metric),
  "frames_total",
  "frames_slow",
  "frames_frozen",
  "stall_count",
  "stall_total_time",
  "stall_longest_time",
];

interface PanelRow {
  key: string;
  label: string;
  sub: string;
  value: string;
  rating: MetricRating | null;
  widthPct: number | null;
}

function sampleLabel(count: number): string {
  return `P50 · ${count} sample${count === 1 ? "" : "s"}`;
}

function bandWidthPct(value: number, band: MetricBand): number {
  return Math.max(4, Math.min(100, Math.round((value / (band.improvement * 1.5)) * 100)));
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
  const [summaries, setSummaries] = useState<Map<string, MetricSeriesPoint>>(new Map());
  const [series, setSeries] = useState<MetricSeriesPoint[]>([]);
  const [breakdown, setBreakdown] = useState<MetricBreakdownRow[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const scope = { projectId, environmentId, appId: applicationId };
      const to = new Date();
      const from = new Date(to.getTime() - WINDOW_SECONDS * 1000);
      const range = { from: from.toISOString(), to: to.toISOString() };
      try {
        const entries = await Promise.all(
          SUMMARY_METRICS.map(async (metric) => {
            try {
              const point = await fetchMetricSummary({
                ...scope,
                metric,
                ...range,
                windowSeconds: WINDOW_SECONDS,
              });
              return [metric, point] as const;
            } catch {
              // One metric failing must not blank the whole dashboard.
              return [metric, null] as const;
            }
          }),
        );
        const [chart, table] = await Promise.all([
          fetchMetricSeries({
            ...scope,
            metric: "duration",
            ...range,
            stepSeconds: CHART_STEP_SECONDS,
          }),
          fetchMetricBreakdown({ ...scope, metric: "duration", ...range, limit: BREAKDOWN_LIMIT }),
        ]);
        if (cancelled) return;
        const next = new Map<string, MetricSeriesPoint>();
        for (const [metric, point] of entries) {
          if (point) next.set(metric, point);
        }
        setSummaries(next);
        setSeries(chart.points);
        setBreakdown(table);
        setStatus("ready");
      } catch {
        // keep the last metrics on fetch failure, but stop the loading state
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

  const duration = summaries.get("duration") ?? null;
  const webRows = useMemo<PanelRow[]>(() => {
    const rows: PanelRow[] = [];
    for (const vital of WEB_VITALS) {
      const point = summaries.get(vital.metric);
      if (!point) continue;
      rows.push({
        key: vital.metric,
        label: vital.label,
        sub: sampleLabel(point.count),
        value: formatMetricValue(point.p50, metricUnit(vital.metric)),
        rating: rateMetric(point.p50, vital.band),
        widthPct: bandWidthPct(point.p50, vital.band),
      });
    }
    return rows;
  }, [summaries]);
  const mobileRows = useMemo<PanelRow[]>(() => {
    const rows: PanelRow[] = [];
    for (const start of MOBILE_STARTS) {
      const point = summaries.get(start.metric);
      if (!point) continue;
      rows.push({
        key: start.metric,
        label: start.label,
        sub: sampleLabel(point.count),
        value: formatMetricValue(point.p50, metricUnit(start.metric)),
        rating: rateMetric(point.p50, start.band),
        widthPct: bandWidthPct(point.p50, start.band),
      });
    }
    for (const measurement of MOBILE_MEASUREMENTS) {
      const point = summaries.get(measurement.metric);
      if (!point) continue;
      rows.push({
        key: measurement.metric,
        label: measurement.label,
        sub: sampleLabel(point.count),
        value: formatMetricValue(point.p50, metricUnit(measurement.metric)),
        rating: null,
        widthPct: null,
      });
    }
    // Frame metrics are per-transaction counts; the window rate is
    // weighted by the samples (sum(slow) / sum(total)), never an average
    // of per-transaction rates.
    const total = summaries.get("frames_total");
    if (total) {
      const totalFrames = total.mean * total.count;
      for (const [metric, label] of [
        ["frames_slow", "Slow frames"],
        ["frames_frozen", "Frozen frames"],
      ] as const) {
        const part = summaries.get(metric);
        if (!part || totalFrames <= 0) continue;
        const partFrames = part.mean * part.count;
        rows.push({
          key: `${metric}_rate`,
          label,
          sub: `${Math.round(partFrames)} of ${Math.round(totalFrames)} frames`,
          value: `${((partFrames / totalFrames) * 100).toFixed(1)}%`,
          rating: null,
          widthPct: null,
        });
      }
    }
    // Stalls: `stall_count` sums to the stalled frames in the window,
    // `stall_longest_time` reads as its P99 across transactions.
    const stalls = summaries.get("stall_count");
    if (stalls) {
      const stallTime = summaries.get("stall_total_time");
      rows.push({
        key: "stall_count",
        label: "Stalls",
        sub: stallTime
          ? `total stall time ${formatMs(stallTime.mean * stallTime.count)}`
          : sampleLabel(stalls.count),
        value: `${Math.round(stalls.mean * stalls.count)}`,
        rating: null,
        widthPct: null,
      });
    }
    const longest = summaries.get("stall_longest_time");
    if (longest) {
      rows.push({
        key: "stall_longest_time",
        label: "Longest stall",
        sub: `P99 · ${longest.count} sample${longest.count === 1 ? "" : "s"}`,
        value: formatMs(longest.p99),
        rating: null,
        widthPct: null,
      });
    }
    return rows;
  }, [summaries]);
  const slowest = useMemo(() => [...breakdown].sort((a, b) => b.p95 - a.p95), [breakdown]);
  const maxP95 = useMemo(() => {
    const max = Math.max(duration?.p95 ?? 0, ...breakdown.map((row) => row.p95), 0);
    return max > 0 ? max : null;
  }, [duration, breakdown]);
  const p95Gauge =
    duration && maxP95 ? Math.max(4, Math.min(100, Math.round((duration.p95 / maxP95) * 100))) : 4;
  const chartValues = useMemo(() => series.map((point) => point.p95), [series]);
  const latencyPath = useMemo(
    () => seriesToPath(chartValues, CHART_WIDTH, CHART_HEIGHT),
    [chartValues],
  );
  const slowestBucket = chartValues.length > 0 ? Math.max(...chartValues) : null;
  const throughput =
    duration && duration.count > 0 ? (duration.count / WINDOW_MINUTES).toFixed(1) : null;
  const hasData = duration !== null || webRows.length > 0 || mobileRows.length > 0;

  return (
    <div className="screen-stack">
      <ScreenIntro
        eyebrow="APPLICATION PERFORMANCE"
        title="Performance"
        subtitle="Track latency, throughput, and user experience across every service."
      />

      {status !== "ready" || !hasData ? (
        <article className="panel" style={{ padding: "48px", textAlign: "center" }}>
          <div className="panel-title">
            {status === "loading"
              ? "Loading metrics…"
              : status === "error"
                ? "Could not load metrics"
                : "No transactions in this window"}
          </div>
          <div className="panel-subtitle">
            {status === "loading"
              ? "Fetching the latest ClickHouse samples"
              : status === "error"
                ? "Check the backend connection and try again"
                : "Send traces with performance monitoring enabled (tracesSampleRate > 0) and they will show up here."}
          </div>
        </article>
      ) : (
        <>
          <section className="performance-metrics">
            <div className="performance-card">
              <span>P95 latency</span>
              <strong>{duration ? formatMs(duration.p95) : "—"}</strong>
              <small className="good">
                P50 {duration ? formatMs(duration.p50) : "—"}
              </small>
              <div className="metric-gauge">
                <i className="gauge-info" style={{ width: `${p95Gauge}%` }}></i>
              </div>
            </div>
            <div className="performance-card">
              <span>Throughput</span>
              <strong>{throughput ?? "—"}</strong>
              <small>
                tx/min over {WINDOW_LABEL} · {duration?.count ?? 0} transactions
              </small>
            </div>
            <div className="performance-card">
              <span>Mean latency</span>
              <strong>{duration ? formatMs(duration.mean) : "—"}</strong>
              <small>P99 {duration ? formatMs(duration.p99) : "—"}</small>
            </div>
            <div className="performance-card">
              <span>Slowest transaction</span>
              <strong>{slowest[0] ? formatMs(slowest[0].p95) : "—"}</strong>
              <small>{slowest[0]?.dimension || "no transactions"}</small>
            </div>
          </section>

          {duration && (
            <section className="performance-layout">
              <article className="panel performance-chart">
                <div className="panel-header">
                  <div>
                    <div className="panel-title">Request latency</div>
                    <div className="panel-subtitle">
                      P95 per {CHART_STEP_SECONDS / 60} min bucket, {WINDOW_LABEL}
                    </div>
                  </div>
                  <div className="legend">
                    <span>
                      <i className="violet-dot"></i>P95
                    </span>
                  </div>
                </div>
                <div className="latency-chart">
                  <div className="latency-labels">
                    <span>{slowestBucket != null ? formatMs(slowestBucket) : ""}</span>
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
                    <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} preserveAspectRatio="none">
                      <path className="p95-line" d={latencyPath} />
                    </svg>
                    <div className="x-labels">
                      <span>{WINDOW_HOURS}h ago</span>
                      <span>now</span>
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
                  {slowest.slice(0, 5).map((tx) => {
                    const width = Math.max(
                      4,
                      Math.min(100, Math.round((tx.p95 / (maxP95 ?? 1)) * 100)),
                    );
                    return (
                      <div
                        key={tx.dimension}
                        className="vital-row"
                        style={{ gridTemplateColumns: "1fr auto" }}
                      >
                        <div>
                          <strong>{tx.dimension || "untitled"}</strong>
                          <span>
                            {tx.count} tx · avg {formatMs(tx.mean)}
                          </span>
                        </div>
                        <b style={{ color: "var(--ink)" }}>{formatMs(tx.p95)}</b>
                        <div className="vital-bar">
                          <i style={{ width: `${width}%` }}></i>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>
            </section>
          )}

          <article className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Web vitals</div>
                <div className="panel-subtitle">
                  Core Web Vitals reported by browser transactions
                </div>
              </div>
            </div>
            {webRows.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {webRows.map((vital) => (
                  <div className="vital-row" key={vital.key}>
                    <div>
                      <strong>{vital.label}</strong>
                      <span>{vital.sub}</span>
                    </div>
                    <b className={vital.rating ?? undefined}>{vital.value}</b>
                    <div className="vital-bar">
                      <i
                        className={vital.rating ?? undefined}
                        style={{ width: `${vital.widthPct ?? 0}%` }}
                      ></i>
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

          <article className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Mobile vitals</div>
                <div className="panel-subtitle">
                  App starts, display times, frames, and stalls reported by mobile transactions
                </div>
              </div>
            </div>
            {mobileRows.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {mobileRows.map((row) => (
                  <div className="vital-row" key={row.key}>
                    <div>
                      <strong>{row.label}</strong>
                      <span>{row.sub}</span>
                    </div>
                    <b className={row.rating ?? undefined}>{row.value}</b>
                    <div className="vital-bar">
                      <i
                        className={row.rating ?? undefined}
                        style={{ width: `${row.widthPct ?? 0}%` }}
                      ></i>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="panel-subtitle" style={{ padding: "0 17px 17px" }}>
                No mobile measurements in this window — send transactions from a React Native app
                to see cold/warm starts, display times, frames, and stalls here.
              </div>
            )}
          </article>

          {breakdown.length > 0 && (
            <article className="panel service-table">
              <div className="list-screen-head">
                <strong>Transaction</strong>
                <span>Requests</span>
                <span>P50 latency</span>
                <span>P95 latency</span>
              </div>
              {breakdown.map((row) => (
                <div className="list-screen-row" key={row.dimension}>
                  <strong>
                    <i className="service-status"></i>
                    {row.dimension || "untitled"}
                  </strong>
                  <span>{row.count}</span>
                  <span>{formatMs(row.p50)}</span>
                  <span>{formatMs(row.p95)}</span>
                </div>
              ))}
            </article>
          )}
        </>
      )}
    </div>
  );
}
