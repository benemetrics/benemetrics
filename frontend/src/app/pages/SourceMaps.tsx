import { useEffect, useState } from "react";
import { Action } from "../Action.tsx";
import { Icon } from "../Icon.tsx";
import { ScreenIntro } from "../ScreenIntro.tsx";
import { useWorkspace } from "../WorkspaceContext.tsx";
import {
  api,
  type SourceMapArtifactDto,
  type SourceMapResolveResultDto,
  type SourceMapTokenDto,
  type SourceMapTokenSecretDto,
} from "../../lib/api.ts";
import { notify } from "../../lib/toast.ts";
import { relativeTime } from "../../lib/utils.ts";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

export function SourceMaps() {
  const { project, environments, applications, application, environment } = useWorkspace();
  const projectId = project?.id;

  const [tokens, setTokens] = useState<SourceMapTokenDto[]>([]);
  const [maps, setMaps] = useState<SourceMapArtifactDto[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRotate, setConfirmRotate] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [confirmDeleteMap, setConfirmDeleteMap] = useState<string | null>(null);

  const [creatingToken, setCreatingToken] = useState(false);
  const [tokenName, setTokenName] = useState("");
  const [tokenAppId, setTokenAppId] = useState("");
  const [tokenEnvironmentId, setTokenEnvironmentId] = useState("");
  const [tokenExpires, setTokenExpires] = useState("");
  // The raw token is returned exactly once; keep it only in memory.
  const [secret, setSecret] = useState<SourceMapTokenSecretDto | null>(null);

  const [resolveRelease, setResolveRelease] = useState("");
  const [resolveFilename, setResolveFilename] = useState("");
  const [resolveLine, setResolveLine] = useState("1");
  const [resolveColumn, setResolveColumn] = useState("1");
  const [resolving, setResolving] = useState(false);
  const [resolveResult, setResolveResult] = useState<SourceMapResolveResultDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!projectId) {
      setTokens([]);
      setMaps([]);
      setStatus("ready");
      return;
    }
    (async () => {
      try {
        const [tokensResult, mapsResult] = await Promise.all([
          api.api.admin["source-map-tokens"].get({ $query: { projectId } }),
          api.api.admin["source-maps"].get({ $query: { projectId, limit: 100 } }),
        ]);
        if (cancelled) return;
        setTokens((tokensResult?.data as { data?: SourceMapTokenDto[] } | null)?.data ?? []);
        setMaps((mapsResult?.data as { data?: SourceMapArtifactDto[] } | null)?.data ?? []);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const appName = (appId: string) =>
    applications.find((app) => app.id === appId)?.name ?? appId;
  const environmentName = (environmentId: string) =>
    environments.find((item) => item.id === environmentId)?.name ?? environmentId;

  const openTokenForm = () => {
    const appId = application?.id ?? applications[0]?.id ?? "";
    setTokenName("");
    setTokenAppId(appId);
    setTokenEnvironmentId(
      application?.environmentId ?? environment?.id ?? environments[0]?.id ?? "",
    );
    setTokenExpires("");
    setCreatingToken(true);
  };

  const copySecret = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret.token);
      notify("Token copied to clipboard");
    } catch {
      notify("Could not copy automatically — select the token and copy it manually.");
    }
  };

  const createToken = async () => {
    if (!projectId || busy) return;
    if (!tokenName.trim() || !tokenAppId || !tokenEnvironmentId) {
      notify("Name the token and pick an application and environment.");
      return;
    }
    setBusy("create");
    try {
      const result = await api.api.admin["source-map-tokens"].post({
        name: tokenName.trim(),
        projectId,
        appId: tokenAppId,
        environmentId: tokenEnvironmentId,
        expiresAt: tokenExpires ? new Date(tokenExpires).toISOString() : undefined,
      });
      const created = (result?.data as SourceMapTokenSecretDto | null) ?? null;
      if (!created?.token) {
        notify(`Could not create "${tokenName.trim()}"`);
        return;
      }
      setSecret(created);
      setTokens((current) => [created, ...current]);
      setCreatingToken(false);
      notify(`Upload token "${created.name}" created — copy it now`);
    } catch {
      notify("Could not reach the backend while creating the token.");
    } finally {
      setBusy(null);
    }
  };

  const rotateToken = async (token: SourceMapTokenDto) => {
    if (busy) return;
    setBusy(token.id);
    try {
      const result = await api.api.admin["source-map-tokens"][token.id].rotate.post();
      const rotated = (result?.data as SourceMapTokenSecretDto | null) ?? null;
      if (!rotated?.token) {
        notify(`Could not rotate "${token.name}"`);
        return;
      }
      setSecret(rotated);
      setTokens((current) =>
        current.map((item) => (item.id === token.id ? rotated : item)),
      );
      setConfirmRotate(null);
      notify(`Token "${token.name}" rotated — the previous value stopped working`);
    } catch {
      notify("Could not reach the backend while rotating the token.");
    } finally {
      setBusy(null);
    }
  };

  const revokeToken = async (token: SourceMapTokenDto) => {
    if (busy) return;
    setBusy(token.id);
    try {
      const result = await api.api.admin["source-map-tokens"][token.id].delete();
      if ((result as { error?: unknown } | null)?.error) {
        notify(`Could not revoke "${token.name}"`);
        return;
      }
      const revokedAt = new Date().toISOString();
      setTokens((current) =>
        current.map((item) => (item.id === token.id ? { ...item, revokedAt } : item)),
      );
      setConfirmRevoke(null);
      notify(`Token "${token.name}" revoked`);
    } catch {
      notify("Could not reach the backend while revoking the token.");
    } finally {
      setBusy(null);
    }
  };

  const deleteMap = async (map: SourceMapArtifactDto) => {
    if (busy) return;
    setBusy(map.id);
    try {
      const result = await api.api.admin["source-maps"][map.id].delete();
      if ((result as { error?: unknown } | null)?.error) {
        notify(`Could not delete "${map.name}"`);
        return;
      }
      setMaps((current) => current.filter((item) => item.id !== map.id));
      setConfirmDeleteMap(null);
      notify(`Source map "${map.name}" deleted`);
    } catch {
      notify("Could not reach the backend while deleting the source map.");
    } finally {
      setBusy(null);
    }
  };

  const resolve = async () => {
    if (!projectId || resolving) return;
    const line = Number(resolveLine);
    const column = Number(resolveColumn);
    if (
      !resolveRelease.trim() ||
      !resolveFilename.trim() ||
      !Number.isInteger(line) ||
      !Number.isInteger(column)
    ) {
      notify("Fill in the release, file name, line and column.");
      return;
    }
    setResolving(true);
    try {
      const result = await api.api.admin["source-maps"].resolve.post({
        projectId,
        release: resolveRelease.trim(),
        filename: resolveFilename.trim(),
        line,
        column,
      });
      if ((result as { error?: unknown } | null)?.error) {
        setResolveResult(null);
        notify("No source map found for that file and release.");
        return;
      }
      setResolveResult((result?.data as SourceMapResolveResultDto | null) ?? null);
    } catch {
      notify("Could not reach the backend while resolving.");
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="screen-stack">
      <ScreenIntro
        eyebrow="DEBUG SYMBOLS"
        title="Source maps"
        subtitle="Upload tokens for sentry-cli and the maps it uploads, scoped to an app and environment."
        action={
          <Action variant="primary" onClick={openTokenForm} active={creatingToken}>
            <span className="plus">+</span>New upload token
          </Action>
        }
      />
      {!projectId && (
        <article className="panel" style={{ padding: "48px", textAlign: "center" }}>
          <div className="panel-title">No project selected</div>
          <div className="panel-subtitle">
            Upload tokens and source maps are scoped to a project. Select one first.
          </div>
        </article>
      )}
      {secret && (
        <>
          <div className="secret-banner">
            <Icon name="spark" size={16} />
            <code>{secret.token}</code>
            <span className="row-action" role="button" tabIndex={0} onClick={copySecret}>
              Copy
            </span>
            <span
              className="row-action"
              role="button"
              tabIndex={0}
              onClick={() => setSecret(null)}
            >
              Dismiss
            </span>
          </div>
          <div className="secret-note">
            Shown once — the backend stores only a hash. Use it as SENTRY_AUTH_TOKEN with{" "}
            <code>sentry-cli sourcemaps upload</code>.
          </div>
        </>
      )}
      {creatingToken && projectId && (
        <article className="panel builder-card">
          <div className="form-grid">
            <div className="form-field">
              <span>Token name</span>
              <input
                className="field-control"
                placeholder="web-app release uploads"
                value={tokenName}
                autoFocus
                onChange={(event) => setTokenName(event.target.value)}
              />
            </div>
            <div className="form-field">
              <span>Application</span>
              <select
                className="field-control"
                value={tokenAppId}
                onChange={(event) => {
                  setTokenAppId(event.target.value);
                  const app = applications.find((item) => item.id === event.target.value);
                  if (app) setTokenEnvironmentId(app.environmentId);
                }}
              >
                {applications.map((app) => (
                  <option key={app.id} value={app.id}>
                    {app.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <span>Environment</span>
              <select
                className="field-control"
                value={tokenEnvironmentId}
                onChange={(event) => setTokenEnvironmentId(event.target.value)}
              >
                {environments.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <span>Expires (optional)</span>
              <input
                className="field-control"
                type="date"
                value={tokenExpires}
                onChange={(event) => setTokenExpires(event.target.value)}
              />
              <small>Leave empty for a token without an expiry date.</small>
            </div>
          </div>
          <div className="builder-actions">
            <Action variant="soft" onClick={() => setCreatingToken(false)}>
              Cancel
            </Action>
            <Action variant="primary" onClick={createToken}>
              {busy === "create" ? "Creating…" : "Create token"}
            </Action>
          </div>
        </article>
      )}
      <div className="section-label-row">
        <div>
          <strong>Upload tokens</strong>
          <span>Used by sentry-cli to upload source maps; revoked rows keep their audit trail</span>
        </div>
      </div>
      <article className="panel list-screen tokens">
        <div className="list-screen-head">
          <strong>Token</strong>
          <span>Scope</span>
          <span>Expires</span>
          <span>Last used</span>
          <span>Status</span>
        </div>
        {tokens.map((token) => (
          <div className="list-screen-row" key={token.id}>
            <span className="flag-cell">
              <strong>{token.name}</strong>
              <span>•••{token.tokenPrefix}</span>
            </span>
            <span>
              {appName(token.appId)} · {environmentName(token.environmentId)}
            </span>
            <span>{formatDate(token.expiresAt)}</span>
            <span>{token.lastUsedAt ? relativeTime(token.lastUsedAt) : "Never"}</span>
            <span className="row-status">
              <span className={`table-status ${token.revokedAt ? "draft" : token.expiresAt && new Date(token.expiresAt) < new Date() ? "degraded" : ""}`}>
                <i></i>
                {token.revokedAt
                  ? "Revoked"
                  : token.expiresAt && new Date(token.expiresAt) < new Date()
                    ? "Expired"
                    : "Active"}
              </span>
              {!token.revokedAt && (
                <span className="row-actions">
                  {confirmRotate === token.id ? (
                    <>
                      <span
                        className={`row-action danger ${busy === token.id ? "is-busy" : ""}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => rotateToken(token)}
                        onKeyDown={(event) => event.key === "Enter" && rotateToken(token)}
                      >
                        Confirm rotate
                      </span>
                      <span
                        className="row-action"
                        role="button"
                        tabIndex={0}
                        onClick={() => setConfirmRotate(null)}
                        onKeyDown={(event) => event.key === "Enter" && setConfirmRotate(null)}
                      >
                        Cancel
                      </span>
                    </>
                  ) : (
                    <span
                      className="row-action"
                      role="button"
                      tabIndex={0}
                      onClick={() => setConfirmRotate(token.id)}
                      onKeyDown={(event) => event.key === "Enter" && setConfirmRotate(token.id)}
                    >
                      Rotate
                    </span>
                  )}
                  {confirmRevoke === token.id ? (
                    <>
                      <span
                        className={`row-action danger ${busy === token.id ? "is-busy" : ""}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => revokeToken(token)}
                        onKeyDown={(event) => event.key === "Enter" && revokeToken(token)}
                      >
                        Confirm revoke
                      </span>
                      <span
                        className="row-action"
                        role="button"
                        tabIndex={0}
                        onClick={() => setConfirmRevoke(null)}
                        onKeyDown={(event) => event.key === "Enter" && setConfirmRevoke(null)}
                      >
                        Cancel
                      </span>
                    </>
                  ) : (
                    <span
                      className="row-action danger"
                      role="button"
                      tabIndex={0}
                      onClick={() => setConfirmRevoke(token.id)}
                      onKeyDown={(event) => event.key === "Enter" && setConfirmRevoke(token.id)}
                    >
                      Revoke
                    </span>
                  )}
                </span>
              )}
            </span>
          </div>
        ))}
        {status === "ready" && tokens.length === 0 && projectId && (
          <div className="list-screen-row">
            <strong>No upload tokens</strong>
            <span>—</span>
            <span>—</span>
            <span>—</span>
            <span className="table-status draft">
              <i></i>—
            </span>
          </div>
        )}
        {status === "loading" && projectId && (
          <div className="list-screen-row">
            <strong>Loading tokens…</strong>
            <span>—</span>
            <span>—</span>
            <span>—</span>
            <span className="table-status draft">
              <i></i>—
            </span>
          </div>
        )}
        {status === "error" && projectId && (
          <div className="list-screen-row">
            <strong>Could not load tokens</strong>
            <span>—</span>
            <span>—</span>
            <span>—</span>
            <span className="table-status draft">
              <i></i>—
            </span>
          </div>
        )}
      </article>
      <div className="section-label-row">
        <div>
          <strong>Uploaded maps</strong>
          <span>Artifacts stored for this project, newest first</span>
        </div>
      </div>
      <article className="panel list-screen maps">
        <div className="list-screen-head">
          <strong>File</strong>
          <span>Release</span>
          <span>Size</span>
          <span>Uploaded</span>
          <span>Actions</span>
        </div>
        {maps.map((map) => (
          <div className="list-screen-row" key={map.id}>
            <span className="flag-cell">
              <strong className="code-inline" title={map.name}>
                {map.name}
              </strong>
              <span>
                {appName(map.appId)} · {environmentName(map.environmentId)}
                {map.dist ? ` · dist ${map.dist}` : ""}
              </span>
            </span>
            <span className="code-inline">{map.release}</span>
            <span>{formatBytes(map.size)}</span>
            <span>{relativeTime(map.createdAt).replace(/^seen /, "")}</span>
            <span>
              {confirmDeleteMap === map.id ? (
                <span className="row-actions">
                  <span
                    className={`row-action danger ${busy === map.id ? "is-busy" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => deleteMap(map)}
                    onKeyDown={(event) => event.key === "Enter" && deleteMap(map)}
                  >
                    Confirm delete
                  </span>
                  <span
                    className="row-action"
                    role="button"
                    tabIndex={0}
                    onClick={() => setConfirmDeleteMap(null)}
                    onKeyDown={(event) => event.key === "Enter" && setConfirmDeleteMap(null)}
                  >
                    Cancel
                  </span>
                </span>
              ) : (
                <span className="row-actions">
                  <span
                    className="row-action danger"
                    role="button"
                    tabIndex={0}
                    onClick={() => setConfirmDeleteMap(map.id)}
                    onKeyDown={(event) => event.key === "Enter" && setConfirmDeleteMap(map.id)}
                  >
                    Delete
                  </span>
                </span>
              )}
            </span>
          </div>
        ))}
        {status === "ready" && maps.length === 0 && projectId && (
          <div className="list-screen-row">
            <strong>No source maps uploaded</strong>
            <span>—</span>
            <span>—</span>
            <span>—</span>
            <span>—</span>
          </div>
        )}
        {status === "loading" && projectId && (
          <div className="list-screen-row">
            <strong>Loading maps…</strong>
            <span>—</span>
            <span>—</span>
            <span>—</span>
            <span>—</span>
          </div>
        )}
        {status === "error" && projectId && (
          <div className="list-screen-row">
            <strong>Could not load source maps</strong>
            <span>—</span>
            <span>—</span>
            <span>—</span>
            <span>—</span>
          </div>
        )}
      </article>
      <div className="section-label-row">
        <div>
          <strong>Resolve a position</strong>
          <span>Look up an original file, line and column from an uploaded map</span>
        </div>
      </div>
      <article className="panel builder-card">
        <div className="form-grid">
          <div className="form-field">
            <span>Release</span>
            <input
              className="field-control code-value"
              placeholder="web-app@2.8.1"
              value={resolveRelease}
              onChange={(event) => setResolveRelease(event.target.value)}
            />
          </div>
          <div className="form-field">
            <span>File name</span>
            <input
              className="field-control code-value"
              placeholder="~/static/js/main.js"
              value={resolveFilename}
              onChange={(event) => setResolveFilename(event.target.value)}
            />
          </div>
          <div className="form-field">
            <span>Line</span>
            <input
              className="field-control"
              type="number"
              min={1}
              value={resolveLine}
              onChange={(event) => setResolveLine(event.target.value)}
            />
          </div>
          <div className="form-field">
            <span>Column</span>
            <input
              className="field-control"
              type="number"
              min={0}
              value={resolveColumn}
              onChange={(event) => setResolveColumn(event.target.value)}
            />
          </div>
        </div>
        <div className="builder-actions">
          <Action variant="primary" onClick={resolve}>
            {resolving ? "Resolving…" : "Resolve position"}
          </Action>
        </div>
        {resolveResult && (
          <div style={{ marginTop: 16 }}>
            <div className="context-list" style={{ padding: 0 }}>
              <div>
                <span>File</span>
                <strong>{resolveResult.filename}</strong>
              </div>
              <div>
                <span>Release</span>
                <strong>{resolveResult.release}</strong>
              </div>
              <div>
                <span>Generated position</span>
                <strong>
                  {resolveResult.line}:{resolveResult.column}
                </strong>
              </div>
              <div>
                <span>Original position</span>
                <strong>
                  {resolveResult.original
                    ? `${resolveResult.original.source}:${resolveResult.original.line}:${resolveResult.original.column}`
                    : "No mapping found"}
                </strong>
              </div>
            </div>
            {resolveResult.original && (
              <pre className="payload-json" style={{ marginTop: 12 }}>
                {[
                  ...resolveResult.original.preContext,
                  resolveResult.original.contextLine ?? "",
                  ...resolveResult.original.postContext,
                ]
                  .filter(Boolean)
                  .join("\n") || "(no source context stored)"}
              </pre>
            )}
          </div>
        )}
      </article>
    </div>
  );
}
