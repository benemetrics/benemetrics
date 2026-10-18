import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Action } from "../Action.tsx";
import { ScreenIntro } from "../ScreenIntro.tsx";
import { useWorkspace } from "../WorkspaceContext.tsx";
import { api } from "../../lib/api.ts";
import { notify } from "../../lib/toast.ts";

function unwrapOne<T>(response: unknown): T | null {
  if (!response || typeof response !== "object") return null;
  const candidate = response as { data?: T | null; error?: unknown };
  if (candidate.error) return null;
  return candidate.data ?? null;
}

export function NewRelease() {
  const navigate = useNavigate();
  const { applications, application } = useWorkspace();
  const [appId, setAppId] = useState(application?.id ?? applications[0]?.id ?? "");
  const [version, setVersion] = useState("");
  const [ref, setRef] = useState("");
  const [owner, setOwner] = useState("");
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<"draft" | "finalized">("finalized");
  const [creating, setCreating] = useState(false);
  const effectiveAppId = applications.some((app) => app.id === appId)
    ? appId
    : (application?.id ?? applications[0]?.id ?? "");

  const create = async () => {
    if (!effectiveAppId || !version.trim() || creating) return;
    setCreating(true);
    try {
      const created = unwrapOne<{ id: string; version: string }>(
        await api.api.admin.releases.post({
          appId: effectiveAppId,
          version: version.trim(),
          ref: ref.trim() || undefined,
          url: url.trim() || undefined,
          owner: owner.trim() || undefined,
          status,
        }),
      );
      if (!created?.id) {
        notify(`Could not create release "${version.trim()}" — check the app and version.`);
        return;
      }
      notify(`Release "${created.version}" created`);
      navigate("/releases");
    } catch {
      notify("Could not reach the backend while creating the release.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="screen-stack">
      <div
        className="back-link"
        role="button"
        tabIndex={0}
        onClick={() => navigate("/releases")}
      >
        ← Back to releases
      </div>
      <ScreenIntro
        eyebrow="DEPLOYMENTS"
        title="Create a release"
        subtitle="Connect a version to the app that shipped it; events with this release link back here."
      />
      {applications.length === 0 ? (
        <article className="panel" style={{ padding: "48px", textAlign: "center" }}>
          <div className="panel-title">No applications yet</div>
          <div className="panel-subtitle">
            Releases belong to an application. Create one first and it will be selectable here.
          </div>
          <div className="setup-actions" style={{ justifyContent: "center", marginTop: 18 }}>
            <Action variant="primary" onClick={() => navigate("/projects")}>
              Go to projects
            </Action>
          </div>
        </article>
      ) : (
        <article className="panel builder-card">
          <div className="form-grid">
            <div className="form-field">
              <span>Version</span>
              <input
                className="field-control code-value"
                placeholder="web-app@2.8.1"
                value={version}
                onChange={(event) => setVersion(event.target.value)}
              />
              <small>The version string reported by the SDK (for example app@1.2.3).</small>
            </div>
            <div className="form-field">
              <span>Application</span>
              <select
                className="field-control"
                value={effectiveAppId}
                onChange={(event) => setAppId(event.target.value)}
              >
                {applications.map((app) => (
                  <option key={app.id} value={app.id}>
                    {app.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <span>Commit / ref</span>
              <input
                className="field-control code-value"
                placeholder="main"
                value={ref}
                onChange={(event) => setRef(event.target.value)}
              />
            </div>
            <div className="form-field">
              <span>Owner</span>
              <input
                className="field-control"
                placeholder="elena@acme.io"
                value={owner}
                onChange={(event) => setOwner(event.target.value)}
              />
            </div>
            <div className="form-field">
              <span>Release URL</span>
              <input
                className="field-control code-value"
                placeholder="https://ci.example.com/releases/42"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
            </div>
            <div className="form-field">
              <span>Status</span>
              <select
                className="field-control"
                value={status}
                onChange={(event) => setStatus(event.target.value as "draft" | "finalized")}
              >
                <option value="finalized">Finalized</option>
                <option value="draft">Draft</option>
              </select>
              <small>Ingestion also auto-creates releases from the events it receives.</small>
            </div>
          </div>
          <div className="builder-actions">
            <Action variant="soft" onClick={() => navigate("/releases")}>
              Cancel
            </Action>
            <Action variant="primary" onClick={create}>
              {creating ? "Creating…" : "Create release"}
            </Action>
          </div>
        </article>
      )}
    </div>
  );
}
