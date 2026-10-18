import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../Icon.tsx";
import { Action } from "../Action.tsx";
import { useWorkspace } from "../WorkspaceContext.tsx";
import {
  AGGREGATE_EVENT_LIMIT,
  api,
  listEvents,
  type AlertChannelDto,
  type AlertRuleDto,
  type ReleaseDto,
} from "../../lib/api.ts";
import { POLL_INTERVAL_MS, relativeTime } from "../../lib/utils.ts";
import { eventTitle, groupIssues, type StoredEvent } from "../../lib/issues.ts";
import { subscribeLiveFeed } from "../../lib/live-events.ts";

function bucketize(events: StoredEvent[], spanMs: number, buckets = 6): number[] {
  const start = Date.now() - spanMs;
  const counts = new Array<number>(buckets).fill(0);
  for (const event of events) {
    const time = new Date(event.receivedAt).getTime();
    if (Number.isNaN(time) || time < start) continue;
    const index = Math.min(buckets - 1, Math.floor(((time - start) / spanMs) * buckets));
    counts[index]! += 1;
  }
  return counts;
}

/** Human labels for the start of each chart bucket, based on the range. */
function bucketLabels(spanMs: number, buckets = 6): string[] {
  const now = Date.now();
  const spanDays = spanMs / (24 * 60 * 60 * 1000);
  return Array.from({ length: buckets }, (_, index) => {
    const time = new Date(now - spanMs + (spanMs / buckets) * index);
    return spanDays >= 2
      ? time.toLocaleDateString("en-US", { weekday: "short" })
      : time.toLocaleTimeString("en-US", { hour: "numeric" });
  });
}

