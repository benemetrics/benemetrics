import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../Icon";
import { ScreenIntro } from "../ScreenIntro";
import { useWorkspace } from "../WorkspaceContext";
import { AGGREGATE_EVENT_LIMIT, api, listEvents } from "../../lib/api";
import { groupIssues, type IssueGroup, type StoredEvent } from "../../lib/issues";
import { POLL_INTERVAL_MS, relativeTime } from "../../lib/utils";

const PAGE_SIZE = 20;

export function Issues() {
  const navigate = useNavigate();
  const { project, environment, application, query, setQuery } = useWorkspace();
  const projectId = project?.id;
  const environmentId = environment?.id;
  const applicationId = application?.id;
  const [groups, setGroups] = useState<IssueGroup[]>([]);
  const [loadedEvents, setLoadedEvents] = useState(0);
  const [storedTotal, setStoredTotal] = useState(0);
  const [health, setHealth] = useState<{ status: string; eventsStored: number } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [projectId, environmentId, applicationId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await listEvents({
          projectId,
          environmentId,
          appId: applicationId,
          page: 1,
          limit: AGGREGATE_EVENT_LIMIT,
        });
        const body = result?.data as {
          data?: StoredEvent[];
          pagination?: { total: number };
        } | null;
        const events = body?.data ?? [];
        if (cancelled) return;
        setGroups(groupIssues(events));
        setLoadedEvents(events.length);
        setStoredTotal(body?.pagination?.total ?? events.length);
        setStatus("ready");
      } catch {
        // keep the last rows on fetch failure, but stop the loading state
        if (!cancelled) setStatus((current) => (current === "ready" ? current : "error"));
      }
      try {
        const healthResult = await api.health.get();
        if (!cancelled && healthResult?.data) setHealth(healthResult.data);
      } catch {
        // keep the last health on fetch failure
      }
    };
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectId, environmentId, applicationId]);

  const term = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      term
        ? groups.filter(
            (group) =>
              group.title.toLowerCase().includes(term) ||
              group.source.toLowerCase().includes(term) ||
              group.tag.toLowerCase().includes(term),
          )
        : groups,
    [groups, term],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageGroups = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const groupedCopy =
    storedTotal > loadedEvents
      ? `grouped from the latest ${loadedEvents} of ${storedTotal} stored events`
      : `grouped from ${loadedEvents} stored event${loadedEvents === 1 ? "" : "s"}`;

  return (
    <div className="screen-stack">
      <ScreenIntro
        eyebrow="ERROR MONITORING"
        title="Issues"
        subtitle="Errors captured from your applications, grouped by error signature (newest first)."
      />
      <div className="toolbar">
        <div className="toolbar-search">
          <Icon name="search" size={15} />
          <input
            className="toolbar-input"
            type="text"
            placeholder="Search by issue, service, or user..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="filter-chip">Status: Unresolved</div>
        <div className="filter-chip">All projects</div>
        {health && (
          <div className="filter-chip">{health.eventsStored} stored</div>
        )}
      </div>
      <article className="panel data-panel">
        <div className="data-head">
          <span>Issue</span>
          <span>Events</span>
          <span>Users</span>
          <span>Last seen</span>
        </div>
        {pageGroups.map((group) => (
          <div
            className="data-row clickable"
            key={group.key}
            role="button"
            tabIndex={0}
            onClick={() => navigate(`/issues/${group.latestEventId}`)}
            onKeyDown={(event) => event.key === "Enter" && navigate(`/issues/${group.latestEventId}`)}
          >
            <div className="issue-main">
              <div className="issue-title">
                <span>{group.code}</span>
                {group.title}
              </div>
              <div className="issue-meta">
                {group.source} · {group.tag}
              </div>
            </div>
            <strong>{group.events}</strong>
            <span>{group.users > 0 ? group.users : "—"}</span>
            <span>{relativeTime(group.lastSeen)}</span>
          </div>
        ))}
        {status !== "ready" && (
          <div className="data-row">
            <div className="issue-main">
              <div className="issue-title">
                <span>—</span>
                {status === "loading" ? "Loading events…" : "Could not load events"}
              </div>
              <div className="issue-meta">
                {status === "loading"
                  ? "Fetching the latest stored events"
                  : "Check the backend connection and try again"}
              </div>
            </div>
            <strong>—</strong>
            <span>—</span>
            <span>—</span>
          </div>
        )}
        {status === "ready" && filtered.length === 0 && (
          <div className="data-row">
            <div className="issue-main">
              <div className="issue-title">
                <span>—</span>
                {term ? "No matching issues" : "No events yet"}
              </div>
              <div className="issue-meta">
                {term
                  ? `Nothing matches “${query.trim()}” in the current project and environment`
                  : "Send an event through your DSN and it will appear here"}
              </div>
            </div>
            <strong>0</strong>
            <span>—</span>
            <span>—</span>
          </div>
        )}
        {status === "ready" && filtered.length > 0 && (
          <div className="pagination">
            <span>
              Page {currentPage} of {totalPages} · {filtered.length} issue
              {filtered.length === 1 ? "" : "s"} {groupedCopy}
            </span>
            <div className="pagination-actions">
              {currentPage > 1 && (
                <div
                  className="pagination-button"
                  role="button"
                  tabIndex={0}
                  onClick={() => setPage(currentPage - 1)}
                  onKeyDown={(event) => event.key === "Enter" && setPage(currentPage - 1)}
                >
                  ← Prev
                </div>
              )}
              {currentPage < totalPages && (
                <div
                  className="pagination-button"
                  role="button"
                  tabIndex={0}
                  onClick={() => setPage(currentPage + 1)}
                  onKeyDown={(event) => event.key === "Enter" && setPage(currentPage + 1)}
                >
                  Next →
                </div>
              )}
            </div>
          </div>
        )}
      </article>
    </div>
  );
}
