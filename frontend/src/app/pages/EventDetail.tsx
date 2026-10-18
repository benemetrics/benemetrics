import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ScreenIntro } from "../ScreenIntro.tsx";
import { useWorkspace } from "../WorkspaceContext.tsx";
import { AGGREGATE_EVENT_LIMIT, api, listEvents } from "../../lib/api.ts";
import {
  payloadFingerprint,
  type ExceptionFrame,
  type StoredEvent,
} from "../../lib/issues.ts";
import { relativeTime } from "../../lib/utils.ts";
import "rrweb-player/dist/style.css";

interface ExceptionValue {
  type?: string;
  value?: string;
  stacktrace?: { frames?: ExceptionFrame[] };
}

interface ContextInfo {
  name?: string;
  version?: string;
  family?: string;
  model?: string;
}

interface EventPayload {
  event_id?: string;
  level?: string;
  message?: string;
  culprit?: string;
  release?: string;
  environment?: string;
  platform?: string;
  transaction?: string;
  replay_id?: string;
  fingerprint?: unknown[];
  user?: { id?: string; email?: string; username?: string };
  tags?: Record<string, string>;
  exception?: { values?: ExceptionValue[] };
  contexts?: {
    browser?: ContextInfo;
    os?: ContextInfo;
    runtime?: ContextInfo;
    device?: ContextInfo;
    replay?: { replay_id?: string; segment_id?: number };
  };
}

// GET /replays/by-event/:eventId — the recording segments of the session
// the event was reported in, already assembled in playback order.
interface ReplaySegment {
  key: string;
  events: number;
  bytes: number;
  startedAt: string | null;
}

interface ReplayPayload {
  replayId: string | null;
  available: boolean;
  truncated: boolean;
  bytes: number;
  segments: ReplaySegment[];
  events: unknown[];
}

