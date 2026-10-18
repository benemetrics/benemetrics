import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Action } from "../Action.tsx";
import { ScreenIntro } from "../ScreenIntro.tsx";
import { api } from "../../lib/api.ts";
import { notify } from "../../lib/toast.ts";

interface FeatureFlagDto {
  id: string;
  key: string;
  name: string;
  type: string;
  rolloutPercentage: number;
  status: string;
  variants: Array<{ key: string; value: unknown; weight: number }>;
  segments: string[];
  experiment: {
    enabled?: boolean;
    status?: "draft" | "running" | "completed";
  } | null;
}

// Extracts a human-readable backend message from an Eden error response.
function readErrorMessage(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  const error = (response as { error?: unknown }).error;
  if (!error) return null;
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const body = error as { error?: unknown; value?: unknown; message?: unknown };
    if (typeof body.error === "string") return body.error;
    if (typeof body.value === "string") return body.value;
    if (typeof body.message === "string") return body.message;
  }
  return null;
}

export function FeatureFlags() {
  const navigate = useNavigate();
  const [flags, setFlags] = useState<FeatureFlagDto[]>([]);
  const [projectCount, setProjectCount] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await api.api.admin["feature-flags"].get();
        if (!cancelled) {
          setFlags((result?.data as { data?: FeatureFlagDto[] } | null)?.data ?? []);
          setStatus("ready");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
      try {
        const projects = await api.api.admin.projects.get();
        if (!cancelled) {
          setProjectCount((projects?.data as { data?: unknown[] } | null)?.data?.length ?? 0);
        }
      } catch {
        // keep the current count on failure
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const active = flags.filter((flag) => flag.status === "active");
  const variantTotal = flags.reduce(
    (total, flag) => total + (flag.variants?.length ?? 0),
    0,
  );

  const toggleStatus = async (flag: FeatureFlagDto) => {
    if (busy) return;
    const next = flag.status === "active" ? "paused" : "active";
    setBusy(flag.id);
    try {
      const result = await api.api.admin["feature-flags"][flag.id].status.post({ status: next });
      if (result?.error) {
        notify(`Could not update "${flag.key}"`);
        return;
      }
      setFlags((current) =>
        current.map((item) => (item.id === flag.id ? { ...item, status: next } : item)),
      );
      notify(`Flag "${flag.key}" ${next === "active" ? "activated" : "paused"}`);
    } catch {
      notify("Could not reach the backend while updating the flag.");
    } finally {
      setBusy(null);
    }
  };

  // Start/stop only move the experiment status; promote applies the
  // winning variant returned by the backend's statistical results.
  const setExperimentStatus = async (flag: FeatureFlagDto, next: "running" | "completed") => {
    if (busy) return;
    setBusy(flag.id);
    try {
      const result =
        next === "running"
          ? await api.api.admin.experiments[flag.id].start.post()
          : await api.api.admin.experiments[flag.id].stop.post();
      if ((result as { error?: unknown } | null)?.error) {
        notify(readErrorMessage(result) ?? `Could not update the experiment for "${flag.key}"`);
        return;
      }
      setFlags((current) =>
        current.map((item) =>
          item.id === flag.id
            ? {
                ...item,
                experiment: { ...(item.experiment ?? { enabled: true }), enabled: true, status: next },
              }
            : item,
        ),
      );
      notify(
        `Experiment for "${flag.key}" ${next === "running" ? "started" : "stopped"}`,
      );
    } catch {
      notify("Could not reach the backend while updating the experiment.");
    } finally {
      setBusy(null);
    }
  };

  const promoteExperiment = async (flag: FeatureFlagDto) => {
    if (busy) return;
    setBusy(flag.id);
    try {
      const result = await api.api.admin.experiments[flag.id].promote.post();
      if ((result as { error?: unknown } | null)?.error) {
        notify(readErrorMessage(result) ?? `Could not promote a winner for "${flag.key}"`);
        return;
      }
      const updated = (result?.data as FeatureFlagDto | null) ?? null;
      setFlags((current) =>
        current.map((item) =>
          item.id === flag.id ? { ...item, ...(updated ?? {}) } : item,
        ),
      );
      notify(`Winning variant promoted for "${flag.key}"`);
    } catch {
      notify("Could not reach the backend while promoting the experiment.");
    } finally {
      setBusy(null);
    }
  };

  const deleteFlag = async (flag: FeatureFlagDto) => {
    if (busy) return;
    setBusy(flag.id);
    try {
      const result = await api.api.admin["feature-flags"][flag.id].delete();
      if ((result as { error?: unknown } | null)?.error) {
        notify(readErrorMessage(result) ?? `Could not delete "${flag.key}"`);
        return;
      }
      setFlags((current) => current.filter((item) => item.id !== flag.id));
      setConfirmDelete(null);
      notify(`Flag "${flag.key}" deleted`);
    } catch {
      notify("Could not reach the backend while deleting the flag.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="screen-stack">
      <ScreenIntro
        eyebrow="FEATURE MANAGEMENT"
        title="Feature flags"
        subtitle="Flags created through the admin API show up here."
        action={
          <Action variant="primary" onClick={() => navigate("/feature-flags/new")}>
            <span className="plus">+</span>New flag
          </Action>
        }
      />
      <section className="mini-metrics">
        <div>
          <span>Active flags</span>
          <strong>{active.length}</strong>
        </div>
        <div>
          <span>Total variants</span>
          <strong>{variantTotal}</strong>
        </div>
        <div>
          <span>Projects</span>
          <strong>{projectCount}</strong>
        </div>
      </section>
      <article className="panel list-screen flags">
        <div className="list-screen-head">
          <strong>Flag</strong>
          <span>Rollout</span>
          <span>Variants</span>
          <span>Status</span>
        </div>
        {flags.map((flag) => {
          const running = flag.experiment?.status === "running";
          return (
            <div className="list-screen-row" key={flag.id}>
              <span className="flag-cell">
                <strong>{flag.key}</strong>
                <span>{flag.name}</span>
                {flag.experiment?.enabled && (
                  <span className="flag-experiment">
                    Experiment · {flag.experiment.status ?? "draft"}
                  </span>
                )}
                {flag.segments?.length > 0 && (
                  <span className="flag-audience">
                    Audience · {flag.segments.length} segment{flag.segments.length === 1 ? "" : "s"}
                  </span>
                )}
              </span>
              <span>{flag.rolloutPercentage}% rollout</span>
              <span>{flag.variants?.length ?? 0}</span>
              <span className="row-status">
                <span className={`table-status ${flag.status === "active" ? "" : "draft"}`}>
                  <i></i>
                  {flag.status.charAt(0).toUpperCase() + flag.status.slice(1)}
                </span>
                <span className="row-actions">
                  {flag.experiment?.enabled && (
                    <>
                      <span
                        className={`row-action ${busy === flag.id ? "is-busy" : ""}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => setExperimentStatus(flag, running ? "completed" : "running")}
                        onKeyDown={(event) =>
                          event.key === "Enter" &&
                          setExperimentStatus(flag, running ? "completed" : "running")
                        }
                      >
                        {running ? "Stop exp." : "Start exp."}
                      </span>
                      <span
                        className={`row-action ${busy === flag.id ? "is-busy" : ""}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => promoteExperiment(flag)}
                        onKeyDown={(event) => event.key === "Enter" && promoteExperiment(flag)}
                      >
                        Promote
                      </span>
                    </>
                  )}
                  <span
                    className={`row-action ${busy === flag.id ? "is-busy" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleStatus(flag)}
                    onKeyDown={(event) => event.key === "Enter" && toggleStatus(flag)}
                  >
                    {busy === flag.id
                      ? "Saving…"
                      : flag.status === "active"
                        ? "Pause"
                        : "Activate"}
                  </span>
                  {flag.status === "draft" &&
                    (confirmDelete === flag.id ? (
                      <>
                        <span
                          className={`row-action danger ${busy === flag.id ? "is-busy" : ""}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => deleteFlag(flag)}
                          onKeyDown={(event) => event.key === "Enter" && deleteFlag(flag)}
                        >
                          Confirm delete
                        </span>
                        <span
                          className="row-action"
                          role="button"
                          tabIndex={0}
                          onClick={() => setConfirmDelete(null)}
                          onKeyDown={(event) => event.key === "Enter" && setConfirmDelete(null)}
                        >
                          Cancel
                        </span>
                      </>
                    ) : (
                      <span
                        className="row-action"
                        role="button"
                        tabIndex={0}
                        onClick={() => setConfirmDelete(flag.id)}
                        onKeyDown={(event) => event.key === "Enter" && setConfirmDelete(flag.id)}
                      >
                        Delete
                      </span>
                    ))}
                </span>
              </span>
            </div>
          );
        })}
        {status !== "ready" && (
          <div className="list-screen-row">
            <strong>{status === "loading" ? "Loading flags…" : "Could not load flags"}</strong>
            <span>—</span>
            <span>—</span>
            <span className="table-status draft">
              <i></i>—
            </span>
          </div>
        )}
        {status === "ready" && flags.length === 0 && (
          <div className="list-screen-row">
            <strong>No flags</strong>
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
