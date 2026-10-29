import { useCallback, useEffect, useState } from "react";
import { api, PAGE_SIZE } from "../lib/api";

// GET/PUT /api/admin/settings/events-ttl — read back from the table
// definition, so what the admin sees is what the store enforces.
export interface EventsTtl {
  table: string;
  expression: string;
  interval: { amount: number; unit: string } | null;
}

export interface PermissionRuleRecord {
  id: string;
  name: string;
  projectIds: string[];
  appPrefixes: string[];
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PermissionGrantRecord {
  id: string;
  identityId: string;
  label: string | null;
  projectIds: string[];
  appPrefixes: string[];
  isEnabled: boolean;
  canWrite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PermissionAuditRecord {
  id: string;
  actorId: string;
  target: string;
  targetId: string;
  action: string;
  before: string;
  after: string;
  createdAt: string;
}

export interface PermissionIdentityRecord {
  identityId: string;
  label: string | null;
  source: string;
}

export function useEventsTtl() {
  const [ttl, setTtl] = useState<EventsTtl | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    api["api/admin/settings"]["events-ttl"]
      .get()
      .then((res: { error?: unknown; data?: unknown }) => {
        if (!alive) return;
        if (res.error)
          setError(
            "Failed to read the event retention — the admin token is required.",
          );
        else setTtl((res.data as EventsTtl) ?? null);
      });
    return () => {
      alive = false;
    };
  }, [tick]);

  const saveTtl = useCallback(
    async (amount: number, unit: string) => {
      const res = await api["api/admin/settings"]["events-ttl"].put({
        amount,
        unit,
      });
      if (res.error) throw new Error("Failed to update the event retention");
      reload();
    },
    [reload],
  );

  return { ttl, error, saveTtl };
}

export function usePermissions() {
  const [rules, setRules] = useState<PermissionRuleRecord[] | null>(null);
  const [grants, setGrants] = useState<PermissionGrantRecord[] | null>(null);
  const [audit, setAudit] = useState<PermissionAuditRecord[] | null>(null);
  const [identities, setIdentities] = useState<
    PermissionIdentityRecord[] | null
  >(null);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      api["api/admin/permissions"].rules.get({ query: { limit: PAGE_SIZE } }),
      api["api/admin/permissions"].grants.get({ query: { limit: PAGE_SIZE } }),
      api["api/admin/permissions"].audit.get({ query: { limit: PAGE_SIZE } }),
      api["api/admin/permissions"].identities.get(),
    ]).then(([rulesRes, grantsRes, auditRes, identitiesRes]) => {
      if (!alive) return;
      // The whole surface is admin-token-only: one 403 means all of them are.
      const anyForbidden = [rulesRes, grantsRes, auditRes, identitiesRes].some(
        (r) => (r as { status?: number }).status === 403,
      );
      setForbidden(anyForbidden);
      setRules(
        rulesRes.error
          ? []
          : (rulesRes.data as { data: PermissionRuleRecord[] }).data,
      );
      setGrants(
        grantsRes.error
          ? []
          : (grantsRes.data as { data: PermissionGrantRecord[] }).data,
      );
      setAudit(
        auditRes.error
          ? []
          : (auditRes.data as { data: PermissionAuditRecord[] }).data,
      );
      setIdentities(
        identitiesRes.error
          ? []
          : (identitiesRes.data as { data: PermissionIdentityRecord[] }).data,
      );
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [tick]);

  const createRule = useCallback(
    async (draft: {
      name: string;
      projectIds: string[];
      appPrefixes: string[];
    }) => {
      const res = await api["api/admin/permissions"].rules.post({
        name: draft.name.trim(),
        projectIds: draft.projectIds,
        appPrefixes: draft.appPrefixes,
      });
      if (res.error) throw new Error("Failed to create the permission rule");
      reload();
    },
    [reload],
  );

  const toggleRule = useCallback(
    async (ruleId: string, isEnabled: boolean) => {
      const res = await api["api/admin/permissions"].rules[ruleId].patch({
        isEnabled,
      });
      if (res.error) throw new Error("Failed to update the permission rule");
      reload();
    },
    [reload],
  );

  const deleteRule = useCallback(
    async (ruleId: string) => {
      const res = await api["api/admin/permissions"].rules[ruleId].delete();
      if (res.error) throw new Error("Failed to delete the permission rule");
      reload();
    },
    [reload],
  );

  const createGrant = useCallback(
    async (draft: {
      identityId: string;
      label?: string;
      projectIds: string[];
      appPrefixes: string[];
      canWrite: boolean;
    }) => {
      const res = await api["api/admin/permissions"].grants.post({
        identityId: draft.identityId.trim(),
        label: draft.label?.trim() || undefined,
        projectIds: draft.projectIds,
        appPrefixes: draft.appPrefixes,
        canWrite: draft.canWrite,
      });
      if (res.error) throw new Error("Failed to create the permission grant");
      reload();
    },
    [reload],
  );

  const toggleGrant = useCallback(
    async (grantId: string, isEnabled: boolean) => {
      const res = await api["api/admin/permissions"].grants[grantId].patch({
        isEnabled,
      });
      if (res.error) throw new Error("Failed to update the permission grant");
      reload();
    },
    [reload],
  );

  const deleteGrant = useCallback(
    async (grantId: string) => {
      const res = await api["api/admin/permissions"].grants[grantId].delete();
      if (res.error) throw new Error("Failed to delete the permission grant");
      reload();
    },
    [reload],
  );

  return {
    rules,
    grants,
    audit,
    identities,
    forbidden,
    loading,
    createRule,
    toggleRule,
    deleteRule,
    createGrant,
    toggleGrant,
    deleteGrant,
  };
}
