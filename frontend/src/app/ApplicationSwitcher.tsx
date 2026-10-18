import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "./Icon.tsx";
import { useWorkspace } from "./WorkspaceContext.tsx";
import type { AppDto } from "../lib/api.ts";
import { platformSymbol } from "../lib/platform.ts";

export function ApplicationSwitcher() {
  const navigate = useNavigate();
  const { applications, application, setApplication } = useWorkspace();
  const [open, setOpen] = useState(false);
  const label = application?.name ?? "All applications";

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const select = (app: AppDto | null) => {
    setApplication(app);
    setOpen(false);
  };

  return (
    <div className="application-wrap">
      <div
        className={`application-switcher ${open ? "open" : ""}`}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => event.key === "Enter" && setOpen(!open)}
      >
        <Icon name="grid" size={14} />
        <span>{label}</span>
        <span className="caret">⌄</span>
      </div>
      {open && (
        <div className="application-menu">
          <div className="menu-label">Filter by application</div>
          <div
            className={`application-option ${application == null ? "selected" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => select(null)}
            onKeyDown={(event) => event.key === "Enter" && select(null)}
          >
            <div className="app-mini-icon all">
              <Icon name="grid" size={13} />
            </div>
            <span>All applications</span>
            {application == null && <b>✓</b>}
          </div>
          {applications.map((app) => {
            const symbol = platformSymbol(app.platform);
            return (
              <div
                key={app.id}
                className={`application-option ${application?.id === app.id ? "selected" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => select(app)}
                onKeyDown={(event) => event.key === "Enter" && select(app)}
              >
                <div className={`app-mini-icon ${symbol.className}`}>{symbol.label}</div>
                <span>{app.name}</span>
                <small>Connected</small>
                {application?.id === app.id && <b>✓</b>}
              </div>
            );
          })}
          <div className="menu-divider"></div>
          <div
            className="add-application-trigger"
            role="button"
            tabIndex={0}
            onClick={() => {
              setOpen(false);
              navigate("/projects");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                setOpen(false);
                navigate("/projects");
              }
            }}
          >
            <span>+</span>
            <div>
              <strong>Add application</strong>
              <small>Connect a service or client</small>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
