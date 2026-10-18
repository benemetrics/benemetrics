import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Action } from "../Action.tsx";
import { ScreenIntro } from "../ScreenIntro.tsx";
import { api, type ReleaseDto } from "../../lib/api.ts";
import { relativeTime } from "../../lib/utils.ts";

export function Releases() {
  const navigate = useNavigate();
  const [releases, setReleases] = useState<ReleaseDto[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await api.api.admin.releases.get();
        if (cancelled) return;
        setReleases((result?.data as { data?: ReleaseDto[] } | null)?.data ?? []);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const finalized = releases.filter((release) => release.status === "finalized");
  const draft = releases.filter((release) => release.status !== "finalized");

  return (
    <div className="screen-stack">
      <ScreenIntro
        eyebrow="DEPLOYMENTS"
        title="Releases"
        subtitle="Releases appear here when reported by your SDK or CLI."
        action={
          <Action variant="primary" onClick={() => navigate("/releases/new")}>
            <span className="plus">+</span>Create release
          </Action>
        }
      />
      <section className="mini-metrics">
        <div>
          <span>Total</span>
          <strong>{releases.length}</strong>
        </div>
        <div>
          <span>Finalized</span>
          <strong>{finalized.length}</strong>
        </div>
        <div>
          <span>Draft</span>
          <strong>{draft.length}</strong>
        </div>
      </section>
      <article className="panel list-screen">
        <div className="list-screen-head">
          <strong>Release</strong>
          <span>Owner</span>
          <span>Last seen</span>
          <span>Status</span>
        </div>
        {releases.map((release) => (
          <div
            className="list-screen-row clickable"
            key={release.id}
            role="button"
            tabIndex={0}
            onClick={() => navigate(`/releases/${release.id}`)}
            onKeyDown={(event) =>
              event.key === "Enter" && navigate(`/releases/${release.id}`)
            }
          >
            <strong>{release.version}</strong>
            <span>{release.owner ?? "—"}</span>
            <span>{relativeTime(release.lastSeen)}</span>
            <span className={`table-status ${release.status === "finalized" ? "" : "draft"}`}>
              <i></i>
              {release.status === "finalized" ? "Healthy" : "Draft"}
            </span>
          </div>
        ))}
        {status !== "ready" && (
          <div className="list-screen-row">
            <strong>{status === "loading" ? "Loading releases…" : "Could not load releases"}</strong>
            <span>—</span>
            <span>—</span>
            <span className="table-status draft">
              <i></i>—
            </span>
          </div>
        )}
        {status === "ready" && releases.length === 0 && (
          <div className="list-screen-row">
            <strong>No releases</strong>
            <span>—</span>
            <span>—</span>
            <span className="table-status draft">
              <i></i>—
            </span>
          </div>
        )}
      </article>
    </div>
  );
}
