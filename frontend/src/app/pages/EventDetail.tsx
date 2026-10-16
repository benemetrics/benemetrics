import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ScreenIntro } from "../ScreenIntro";
import { useWorkspace } from "../WorkspaceContext";
import { AGGREGATE_EVENT_LIMIT, api, listEvents } from "../../lib/api";
import { payloadSignature, type StoredEvent } from "../../lib/issues";

interface ExceptionFrame {
  filename?: string;
  function?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
  context_line?: string;
}

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
  user?: { id?: string; email?: string; username?: string };
  tags?: Record<string, string>;
  exception?: { values?: ExceptionValue[] };
  contexts?: {
    browser?: ContextInfo;
    os?: ContextInfo;
    runtime?: ContextInfo;
    device?: ContextInfo;
  };
}

const HOUR_MS = 3_600_000;
const BUCKET_COUNT = 24;

export function EventDetail() {
  const { eventId = "" } = useParams();
  const { project, environment, application } = useWorkspace();
  const projectId = project?.id;
  const environmentId = environment?.id;
  const applicationId = application?.id;
  const [payload, setPayload] = useState<EventPayload | null>(null);
  const [receivedAt, setReceivedAt] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [related, setRelated] = useState<StoredEvent[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await api.events[eventId].get();
        if (cancelled) return;
        const stored = result?.data as
          | { event?: EventPayload | null; receivedAt?: string }
          | null;
        setPayload(stored?.event ?? null);
        setReceivedAt(stored?.receivedAt ?? null);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const first = payload?.exception?.values?.[0];
  const title = first
    ? `${first.type ?? "Error"}: ${first.value ?? ""}`
    : payload?.message ?? payload?.transaction ?? "Event";
  const frames = first?.stacktrace?.frames ?? [];
  const tags = Object.entries(payload?.tags ?? {}).slice(0, 12);
  const userId = payload?.user?.email ?? payload?.user?.username ?? payload?.user?.id ?? null;
  const signature = payload ? payloadSignature(payload) : null;

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
  if (receivedAt) contextRows.push(["Last seen", new Date(receivedAt).toLocaleString()]);

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
                  {frames.slice(0, 12).map((frame, index) => (
                    <div className="frame-row" key={`${frame.filename}-${index}`}>
                      <span>{index === 0 ? "▸" : ""}</span>
                      <strong>
                        {frame.function || "<anonymous>"}
                        {frame.in_app && <span className="frame-tag">in app</span>}
                      </strong>
                      <small>
                        {frame.filename ?? "unknown"}
                        {frame.lineno != null ? `:${frame.lineno}` : ""}
                      </small>
                      {frame.context_line && <code>{frame.context_line.trim()}</code>}
                    </div>
                  ))}
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
