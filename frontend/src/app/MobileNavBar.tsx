import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Icon } from "./Icon";
import { useWorkspace } from "./WorkspaceContext";
import { MOBILE_MORE_NAV, MOBILE_NAV } from "./workspace";

export function MobileNavBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAdmin } = useWorkspace();
  const [moreOpen, setMoreOpen] = useState(false);

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

  const moreActive = MOBILE_MORE_NAV.some((item) => item.path === location.pathname);

  return (
    <nav className="mobile-nav" aria-label="Mobile navigation">
      {MOBILE_NAV.filter((item) => isAdmin || !item.adminOnly).map((item) => (
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
      {moreOpen && (
        <div className="mobile-more-menu">
          {MOBILE_MORE_NAV.filter((item) => isAdmin || !item.adminOnly).map((item) => (
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
