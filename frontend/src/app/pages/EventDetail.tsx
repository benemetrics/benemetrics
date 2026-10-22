import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ScreenIntro } from "../ScreenIntro";
import { useWorkspace } from "../WorkspaceContext";
import {
  EVENT_PAGE_SIZE,
  api,
  getIssueStats,
  listEvents,
  listIssueOccurrences,
  type IssueOccurrenceDto,
  type IssueStatsDto,
} from "../../lib/api";
import { loadAllPages } from "../../lib/cursor";
import { type ExceptionFrame, type StoredEvent } from "../../lib/issues";
import { relativeTime } from "../../lib/utils";
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

// GET /api/admin/events/:eventId/replay/:replayId — one page of presigned
// segment URLs (S3). The keys embed the segment start, so pages arrive in
// playback order; the player is fed with `addEvent` as segments land.
interface ReplaySegment {
  key: string;
  url: string;
  bytes: number;
}

interface ReplayPage {
  replayId: string;
  available: boolean;
  expiresAt: string | null;
  segments: ReplaySegment[];
  nextCursor: string | null;
  hasMore: boolean;
}


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
  const [searchParams] = useSearchParams();
  // The issue the event belongs to: the server owns the grouping, so the
  // page asks for the issue's occurrences instead of matching events itself.
  const issueId = searchParams.get("issue") ?? "";
  const navigate = useNavigate();
  const { project, environment, application } = useWorkspace();
  const projectId = project?.id;
  const environmentId = environment?.id;
  const applicationId = application?.id;
  const [payload, setPayload] = useState<EventPayload | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [related, setRelated] = useState<StoredEvent[]>([]);
  const [occurrences, setOccurrences] = useState<IssueOccurrenceDto[]>([]);
  const [stats, setStats] = useState<IssueStatsDto | null>(null);
  const [relatedStatus, setRelatedStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [replayId, setReplayId] = useState<string | null>(null);
  const [replayStatus, setReplayStatus] = useState<"loading" | "ready" | "error">("loading");
  const [replayAvailable, setReplayAvailable] = useState(true);
  const [replayMeta, setReplayMeta] = useState({ segments: 0, events: 0, bytes: 0 });
  const [replayDurationLabel, setReplayDurationLabel] = useState<string | null>(null);
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

  // The event payload carries the replay link (`contexts.replay.replay_id`),
  // so the page only needs the event id and the replay id to stream the
  // session's segments back from the object store.
  useEffect(() => {
    setReplayId(null);
    setReplayStatus("loading");
    setReplayAvailable(true);
    setReplayMeta({ segments: 0, events: 0, bytes: 0 });
    setReplayDurationLabel(null);
  }, [eventId]);

  useEffect(() => {
    if (status !== "ready") return;
    const id = payload?.contexts?.replay?.replay_id ?? null;
    setReplayId(id);
    setReplayStatus(id ? "loading" : "ready");
    setReplayAvailable(true);
    setReplayMeta({ segments: 0, events: 0, bytes: 0 });
    setReplayDurationLabel(null);
  }, [payload, status]);

  // rrweb is pulled in only when a replay exists so ordinary event pages
  // do not pay for the player bundle. Segments are fetched a page at a time
  // and pushed into the running player with `addEvent`, in playback order.
  useEffect(() => {
    const stage = replayStage.current;
    if (!stage || !replayId) return;
    let cancelled = false;
    let player: { addEvent?: (event: unknown) => void; $destroy?: () => void } | null = null;
    const loaded: unknown[] = [];

    (async () => {
      const { default: RrwebPlayer } = await import("rrweb-player");
      let cursor: string | null = null;
      let firstPage = true;
      do {
        const response =
          cursor === null
            ? await api.api.admin.events[eventId].replay[replayId].get()
            : await api.api.admin.events[eventId].replay[replayId].get({
                $query: { cursor },
              });
        if (cancelled) return;
        const page = response?.data as ReplayPage | null;
        if (!page || page.available === false) {
          setReplayAvailable(false);
          setReplayStatus("ready");
          return;
        }

        const pageEvents: unknown[] = [];
        for (const segment of page.segments) {
          const objectResponse = await fetch(segment.url);
          const events = await objectResponse.json().catch(() => null);
          const list = Array.isArray(events) ? events : [];
          pageEvents.push(...list);
          setReplayMeta((meta) => ({
            segments: meta.segments + 1,
            events: meta.events + list.length,
            bytes: meta.bytes + segment.bytes,
          }));
        }
        cursor = page.nextCursor;

        if (cancelled) return;
        if (firstPage) {
          firstPage = false;
          loaded.push(...pageEvents);
          if (loaded.length > 0) {
            stage.innerHTML = "";
            player = new RrwebPlayer({
              target: stage,
              props: {
                events: loaded as never[],
                width: Math.max(360, Math.min(stage.clientWidth || 960, 1440)),
                height: 460,
                autoPlay: false,
                showController: true,
              },
            }) as { addEvent?: (event: unknown) => void; $destroy?: () => void };
          }
        } else {
          for (const event of pageEvents) player?.addEvent?.(event);
          loaded.push(...pageEvents);
        }
        setReplayDurationLabel(replayDuration(loaded));
        setReplayStatus("ready");
      } while (cursor !== null && !cancelled);
    })().catch((err) => {
      console.error(
        "[replay] Player failed to load:",
        err instanceof Error ? err.message : String(err),
      );
      if (!cancelled) setReplayStatus("error");
    });

    return () => {
      cancelled = true;
      player?.$destroy?.();
      stage.innerHTML = "";
    };
  }, [replayId, eventId]);

  const first = payload?.exception?.values?.[0];
  const title = first
    ? `${first.type ?? "Error"}: ${first.value ?? ""}`
    : payload?.message ?? payload?.transaction ?? "Event";
  const frames = first?.stacktrace?.frames ?? [];
  // Stored oldest-first; the crash site (newest frame) goes on top.
  const displayFrames = [...frames].reverse();
  const tags = Object.entries(payload?.tags ?? {}).slice(0, 12);
  const userId = payload?.user?.email ?? payload?.user?.username ?? payload?.user?.id ?? null;

  // The issue's occurrences and counters come from the server: it owns the
  // grouping, so the page never recomputes a fingerprint.
  useEffect(() => {
    if (!issueId) return;
    let cancelled = false;
    setRelatedStatus("loading");
    (async () => {
      try {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const [occurrenceResult, statsResult] = await Promise.all([
          listIssueOccurrences(issueId, { limit: EVENT_PAGE_SIZE }),
          getIssueStats(issueId, { from: since, stepSeconds: 3600 }),
        ]);
        const list =
          (occurrenceResult?.data as { data?: IssueOccurrenceDto[] } | null)?.data ?? [];
        const counters = (statsResult?.data as IssueStatsDto | null) ?? null;
        if (cancelled) return;
        setOccurrences(list);
        setStats(counters);
        setRelatedStatus("ready");
      } catch {
        // the panels keep their empty state on failure
        if (!cancelled) setRelatedStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [issueId]);

  // The stored window supplies the payloads the panels aggregate; the
  // occurrences decide which of them belong to this issue. The window is the
  // last 24 hours, matching the stats above — time-bounded, not item-capped.
  useEffect(() => {
    if (!issueId) return;
    let cancelled = false;
    (async () => {
      try {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const list = await loadAllPages<StoredEvent>(
          async (cursor, limit) => {
            const result = await listEvents({
              projectId,
              environmentId,
              appId: applicationId,
              cursor,
              limit,
              since,
            });
            return (result?.data as { data?: StoredEvent[] })?.data ?? [];
          },
          EVENT_PAGE_SIZE,
        );
        if (cancelled) return;
        setRelated(list);
      } catch {
        // the panels keep their empty state on failure
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [issueId, projectId, environmentId, applicationId]);

  const payloadByMessageId = useMemo(() => {
    const map = new Map<string, StoredEvent>();
    for (const stored of related) map.set(stored.id, stored);
    return map;
  }, [related]);

  const occurrenceIds = useMemo(
    () => new Set(occurrences.map((occurrence) => occurrence.messageId)),
    [occurrences],
  );

  // The payloads the panels aggregate: the loaded events that the server
  // grouped into this issue.
  const issueEvents = useMemo(
    () =>
      related.filter(
        (stored) => occurrenceIds.has(stored.id) && stored.itemTypes?.includes("event"),
      ),
    [related, occurrenceIds],
  );

  const metrics = useMemo(() => buildIssueMetrics(issueEvents), [issueEvents]);

  const selectEvent = (id: string) => {
    if (id !== eventId) navigate(`/issues/${id}?issue=${issueId}`);
    // The details sit below the list; bring the updated event into view.
    requestAnimationFrame(() => {
      detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  // Frequency: the server's hourly buckets over the last 24 hours.
  const buckets = (stats?.points ?? []).map((point) => point.eventCount);
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
                      : `${occurrences.length} event${
                          occurrences.length === 1 ? "" : "s"
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
              {occurrences.map((occurrence) => {
                const stored = payloadByMessageId.get(occurrence.messageId);
                const row = (stored?.event ?? {}) as EventPayload;
                const rowFirst = row.exception?.values?.[0];
                const rowReplayId = row.contexts?.replay?.replay_id;
                const hasReplay =
                  Boolean(rowReplayId) ||
                  Boolean(
                    stored?.itemTypes?.some(
                      (type) => type === "replay_event" || type === "replay_recording",
                    ),
                  );
                const user =
                  row.user?.email ??
                  row.user?.username ??
                  row.user?.id ??
                  occurrence.user ??
                  "—";
                const line =
                  row.message ||
                  rowFirst?.value ||
                  row.transaction ||
                  occurrence.title ||
                  occurrence.messageId;
                return (
                  <div
                    key={occurrence.messageId}
                    className={`data-row clickable${occurrence.messageId === eventId ? " selected" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => selectEvent(occurrence.messageId)}
                    onKeyDown={(keyEvent) => {
                      if (keyEvent.key === "Enter") selectEvent(occurrence.messageId);
                    }}
                  >
                    <div className="issue-main">
                      <div className="issue-title">
                        <span>{occurrence.messageId.slice(0, 6).toUpperCase()}</span>
                        {line}
                      </div>
                      <div className="issue-meta">
                        {hasReplay && (
                          <span
                            className="replay-tag"
                            title={rowReplayId ? `replay ${rowReplayId}` : "replay attached"}
                          >
                            replay
                          </span>
                        )}
                        <span>{row.culprit ?? rowFirst?.type ?? occurrence.level ?? "error"}</span>
                      </div>
                    </div>
                    <span className="event-cell" title={user}>
                      {user}
                    </span>
                    <span className="event-cell" title={row.release ?? occurrence.release}>
                      {row.release ?? occurrence.release ?? "—"}
                    </span>
                    <span className="event-cell">{relativeTime(occurrence.receivedAt)}</span>
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
              {replayId && (
                <div className="filter-chip">replay {replayId.slice(0, 8)}</div>
              )}
            </div>
            {replayStatus === "loading" && (
              <div className="panel-subtitle">Locating the replay linked to this issue…</div>
            )}
            {replayStatus === "error" && (
              <div className="panel-subtitle">Could not load the session replay.</div>
            )}
            {replayStatus === "ready" && !replayId && (
              <div className="panel-subtitle">
                No session replay is linked to this issue — enable Session Replay in the
                browser SDK to record the sessions around your errors.
              </div>
            )}
            {replayId && !replayAvailable && (
              <div className="panel-subtitle">
                {`Replay ${replayId.slice(0, 8)} is linked, but the object store could not be read.`}
              </div>
            )}
            {replayId && replayAvailable && (
              <>
                {replayMeta.segments > 0 && (
                  <div className="replay-meta">
                    <div className="filter-chip">
                      {replayMeta.segments === 1
                        ? "1 segment"
                        : `${replayMeta.segments} segments`}
                    </div>
                    <div className="filter-chip">
                      {replayMeta.events === 1
                        ? "1 event"
                        : `${replayMeta.events} events`}
                    </div>
                    <div className="filter-chip">{formatBytes(replayMeta.bytes)}</div>
                    {replayDurationLabel && (
                      <div className="filter-chip">{replayDurationLabel}</div>
                    )}
                  </div>
                )}
                <div className="replay-stage" ref={replayStage} />
                {replayStatus === "ready" && replayMeta.events === 0 && (
                  <div className="panel-subtitle">
                    {`Replay ${replayId.slice(0, 8)} is linked, but no recording segments are stored yet.`}
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
