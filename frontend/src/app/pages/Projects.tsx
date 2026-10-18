import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Action } from "../Action.tsx";
import { Icon } from "../Icon.tsx";
import { ScreenIntro } from "../ScreenIntro.tsx";
import { useWorkspace } from "../WorkspaceContext.tsx";
import { api, type AppDto, type EnvironmentDto } from "../../lib/api.ts";
import { relativeTime } from "../../lib/utils.ts";
import { notify } from "../../lib/toast.ts";
import { platformSymbol } from "../../lib/platform.ts";

const PLATFORMS = ["node", "python", "go", "react-native", "nextjs", "web"];

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

export function Projects() {
  const navigate = useNavigate();
  const {
    project,
    environments,
    refreshApplications,
    refreshEnvironments,
    refreshProjects,
    selectProject,
  } = useWorkspace();
  const [apps, setApps] = useState<AppDto[]>([]);
  const [appsStatus, setAppsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [creating, setCreating] = useState(false);
  const [appName, setAppName] = useState("");
  const [appPlatform, setAppPlatform] = useState(PLATFORMS[0]!);
  const [busyApp, setBusyApp] = useState<string | null>(null);
  const [confirmAppDelete, setConfirmAppDelete] = useState<string | null>(null);

  // Project lifecycle (duplicate / delete)
  const [projectBusy, setProjectBusy] = useState(false);
  const [confirmProjectDelete, setConfirmProjectDelete] = useState(false);

  // Environment management (rename / promote default / delete)
  const [renamingEnv, setRenamingEnv] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [busyEnv, setBusyEnv] = useState<string | null>(null);
  const [confirmEnvDelete, setConfirmEnvDelete] = useState<string | null>(null);

  const projectId = project?.id;

  const loadApps = async () => {
    if (!projectId) {
      setApps([]);
      setAppsStatus("ready");
      return;
    }
    try {
      const result = await api.api.admin.projects[projectId].get();
      setApps((result?.data as { apps?: AppDto[] } | null)?.apps ?? []);
      setAppsStatus("ready");
    } catch {
      setAppsStatus("error");
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!projectId) {
        if (!cancelled) {
          setApps([]);
          setAppsStatus("ready");
        }
        return;
      }
      setAppsStatus("loading");
      try {
        const result = await api.api.admin.projects[projectId].get();
        if (!cancelled) {
          setApps((result?.data as { apps?: AppDto[] } | null)?.apps ?? []);
          setAppsStatus("ready");
        }
      } catch {
        if (!cancelled) setAppsStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const create = async () => {
    const name = appName.trim();
    if (!project || !name) return;
    try {
      const created = (await api.api.admin.projects[project.id].apps.post({ name, platform: appPlatform }))?.data;
      if (!created) {
        notify(`Could not create "${name}" — check the name and try again.`);
        return;
      }
    } catch {
      notify("Could not reach the backend while creating the application.");
      return;
    }
    setAppName("");
    setCreating(false);
    await loadApps();
    await refreshApplications();
  };

  const deleteApp = async (app: AppDto) => {
    if (busyApp) return;
    setBusyApp(app.id);
    try {
      const result = await api.api.admin.apps[app.id].delete();
      if ((result as { error?: unknown } | null)?.error) {
        notify(readErrorMessage(result) ?? `Could not delete "${app.name}"`);
        return;
      }
      setConfirmAppDelete(null);
      notify(`Application "${app.name}" deleted with its events, releases and maps`);
      await loadApps();
      await refreshApplications();
    } catch {
      notify("Could not reach the backend while deleting the application.");
    } finally {
      setBusyApp(null);
    }
  };

  const duplicateProject = async () => {
    if (!project || projectBusy) return;
    setProjectBusy(true);
    try {
      const result = await api.api.admin.projects[project.id].duplicate.post({});
      const created =
        (result?.data as { id?: string; name?: string } | null) ?? null;
      if (!created?.id) {
        notify(readErrorMessage(result) ?? "Could not duplicate this project.");
        return;
      }
      await refreshProjects();
      selectProject(created.id);
      notify(
        `Project "${created.name ?? project.name}" duplicated with its apps and environments`,
      );
    } catch {
      notify("Could not reach the backend while duplicating the project.");
    } finally {
      setProjectBusy(false);
    }
  };

  const deleteProject = async () => {
    if (!project || projectBusy) return;
    const deletedName = project.name;
    setProjectBusy(true);
    try {
      const result = await api.api.admin.projects[project.id].delete();
      if ((result as { error?: unknown } | null)?.error) {
        notify(readErrorMessage(result) ?? "Could not delete the project.");
        return;
      }
      setConfirmProjectDelete(false);
      notify(`Project "${deletedName}" deleted with its apps and environments`);
      const fresh = await refreshProjects();
      if (fresh && fresh.length > 0) {
        selectProject(fresh[0]!.id);
      } else {
        selectProject("");
      }
    } catch {
      notify("Could not reach the backend while deleting the project.");
    } finally {
      setProjectBusy(false);
    }
  };

  const startRenameEnv = (environment: EnvironmentDto) => {
    setRenamingEnv(environment.id);
    setRenameDraft(environment.name);
  };

  const saveEnvName = async (environment: EnvironmentDto) => {
    const name = renameDraft.trim();
    if (!name || busyEnv) return;
    setBusyEnv(environment.id);
    try {
      const result = await api.api.admin.environments[environment.id].patch({ name });
      if ((result as { error?: unknown } | null)?.error) {
        notify(readErrorMessage(result) ?? `Could not rename "${environment.name}"`);
        return;
      }
      await refreshEnvironments();
      setRenamingEnv(null);
      notify(`Environment renamed to "${name}"`);
    } catch {
      notify("Could not reach the backend while renaming the environment.");
    } finally {
      setBusyEnv(null);
    }
  };

  const makeDefaultEnv = async (environment: EnvironmentDto) => {
    if (busyEnv) return;
    setBusyEnv(environment.id);
    try {
      const result = await api.api.admin.environments[environment.id].patch({
        isDefault: true,
      });
      if ((result as { error?: unknown } | null)?.error) {
        notify(readErrorMessage(result) ?? `Could not promote "${environment.name}"`);
        return;
      }
      await refreshEnvironments();
      notify(`"${environment.name}" is now the default environment`);
    } catch {
      notify("Could not reach the backend while updating the environment.");
    } finally {
      setBusyEnv(null);
    }
  };

  const deleteEnvironment = async (environment: EnvironmentDto) => {
    if (busyEnv) return;
    setBusyEnv(environment.id);
    try {
      const result = await api.api.admin.environments[environment.id].delete();
      if ((result as { error?: unknown } | null)?.error) {
        notify(readErrorMessage(result) ?? `Could not delete "${environment.name}"`);
        return;
      }
      const deletedApps =
        (result?.data as { deletedApps?: number } | null)?.deletedApps ?? 0;
      setConfirmEnvDelete(null);
      notify(
        deletedApps > 0
          ? `Environment "${environment.name}" deleted with ${deletedApps} app${deletedApps === 1 ? "" : "s"} inside it`
          : `Environment "${environment.name}" deleted`,
      );
      await refreshEnvironments();
      await loadApps();
      await refreshApplications();
    } catch {
      notify("Could not reach the backend while deleting the environment.");
    } finally {
      setBusyEnv(null);
    }
  };

  const appsInEnvironment = (environmentId: string) =>
    apps.filter((app) => app.environmentId === environmentId).length;

  return (
    <div className="screen-stack">
      <ScreenIntro
        eyebrow="WORKSPACE"
        title="Projects"
        subtitle="Organize applications and keep every environment in one place."
        action={
          project ? (
            <div className="intro-actions">
              <Action variant="soft" onClick={duplicateProject}>
                {projectBusy ? "Working…" : "Duplicate"}
              </Action>
              {confirmProjectDelete ? (
                <>
                  <Action variant="soft" onClick={deleteProject}>
                    <span className="danger-text">
                      {projectBusy ? "Deleting…" : "Confirm delete"}
                    </span>
                  </Action>
                  <Action variant="soft" onClick={() => setConfirmProjectDelete(false)}>
                    Cancel
                  </Action>
                </>
              ) : (
                <Action variant="soft" onClick={() => setConfirmProjectDelete(true)}>
                  <span className="danger-text">Delete project</span>
                </Action>
              )}
            </div>
          ) : undefined
        }
      />
      <section className="project-hero">
        <div className="project-hero-icon">
          <Icon name="layers" size={22} />
        </div>
        <div className="project-hero-copy">
          <div className="project-name">{project?.name ?? "No project"}</div>
          <div className="project-meta">
            {appsStatus === "loading"
              ? "Loading applications…"
              : appsStatus === "error"
                ? "Could not load applications"
                : `${apps.length} application${apps.length === 1 ? "" : "s"} · ${environments.length} environment${
                    environments.length === 1 ? "" : "s"
                  }`}
          </div>
        </div>
      </section>
      <div className="section-label-row">
        <div>
          <strong>Applications</strong>
          <span>Services connected to this project</span>
        </div>
      </div>
      <section className="apps-grid">
        {apps.map((app) => {
          const symbol = platformSymbol(app.platform);
          const appEnvironment =
            environments.find((item) => item.id === app.environmentId)?.name ?? "—";
          return (
            <div
              className="app-card"
              role="button"
              tabIndex={0}
              key={app.id}
              onClick={() => navigate(`/setup?app=${app.id}`)}
              onKeyDown={(event) => event.key === "Enter" && navigate(`/setup?app=${app.id}`)}
            >
              <div className="app-top">
                <div className={`app-symbol ${symbol.className}`}>{symbol.label}</div>
                <div className="app-state live">
                  <span></span>Live
                </div>
              </div>
              <div className="app-name">{app.name}</div>
              <div className="app-detail">{app.platform} · application</div>
              <div className="app-metrics">
                <span>
                  <strong>{app.ingestKey.slice(0, 4)}</strong>key
                </span>
                <span>
                  <strong>{appEnvironment}</strong>env
                </span>
                <span>
                  <strong>{relativeTime(app.createdAt)}</strong>created
                </span>
              </div>
              <div className="app-card-footer">
                <span>Added {relativeTime(app.createdAt)}</span>
                <span className="row-actions">
                  {confirmAppDelete === app.id ? (
                    <>
                      <span
                        className={`row-action danger ${busyApp === app.id ? "is-busy" : ""}`}
                        role="button"
                        tabIndex={0}
                        onClick={(event) => {
                          event.stopPropagation();
                          deleteApp(app);
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter") return;
                          event.stopPropagation();
                          deleteApp(app);
                        }}
                      >
                        {busyApp === app.id ? "Deleting…" : "Confirm delete"}
                      </span>
                      <span
                        className="row-action"
                        role="button"
                        tabIndex={0}
                        onClick={(event) => {
                          event.stopPropagation();
                          setConfirmAppDelete(null);
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter") return;
                          event.stopPropagation();
                          setConfirmAppDelete(null);
                        }}
                      >
                        Cancel
                      </span>
                    </>
                  ) : (
                    <>
                      <span
                        className="row-action danger"
                        role="button"
                        tabIndex={0}
                        onClick={(event) => {
                          event.stopPropagation();
                          setConfirmAppDelete(app.id);
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter") return;
                          event.stopPropagation();
                          setConfirmAppDelete(app.id);
                        }}
                      >
                        Delete
                      </span>
                      <Icon name="chevron" size={15} />
                    </>
                  )}
                </span>
              </div>
            </div>
          );
        })}
        {creating ? (
          <div className="new-app-card" style={{ cursor: "default" }}>
            <div className="new-app-plus">+</div>
            <strong>Add application</strong>
            <span>Connect another service</span>
            <div className="create-project-inline" style={{ marginTop: 16, width: "100%" }}>
              <input
                className="inline-project-input"
                placeholder="Application name"
                value={appName}
                autoFocus
                onChange={(event) => setAppName(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && create()}
              />
              <select
                className="app-select"
                value={appPlatform}
                onChange={(event) => setAppPlatform(event.target.value)}
                style={{ height: 32, flex: "0 0 auto" }}
              >
                {PLATFORMS.map((platform) => (
                  <option key={platform} value={platform}>
                    {platform}
                  </option>
                ))}
              </select>
              <div
                className="inline-create-action"
                role="button"
                tabIndex={0}
                onClick={create}
                onKeyDown={(event) => event.key === "Enter" && create()}
              >
                Create
              </div>
            </div>
          </div>
        ) : (
          <div
            className="new-app-card"
            role="button"
            tabIndex={0}
            onClick={() => setCreating(true)}
            onKeyDown={(event) => event.key === "Enter" && setCreating(true)}
          >
            <div className="new-app-plus">+</div>
            <strong>Add application</strong>
            <span>Connect another service</span>
          </div>
        )}
      </section>
      <div className="section-label-row">
        <div>
          <strong>Environments</strong>
          <span>Shared by every application in this project — exactly one is the default</span>
        </div>
      </div>
      <article className="panel list-screen environments">
        <div className="list-screen-head">
          <strong>Environment</strong>
          <span>Slug</span>
          <span>Default</span>
          <span>Actions</span>
        </div>
        {environments.map((environment) => (
          <div className="list-screen-row" key={environment.id}>
            {renamingEnv === environment.id ? (
              <span className="env-name-edit">
                <input
                  className="field-control"
                  value={renameDraft}
                  autoFocus
                  onChange={(event) => setRenameDraft(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && saveEnvName(environment)}
                />
                <span
                  className="row-action"
                  role="button"
                  tabIndex={0}
                  onClick={() => saveEnvName(environment)}
                  onKeyDown={(event) => event.key === "Enter" && saveEnvName(environment)}
                >
                  Save
                </span>
                <span
                  className="row-action"
                  role="button"
                  tabIndex={0}
                  onClick={() => setRenamingEnv(null)}
                  onKeyDown={(event) => event.key === "Enter" && setRenamingEnv(null)}
                >
                  Cancel
                </span>
              </span>
            ) : (
              <strong>{environment.name}</strong>
            )}
            <span className="code-inline">{environment.slug}</span>
            <span className={`table-status ${environment.isDefault ? "" : "draft"}`}>
              <i></i>
              {environment.isDefault ? "Default" : "—"}
            </span>
            <span className="row-actions">
              <span
                className="row-action"
                role="button"
                tabIndex={0}
                onClick={() => startRenameEnv(environment)}
                onKeyDown={(event) => event.key === "Enter" && startRenameEnv(environment)}
              >
                Rename
              </span>
              {!environment.isDefault && (
                <span
                  className={`row-action ${busyEnv === environment.id ? "is-busy" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => makeDefaultEnv(environment)}
                  onKeyDown={(event) => event.key === "Enter" && makeDefaultEnv(environment)}
                >
                  Make default
                </span>
              )}
              {confirmEnvDelete === environment.id ? (
                <>
                  <span
                    className={`row-action danger ${busyEnv === environment.id ? "is-busy" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => deleteEnvironment(environment)}
                    onKeyDown={(event) => event.key === "Enter" && deleteEnvironment(environment)}
                  >
                    {busyEnv === environment.id
                      ? "Deleting…"
                      : appsInEnvironment(environment.id) > 0
                        ? `Confirm delete (${appsInEnvironment(environment.id)} app${
                            appsInEnvironment(environment.id) === 1 ? "" : "s"
                          })`
                        : "Confirm delete"}
                  </span>
                  <span
                    className="row-action"
                    role="button"
                    tabIndex={0}
                    onClick={() => setConfirmEnvDelete(null)}
                    onKeyDown={(event) => event.key === "Enter" && setConfirmEnvDelete(null)}
                  >
                    Cancel
                  </span>
                </>
              ) : (
                <span
                  className="row-action danger"
                  role="button"
                  tabIndex={0}
                  onClick={() => setConfirmEnvDelete(environment.id)}
                  onKeyDown={(event) =>
                    event.key === "Enter" && setConfirmEnvDelete(environment.id)
                  }
                >
                  Delete
                </span>
              )}
            </span>
          </div>
        ))}
        {environments.length === 0 && (
          <div className="list-screen-row">
            <strong>No environments</strong>
            <span>—</span>
            <span className="table-status draft">
              <i></i>—
            </span>
            <span>—</span>
          </div>
        )}
      </article>
    </div>
  );
}
