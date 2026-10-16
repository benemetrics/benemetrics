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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return ((parts[0]![0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function AppSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { project, application, adminUser } = useWorkspace();
  const projectId = project?.id;
  const applicationId = application?.id;
  const [issueCount, setIssueCount] = useState(0);
  const [issueCountCapped, setIssueCountCapped] = useState(false);
  const [alertCount, setAlertCount] = useState(0);
  const [health, setHealth] = useState<{ status: string; eventsStored: number } | null>(null);
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
        const result = await listIssues({
          projectId,
          appId: applicationId,
          status: "unresolved",
          limit: 1,
        });
        const body = result?.data as {
          pagination?: { total: number };
        } | null;
        const total = body?.pagination?.total ?? 0;
        if (!cancelled) {
          setIssueCount(Math.min(total, 99));
          setIssueCountCapped(total > 99);
        }
      } catch {
        // keep last counts on failure
      }
      try {
        const rules = await api.api.admin.alerting.rules.get();
        const list = ((rules?.data as { data?: { isEnabled: boolean }[] })?.data ?? []);
        if (!cancelled) setAlertCount(list.filter((rule) => rule.isEnabled).length);
      } catch {
        // keep last counts on failure
      }
      try {
        const healthResult = await api.health.get();
        if (cancelled) return;
        if (healthResult?.data) {
          setHealth(healthResult.data);
          setHealthState("ok");
        } else {
          setHealthState("down");
        }
      } catch {
        if (!cancelled) setHealthState("down");
      }
    };
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectId, applicationId]);

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
        {NAV.map((item) => (
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
            {healthState === "down"
              ? "Backend unreachable — retrying"
              : healthState === "loading"
                ? "Checking backend…"
                : `${health?.eventsStored ?? 0} events stored`}
          </div>
        )}
      </div>
    </aside>
  );
}
