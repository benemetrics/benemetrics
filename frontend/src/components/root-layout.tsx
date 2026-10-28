import { Bug } from "lucide-react";
import { Link, Outlet } from "react-router-dom";
import { useLocation } from "react-router-dom";
import { useEffect, type ReactNode } from "react";
import { readIdTokenClaims } from "../lib/api";

// The session the gate resolved (GET /api/admin/session); declared here
// because the composed route tree does not flow through treaty's typing.
interface SessionInfo {
  id: string;
  isAdmin: boolean;
  scope: unknown;
}

// Harbor's __root.tsx shell: sticky brand header + centered content column.
// The identity comes from the session the gate resolved: provider claims for
// an OIDC login, the resolved id for the admin token.
export function RootLayout({
  children,
  session,
}: {
  children?: ReactNode;
  session?: SessionInfo | null;
}) {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  const claims = readIdTokenClaims();
  const label = claims.name ?? claims.email ?? session?.id;
  const initials = (label ?? "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part: string) => part[0]!.toUpperCase())
    .join("");

  return (
    <>
      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-6xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 font-mono text-sm font-bold">
            <Bug className="h-4 w-4 text-primary" />
            glitchlog<span className="blink text-primary">_</span>
          </Link>
          <div className="flex items-center gap-3 font-mono text-xs text-muted-foreground">
            {session?.isAdmin && (
              <Link to="/settings" className="hover:text-foreground">
                settings
              </Link>
            )}
            {claims.name && <span className="hidden md:inline">{claims.name}</span>}
            {claims.email && <span className="hidden sm:inline">{claims.email}</span>}
            {!claims.name && !claims.email && label && <span className="hidden sm:inline">{label}</span>}
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-accent-foreground">{initials}</span>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children ?? <Outlet />}</main>
    </>
  );
}
