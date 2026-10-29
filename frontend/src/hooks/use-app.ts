import { useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";
import type { ProjectRecord } from "./use-projects";

export interface AppRecord {
  id: string;
  number: number;
  projectId: string;
  name: string;
  platform: string;
  publicKey: string;
}

export interface AppDetail extends ProjectRecord {
  apps: AppRecord[];
}

export function useApp(
  projectId: string | undefined,
  appId: string | undefined,
) {
  const [app, setApp] = useState<AppRecord | null>(null);
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId || !appId) return;
    let alive = true;
    setLoading(true);
    setNotFound(false);
    api["api/admin/projects"][projectId]
      .get()
      .then((res: { error?: unknown; data?: unknown }) => {
        if (!alive) return;
        if (res.error) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        const data = res.data as {
          apps: AppRecord[];
          name: string;
          slug: string;
          description: string;
        };
        const found = data.apps.find((a) => a.id === appId) ?? null;
        if (!found) {
          setNotFound(true);
        } else {
          setApp(found);
          setProject({
            id: projectId,
            name: data.name,
            slug: data.slug,
            description: data.description,
          });
        }
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [projectId, appId]);

  const reload = useCallback(() => {
    if (!projectId || !appId) return;
    let alive = true;
    setLoading(true);
    api["api/admin/projects"][projectId]
      .get()
      .then((res: { error?: unknown; data?: unknown }) => {
        if (!alive) return;
        if (res.error) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        const data = res.data as {
          apps: AppRecord[];
          name: string;
          slug: string;
          description: string;
        };
        const found = data.apps.find((a) => a.id === appId) ?? null;
        if (!found) {
          setNotFound(true);
        } else {
          setApp(found);
          setProject({
            id: projectId,
            name: data.name,
            slug: data.slug,
            description: data.description,
          });
        }
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [projectId, appId]);

  return { app, project, notFound, loading, reload };
}
