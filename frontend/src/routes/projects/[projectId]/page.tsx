import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Bell, Code2, Copy, Plus, Send, Trash2 } from "lucide-react";
import { compact } from "../../../lib/data";
import { Crumbs, Pill, Sparkline, Stat, Btn } from "../../../components/ui-kit";
import { AppForm, ChannelForm } from "../../../components/create-forms";
import { ConfirmAction } from "../../../components/confirm-action";
import { useProjectFlagCount } from "../../../hooks/use-flags";
import { LoadingScreen } from "../../../components/loading-screen";
import { NotFoundPage } from "../../../components/not-found";
import { ChannelIcon } from "../../../components/channel-icon";
import { useChannels, useProject } from "../../../hooks/use-projects";
import { appDsn, api } from "../../../lib/api";

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
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    document.title = `${detail?.name ?? "Project"} — Glitchlog`;
  }, [detail]);

  if (notFound) return <NotFoundPage />;
  if (!detail) return <LoadingScreen />;
  const p = detail;

  const open = p.apps.reduce((s, a) => s + (a.unresolvedCount ?? 0), 0);
  const anyOpenExceeded = p.apps.some((a) => a.unresolvedCount === null);
  const totalEvents24h = p.apps.reduce((s, a) => s + a.events, 0);

  return (
    <div className="space-y-6">
      <div>
        <Crumbs items={[{ label: "projects", to: "/" }, { label: p.slug }]} />
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div>
            <h1 className="min-w-0 break-words text-3xl font-bold tracking-tight">
              {p.name}
            </h1>
            <p className="text-sm text-muted-foreground">
              {p.description} · team {p.team ?? "—"}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Btn
              title="Duplicate project"
              aria-label="Duplicate project"
              onClick={async () => {
                const res = await api[
                  `api/admin/projects/${p.id}/duplicate`
                ].post({ body: { name: `${p.name} (copy)` } });
                if (!res.error) {
                  const copy = res.data as { id: string };
                  navigate(`/projects/${copy.id}`);
                }
              }}
            >
              <Copy className="h-4 w-4" />
            </Btn>
            <Btn
              variant="danger"
              title="Delete project"
              aria-label="Delete project"
              onClick={() => setDeleting(true)}
            >
              <Trash2 className="h-4 w-4" />
            </Btn>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Apps" value={p.apps.length} />
        <Stat
          label="Open issues"
          value={anyOpenExceeded ? `${open}+` : open}
          hint={
            anyOpenExceeded
              ? "counts capped at the first 100 per app"
              : undefined
          }
        />
        <Stat label="Events 24h" value={compact(totalEvents24h)} />
        <Link
          to={`/projects/${projectId}/flags`}
          className="panel panel-hover block"
        >
          <Stat label="Feature flags →" value={flagCount ?? "…"} />
        </Link>
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
                crashFree={a.crashFree}
                release={a.release}
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
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <ChannelIcon type={c.type as never} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{c.name}</div>
                  <div className="truncate font-mono text-xs text-muted-foreground">
                    {c.type}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
                {c.verified ? (
                  <Pill tone="primary">verified</Pill>
                ) : (
                  <Pill tone="warning">unverified</Pill>
                )}
                <button
                  onClick={() => {
                    // Demo test send
                  }}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                >
                  <Send className="h-3 w-3" /> Send test
                </button>
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

      <ConfirmAction
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={() => {
          // Delete project via API
          setDeleting(false);
        }}
        title={`Delete ${p.name}?`}
        description="This removes the project, all its apps, feature flags and alert channels."
        label="Delete project"
        danger
      />
    </div>
  );
}

function AppCard({
  projectId,
  appId,
  name,
  platform,
  crashFree,
  release,
  number,
  publicKey,
  unresolvedCount,
  events,
}: {
  projectId: string;
  appId: string;
  name: string;
  platform: string;
  crashFree?: number | undefined;
  release?: string | undefined;
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
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <div className="flex min-w-0 items-center gap-2 font-semibold">
          <Code2 className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate">{name}</span>
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
          {crashFree != null && (
            <div>
              crash-free <span className="text-primary">{crashFree}%</span>
            </div>
          )}
          {release && <div className="font-mono">{release}</div>}
        </div>
        <Sparkline data={[40, 55, 30, 70, 45, 60, 50, 65]} className="h-8 w-24" />
      </div>
    </div>
  );
}
