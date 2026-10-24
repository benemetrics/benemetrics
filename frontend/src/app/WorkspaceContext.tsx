import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  api,
  getSession,
  listEnvironments,
  viewerProfile,
  type AdminProfileDto,
  type AppDto,
  type EnvironmentDto,
  type ProjectDto,
  type SessionDto,
} from "../lib/api";
import { notify } from "../lib/toast";
import { loadAllPages } from "../lib/cursor";

interface WorkspaceValue {
  projects: ProjectDto[];
  project: ProjectDto | null;
  selectProject: (id: string) => void;
  createProjectWithName: (name: string) => Promise<void>;
  environments: EnvironmentDto[];
  /** Selected environment, or null for "All environments". */
  environment: EnvironmentDto | null;
  setEnvironment: (environment: EnvironmentDto | null) => void;
  createEnvironmentWithName: (name: string) => Promise<void>;
  /** Re-read the environment list (after renaming or deleting one). */
  refreshEnvironments: () => Promise<void>;
  applications: AppDto[];
  /** Selected application, or null for "All applications". */
  application: AppDto | null;
  setApplication: (application: AppDto | null) => void;
  /** Re-read the application list (after creating an app on the Projects page). */
  refreshApplications: () => Promise<void>;
  /** Re-read the project list; returns null when the request fails. */
  refreshProjects: () => Promise<ProjectDto[] | null>;
  /** Locally decoded viewer identity for display; null when no token is stored. */
  adminUser: AdminProfileDto | null;
  /** The server's answer: false when the identity is scoped read-only. */
  isAdmin: boolean;
  /** The scope the server granted; null for the unrestricted admin token. */
  scope: SessionDto["scope"];
  /** True when the identity has an enabled grant but its scope is empty
   *  (explicit "read nothing"). Distinct from "no grant" which yields 401. */
  noAccess: boolean;
  query: string;
  setQuery: (value: string) => void;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

function unwrapData<T>(response: unknown): T | null {
  if (!response || typeof response !== "object") return null;
  const candidate = response as { data?: T | null; error?: unknown };
  if (candidate.error) return null;
  return candidate.data ?? null;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [environments, setEnvironments] = useState<EnvironmentDto[]>([]);
  const [environment, setEnvironment] = useState<EnvironmentDto | null>(null);
  const [applications, setApplications] = useState<AppDto[]>([]);
  const [application, setApplication] = useState<AppDto | null>(null);
  const [adminUser] = useState<AdminProfileDto | null>(() => viewerProfile());
  const [isAdmin, setIsAdmin] = useState(true);
  const [scope, setScope] = useState<SessionDto["scope"]>(null);
  const [noAccess, setNoAccess] = useState(false);
  const [query, setQuery] = useState("");

  // The server decides whether the identity is the admin or a scoped
  // read-only one; the UI never guesses it from the token.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await getSession();
        if (cancelled) return;
        setIsAdmin(session?.isAdmin ?? true);
        setScope(session?.scope ?? null);
        // An enabled grant with empty scope = explicit "read nothing".
        // Distinct from "no grant" (401). Show a dedicated screen.
        const s = session?.scope;
        setNoAccess(
          session?.isAdmin === false &&
            s != null &&
            s.environments.length === 0 &&
            s.appPrefixes.length === 0,
        );
      } catch {
        if (!cancelled) setIsAdmin(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await loadAllPages<ProjectDto>(async (cursor, limit) => {
          const payload = unwrapData<{ data?: ProjectDto[] }>(
            await api.api.admin.projects.get({
              $query: { limit, ...(cursor ? { cursor } : {}) },
            }),
          );
          return payload?.data ?? [];
        });
        if (cancelled) return;
        setProjects(list);
        if (list.length > 0) {
          setProjectId((current) => current ?? list[0]!.id);
        }
      } catch {
        // keep the empty workspace on fetch failure
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!projectId) {
      setEnvironments([]);
      setEnvironment(null);
      return;
    }
    (async () => {
      try {
        const payload = await listEnvironments(projectId);
        const list = (payload as { data?: EnvironmentDto[] } | null)?.data ?? [];
        if (cancelled) return;
        setEnvironments(list);
        // Drop a selection that no longer exists in this project.
        setEnvironment((current) =>
          current && !list.some((item) => item.id === current.id) ? null : current,
        );
      } catch {
        // keep the current environments on failure
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Applications of the current project power the topbar app switcher and
  // the app-scoped event queries. The project GET embeds them.
  useEffect(() => {
    let cancelled = false;
    if (!projectId) {
      setApplications([]);
      setApplication(null);
      return;
    }
    (async () => {
      try {
        const result = await api.api.admin.projects[projectId].get();
        const list = (result?.data as { apps?: AppDto[] } | null)?.apps ?? [];
        if (cancelled) return;
        setApplications(list);
        // Drop a selection that no longer exists in this project.
        setApplication((current) =>
          current && !list.some((item) => item.id === current.id) ? null : current,
        );
      } catch {
        // keep the current applications on failure
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const project = projects.find((item) => item.id === projectId) ?? null;

  const selectProject = useCallback((id: string) => {
    setProjectId(id);
    setEnvironment(null);
    setApplication(null);
    // The previous project's environments and apps must not leak into the new one.
    setEnvironments([]);
    setApplications([]);
  }, []);

  const refreshApplications = useCallback(async () => {
    if (!projectId) return;
    try {
      const result = await api.api.admin.projects[projectId].get();
      const list = (result?.data as { apps?: AppDto[] } | null)?.apps ?? [];
      setApplications(list);
    } catch {
      // keep the current applications on failure
    }
  }, [projectId]);

  const refreshEnvironments = useCallback(async () => {
    if (!projectId) {
      setEnvironments([]);
      return;
    }
    try {
      const payload = await listEnvironments(projectId);
      const list = (payload as { data?: EnvironmentDto[] } | null)?.data ?? [];
      setEnvironments(list);
      // Drop a selection that no longer exists in this project.
      setEnvironment((current) =>
        current && !list.some((item) => item.id === current.id) ? null : current,
      );
    } catch {
      // keep the current environments on failure
    }
  }, [projectId]);

  const refreshProjects = useCallback(async (): Promise<ProjectDto[] | null> => {
    try {
      const list = await loadAllPages<ProjectDto>(async (cursor, limit) => {
        const payload = unwrapData<{ data?: ProjectDto[] }>(
          await api.api.admin.projects.get({
            $query: { limit, ...(cursor ? { cursor } : {}) },
          }),
        );
        return payload?.data ?? [];
      });
      setProjects(list);
      return list;
    } catch {
      return null;
    }
  }, []);

  const createEnvironmentWithName = useCallback(
    async (name: string) => {
      if (!projectId) {
        notify("Select a project before creating an environment.");
        return;
      }
      try {
        const created = unwrapData<EnvironmentDto>(
          await api.api.admin.environments.post({ projectId, name }),
        );
        if (!created) {
          notify(`Could not create "${name}" — the name may already be taken.`);
          return;
        }
        setEnvironments((previous) => [...previous, created]);
        setEnvironment(created);
        notify(`Environment "${created.name}" created`);
      } catch {
        notify("Could not reach the backend while creating the environment.");
      }
    },
    [projectId],
  );

  const createProjectWithName = useCallback(async (name: string) => {
    try {
      const created = unwrapData<ProjectDto>(await api.api.admin.projects.post({ name }));
      if (!created) {
        notify(`Could not create "${name}" — check your admin token and try again.`);
        return;
      }
      setProjects((previous) => [...previous, created]);
      setProjectId(created.id);
      setEnvironment(null);
      notify(`Project "${created.name}" created`);
    } catch {
      notify("Could not reach the backend while creating the project.");
    }
  }, []);

  return (
    <WorkspaceContext.Provider
      value={{
        projects,
        project,
        selectProject,
        createProjectWithName,
        environments,
        environment,
        setEnvironment,
        createEnvironmentWithName,
        refreshEnvironments,
        applications,
        application,
        setApplication,
        refreshApplications,
        refreshProjects,
        adminUser,
        isAdmin,
        scope,
        noAccess,
        query,
        setQuery,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceValue {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return context;
}
