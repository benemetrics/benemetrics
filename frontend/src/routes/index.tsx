import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Boxes, Plus } from "lucide-react";
import { compact } from "../lib/data";
import { Crumbs, Pill, Btn } from "../components/ui-kit";
import { ProjectForm } from "../components/create-forms";
import { LoadingScreen } from "../components/loading-screen";
import { ErrorScreen } from "../components/error-screen";
import { api, PAGE_SIZE } from "../lib/api";
import { useProjects, type ProjectRecord } from "../hooks/use-projects";

export default function IndexPage() {
  useEffect(() => {
    document.title = "Projects — Glitchlog";
  }, []);
  const { projects, error } = useProjects();
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  if (!projects) return error ? <ErrorScreen status={error} /> : <LoadingScreen />;

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-xl border p-6">
        <div className="grid-bg pointer-events-none absolute inset-0 opacity-40" />
        <div className="relative flex flex-wrap items-end justify-between gap-3">
          <div>
            <Crumbs items={[{ label: "projects" }]} />
            <h1 className="mt-3 text-3xl font-bold tracking-tight">Projects</h1>
            <p className="mt-1 text-sm text-muted-foreground">Every project groups the apps that ship together.</p>
          </div>
          <Btn variant="primary" onClick={() => setCreating((v) => !v)}><Plus className="h-4 w-4" />New project</Btn>
        </div>
      </div>

      {creating && (
        <ProjectForm
          onCancel={() => setCreating(false)}
          onDone={(p) => navigate(`/projects/${p.id}`)}
        />
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {projects.map((p) => (
          <ProjectCard key={p.id} p={p} />
        ))}
      </div>
    </div>
  );
}

function ProjectCard({ p }: { p: ProjectRecord }) {
  // Apps and open-issue counts arrive with the project detail; mixing sample
  // metrics (sparkline trends, crash-free) is off until their domains are wired.
  const [detail, setDetail] = useState<{ appCount: number; open: number | null; events: number } | null>(null);

  useEffect(() => {
    let alive = true;
    api["api/admin/projects"][p.id].get().then(async (res: { error?: unknown; data?: unknown }) => {
      if (!alive) return;
      if (res.error) return;
      const appList = (res.data as { apps: Array<{ id: string }> }).apps;
      const apps = await Promise.all(
        appList.map(async (a) => {
          const issues = await api["api/admin/issues"].get({
            query: { query: `app:${a.id} is:unresolved`, limit: PAGE_SIZE },
          });
          if (issues.error) return { open: 0, events: 0 };
          const list = (issues.data as { data: Array<{ eventCount: number }> }).data;
          return {
            open: list.length >= PAGE_SIZE ? null : list.length,
            events: list.reduce((s: number, i: { eventCount: number }) => s + i.eventCount, 0),
          };
        }),
      );
      if (!alive) return;
      setDetail({
        appCount: apps.length,
        open: apps.some((a) => a.open === null) ? null : apps.reduce((s: number, a) => s + a.open!, 0),
        events: apps.reduce((s: number, a) => s + a.events, 0),
      });
    });
    return () => {
      alive = false;
    };
  }, [p.id]);

  const d = detail;
  return (
    <Link to={`/projects/${p.id}`} className="panel panel-hover group block p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Boxes className="h-4 w-4 text-primary" />
            <h2 className="text-lg font-semibold">{p.name}</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {d && <Pill>{d.appCount} apps</Pill>}
        {d?.open != null && <Pill tone="destructive">{d.open} open issues</Pill>}
        {d?.open === null && <Pill tone="destructive">{compact(d.events)}+ events in open issues</Pill>}
        {d && <Pill>{compact(d.events)} events</Pill>}
      </div>
      <div className="mt-4 flex items-end justify-between">
        {d && d.appCount === 0 && (
          <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">no apps yet</span>
        )}
      </div>
    </Link>
  );
}
