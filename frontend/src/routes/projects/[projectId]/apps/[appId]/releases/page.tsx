import { useState } from "react";
import { useParams } from "react-router-dom";
import { Flag, Plus, Trash2 } from "lucide-react";
import { useReleases, type ReleaseRecord, type ReleaseSummary } from "../../../../../../hooks/use-releases";
import { Btn, Pill } from "../../../../../../components/ui-kit";
import { AppLayout } from "../../../../../../components/app-layout";
import { LoadingScreen } from "../../../../../../components/loading-screen";
import { cn } from "../../../../../../lib/utils";

const inputCls = "rounded-md border bg-code px-2 py-1.5 font-mono text-xs outline-none focus:border-primary";

export default function ReleasesPage() {
  const { projectId, appId } = useParams<{ projectId: string; appId: string }>();
  if (!projectId || !appId) return null;
  return (
    <AppLayout>
      <ReleasesInner projectId={projectId} appId={appId} />
    </AppLayout>
  );
}

function ReleasesInner({ projectId, appId }: { projectId: string; appId: string }) {
  const { releases, loading, createRelease, finalizeRelease, deleteRelease, loadSummary } = useReleases(appId);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ version: "", ref: "", url: "", owner: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<string, { state: "loading" | "error" } | { state: "ready"; data: ReleaseSummary }>>({});
  const [openSummary, setOpenSummary] = useState<string | null>(null);

  const save = async () => {
    if (!draft.version.trim()) return;
    setBusy("create");
    try {
      await createRelease(draft);
      setDraft({ version: "", ref: "", url: "", owner: "" });
      setCreating(false);
    } catch {
      // The hook surfaces failures by throwing; keep the form open.
    }
    setBusy(null);
  };

  const toggleSummary = async (releaseId: string) => {
    if (openSummary === releaseId) {
      setOpenSummary(null);
      return;
    }
    setOpenSummary(releaseId);
    if (!(releaseId in summaries)) {
      setSummaries((s) => ({ ...s, [releaseId]: { state: "loading", data: null } }));
      const summary = await loadSummary(releaseId);
      setSummaries((s) => ({ ...s, [releaseId]: summary ? { state: "ready", data: summary } : { state: "error" } }));
    }
  };

  const act = async (id: string, run: () => Promise<void>) => {
    setBusy(id);
    try {
      await run();
    } catch {
      // row stays; the next reload reflects the store
    }
    setBusy(null);
  };

  if (loading) return <LoadingScreen />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Releases</h3>
        <Btn variant="primary" onClick={() => setCreating((v) => !v)}><Plus className="h-4 w-4" />New release</Btn>
      </div>

      {creating && (
        <div className="panel space-y-3 p-4" style={{ boxShadow: "var(--glow)" }}>
          <input autoFocus placeholder="Version (e.g. 1.4.2)" value={draft.version} onChange={(e) => setDraft({ ...draft, version: e.target.value })} className={cn(inputCls, "w-full text-sm")} />
          <div className="grid gap-3 sm:grid-cols-3">
            <input placeholder="git ref" value={draft.ref} onChange={(e) => setDraft({ ...draft, ref: e.target.value })} className={inputCls} />
            <input placeholder="deploy url" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} className={inputCls} />
            <input placeholder="owner" value={draft.owner} onChange={(e) => setDraft({ ...draft, owner: e.target.value })} className={inputCls} />
          </div>
          <div className="flex justify-end gap-2">
            <Btn onClick={() => setCreating(false)}>Cancel</Btn>
            <Btn variant="primary" onClick={save} disabled={!draft.version.trim() || busy === "create"}>Create</Btn>
          </div>
        </div>
      )}

      <div className="panel divide-y">
        {(releases ?? []).map((r) => (
          <ReleaseRow
            key={r.id}
            release={r}
            busy={busy === r.id}
            summary={summaries[r.id]}
            summaryOpen={openSummary === r.id}
            onToggleSummary={() => toggleSummary(r.id)}
            onFinalize={() => act(r.id, () => finalizeRelease(r.id))}
            onDelete={() => act(r.id, () => deleteRelease(r.id))}
          />
        ))}
        {!releases?.length && <div className="p-8 text-center font-mono text-sm text-muted-foreground">No releases yet — they are auto-created when events carry a release version.</div>}
      </div>
    </div>
  );
}

function ReleaseRow({ release, busy, summary, summaryOpen, onToggleSummary, onFinalize, onDelete }: {
  release: ReleaseRecord;
  busy: boolean;
  summary: { state: "loading" | "error" } | { state: "ready"; data: ReleaseSummary } | undefined;
  summaryOpen: boolean;
  onToggleSummary: () => void;
  onFinalize: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-3">
        <button onClick={onToggleSummary} className="min-w-0 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <Flag className="h-3.5 w-3.5 text-primary" />
            <span className="font-mono font-semibold">{release.version}</span>
            <Pill tone={release.status === "finalized" ? "primary" : "warning"}>{release.status}</Pill>
          </div>
          <div className="mt-1 font-mono text-xs text-muted-foreground">
            {release.eventCount} events · {release.owner ?? "no owner"}{release.ref ? ` · ${release.ref}` : ""}
            {release.lastSeen ? ` · last seen ${new Date(release.lastSeen).toLocaleDateString()}` : ""}
          </div>
        </button>
        <div className="flex items-center gap-2">
          {release.status === "draft" && (
            <Btn onClick={onFinalize} disabled={busy} className="px-2 py-1 text-xs">Finalize</Btn>
          )}
          <button onClick={onDelete} disabled={busy} className="text-muted-foreground hover:text-destructive" title="Delete release">
            {busy ? "…" : <Trash2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {summaryOpen && (
        <div className="mt-3 rounded-md border bg-code/40 p-3">
          {(!summary || summary.state !== "ready") ? (
            <p className="font-mono text-xs text-muted-foreground">{summary?.state === "error" ? "Summary unavailable." : "Loading summary…"}</p>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <Pill>{summary.data.issueCount} issues</Pill>
                <Pill tone="warning">{summary.data.newIssueCount} new</Pill>
                <Pill tone="destructive">{summary.data.regressedIssueCount} regressed</Pill>
              </div>
              {summary.data.issues.length > 0 && (
                <div className="space-y-1 font-mono text-[11px] text-muted-foreground">
                  {summary.data.issues.map((issue) => (
                    <div key={issue.fingerprint} className="truncate">
                      <span className={issue.isNew ? "text-warning" : issue.isRegressed ? "text-destructive" : ""}>{issue.isNew ? "new" : issue.isRegressed ? "regressed" : "known"}</span>
                      {" "}{issue.fingerprint} · {issue.count} events
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}