const HOUR_MS = 3_600_000;
const BUCKET_COUNT = 24;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// rrweb events carry millisecond timestamps; their span is the session
// length that was actually recorded.
function replayDuration(events: unknown[]): string | null {
  let first: number | null = null;
  let last: number | null = null;
  for (const event of events) {
    if (!event || typeof event !== "object" || Array.isArray(event)) continue;
    const timestamp = (event as Record<string, unknown>).timestamp;
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) continue;
    if (first == null || timestamp < first) first = timestamp;
    if (last == null || timestamp > last) last = timestamp;
  }
  if (first == null || last == null || last <= first) return null;
  const seconds = Math.round((last - first) / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

interface MetricValue {
  value: string;
  count: number;
}

interface MetricRow {
  label: string;
  values: MetricValue[];
  /** Distinct values behind the row, the ones shown and the ones trimmed. */
  distinct: number;
}

interface IssueMetrics {
  total: number;
  userTotal: number;
  /** Label/value pairs that are not distributions (first/last seen). */
  plain: Array<[string, string]>;
  rows: MetricRow[];
}

const METRIC_VALUES_SHOWN = 3;
const TAG_KEYS_SHOWN = 6;

function addValue(map: Map<string, number>, value: string | null | undefined): void {
  if (!value) return;
  map.set(value, (map.get(value) ?? 0) + 1);
}

function topValues(
  map: Map<string, number>,
  limit: number,
): { values: MetricValue[]; distinct: number } {
  const sorted = [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    values: sorted.slice(0, limit).map(([value, count]) => ({ value, count })),
    distinct: sorted.length,
  };
}

// Browser/OS/runtime read best as "Name version"; devices have no version.
function contextLabel(info: ContextInfo | undefined): string | undefined {
  if (!info) return undefined;
  const label = [info.name, info.version].filter(Boolean).join(" ").trim();
  return label || undefined;
}

function deviceLabel(info: ContextInfo | undefined): string | undefined {
  if (!info) return undefined;
  const parts = [info.family, info.model].filter(
    (part, index, list) => part && list.indexOf(part) === index,
  );
  return parts.join(" ") || undefined;
}

// Aggregates every event of the issue: the SDK context dimensions first,
// then whatever tag keys the events carry, each with its most frequent
// values and occurrence counts.
function buildIssueMetrics(events: StoredEvent[]): IssueMetrics {
  const dimensions = new Map<string, Map<string, number>>([
    ["Browser", new Map()],
    ["OS", new Map()],
    ["Runtime", new Map()],
    ["Device", new Map()],
    ["Release", new Map()],
    ["Environment", new Map()],
    ["Platform", new Map()],
    ["Level", new Map()],
    ["Users", new Map()],
    ["Transaction", new Map()],
  ]);
  const dimension = (label: string): Map<string, number> => {
    const existing = dimensions.get(label);
    if (existing) return existing;
    const created = new Map<string, number>();
    dimensions.set(label, created);
    return created;
  };
  const tags = new Map<string, Map<string, number>>();
  let firstSeen: string | null = null;
  let lastSeen: string | null = null;

  for (const stored of events) {
    const payload = (stored.event ?? {}) as EventPayload;
    const contexts = payload.contexts ?? {};
    addValue(dimension("Browser"), contextLabel(contexts.browser));
    addValue(dimension("OS"), contextLabel(contexts.os));
    addValue(dimension("Runtime"), contextLabel(contexts.runtime));
    addValue(dimension("Device"), deviceLabel(contexts.device));
    addValue(dimension("Release"), payload.release);
    addValue(dimension("Environment"), payload.environment);
    addValue(dimension("Platform"), payload.platform);
    addValue(dimension("Level"), payload.level ?? "error");
    addValue(
      dimension("Users"),
      payload.user?.email ?? payload.user?.username ?? payload.user?.id,
    );
    addValue(dimension("Transaction"), payload.transaction);
    for (const [key, value] of Object.entries(payload.tags ?? {})) {
      let values = tags.get(key);
      if (!values) {
        values = new Map();
        tags.set(key, values);
      }
      addValue(values, typeof value === "string" ? value : undefined);
    }
    const receivedAt = Date.parse(stored.receivedAt);
    if (!Number.isNaN(receivedAt)) {
      if (!firstSeen || receivedAt < Date.parse(firstSeen)) firstSeen = stored.receivedAt;
      if (!lastSeen || receivedAt > Date.parse(lastSeen)) lastSeen = stored.receivedAt;
    }
  }

  const rows: MetricRow[] = [];
  for (const [label, values] of dimensions) {
    if (values.size === 0) continue;
    const { values: top, distinct } = topValues(values, METRIC_VALUES_SHOWN);
    rows.push({ label, values: top, distinct });
  }
  const tagKeys = [...tags.entries()]
    .map(([key, values]) => ({
      key,
      values,
      coverage: [...values.values()].reduce((total, count) => total + count, 0),
    }))
    .sort((a, b) => b.coverage - a.coverage || a.key.localeCompare(b.key))
    .slice(0, TAG_KEYS_SHOWN);
  for (const { key, values } of tagKeys) {
    const { values: top, distinct } = topValues(values, METRIC_VALUES_SHOWN);
    rows.push({ label: key, values: top, distinct });
  }

  const plain: Array<[string, string]> = [];
  if (firstSeen) plain.push(["First seen", agoLabel(firstSeen)]);
  if (lastSeen) plain.push(["Last seen", agoLabel(lastSeen)]);

  return {
    total: events.length,
    userTotal: dimension("Users").size,
    plain,
    rows,
  };
}

// relativeTime renders "seen 2m ago"; the metrics rows carry their own label.
function agoLabel(input: string): string {
  const label = relativeTime(input);
  return label.startsWith("seen ") ? label.slice("seen ".length) : label;
}

function metricValueText(row: MetricRow): string {
  const counts = row.distinct > 1;
  const parts = row.values.map((entry) =>
    counts ? `${entry.value} ×${entry.count}` : entry.value,
  );
  if (row.distinct > row.values.length) parts.push(`+${row.distinct - row.values.length}`);
  return parts.join("  ·  ");
}

export function EventDetail() {
  const { eventId = "" } = useParams();
  const navigate = useNavigate();
  const { project, environment, application } = useWorkspace();
  const projectId = project?.id;
  const environmentId = environment?.id;
  const applicationId = application?.id;
  const [payload, setPayload] = useState<EventPayload | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [related, setRelated] = useState<StoredEvent[]>([]);
  const [relatedStatus, setRelatedStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [replay, setReplay] = useState<ReplayPayload | null>(null);
  const [replayStatus, setReplayStatus] = useState<"loading" | "ready" | "error">("loading");
  const replayStage = useRef<HTMLDivElement | null>(null);
  const detailsRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await api.events[eventId].get();
        if (cancelled) return;
        // GET /events/:id returns the event payload itself.
        setPayload((result?.data as EventPayload | null) ?? null);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  // The backend resolves the replay from the stored event (replay metadata
  // or `contexts.replay` on the error) and assembles its segments, so the
  // section stays authoritative even when a payload shape is new here.
  useEffect(() => {
    if (status !== "ready") return;
    let cancelled = false;
    setReplayStatus("loading");
    (async () => {
      try {
        const result = await api.replays["by-event"][eventId].get();
        if (cancelled) return;
        setReplay((result?.data as ReplayPayload | null) ?? null);
        setReplayStatus("ready");
      } catch {
        if (!cancelled) setReplayStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, status]);

  // rrweb is pulled in only when a replay exists so ordinary event pages
  // do not pay for the player bundle.
  useEffect(() => {
    const stage = replayStage.current;
    if (
      !stage ||
      replayStatus !== "ready" ||
      !replay?.available ||
      replay.events.length === 0
    ) {
      return;
    }
    let cancelled = false;
    let player: { $destroy?: () => void } | null = null;
    (async () => {
      const { default: RrwebPlayer } = await import("rrweb-player");
      if (cancelled) return;
      stage.innerHTML = "";
      player = new RrwebPlayer({
        target: stage,
        props: {
          events: replay.events as never[],
          width: Math.max(360, Math.min(stage.clientWidth || 960, 1440)),
          height: 460,
          autoPlay: false,
          showController: true,
        },
      }) as { $destroy?: () => void };
    })().catch((err) => {
      console.error(
        "[replay] Player failed to load:",
        err instanceof Error ? err.message : String(err),
      );
    });
    return () => {
      cancelled = true;
      player?.$destroy?.();
      stage.innerHTML = "";
    };
  }, [replay, replayStatus]);

  const first = payload?.exception?.values?.[0];
  const title = first
    ? `${first.type ?? "Error"}: ${first.value ?? ""}`
    : payload?.message ?? payload?.transaction ?? "Event";
  const frames = first?.stacktrace?.frames ?? [];
  // Stored oldest-first; the crash site (newest frame) goes on top.
  const displayFrames = [...frames].reverse();
  const tags = Object.entries(payload?.tags ?? {}).slice(0, 12);
  const userId = payload?.user?.email ?? payload?.user?.username ?? payload?.user?.id ?? null;
  const fingerprint = payload ? payloadFingerprint(payload) : null;
  const replayDurationLabel = replay ? replayDuration(replay.events) : null;

  // The stored window the issue panels read from. Matching mirrors the
  // backend's ingestion-time grouping so the list and metrics contain
  // exactly the events the backend folded into this issue.
  useEffect(() => {
    if (!fingerprint) return;
    let cancelled = false;
    setRelatedStatus("loading");
    (async () => {
      try {
        const result = await listEvents({
          projectId,
          environmentId,
          appId: applicationId,
          limit: AGGREGATE_EVENT_LIMIT,
        });
        const list = (result?.data as { data?: StoredEvent[] })?.data ?? [];
        if (cancelled) return;
        setRelated(list);
        setRelatedStatus("ready");
      } catch {
        // the panels keep their empty state on failure
        if (!cancelled) setRelatedStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fingerprint, projectId, environmentId, applicationId]);

  const issueEvents = useMemo(() => {
    if (!fingerprint) return [];
    return related
      .filter((stored) => stored.itemTypes?.includes("event"))
      .filter((stored) => payloadFingerprint(stored.event) === fingerprint)
      .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
  }, [related, fingerprint]);

  const metrics = useMemo(() => buildIssueMetrics(issueEvents), [issueEvents]);

  const selectEvent = (id: string) => {
    if (id !== eventId) navigate(`/issues/${id}`);
    // The details sit below the list; bring the updated event into view.
    requestAnimationFrame(() => {
      detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  // Frequency: same-issue events in the stored window, bucketed hourly.
  const buckets = new Array<number>(BUCKET_COUNT).fill(0);
  if (fingerprint) {
    const now = Date.now();
    for (const event of issueEvents) {
      const age = now - Date.parse(event.receivedAt);
      if (Number.isNaN(age) || age < 0 || age >= BUCKET_COUNT * HOUR_MS) continue;
      const index = BUCKET_COUNT - 1 - Math.floor(age / HOUR_MS);
      if (index < 0 || index >= BUCKET_COUNT) continue;
      buckets[index] = (buckets[index] ?? 0) + 1;
    }
  }
  const bucketMax = Math.max(...buckets, 1);
  const relatedTotal = buckets.reduce((total, count) => total + count, 0);

  const contexts = payload?.contexts ?? {};
  const contextRows: Array<[string, string]> = [];
  const browser = contexts.browser;
  if (browser?.name) {
    contextRows.push(["Browser", [browser.name, browser.version].filter(Boolean).join(" ")]);
  }
  const os = contexts.os;
  if (os?.name) {
    contextRows.push(["OS", [os.name, os.version].filter(Boolean).join(" ")]);
  }
  const runtime = contexts.runtime;
  if (runtime?.name) {
    contextRows.push(["Runtime", [runtime.name, runtime.version].filter(Boolean).join(" ")]);
  }
  const device = contexts.device;
  if (device?.family || device?.model) {
    contextRows.push(["Device", [device.family, device.model].filter(Boolean).join(" ")]);
  }
  if (payload?.release) contextRows.push(["Release", payload.release]);
  if (payload?.environment) contextRows.push(["Environment", payload.environment]);
  if (payload?.platform) contextRows.push(["Platform", payload.platform]);

  return (
    <div className="screen-stack">
      <Link to="/issues" className="back-link">
        ← Back to issues
      </Link>
      <ScreenIntro
        eyebrow={`EVENT ${eventId.slice(0, 8).toUpperCase()}`}
        title={status === "ready" ? title : status === "loading" ? "Loading event…" : "Could not load event"}
        subtitle={
          status === "ready"
            ? payload?.culprit ?? "Details reported by the SDK for this event."
            : status === "loading"
              ? "Fetching the stored payload"
              : "The event may have been removed, or the backend is unreachable."
        }
      />
      {status === "ready" && payload && (
        <>
          <div className="toolbar">
            <div className="filter-chip">level: {payload.level ?? "error"}</div>
            {payload.release && <div className="filter-chip">release: {payload.release}</div>}
            {payload.environment && (
              <div className="filter-chip">environment: {payload.environment}</div>
            )}
            {payload.platform && <div className="filter-chip">platform: {payload.platform}</div>}
            {payload.transaction && (
              <div className="filter-chip">transaction: {payload.transaction}</div>
            )}
          </div>
          <article className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Issue metrics</div>
                <div className="panel-subtitle">
                  {relatedStatus === "idle" || relatedStatus === "loading"
                    ? "Aggregating the events of this issue…"
                    : relatedStatus === "error"
                      ? "The events of this issue could not be loaded."
                      : `Aggregated from ${metrics.total} event${
                          metrics.total === 1 ? "" : "s"
                        } in the loaded window`}
                </div>
              </div>
              {relatedStatus === "ready" && metrics.userTotal > 0 && (
                <div className="filter-chip">
                  {metrics.userTotal} user{metrics.userTotal === 1 ? "" : "s"}
                </div>
              )}
            </div>
            {relatedStatus === "ready" && metrics.rows.length > 0 ? (
              <div className="metrics-list">
                {metrics.plain.map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong className="metric-values">{value}</strong>
                  </div>
                ))}
                {metrics.rows.map((row) => (
                  <div key={row.label}>
                    <span>{row.label}</span>
                    <strong className="metric-values" title={metricValueText(row)}>
                      {metricValueText(row)}
                    </strong>
                  </div>
                ))}
              </div>
            ) : (
              relatedStatus === "ready" && (
                <div className="panel-subtitle metrics-empty">
                  No events of this issue are in the loaded window.
                </div>
              )
            )}
          </article>
          <article className="panel data-panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Events in this issue</div>
                <div className="panel-subtitle">
                  {relatedStatus === "idle" || relatedStatus === "loading"
                    ? "Matching the loaded event window…"
                    : relatedStatus === "error"
                      ? "The event list could not be loaded."
                      : `${issueEvents.length} event${
                          issueEvents.length === 1 ? "" : "s"
                        }: click one to read its details`}
                </div>
              </div>
            </div>
            <div className="data-head">
              <span>Event</span>
              <span>User</span>
              <span>Release</span>
              <span>Seen</span>
            </div>
            <div className="issue-events-scroll">
              {issueEvents.map((stored) => {
                const row = (stored.event ?? {}) as EventPayload;
                const rowFirst = row.exception?.values?.[0];
                const replayId = row.contexts?.replay?.replay_id;
                const hasReplay =
                  Boolean(replayId) ||
                  Boolean(
                    stored.itemTypes?.some(
                      (type) => type === "replay_event" || type === "replay_recording",
                    ),
                  );
                const user = row.user?.email ?? row.user?.username ?? row.user?.id ?? "—";
                const line = row.message ?? rowFirst?.value ?? row.transaction ?? stored.id;
                return (
                  <div
                    key={stored.id}
                    className={`data-row clickable${stored.id === eventId ? " selected" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => selectEvent(stored.id)}
                    onKeyDown={(keyEvent) => {
                      if (keyEvent.key === "Enter") selectEvent(stored.id);
                    }}
                  >
                    <div className="issue-main">
                      <div className="issue-title">
                        <span>{stored.id.slice(0, 6).toUpperCase()}</span>
                        {line}
                      </div>
                      <div className="issue-meta">
                        {hasReplay && (
                          <span
                            className="replay-tag"
                            title={replayId ? `replay ${replayId}` : "replay attached"}
                          >
                            replay
                          </span>
                        )}
                        <span>{row.culprit ?? rowFirst?.type ?? row.level ?? "error"}</span>
                      </div>
                    </div>
                    <span className="event-cell" title={user}>
                      {user}
                    </span>
                    <span className="event-cell" title={row.release ?? ""}>
                      {row.release ?? "—"}
                    </span>
                    <span className="event-cell">{relativeTime(stored.receivedAt)}</span>
                  </div>
                );
              })}
            </div>
          </article>
          <section className="content-grid" ref={detailsRef}>
            <article className="panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Stack trace</div>
                  <div className="panel-subtitle">
                    {frames.length} frame{frames.length === 1 ? "" : "s"}, newest first
                  </div>
                </div>
              </div>
              {frames.length > 0 ? (
                <div className="frames">
                  {displayFrames.slice(0, 12).map((frame, index) => {
                    const file = frame.original_filename ?? frame.filename ?? "unknown";
                    const line = frame.original_lineno ?? frame.lineno;
                    const symbolicated =
                      frame.original_filename != null &&
                      frame.original_filename !== frame.filename;
                    const snippet = frame.context_line
                      ? [
                          ...(frame.pre_context ?? []),
                          frame.context_line,
                          ...(frame.post_context ?? []),
                        ]
                      : [];
                    return (
                      <div className="frame-row" key={`${frame.filename}-${index}`}>
                        <span>{index === 0 ? "▸" : ""}</span>
                        <strong>
                          {frame.function || "<anonymous>"}
                          {frame.in_app && <span className="frame-tag">in app</span>}
                          {symbolicated && <span className="frame-tag">source map</span>}
                        </strong>
                        <small
                          title={
                            symbolicated && frame.filename
                              ? `minified: ${frame.filename}${frame.lineno != null ? `:${frame.lineno}` : ""}`
                              : undefined
                          }
                        >
                          {file}
                          {line != null ? `:${line}` : ""}
                        </small>
                        {snippet.length > 0 && (
                          <code className="frame-context">{snippet.join("\n")}</code>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="panel-subtitle">No stack trace in this payload.</div>
              )}
              {userId && (
                <div className="detail-user">
                  <div className="avatar">{(userId[0] ?? "?").toUpperCase()}</div>
                  <div>
                    <strong>{payload.user?.username ?? payload.user?.email ?? payload.user?.id}</strong>
                    <span>user context reported with this event</span>
                  </div>
                </div>
              )}
            </article>
            <div className="issue-context">
              <article className="panel">
                <div className="panel-header">
                  <div>
                    <div className="panel-title">Event context</div>
                    <div className="panel-subtitle">Attached by the SDK at capture time</div>
                  </div>
                </div>
                {contextRows.length > 0 ? (
                  <div className="context-list">
                    {contextRows.map(([label, value]) => (
                      <div key={label}>
                        <span>{label}</span>
                        <strong>{value}</strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="panel-subtitle">No context data attached to this event.</div>
                )}
              </article>
              <article className="panel">
                <div className="panel-header">
                  <div>
                    <div className="panel-title">Frequency</div>
                    <div className="panel-subtitle">
                      {relatedTotal} matching event{relatedTotal === 1 ? "" : "s"} in the last 24
                      hours
                    </div>
                  </div>
                </div>
                <div className="frequency-chart">
                  {buckets.map((count, index) => (
                    <i
                      key={index}
                      className={count > 0 ? "has-events" : ""}
                      style={{ height: `${Math.max(3, Math.round((count / bucketMax) * 100))}%` }}
                      title={`${count} event${count === 1 ? "" : "s"}`}
                    ></i>
                  ))}
                </div>
                <div className="frequency-foot">
                  <span>24h ago</span>
                  <span>now</span>
                </div>
              </article>
            </div>
          </section>
          <article className="panel replay-panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Session replay</div>
                <div className="panel-subtitle">
                  The session recorded around this error, played back from the stored
                  segments.
                </div>
              </div>
              {replay?.replayId && (
                <div className="filter-chip">replay {replay.replayId.slice(0, 8)}</div>
              )}
            </div>
            {replayStatus === "loading" && (
              <div className="panel-subtitle">Locating the replay linked to this issue…</div>
            )}
            {replayStatus === "error" && (
              <div className="panel-subtitle">Could not load the session replay.</div>
            )}
            {replayStatus === "ready" && !replay?.replayId && (
              <div className="panel-subtitle">
                No session replay is linked to this issue — enable Session Replay in the
                browser SDK to record the sessions around your errors.
              </div>
            )}
            {replayStatus === "ready" && replay?.replayId && (
              <>
                {replay.segments.length > 0 && (
                  <div className="replay-meta">
                    <div className="filter-chip">
                      {replay.segments.length === 1
                        ? "1 segment"
                        : `${replay.segments.length} segments`}
                    </div>
                    <div className="filter-chip">
                      {replay.events.length === 1
                        ? "1 event"
                        : `${replay.events.length} events`}
                    </div>
                    <div className="filter-chip">{formatBytes(replay.bytes)}</div>
                    {replayDurationLabel && (
                      <div className="filter-chip">{replayDurationLabel}</div>
                    )}
                    {replay.truncated && <div className="filter-chip">truncated</div>}
                  </div>
                )}
                {replay.available && replay.events.length > 0 ? (
                  <div className="replay-stage" ref={replayStage} />
                ) : (
                  <div className="panel-subtitle">
                    {replay.available
                      ? `Replay ${replay.replayId.slice(0, 8)} is linked, but no recording segments are stored yet.`
                      : `Replay ${replay.replayId.slice(0, 8)} is linked, but the object store could not be read.`}
                  </div>
                )}
              </>
            )}
          </article>
          <article className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Payload</div>
                <div className="panel-subtitle">What the SDK sent for this event</div>
              </div>
            </div>
            {tags.length > 0 && (
              <div className="detail-tags">
                {tags.map(([key, value]) => (
                  <div className="filter-chip" key={key}>
                    {key}: {value}
                  </div>
                ))}
              </div>
            )}
            <pre className="payload-json">{JSON.stringify(payload, null, 2)}</pre>
          </article>
        </>
      )}
    </div>
  );
}
