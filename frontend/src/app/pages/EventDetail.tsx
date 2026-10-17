import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ScreenIntro } from "../ScreenIntro";
import { useWorkspace } from "../WorkspaceContext";
import { AGGREGATE_EVENT_LIMIT, api, listEvents } from "../../lib/api";
import { payloadSignature, type ExceptionFrame, type StoredEvent } from "../../lib/issues";
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

export function EventDetail() {
  const { eventId = "" } = useParams();
  const { project, environment, application } = useWorkspace();
  const projectId = project?.id;
  const environmentId = environment?.id;
  const applicationId = application?.id;
  const [payload, setPayload] = useState<EventPayload | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [related, setRelated] = useState<StoredEvent[]>([]);
  const [replay, setReplay] = useState<ReplayPayload | null>(null);
  const [replayStatus, setReplayStatus] = useState<"loading" | "ready" | "error">("loading");
  const replayStage = useRef<HTMLDivElement | null>(null);

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
  const signature = payload ? payloadSignature(payload) : null;
  const replayDurationLabel = replay ? replayDuration(replay.events) : null;

  // Frequency: same-signature events in the stored window, bucketed hourly.
  useEffect(() => {
    if (!signature) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await listEvents({
          projectId,
          environmentId,
          appId: applicationId,
          limit: AGGREGATE_EVENT_LIMIT,
        });
        const list = (result?.data as { data?: StoredEvent[] })?.data ?? [];
        if (!cancelled) setRelated(list);
      } catch {
        // keep the chart empty on failure
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signature, projectId, environmentId, applicationId]);

  const buckets = new Array<number>(BUCKET_COUNT).fill(0);
  if (signature) {
    const now = Date.now();
    for (const event of related) {
      if (!event.itemTypes?.includes("event")) continue;
      if (payloadSignature(event.event) !== signature) continue;
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
          <section className="content-grid">
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
