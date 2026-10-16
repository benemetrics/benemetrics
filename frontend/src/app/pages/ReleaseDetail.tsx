import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Action } from "../Action";
import { ScreenIntro } from "../ScreenIntro";
import { useWorkspace } from "../WorkspaceContext";
import { api, type ReleaseDto, type ReleaseSummaryDto } from "../../lib/api";
import { notify } from "../../lib/toast";
import { relativeTime } from "../../lib/utils";

function unwrapOne<T>(response: unknown): T | null {
  if (!response || typeof response !== "object") return null;
  const candidate = response as { data?: T | null; error?: unknown };
  if (candidate.error) return null;
  return candidate.data ?? null;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "unknown" : date.toLocaleString();
}

/** "2d ago" style, reusing the relative-time wording without the "seen" prefix. */
function ago(iso: string): string {
  return relativeTime(iso).replace(/^seen /, "");
}

export function ReleaseDetail() {
  const navigate = useNavigate();
  const { releaseId = "" } = useParams();
  const { applications } = useWorkspace();
  const [release, setRelease] = useState<ReleaseDto | null>(null);
  const [summary, setSummary] = useState<ReleaseSummaryDto | null>(null);
  const [summaryState, setSummaryState] = useState<"loading" | "ready" | "error">("loading");
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [ref, setRef] = useState("");
  const [url, setUrl] = useState("");
  const [owner, setOwner] = useState("");
  const [saving, setSaving] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [releaseResult, summaryResult] = await Promise.all([
          api.api.admin.releases[releaseId].get(),
          api.api.admin.releases[releaseId].summary.get(),
        ]);
        const loaded = unwrapOne<ReleaseDto>(releaseResult);
        if (cancelled) return;
        if (!loaded) {
          setStatus("missing");
          return;
        }
        setRelease(loaded);
        setRef(loaded.ref ?? "");
        setUrl(loaded.url ?? "");
        setOwner(loaded.owner ?? "");
        const loadedSummary = unwrapOne<ReleaseSummaryDto>(summaryResult);
        setSummary(loadedSummary);
        setSummaryState(loadedSummary ? "ready" : "error");
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [releaseId]);

  const appName =
    applications.find((app) => app.id === release?.appId)?.name ?? release?.appId ?? "—";

  const save = async () => {
    if (!release || saving) return;
    setSaving(true);
    try {
      const result = await api.api.admin.releases[release.id].patch({
        ref: ref.trim(),
        url: url.trim(),
        owner: owner.trim(),
      });
      const updated = unwrapOne<ReleaseDto>(result);
      if (!updated) {
        notify(`Could not save "${release.version}"`);
        return;
      }
      setRelease(updated);
      notify(`Release "${release.version}" updated`);
    } catch {
      notify("Could not reach the backend while saving the release.");
    } finally {
      setSaving(false);
    }
  };

  const finalize = async () => {
    if (!release || finalizing) return;
    setFinalizing(true);
    try {
      const result = await api.api.admin.releases[release.id].finalize.post();
      const finalized = unwrapOne<ReleaseDto>(result);
      if (!finalized) {
        notify(`Could not finalize "${release.version}"`);
        return;
      }
      setRelease(finalized);
      notify(`Release "${release.version}" finalized`);
    } catch {
      notify("Could not reach the backend while finalizing the release.");
    } finally {
      setFinalizing(false);
    }
  };

  const remove = async () => {
    if (!release || deleting) return;
    setDeleting(true);
    try {
      const result = await api.api.admin.releases[release.id].delete();
      if ((result as { error?: unknown } | null)?.error) {
        notify(`Could not delete "${release.version}"`);
        return;
      }
      notify(`Release "${release.version}" deleted`);
      navigate("/releases");
    } catch {
      notify("Could not reach the backend while deleting the release.");
    } finally {
      setDeleting(false);
    }
  };

  if (status === "missing" || status === "error") {
    return (
      <div className="screen-stack">
        <div className="back-link" role="button" tabIndex={0} onClick={() => navigate("/releases")}>
          ← Back to releases
        </div>
        <article className="panel" style={{ padding: "48px", textAlign: "center" }}>
          <div className="panel-title">
            {status === "missing" ? "Release not found" : "Could not load this release"}
          </div>
          <div className="panel-subtitle">
            It may have been deleted, or the backend is unreachable.
          </div>
        </article>
      </div>
    );
  }

  return (
    <div className="screen-stack">
      <div className="back-link" role="button" tabIndex={0} onClick={() => navigate("/releases")}>
        ← Back to releases
      </div>
      <ScreenIntro
        eyebrow="RELEASE"
        title={release?.version ?? "Loading release…"}
        subtitle={`Shipped by ${appName} · first seen ${release ? ago(release.firstSeen) : "…"}`}
        action={
          release ? (
            <span className={`table-status ${release.status === "finalized" ? "" : "draft"}`}>
              <i></i>
              {release.status === "finalized" ? "Finalized" : "Draft"}
            </span>
          ) : undefined
        }
      />
      <section className="mini-metrics four">
        <div>
          <span>Events</span>
          <strong>{release?.eventCount ?? 0}</strong>
        </div>
        <div>
          <span>Issues in release</span>
          <strong>{summary ? summary.issueCount : "—"}</strong>
        </div>
        <div>
          <span>New issues</span>
          <strong>{summary ? summary.newIssueCount : "—"}</strong>
        </div>
        <div>
          <span>Regressed</span>
          <strong>{summary ? summary.regressedIssueCount : "—"}</strong>
        </div>
      </section>
      <div className="builder-layout">
        <article className="panel list-screen">
          <div className="list-screen-head">
            <strong>Issue</strong>
            <span>Events</span>
            <span>Last seen</span>
            <span>State</span>
          </div>
          {(summary?.issues ?? []).map((issue) => (
            <div className="list-screen-row" key={issue.fingerprint}>
              <strong className="code-inline" title={issue.fingerprint}>
                {issue.fingerprint.length > 34
                  ? `${issue.fingerprint.slice(0, 34)}…`
                  : issue.fingerprint}
              </strong>
              <span>{issue.count}</span>
              <span>{ago(issue.lastSeen)}</span>
              <span className={`table-status ${issue.isNew ? "" : "degraded"}`}>
                <i></i>
                {issue.isNew ? "New" : "Regressed"}
              </span>
            </div>
          ))}
          {summary && summaryState === "ready" && summary.issues.length === 0 && (
            <div className="list-screen-row">
              <strong>No issues with this release yet</strong>
              <span>—</span>
              <span>—</span>
              <span className="table-status draft">
                <i></i>—
              </span>
            </div>
          )}
          {summaryState === "loading" && (
            <div className="list-screen-row">
              <strong>Computing issue metrics…</strong>
              <span>—</span>
              <span>—</span>
              <span className="table-status draft">
                <i></i>—
              </span>
            </div>
          )}
          {summaryState === "error" && (
            <div className="list-screen-row">
              <strong>Issue metrics unavailable</strong>
              <span>—</span>
              <span>—</span>
              <span className="table-status draft">
                <i></i>—
              </span>
            </div>
          )}
        </article>
        <aside className="builder-preview screen-stack">
          <article className="panel builder-card">
            <div className="panel-title">Release details</div>
            <div className="panel-subtitle">
              Owner and links are optional metadata shown alongside the release.
            </div>
            <div className="form-grid" style={{ marginTop: 18 }}>
              <div className="form-field full">
                <span>Commit / ref</span>
                <input
                  className="field-control code-value"
                  placeholder="main"
                  value={ref}
                  onChange={(event) => setRef(event.target.value)}
                />
              </div>
              <div className="form-field full">
                <span>Release URL</span>
                <input
                  className="field-control code-value"
                  placeholder="https://ci.example.com/releases/42"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                />
              </div>
              <div className="form-field full">
                <span>Owner</span>
                <input
                  className="field-control"
                  placeholder="elena@acme.io"
                  value={owner}
                  onChange={(event) => setOwner(event.target.value)}
                />
              </div>
            </div>
            <div className="context-list" style={{ padding: 0, marginTop: 16 }}>
              <div>
                <span>First seen</span>
                <strong>{release ? formatDate(release.firstSeen) : "—"}</strong>
              </div>
              <div>
                <span>Last seen</span>
                <strong>{release ? formatDate(release.lastSeen) : "—"}</strong>
              </div>
              <div>
                <span>Latest event</span>
                <strong>{release?.latestEventId ?? "—"}</strong>
              </div>
              <div>
                <span>Created</span>
                <strong>{release ? formatDate(release.createdAt) : "—"}</strong>
              </div>
              <div>
                <span>Updated</span>
                <strong>{release ? formatDate(release.updatedAt) : "—"}</strong>
              </div>
            </div>
            <div className="builder-actions">
              <Action variant="primary" onClick={save}>
                {saving ? "Saving…" : "Save changes"}
              </Action>
            </div>
          </article>
          <article className="panel routing-defaults">
            <div>
              <strong>Release state</strong>
              <span>
                {release?.status === "finalized"
                  ? "Finalized — finalized releases keep receiving events."
                  : "Draft — finalize once the rollout is complete."}
              </span>
            </div>
            <div className="intro-actions">
              {release?.status !== "finalized" && (
                <Action variant="soft" onClick={finalize}>
                  {finalizing ? "Finalizing…" : "Finalize"}
                </Action>
              )}
              {confirmDelete ? (
                <>
                  <Action variant="soft" onClick={remove}>
                    <span className="danger-text">{deleting ? "Deleting…" : "Confirm delete"}</span>
                  </Action>
                  <Action variant="soft" onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </Action>
                </>
              ) : (
                <Action variant="soft" onClick={() => setConfirmDelete(true)}>
                  <span className="danger-text">Delete release</span>
                </Action>
              )}
            </div>
          </article>
        </aside>
      </div>
    </div>
  );
}