function seriesToPaths(values: number[], width: number, height: number): { area: string; line: string } {
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values.map((value, index) => {
    const x = index * step;
    const y = height - (value / max) * (height - 4);
    return [x, y] as const;
  });
  const line = points
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  return { area, line };
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function eventLevel(event: StoredEvent): { label: string; tone: "red" | "amber" | "blue" | "violet" } {
  if (event.itemTypes?.includes("transaction")) return { label: "TRACE", tone: "violet" };
  const level = (event.event as { level?: string } | null)?.level ?? "error";
  if (level === "warning") return { label: "WARN", tone: "amber" };
  if (level === "info" || level === "debug") return { label: "INFO", tone: "blue" };
  return { label: "ERROR", tone: "red" };
}

function eventTime(receivedAt: string): string {
  return new Date(receivedAt).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function Overview() {
  const navigate = useNavigate();
  const { project, environment, application, applications, adminUser } = useWorkspace();
  const projectId = project?.id;
  const environmentId = environment?.id;
  const applicationId = application?.id;
  const [range, setRange] = useState("24 hours");
  const [rangeMenuOpen, setRangeMenuOpen] = useState(false);
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [eventsStored, setEventsStored] = useState(0);
  const [eventsStatus, setEventsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [rules, setRules] = useState<AlertRuleDto[]>([]);
  const [channels, setChannels] = useState<AlertChannelDto[]>([]);
  const [releases, setReleases] = useState<ReleaseDto[]>([]);

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
        const body = (result?.data as {
          data?: StoredEvent[];
          pagination?: { total?: number };
        } | null) ?? null;
        const list = (body?.data ?? []) as StoredEvent[];
        if (!cancelled) {
          setEvents(list);
          setEventsStored(body?.pagination?.total ?? list.length);
          setEventsStatus("ready");
        }
      } catch {
        // keep the last events on failure, but stop the loading state
        if (!cancelled) setEventsStatus((current) => (current === "ready" ? current : "error"));
      }
    };
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectId, environmentId, applicationId]);

  // Live feed: the page subscribes to NATS directly (there is no backend
  // fan-out) and prepends events as they are ingested. A `clear` — the
  // events store was truncated — empties the list until the next poll
  // refills it.
  useEffect(() => {
    const close = subscribeLiveFeed({
      onItem: (item) => {
        if (projectId && item.projectId !== projectId) return;
        if (applicationId && item.appId !== applicationId) return;
        if (!applicationId && environmentId) {
          const visible = applications.some(
            (app) => app.id === item.appId && app.environmentId === environmentId,
          );
          if (!visible) return;
        }
        setEvents((current) =>
          [
            {
              id: item.id,
              itemTypes: item.itemTypes,
              event: item.event,
              receivedAt: item.receivedAt,
            },
            ...current.filter((event) => event.id !== item.id),
          ].slice(0, AGGREGATE_EVENT_LIMIT),
        );
      },
      onClear: () => setEvents([]),
    });
    return close;
  }, [projectId, environmentId, applicationId, applications]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [rulesResult, channelsResult, releasesResult] = await Promise.all([
          api.api.admin.alerting.rules.get(),
          api.api.admin.alerting.channels.get(),
          api.api.admin.releases.get(),
        ]);
        if (cancelled) return;
        setRules(((rulesResult?.data as { data?: AlertRuleDto[] })?.data ?? []));
        setChannels(((channelsResult?.data as { data?: AlertChannelDto[] })?.data ?? []));
        setReleases(((releasesResult?.data as { data?: ReleaseDto[] })?.data ?? []));
      } catch {
        // keep the current lists on failure
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rangeSpanMs = range === "7 days" ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const windowStart = Date.now() - rangeSpanMs;
  const windowed = useMemo(
    () => events.filter((event) => Date.parse(event.receivedAt) >= windowStart),
    [events, windowStart],
  );
  const errorEvents = useMemo(
    () => windowed.filter((event) => event.itemTypes?.includes("event")),
    [windowed],
  );
  const transactionEvents = useMemo(
    () => windowed.filter((event) => event.itemTypes?.includes("transaction")),
    [windowed],
  );
  const transactionCount = transactionEvents.length;
  const warningEvents = useMemo(
    () =>
      errorEvents.filter(
        (event) => (event.event as { level?: string } | null)?.level === "warning",
      ),
    [errorEvents],
  );

  const errorSeries = useMemo(() => bucketize(errorEvents, rangeSpanMs), [errorEvents, rangeSpanMs]);
  const warningSeries = useMemo(
    () => bucketize(warningEvents, rangeSpanMs),
    [warningEvents, rangeSpanMs],
  );
  const transactionSeries = useMemo(
    () => bucketize(transactionEvents, rangeSpanMs),
    [transactionEvents, rangeSpanMs],
  );
  const volumeSeries = useMemo(() => bucketize(windowed, rangeSpanMs), [windowed, rangeSpanMs]);
  const errorPaths = useMemo(() => seriesToPaths(errorSeries, 720, 180), [errorSeries]);
  const warningPaths = useMemo(() => seriesToPaths(warningSeries, 720, 180), [warningSeries]);
  const errorSparkline = useMemo(() => seriesToPaths(errorSeries, 240, 48), [errorSeries]);
  const transactionSparkline = useMemo(
    () => seriesToPaths(transactionSeries, 240, 48),
    [transactionSeries],
  );
  const volumeSparkline = useMemo(() => seriesToPaths(volumeSeries, 240, 48), [volumeSeries]);
  const xLabels = useMemo(() => bucketLabels(rangeSpanMs), [rangeSpanMs]);

  const enabledRules = rules.filter((rule) => rule.isEnabled);
  const dateLabel = new Date()
    .toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
    .toUpperCase();

  const issueGroups = useMemo(() => groupIssues(windowed), [windowed]);
  const visibleIssues = useMemo(
    () =>
      [...issueGroups]
        .sort((a, b) => b.events - a.events || Date.parse(b.lastSeen) - Date.parse(a.lastSeen))
        .slice(0, 4),
    [issueGroups],
  );
  const recentEvents = events.slice(0, 4);

  return (
    <>
      <section className="welcome-row">
        <div>
          <div className="eyebrow">{dateLabel}</div>
          <div className="page-title">
            {greeting()}
            {adminUser ? `, ${adminUser.name.split(" ")[0]}` : ""}
          </div>
          <div className="page-subtitle">Here&apos;s what&apos;s happening across your applications.</div>
        </div>
        <div className="filters">
          <div className="range-wrap">
            <div
              className="select-control"
              role="button"
              tabIndex={0}
              aria-expanded={rangeMenuOpen}
              onClick={() => setRangeMenuOpen(!rangeMenuOpen)}
              onKeyDown={(event) => event.key === "Enter" && setRangeMenuOpen(!rangeMenuOpen)}
            >
              <Icon name="clock" size={15} />
              Last {range}
              <span className="caret">⌄</span>
            </div>
            {rangeMenuOpen && (
              <div className="range-menu">
                {["24 hours", "7 days"].map((option) => (
                  <div
                    key={option}
                    className={`range-option ${range === option ? "selected" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setRange(option);
                      setRangeMenuOpen(false);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        setRange(option);
                        setRangeMenuOpen(false);
                      }
                    }}
                  >
                    Last {option}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="metrics-grid">
        <article className="metric-card">
          <div className="metric-header">
            <span>Unresolved issues</span>
            <div className="metric-icon red">
              <Icon name="alert" />
            </div>
          </div>
          <div className="metric-value">{issueGroups.length}</div>
          <div className="metric-foot">
            <span>distinct error signatures in the last {range} (latest {AGGREGATE_EVENT_LIMIT} stored items)</span>
          </div>
          <div className="sparkline red-line">
            <svg viewBox="0 0 240 48" preserveAspectRatio="none">
              <path className="area" d={errorSparkline.area} />
              <path d={errorSparkline.line} />
            </svg>
          </div>
        </article>
        <article className="metric-card">
          <div className="metric-header">
            <span>Transactions</span>
            <div className="metric-icon amber">
              <Icon name="stack" />
            </div>
          </div>
          <div className="metric-value">{transactionCount}</div>
          <div className="metric-foot">
            <span>traces in the last {range} (latest {AGGREGATE_EVENT_LIMIT} stored items)</span>
          </div>
          <div className="sparkline amber-line">
            <svg viewBox="0 0 240 48" preserveAspectRatio="none">
              <path className="area" d={transactionSparkline.area} />
              <path d={transactionSparkline.line} />
            </svg>
          </div>
        </article>
        <article className="metric-card">
          <div className="metric-header">
            <span>Stored envelopes</span>
            <div className="metric-icon blue">
              <Icon name="logs" />
            </div>
          </div>
          <div className="metric-value">{eventsStored}</div>
          <div className="metric-foot">
            <span>total envelopes stored in the selected scope</span>
          </div>
          <div className="sparkline blue-line">
            <svg viewBox="0 0 240 48" preserveAspectRatio="none">
              <path className="area" d={volumeSparkline.area} />
              <path d={volumeSparkline.line} />
            </svg>
          </div>
        </article>
        <article className="metric-card">
          <div className="metric-header">
            <span>Active alerts</span>
            <div className="metric-icon violet">
              <Icon name="bell" />
            </div>
          </div>
          <div className="metric-value">{enabledRules.length}</div>
          <div className="metric-foot">
            <span>rules enabled</span>
          </div>
          <div className="alert-channels">
            {channels.map((channel) => (
              <span key={channel.id} className={`channel ${channel.type === "slack" ? "slack" : channel.type === "rocketchat" ? "rocket" : "mail"}`}>
                {channel.type === "slack" ? "S" : channel.type === "rocketchat" ? "R" : "@"}
              </span>
            ))}
            <span className="channel-copy">
              {channels.length} channel{channels.length === 1 ? "" : "s"} connected
            </span>
          </div>
        </article>
      </section>

      <section className="content-grid">
        <article className="panel issues-panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Issues requiring attention</div>
              <div className="panel-subtitle">Grouped by error signature · most frequent first</div>
            </div>
            <Action variant="soft" onClick={() => navigate("/issues")}>
              View all issues <Icon name="chevron" size={14} />
            </Action>
          </div>
          <div className="issue-list">
            {visibleIssues.map((issue) => (
              <div
                className="issue-row clickable"
                key={issue.key}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/issues/${issue.latestEventId}`)}
                onKeyDown={(navEvent) =>
                  navEvent.key === "Enter" && navigate(`/issues/${issue.latestEventId}`)
                }
              >
                <div className={`severity ${issue.severity}`}>
                  <Icon
                    name={issue.severity === "critical" ? "alert" : issue.severity === "warning" ? "clock" : "code"}
                    size={16}
                  />
                </div>
                <div className="issue-main">
                  <div className="issue-title">
                    <span>{issue.code}</span>
                    {issue.title}
                  </div>
                  <div className="issue-meta">
                    <span>{issue.tag}</span>
                    <span className="meta-dot">•</span>
                    <span>{relativeTime(issue.lastSeen)}</span>
                  </div>
                </div>
                <div className="issue-stat">
                  <strong>{issue.events}</strong>
                  <span>events</span>
                </div>
                <div className="issue-stat">
                  <strong>{issue.users > 0 ? issue.users : "—"}</strong>
                  <span>users</span>
                </div>
                <div className="issue-time">{relativeTime(issue.lastSeen)}</div>
              </div>
            ))}
            {eventsStatus !== "ready" && (
              <div className="issue-row">
                <div className="severity info">
                  <Icon name="code" size={16} />
                </div>
                <div className="issue-main">
                  <div className="issue-title">
                    <span>—</span>
                    {eventsStatus === "loading" ? "Loading issues…" : "Could not load issues"}
                  </div>
                  <div className="issue-meta">
                    {eventsStatus === "loading"
                      ? "Fetching the latest stored events"
                      : "Check the backend connection and try again"}
                  </div>
                </div>
              </div>
            )}
            {eventsStatus === "ready" && visibleIssues.length === 0 && (
              <div className="issue-row">
                <div className="severity info">
                  <Icon name="code" size={16} />
                </div>
                <div className="issue-main">
                  <div className="issue-title">
                    <span>—</span>No issues yet
                  </div>
                  <div className="issue-meta">Send an event through your DSN to see it here</div>
                </div>
              </div>
            )}
          </div>
        </article>

        <article className="panel volume-panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Event volume</div>
              <div className="panel-subtitle">Errors and warnings over time</div>
            </div>
            <div className="legend">
              <span>
                <i className="red-dot"></i>Errors
              </span>
              <span>
                <i className="amber-dot"></i>Warnings
              </span>
            </div>
          </div>
          <div className="chart">
            <div className="y-labels">
              <span>{Math.max(...errorSeries, ...warningSeries, 0)}</span>
              <span></span>
              <span></span>
              <span>0</span>
            </div>
            <div className="chart-area">
              <div className="grid-lines">
                <i></i>
                <i></i>
                <i></i>
                <i></i>
              </div>
              <svg viewBox="0 0 720 180" preserveAspectRatio="none">
                <path className="area-error" d={errorPaths.area} />
                <path className="chart-error" d={errorPaths.line} />
                <path className="area-warning" d={warningPaths.area} />
                <path className="chart-warning" d={warningPaths.line} />
              </svg>
              <div className="x-labels">
                {xLabels.map((label, index) => (
                  <span key={`${label}-${index}`}>{label}</span>
                ))}
              </div>
            </div>
          </div>
        </article>
      </section>

      <section className="bottom-grid">
        <article className="panel log-panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Recent events</div>
              <div className="live-state">
                <span></span>Live · refreshed every {POLL_INTERVAL_MS / 1000}s
              </div>
            </div>
            <div className="log-actions">
              <Action variant="soft" onClick={() => navigate("/issues")}>
                Explore issues <Icon name="chevron" size={14} />
              </Action>
            </div>
          </div>
          <div className="logs">
            {recentEvents.map((event) => {
              const level = eventLevel(event);
              return (
                <div
                  className="log-row clickable"
                  key={event.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/issues/${event.id}`)}
                  onKeyDown={(navEvent) =>
                    navEvent.key === "Enter" && navigate(`/issues/${event.id}`)
                  }
                >
                  <span className="log-time">{eventTime(event.receivedAt)}</span>
                  <span className={`log-level ${level.tone}`}>{level.label}</span>
                  <span className="log-message">{eventTitle(event)}</span>
                  <span className="log-service">{event.itemTypes?.[0] ?? "event"}</span>
                </div>
              );
            })}
            {recentEvents.length === 0 && (
              <div className="log-row">
                <span className="log-message">No stored events yet</span>
              </div>
            )}
          </div>
        </article>

        <article className="panel release-panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Recent releases</div>
              <div className="panel-subtitle">Deployment health</div>
            </div>
          </div>
          <div className="release-list">
            {releases.slice(0, 3).map((release) => (
              <div className="release-row" key={release.id}>
                <div className={`release-icon ${release.status === "finalized" ? "healthy" : "warning"}`}>
                  <Icon name="release" size={17} />
                </div>
                <div className="release-copy">
                  <strong>
                    {release.version} <span>{release.ref ?? release.appId.slice(0, 6)}</span>
                  </strong>
                  <small>
                    {relativeTime(release.lastSeen)} · {release.owner ?? "unassigned"}
                  </small>
                </div>
                <div className={`health ${release.status === "finalized" ? "" : "degraded"}`}>
                  <i></i>
                  {release.status === "finalized" ? "Healthy" : "Draft"}
                </div>
              </div>
            ))}
            {releases.length === 0 && (
              <div className="release-row">
                <div className="release-icon healthy">
                  <Icon name="release" size={17} />
                </div>
                <div className="release-copy">
                  <strong>
                    No releases <span>yet</span>
                  </strong>
                  <small>Reported releases appear here automatically</small>
                </div>
              </div>
            )}
          </div>
        </article>
      </section>

      <section className="insight">
        <div className="insight-icon">
          <Icon name="spark" size={20} />
        </div>
        <div className="insight-copy">
          <strong>Benedebug Insight</strong>
          <span>
            <b>{errorEvents.length}</b> error events and <b>{transactionCount}</b> transactions stored
            across <b>{enabledRules.length}</b> active alert rules.
          </span>
        </div>
        <Action variant="ghost" onClick={() => navigate("/issues")}>
          Investigate <Icon name="chevron" size={14} />
        </Action>
      </section>
    </>
  );
}
