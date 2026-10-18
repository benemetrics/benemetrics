import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Action } from "./Action.tsx";
import { ApplicationSwitcher } from "./ApplicationSwitcher.tsx";
import { Icon } from "./Icon.tsx";
import { EnvironmentSwitcher } from "./EnvironmentSwitcher.tsx";
import { ProjectMenu } from "./ProjectSwitcher.tsx";
import { useWorkspace } from "./WorkspaceContext.tsx";
import { NAV } from "./workspace.ts";

export function Topbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { project, query, setQuery } = useWorkspace();
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K focuses the global search from anywhere.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const current =
    NAV.find((item) => location.pathname === item.path) ??
    NAV.find((item) => location.pathname.startsWith(item.path));
  const crumb = current?.label ?? "Overview";

  return (
    <header className="topbar">
      <div className="mobile-brand">
        <div className="brand-mark">
          <Icon name="activity" size={18} />
        </div>
      </div>
      <div className="mobile-project-wrap">
        <div
          className="mobile-project-trigger"
          role="button"
          tabIndex={0}
          onClick={() => setProjectMenuOpen(!projectMenuOpen)}
          onKeyDown={(event) => event.key === "Enter" && setProjectMenuOpen(!projectMenuOpen)}
        >
          <span>{project?.name ?? "No project"}</span>
          <span className="caret">⌄</span>
        </div>
        {projectMenuOpen && (
          <ProjectMenu
            className="mobile-project-menu"
            onSelect={() => setProjectMenuOpen(false)}
          />
        )}
      </div>
      <div className="breadcrumb">
        Benedebug <span>/</span> {crumb}
      </div>
      <div className="top-actions">
        <ApplicationSwitcher />
        <EnvironmentSwitcher />
        <div className="search-control">
          <Icon name="search" size={16} />
          <input
            ref={searchRef}
            className="search-input"
            type="search"
            aria-label="Search issues"
            placeholder="Search anything..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") navigate("/issues");
            }}
          />
          <span className="key">⌘ K</span>
        </div>
        <div
          className="icon-action"
          role="button"
          tabIndex={0}
          aria-label="Alerts"
          onClick={() => navigate("/alerts")}
          onKeyDown={(event) => event.key === "Enter" && navigate("/alerts")}
        >
          <Icon name="bell" />
        </div>
        <Action variant="primary" onClick={() => navigate("/alerts/new")}>
          <span className="plus">+</span> Create alert
        </Action>
      </div>
    </header>
  );
}
