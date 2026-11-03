import { Copy, RotateCcw } from "lucide-react";
import { NavLink, useParams } from "react-router-dom";
import { useState } from "react";
import type { ReactNode } from "react";
import { useApp } from "../hooks/use-app";
import { AppRecordProvider } from "../hooks/app-record-context";
import { Btn, Crumbs, Pill } from "./ui-kit";
import { LoadingScreen } from "./loading-screen";
import { NotFoundPage } from "./not-found";
import { api, appDsn } from "../lib/api";

export function AppLayout({ children }: { children: ReactNode }) {
  const { projectId, appId } = useParams<{
    projectId: string;
    appId: string;
  }>();
  if (!projectId || !appId) return null;
  const { app, project, notFound, loading, reload } = useApp(projectId, appId);
  const [rotating, setRotating] = useState(false);
  const [rotatedAt, setRotatedAt] = useState<number | null>(null);

  if (loading) return <LoadingScreen />;
  if (notFound || !app || !project) return <NotFoundPage />;

  const dsn = appDsn({ publicKey: app.publicKey, number: app.number });

  async function rotateKey() {
    setRotating(true);
    try {
      const res = await api["api/admin/apps"][appId!]["rotate-key"].post();
      if (res.error) throw new Error(String(res.error));
      await reload();
      setRotatedAt(Date.now());
      setTimeout(() => setRotatedAt(null), 2000);
    } catch (error) {
      console.error("[DSN] rotate failed:", error);
    } finally {
      setRotating(false);
    }
  }

  const tabs = [
    {
      to: `/projects/${project.id}/apps/${app.id}`,
      label: "Issues",
      end: true,
    },
    {
      to: `/projects/${project.id}/apps/${app.id}/events`,
      label: "Events",
      end: false,
    },
    {
      to: `/projects/${project.id}/apps/${app.id}/performance`,
      label: "Performance",
      end: false,
    },
    {
      to: `/projects/${project.id}/apps/${app.id}/releases`,
      label: "Releases",
      end: false,
    },
    {
      to: `/projects/${project.id}/apps/${app.id}/source-maps`,
      label: "Source maps",
      end: false,
    },
    {
      to: `/projects/${project.id}/apps/${app.id}/alerts`,
      label: "Alerts",
      end: false,
    },
    {
      to: `/projects/${project.id}/apps/${app.id}/log-setup`,
      label: "Log setup",
      end: false,
    },
  ];

  return (
    <AppRecordProvider app={app}>
      <div className="space-y-5">
        <div>
          <Crumbs
            items={[
              { label: "projects", to: "/" },
              { label: project.slug, to: `/projects/${project.id}` },
              { label: app.name },
            ]}
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{app.name}</h1>
            <Pill>{app.platform}</Pill>
          </div>
          <Btn
            onClick={() => navigator.clipboard?.writeText(dsn)}
            className="mt-2 flex max-w-full items-center gap-2 rounded-md bg-code px-2 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
            title="Copy DSN"
          >
            <span className="text-primary">DSN</span>
            <span className="truncate">{dsn}</span>
            <Copy className="h-3 w-3 shrink-0" />
          </Btn>
          <Btn
            onClick={rotateKey}
            disabled={rotating}
            className="mt-2 flex items-center gap-2 rounded-md border px-2 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
            title="Rotate DSN key — old DSNs stop working immediately"
          >
            <RotateCcw className="h-3 w-3 shrink-0" />
            {rotating ? "Rotating…" : "Rotate DSN key"}
          </Btn>
          {rotatedAt && Date.now() - rotatedAt < 2000 && (
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              Key rotated — old DSNs are invalid.
            </p>
          )}
        </div>
        <nav className="-mx-4 flex gap-1 overflow-x-auto border-b px-4">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                `whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground${isActive ? " !border-primary !text-foreground" : ""}`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
        {children}
      </div>
    </AppRecordProvider>
  );
}
