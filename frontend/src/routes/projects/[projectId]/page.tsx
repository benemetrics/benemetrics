import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Bell, Code2, Copy, Plus } from "lucide-react";
import { compact } from "../../../lib/data";
import { Crumbs, Pill, Stat, Btn } from "../../../components/ui-kit";
import { AppForm, ChannelForm } from "../../../components/create-forms";
import { useProjectFlagCount } from "../../../hooks/use-flags";
import { LoadingScreen } from "../../../components/loading-screen";
import { NotFoundPage } from "../../../components/not-found";
import { ChannelIcon } from "../../../components/channel-icon";
import { useChannels, useProject } from "../../../hooks/use-projects";
import { appDsn } from "../../../lib/api";

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return null;
  return <ProjectDetail projectId={projectId} />;
}

function ProjectDetail({ projectId }: { projectId: string }) {
  const { detail, notFound } = useProject(projectId);
  const { channels, reload: reloadChannels } = useChannels(projectId);
  const flagCount = useProjectFlagCount(projectId);
  const navigate = useNavigate();
  const [creatingApp, setCreatingApp] = useState(false);
  const [addingChannel, setAddingChannel] = useState(false);

  useEffect(() => {
    document.title = `${detail?.name ?? "Project"} — Glitchlog`;
  }, [detail]);

  if (notFound) return <NotFoundPage />;
  if (!detail) return <LoadingScreen />;
  const p = detail;

  const open = p.apps.reduce((s, a) => s + (a.unresolvedCount ?? 0), 0);
  const anyOpenExceeded = p.apps.some((a) => a.unresolvedCount === null);

  return (
    <div className="space-y-6">
      <div>
        <Crumbs items={[{ label: "projects", to: "/" }, { label: p.slug }]} />
        <h1 className="mt-3 text-3xl font-bold tracking-tight">{p.name}</h1>
        <p className="text-sm text-muted-foreground">{p.description}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Apps" value={p.apps.length} />
        <Link
          to={`/projects/${projectId}/flags`}
          className="panel panel-hover block"
        >
          <Stat label="Feature flags →" value={flagCount ?? "…"} />
        </Link>
        <Stat
          label="Open issues"
          value={anyOpenExceeded ? `${open}+` : open}
          hint={
            anyOpenExceeded
              ? "counts capped at the first 100 per app"
              : undefined
          }
        />
        <Stat
          label="Events in open issues"
          value={compact(p.apps.reduce((s, a) => s + a.events, 0))}
        />
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Apps
          </h2>
          <Btn variant="primary" onClick={() => setCreatingApp((v) => !v)}>
            <Plus className="h-4 w-4" />
            New app
          </Btn>
        </div>
        {creatingApp && (
          <div className="mb-3">
            <AppForm
              projectId={p.id}
              projectName={p.name}
              onCancel={() => setCreatingApp(false)}
              onDone={(a) => navigate(`/projects/${p.id}/apps/${a.id}`)}
            />
          </div>
        )}
        {p.apps.length === 0 && !creatingApp ? (
          <div className="panel p-6 text-center font-mono text-sm text-muted-foreground">
            No apps yet — create one to get a DSN.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            {p.apps.map((a) => (
              <AppCard
                key={a.id}
                projectId={p.id}
                appId={a.id}
                name={a.name}
                platform={a.platform}
                number={a.number}
                publicKey={a.publicKey}
                unresolvedCount={a.unresolvedCount}
                events={a.events}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
            <Bell className="h-3.5 w-3.5" /> Alert channels
          </h2>
          <Btn onClick={() => setAddingChannel((v) => !v)}>
            <Plus className="h-4 w-4" />
            Add
          </Btn>
        </div>
        {addingChannel && (
          <div className="mb-3">
            <ChannelForm
              projectId={p.id}
              onCancel={() => setAddingChannel(false)}
              onDone={() => {
                setAddingChannel(false);
                reloadChannels();
              }}
            />
          </div>
        )}
        <div className="panel divide-y">
          {(channels ?? []).map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-3 p-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <ChannelIcon type={c.type as never} />
                <div className="min-w-0">
                  <div className="text-sm font-medium">{c.name}</div>
                  <div className="truncate font-mono text-xs text-muted-foreground">
                    {c.type}
                  </div>
                </div>
              </div>
            </div>
          ))}
          {!channels?.length && (
            <div className="p-4 text-center font-mono text-sm text-muted-foreground">
              No channels yet.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function AppCard({
  projectId,
  appId,
  name,
  platform,
  number,
  publicKey,
  unresolvedCount,
  events,
}: {
  projectId: string;
  appId: string;
  name: string;
  platform: string;
  number: number;
  publicKey: string;
  unresolvedCount: number | null;
  events: number;
}) {
  const [copied, setCopied] = useState(false);
  // The DSN is composed, never stored: SDKs need the numeric project id.
  const dsn = appDsn({ publicKey, number });

  return (
    <div className="panel panel-hover block p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold">
          <Code2 className="h-4 w-4 text-primary" />
          <Link
            to={`/projects/${projectId}/apps/${appId}`}
            className="hover:text-primary"
          >
            {name}
          </Link>
        </div>
        <Pill>{platform}</Pill>
      </div>
      <div className="mt-3 flex items-end justify-between">
        <div className="space-y-1 text-xs text-muted-foreground">
          <div>
            <span className="text-destructive">
              {unresolvedCount ?? "100+"}
            </span>{" "}
            unresolved
          </div>
          <div>{compact(events)} events in open issues</div>
        </div>
        <Btn
          onClick={() => {
            navigator.clipboard?.writeText(dsn);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="flex max-w-full items-center gap-2 rounded-md bg-code px-2 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
          title="Copy DSN"
        >
          <span className="text-primary">DSN</span>
          <span className="truncate">{copied ? "copied" : dsn}</span>
          <Copy className="h-3 w-3 shrink-0" />
        </Btn>
      </div>
    </div>
  );
}
