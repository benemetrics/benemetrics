import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Icon } from "./Icon";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { useWorkspace } from "./WorkspaceContext";
import { NAV } from "./workspace";
import {
  api,
  getAdminToken,
  listIssues,
  setAdminToken,
} from "../lib/api";
import { POLL_INTERVAL_MS } from "../lib/utils";
import { subscribeLiveFeed } from "../lib/live-events";
import { loadAllPages } from "../lib/cursor";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return ((parts[0]![0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function AppSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { project, application, adminUser, isAdmin } = useWorkspace();
  const projectId = project?.id;
  const applicationId = application?.id;
  const [issueCount, setIssueCount] = useState(0);
  const [issueCountCapped, setIssueCountCapped] = useState(false);
  const [alertCount, setAlertCount] = useState(0);
  const [healthState, setHealthState] = useState<"loading" | "ok" | "down">("loading");
  const [sessionOpen, setSessionOpen] = useState(false);
  const [tokenDraft, setTokenDraft] = useState(() => getAdminToken());

  const saveToken = () => {
    setAdminToken(tokenDraft.trim());
    window.location.reload();
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const terms = ["is:unresolved"];
        if (applicationId) terms.push(`app:${applicationId}`);
        else if (projectId) terms.push(`project:${projectId}`);
        const result = await listIssues({
          query: terms.join(" "),
          limit: 100,
        });
        const list = (result?.data as { data?: unknown[] } | null)?.data ?? [];
        if (!cancelled) {
          // No totals with cursor pagination: show what the first page
          // holds and flag a full page as "more than shown".
          setIssueCount(Math.min(list.length, 99));
          setIssueCountCapped(list.length >= 100);
        }
      } catch {
        // keep last counts on failure
      }
      try {
        const list = await loadAllPages<{ id: string; isEnabled: boolean }>(async (cursor, limit) => {
          const result = await api.api.admin.alerting.rules.get({
            $query: { limit, ...(cursor ? { cursor } : {}) },
          });
          return (result?.data as { data?: { id: string; isEnabled: boolean }[] } | null)?.data ?? [];
        });
        if (!cancelled) setAlertCount(list.filter((rule) => rule.isEnabled).length);
      } catch {
        // keep last counts on failure
      }
    };
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectId, applicationId]);

  // The health signal is the live feed's connection: one WebSocket to NATS
  // replaces the health probe.
  useEffect(() => {
    const close = subscribeLiveFeed({
      onStatus: (status) => setHealthState(status === "connected" ? "ok" : "down"),
    });
    return close;
  }, []);

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <Icon name="activity" size={20} />
        </div>
        <div className="brand-name">Benedebug</div>
      </div>

      <ProjectSwitcher />

      <nav className="nav-list" aria-label="Main navigation">
        {NAV.filter((item) => isAdmin || !item.adminOnly).map((item) => (
          <div
            key={item.path}
            className={`nav-item ${location.pathname === item.path ? "active" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => navigate(item.path)}
            onKeyDown={(event) => event.key === "Enter" && navigate(item.path)}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
            {item.label === "Issues" && (
              <span className="nav-count">{issueCountCapped ? `${issueCount}+` : issueCount}</span>
            )}
            {item.label === "Alerts" && <span className="nav-count">{alertCount}</span>}
          </div>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <a
          className="nav-item"
          href="https://docs.sentry.io/"
          target="_blank"
          rel="noreferrer"
        >
          <Icon name="book" />
          <span>Documentation</span>
        </a>
        <div
          className="user-card"
          role="button"
          tabIndex={0}
          aria-expanded={sessionOpen}
          onClick={() => setSessionOpen(!sessionOpen)}
          onKeyDown={(event) => event.key === "Enter" && setSessionOpen(!sessionOpen)}
        >
          <div className="avatar">{initials(adminUser?.name ?? "?")}</div>
          <div className="workspace-copy">
            <div className="workspace-name">{adminUser?.name ?? "Not signed in"}</div>
            <div className="workspace-plan">{adminUser?.email ?? "Set an admin token"}</div>
          </div>
          <Icon name="more" />
        </div>
        {sessionOpen && (
          <div className="session-panel">
            <div className="menu-label">Admin token</div>
            <input
              className="token-input"
              type="password"
              value={tokenDraft}
              placeholder="Bearer token"
              onChange={(event) => setTokenDraft(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && saveToken()}
            />
            <div
              className="token-save"
              role="button"
              tabIndex={0}
              onClick={saveToken}
              onKeyDown={(event) => event.key === "Enter" && saveToken()}
            >
              Save &amp; reconnect
            </div>
          </div>
        )}
        {project && (
          <div className="workspace-plan" style={{ padding: "8px 11px 0" }}>
            {!isAdmin && (
              <div className="workspace-plan" style={{ padding: "8px 11px 0" }}>
                Read-only access
              </div>
            )}
            {healthState === "down"
              ? "Live feed disconnected — retrying"
              : healthState === "loading"
                ? "Connecting to the live feed…"
                : "Live feed connected"}
          </div>
        )}
      </div>
    </aside>
  );
}
