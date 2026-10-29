import { useCallback, useEffect, useState } from "react";
import { api, PAGE_SIZE } from "../lib/api";

// Real records coming back from /api/admin/projects (projectDAO.list +
// findByIdOrThrow + appDAO.listByProject shapes).
export interface AppRecord {
  id: string;
  number: number;
  projectId: string;
  name: string;
  platform: string;
  publicKey: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  slug: string;
  description: string;
}

export interface ChannelRecord {
  id: string;
  name: string;
  type: string;
  config: string;
}

export function useProjects() {
  const [projects, setProjects] = useState<ProjectRecord[] | null>(null);
  const [error, setError] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    api.api.admin.projects
      .get({ query: { limit: PAGE_SIZE } })
      .then((res: { error?: unknown; data?: unknown; status?: number }) => {
        if (!alive) return;
        if (res.error) {
          setError((res as { status?: number }).status ?? 500);
          setProjects(null);
          return;
        }
        setProjects((res.data as { data: ProjectRecord[] }).data);
      });
    return () => {
      alive = false;
    };
  }, []);

  return { projects, error };
}

interface ProjectAppIssues {
  unresolvedCount: number | null;
  eventCount: number;
}

// Sum of open-issue event counts per app, read from the issue query protocol
// (`app:<id> is:unresolved`). `unresolvedCount === null` may mean more issues
// than one page — the UI renders "≥" instead of an invented total.
async function openIssuesForApp(appId: string): Promise<ProjectAppIssues> {
  const res = await api["api/admin/issues"].get({
    query: {
      query: `app:${appId} is:unresolved`,
      sort: "new",
      limit: PAGE_SIZE,
    },
  });
  if (res.error) return { unresolvedCount: null, eventCount: 0 };
  const issues: Array<{ eventCount: number }> = (
    res.data as { data: Array<{ eventCount: number }> }
  ).data;
  const unresolvedCount = issues.length >= PAGE_SIZE ? null : issues.length;
  return {
    unresolvedCount,
    eventCount: issues.reduce(
      (s: number, i: { eventCount: number }) => s + i.eventCount,
      0,
    ),
  };
}

export interface ProjectDetail extends ProjectRecord {
  apps: Array<AppRecord & { unresolvedCount: number | null; events: number }>;
}

export function useProject(projectId: string | undefined) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [reload, setReload] = useState(0);
  const bump = useCallback(() => setReload((r) => r + 1), []);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    setDetail(null);
    setNotFound(false);
    api["api/admin/projects"][projectId]
      .get()
      .then(async (res: { error?: unknown; data?: unknown }) => {
        if (!alive) return;
        if (res.error) {
          setNotFound(true);
          return;
        }
        const { data } = res;
        // Route-handler returns don't flow typed through this composed route
        // tree, so the read data is declared here instead of trusted implicitly.
        const project = data as ProjectRecord;
        const appList = (data as { apps: AppRecord[] }).apps;
        const apps = await Promise.all(
          appList.map(async (a) => ({
            ...a,
            ...(await openIssuesForApp(a.id)),
          })),
        );
        if (!alive) return;
        setDetail({
          ...project,
          apps: apps.map(({ unresolvedCount, eventCount, ...app }) => ({
            ...app,
            unresolvedCount,
            events: eventCount,
          })),
        });
      });
    return () => {
      alive = false;
    };
  }, [projectId, reload]);

  return { detail, notFound, reload: bump };
}

export function useChannels(projectId: string | undefined) {
  const [channels, setChannels] = useState<ChannelRecord[] | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    api["api/admin/alerting"]["channels"]
      .get({ query: { projectId, limit: PAGE_SIZE } })
      .then((res: { error?: unknown; data?: unknown }) => {
        if (!alive) return;
        setChannels(
          res.error ? [] : (res.data as { data: ChannelRecord[] }).data,
        );
      });
    return () => {
      alive = false;
    };
  }, [projectId, tick]);

  return { channels, reload };
}
