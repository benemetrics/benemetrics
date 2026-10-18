import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Icon } from "./Icon.tsx";
import { MOBILE_MORE_NAV, MOBILE_NAV, READ_ONLY_NAV_PATHS } from "./workspace.ts";
import { useWorkspace } from "./WorkspaceContext.tsx";

export function MobileNavBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { adminUser } = useWorkspace();
  const [moreOpen, setMoreOpen] = useState(false);

  // Scoped (read-only OIDC) identities only see the error-triage pages.
  const readOnly = adminUser?.readOnly === true;
  const mainNav = readOnly
    ? MOBILE_NAV.filter((item) => READ_ONLY_NAV_PATHS.has(item.path))
    : MOBILE_NAV;
  const moreNav = readOnly ? [] : MOBILE_MORE_NAV;

  useEffect(() => {
    if (!moreOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [moreOpen]);

  const go = (path: string) => {
    setMoreOpen(false);
    navigate(path);
  };

  const moreActive = moreNav.some((item) => item.path === location.pathname);

  return (
    <nav className="mobile-nav" aria-label="Mobile navigation">
      {mainNav.map((item) => (
        <div
          key={item.path}
          className={location.pathname === item.path ? "active" : ""}
          role="button"
          tabIndex={0}
          onClick={() => go(item.path)}
          onKeyDown={(event) => event.key === "Enter" && go(item.path)}
        >
          <Icon name={item.icon} size={19} />
          <span>{item.label}</span>
        </div>
      ))}
      {moreNav.length > 0 && (
        <div
          className={moreActive || moreOpen ? "active" : ""}
          role="button"
          tabIndex={0}
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(!moreOpen)}
          onKeyDown={(event) => event.key === "Enter" && setMoreOpen(!moreOpen)}
        >
          <Icon name="more" size={19} />
          <span>More</span>
        </div>
      )}
      {moreOpen && moreNav.length > 0 && (
        <div className="mobile-more-menu">
          {moreNav.map((item) => (
            <div
              key={item.path}
              className={location.pathname === item.path ? "active" : ""}
              role="button"
              tabIndex={0}
              onClick={() => go(item.path)}
              onKeyDown={(event) => event.key === "Enter" && go(item.path)}
            >
              <Icon name={item.icon} size={17} />
              <span>{item.label}</span>
              {location.pathname === item.path && <b>✓</b>}
            </div>
          ))}
        </div>
      )}
    </nav>
  );
}
