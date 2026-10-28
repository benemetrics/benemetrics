import { useState } from "react";
import { useParams } from "react-router-dom";
import { FileCode2, KeyRound, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useSourceMaps, type SourceMapRecord, type SourceMapTokenRecord, type ResolvedPosition } from "../../../../../../hooks/use-source-maps";
import { Btn, Pill } from "../../../../../../components/ui-kit";
import { AppLayout } from "../../../../../../components/app-layout";
import { LoadingScreen } from "../../../../../../components/loading-screen";
import { cn } from "../../../../../../lib/utils";

const inputCls = "rounded-md border bg-code px-2 py-1.5 font-mono text-xs outline-none focus:border-primary";

export default function SourceMapsPage() {
  const { projectId, appId } = useParams<{ projectId: string; appId: string }>();
  if (!projectId || !appId) return null;
  return (
    <AppLayout>
      <SourceMapsInner projectId={projectId} appId={appId} />
    </AppLayout>
  );
}

function SourceMapsInner({ projectId, appId }: { projectId: string; appId: string }) {
  const { artifacts, tokens, loading, deleteArtifact, createToken, rotateToken, revokeToken, resolvePosition } = useSourceMaps(projectId);
  const [releaseFilter, setReleaseFilter] = useState("");
  const [addingToken, setAddingToken] = useState(false);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<ResolvedPosition | null | "error">(null);
  const [resolveInput, setResolveInput] = useState({ release: "", filename: "", line: 0, column: 0 });

  const filtered = (artifacts ?? []).filter((a) => !releaseFilter.trim() || a.release === releaseFilter.trim());

  const addToken = async (name: string, expiresAt: string) => {
    setError(null);
    try {
      const token = await createToken({ name, appId, expiresAt });
      setAddingToken(false);
      setFreshToken(token);
    } catch {
      setError("Failed to create the upload token.");
    }
  };

  const rotate = async (id: string) => {
    setError(null);
    try {
      setFreshToken(await rotateToken(id));
    } catch {
      setError("Failed to rotate the upload token.");
    }
  };

  const resolve = async () => {
    setError(null);
    setResolved(null);
    const result = await resolvePosition({
      release: resolveInput.release.trim(),
      filename: resolveInput.filename.trim(),
      line: resolveInput.line,
      column: resolveInput.column,
    });
    setResolved(result ?? "error");
  };

  if (loading) return <LoadingScreen />;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Artifacts · project</h3>
          <div className="flex items-center gap-1">
            <input placeholder="release version" value={releaseFilter} onChange={(e) => setReleaseFilter(e.target.value)} className={cn(inputCls, "w-40")} />
          </div>
        </div>
        <div className="panel divide-y">
          {filtered.map((a) => (
            <ArtifactRow key={a.id} artifact={a} onDelete={() => deleteArtifact(a.id).catch(() => setError("Failed to delete the artifact."))} />
          ))}
          {!filtered.length && <div className="p-8 text-center font-mono text-sm text-muted-foreground">No source maps — sentry-cli uploads them per release.</div>}
        </div>

        <div className="panel space-y-2 p-4">
          <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
            <Search className="h-3.5 w-3.5" /> Resolve a position
          </div>
          <div className="flex flex-wrap gap-2">
            <input placeholder="release" value={resolveInput.release} onChange={(e) => setResolveInput({ ...resolveInput, release: e.target.value })} className={inputCls} />
            <input placeholder="filename (e.g. ~/dist/app.js.map)" value={resolveInput.filename} onChange={(e) => setResolveInput({ ...resolveInput, filename: e.target.value })} className={cn(inputCls, "min-w-56 flex-1")} />
            <input type="number" placeholder="line" value={resolveInput.line || ""} onChange={(e) => setResolveInput({ ...resolveInput, line: Number(e.target.value) })} className={cn(inputCls, "w-20")} />
            <input type="number" placeholder="col" value={resolveInput.column || ""} onChange={(e) => setResolveInput({ ...resolveInput, column: Number(e.target.value) })} className={cn(inputCls, "w-20")} />
            <Btn variant="primary" onClick={resolve} disabled={!resolveInput.release.trim() || !resolveInput.filename.trim()}>Resolve</Btn>
          </div>
          {resolved === "error" && <p className="font-mono text-xs text-destructive">No matching map or the position could not be decoded.</p>}
          {resolved && resolved !== "error" && (
            <div className="space-y-1 font-mono text-xs">
              <div><span className="text-muted-foreground">→</span> <span className="text-primary">{resolved.original.source}:{resolved.original.line}:{resolved.original.column}</span></div>
              {resolved.original.preContext.map((l, i) => <div key={`pre-${i}`} className="text-muted-foreground">{l}</div>)}
              {resolved.original.contextLine && <div className="text-foreground">{resolved.original.contextLine}</div>}
              {resolved.original.postContext.map((l, i) => <div key={`post-${i}`} className="text-muted-foreground">{l}</div>)}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Upload tokens · app</h3>
          <Btn onClick={() => setAddingToken((v) => !v)}><Plus className="h-4 w-4" />New token</Btn>
        </div>
        {error && <p className="font-mono text-xs text-destructive">{error}</p>}
        {freshToken && (
          <div className="panel space-y-2 border-primary/40 p-4" style={{ boxShadow: "var(--glow)" }}>
            <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Copy the token now — it is shown once</div>
            <button
              onClick={() => navigator.clipboard?.writeText(freshToken)}
              className="w-full break-all rounded-md bg-code px-2 py-1.5 text-left font-mono text-xs hover:text-primary"
            >
              {freshToken}
            </button>
            <Btn onClick={() => setFreshToken(null)} className="px-2 py-1 text-xs">Dismiss</Btn>
          </div>
        )}
        {addingToken && (
          <TokenForm onCancel={() => setAddingToken(false)} onSubmit={addToken} />
        )}
        <div className="panel divide-y">
          {(tokens ?? []).filter((t) => t.appId === appId).map((t) => (
            <TokenRow key={t.id} token={t} onRotate={() => rotate(t.id)} onRevoke={() => revokeToken(t.id).catch(() => setError("Failed to revoke the token."))} />
          ))}
          {!(tokens ?? []).some((t) => t.appId === appId) && <div className="p-8 text-center font-mono text-sm text-muted-foreground">No upload tokens for this app.</div>}
        </div>
      </section>
    </div>
  );
}

function ArtifactRow({ artifact, onDelete }: { artifact: SourceMapRecord; onDelete: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 p-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <FileCode2 className="h-3.5 w-3.5 text-primary" />
          <span className="truncate font-mono text-sm">{artifact.filename}</span>
          {artifact.dist && <Pill>dist {artifact.dist}</Pill>}
        </div>
        <div className="mt-1 font-mono text-xs text-muted-foreground">
          release {artifact.release} · uploaded {new Date(artifact.createdAt).toLocaleDateString()}
        </div>
      </div>
      <button onClick={onDelete} className="text-muted-foreground hover:text-destructive" title="Delete artifact">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function TokenForm({ onCancel, onSubmit }: { onCancel: () => void; onSubmit: (name: string, expiresAt: string) => void }) {
  const [name, setName] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  return (
    <div className="panel space-y-3 p-4" style={{ boxShadow: "var(--glow)" }}>
      <input autoFocus placeholder="Token name (e.g. CI web)" value={name} onChange={(e) => setName(e.target.value)} className={cn(inputCls, "w-full")} />
      <input placeholder="expires at (ISO, optional)" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className={cn(inputCls, "w-full")} />
      <div className="flex justify-end gap-2">
        <Btn onClick={onCancel}>Cancel</Btn>
        <Btn variant="primary" disabled={!name.trim()} onClick={() => onSubmit(name.trim(), expiresAt)}>Create token</Btn>
      </div>
    </div>
  );
}

function TokenRow({ token, onRotate, onRevoke }: { token: SourceMapTokenRecord; onRotate: () => void; onRevoke: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 p-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <KeyRound className="h-3.5 w-3.5 text-primary" />
          <span className="text-sm font-medium">{token.name}</span>
          {token.revokedAt ? <Pill tone="destructive">revoked</Pill> : <Pill tone="primary">{token.tokenPrefix}…</Pill>}
          {token.expiresAt && <Pill>expires {new Date(token.expiresAt).toLocaleDateString()}</Pill>}
        </div>
        <div className="mt-1 font-mono text-xs text-muted-foreground">
          created {new Date(token.createdAt).toLocaleDateString()}
          {token.lastUsedAt ? ` · last used ${new Date(token.lastUsedAt).toLocaleDateString()}` : " · never used"}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {!token.revokedAt && (
          <button onClick={onRotate} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary" title="Rotate token">
            <RefreshCw className="h-3 w-3" />Rotate
          </button>
        )}
        {!token.revokedAt && (
          <button onClick={onRevoke} className="text-muted-foreground hover:text-destructive" title="Revoke token">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}