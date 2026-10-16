import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../Icon";
import { ScreenIntro } from "../ScreenIntro";
import { useWorkspace } from "../WorkspaceContext";
import { api, listIssues, type IssueDto } from "../../lib/api";
import { POLL_INTERVAL_MS, relativeTime } from "../../lib/utils";

const PAGE_SIZE = 20;

type StatusFilter = "unresolved" | "resolved" | "all";

const STATUS_FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: "unresolved", label: "Status: Unresolved" },
  { id: "resolved", label: "Status: Resolved" },
  { id: "all", label: "Status: All" },
];

export function Issues() {
  const navigate = useNavigate();
  const { project, application, query, setQuery } = useWorkspace();
  const projectId = project?.id;
  const applicationId = application?.id;
  const [issues, setIssues] = useState<IssueDto[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [health, setHealth] = useState<{ status: string; eventsStored: number } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("unresolved");
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // Debounce the shared toolbar query into the server-side `q` filter.
  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setPage(1);
  }, [projectId, applicationId, statusFilter, searchTerm]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await listIssues({
          projectId,
          appId: applicationId,
          status: statusFilter === "all" ? undefined : statusFilter,
          q: searchTerm || undefined,
          page,
          limit: PAGE_SIZE,
        });
        const body = result?.data as {
          data?: IssueDto[];
          pagination?: { page: number; limit: number; total: number; totalPages: number };
        } | null;
        if (cancelled) return;
        setIssues(body?.data ?? []);
        setTotal(body?.pagination?.total ?? body?.data?.length ?? 0);
        setTotalPages(Math.max(1, body?.pagination?.totalPages ?? 1));
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
  }, [projectId, applicationId, statusFilter, searchTerm, page, reloadToken]);

  const setFilter = (filter: StatusFilter) => {
    setStatusFilter(filter);
    setPage(1);
  };

  // Resolving an issue arms the "regression" alert trigger for its next
  // occurrence; reopening one disarms it again.
  const toggleStatus = async (issue: IssueDto) => {
    setBusyId(issue.id);
    try {
      await api.api.admin.issues[issue.id].patch({
        status: issue.status === "resolved" ? "unresolved" : "resolved",
      });
      setReloadToken((token) => token + 1);
    } catch {
      // transient failures reconcile on the next poll
    } finally {
      setBusyId(null);
    }
  };

  const currentPage = Math.min(page, totalPages);
  const scopeCopy = application ? "this app" : "this project";
  const emptyTitle = searchTerm
    ? "No matching issues"
    : statusFilter === "resolved"
      ? "No resolved issues"
      : statusFilter === "all"
        ? "No issues yet"
        : "No unresolved issues";
  const emptyMeta = searchTerm
    ? `Nothing matches “${searchTerm}” in ${scopeCopy}`
    : statusFilter === "unresolved"
      ? "New and regressed issues appear here"
      : statusFilter === "resolved"
        ? "Resolved issues appear here"
        : "Send an event through your DSN and it will appear here";

  return (
    <div className="screen-stack">
      <ScreenIntro
        eyebrow="ERROR MONITORING"
        title="Issues"
        subtitle="Errors captured from your applications, grouped into issues by fingerprint (newest first)."
      />
      <div className="toolbar">
        <div className="toolbar-search">
          <Icon name="search" size={15} />
          <input
            className="toolbar-input"
            type="text"
            placeholder="Search by issue title or fingerprint..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {STATUS_FILTERS.map((filter) => (
          <div
            key={filter.id}
            className={`filter-chip clickable ${statusFilter === filter.id ? "active" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => setFilter(filter.id)}
            onKeyDown={(event) => event.key === "Enter" && setFilter(filter.id)}
          >
            {filter.label}
          </div>
        ))}
        <div className="filter-chip">
          {application
            ? `App: ${application.name}`
            : project
              ? `Project: ${project.name}`
              : "All projects"}
        </div>
        {health && <div className="filter-chip">{health.eventsStored} stored</div>}
      </div>
      <article className="panel data-panel">
        <div className="data-head">
          <span>Issue</span>
          <span>Events</span>
          <span>Status</span>
          <span>Last seen</span>
        </div>
        {issues.map((issue) => (
          <div
            className={`data-row ${issue.latestEventId ? "clickable" : ""}`}
            key={issue.id}
            role="button"
            tabIndex={0}
            onClick={() => {
              if (issue.latestEventId) navigate(`/issues/${issue.latestEventId}`);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && issue.latestEventId) {
                navigate(`/issues/${issue.latestEventId}`);
              }
            }}
          >
            <div className="issue-main">
              <div className="issue-title">
                <span>{issue.id.slice(0, 6).toUpperCase()}</span>
                {issue.title}
              </div>
              <div className="issue-meta issue-meta-truncate" title={issue.fingerprint}>
                {issue.fingerprint}
              </div>
            </div>
            <strong>{issue.eventCount}</strong>
            <div className="issue-status">
              <span className={`table-status ${issue.status === "resolved" ? "draft" : ""}`}>
                <i></i>
                {issue.status}
              </span>
              <span
                className={`row-action ${busyId === issue.id ? "is-busy" : ""}`}
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  void toggleStatus(issue);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.stopPropagation();
                    void toggleStatus(issue);
                  }
                }}
              >
                {busyId === issue.id
                  ? "Saving…"
                  : issue.status === "resolved"
                    ? "Reopen"
                    : "Resolve"}
              </span>
            </div>
            <span>{relativeTime(issue.lastSeen)}</span>
          </div>
        ))}
        {status !== "ready" && (
          <div className="data-row">
            <div className="issue-main">
              <div className="issue-title">
                <span>—</span>
                {status === "loading" ? "Loading issues…" : "Could not load issues"}
              </div>
              <div className="issue-meta">
                {status === "loading"
                  ? "Fetching issues from the backend"
                  : "Check the backend connection and try again"}
              </div>
            </div>
            <strong>—</strong>
            <span>—</span>
            <span>—</span>
          </div>
        )}
        {status === "ready" && issues.length === 0 && (
          <div className="data-row">
            <div className="issue-main">
              <div className="issue-title">
                <span>—</span>
                {emptyTitle}
              </div>
              <div className="issue-meta">{emptyMeta}</div>
            </div>
            <strong>0</strong>
            <span>—</span>
            <span>—</span>
          </div>
        )}
        {status === "ready" && total > 0 && (
          <div className="pagination">
            <span>
              Page {currentPage} of {totalPages} · {total} issue{total === 1 ? "" : "s"}
              {searchTerm ? ` matching “${searchTerm}”` : ""}
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
