import { useEffect, useState, useCallback } from "react";
import { api, PAGE_SIZE } from "../lib/api";

export interface AlertChannelRecord {
  id: string;
  name: string;
  type: string;
  config: string;
  verified: boolean;
}

export interface AlertRuleRecord {
  id: string;
  name: string;
  trigger: string;
  metric: string | null;
  operator: string | null;
  threshold: number | null;
  windowSeconds: number | null;
  cooldownSeconds: number;
  channelIds: string[];
  isEnabled: boolean;
  status: "ok" | "triggered" | "muted";
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function useAlerts(projectId: string | undefined, appId: string | undefined) {
  const [rules, setRules] = useState<AlertRuleRecord[] | null>(null);
  const [channels, setChannels] = useState<AlertChannelRecord[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!projectId || !appId) return;
    let alive = true;
    setLoading(true);
    const [rulesRes, channelsRes] = await Promise.all([
      api["api/admin/alerting"]["rules"].get({ query: { appId, limit: PAGE_SIZE } }),
      api["api/admin/alerting"]["channels"].get({ query: { projectId, limit: PAGE_SIZE } }),
    ]);
    if (!alive) return;
    if (rulesRes.error) {
      setRules(null);
    } else {
      setRules((rulesRes.data as { data: AlertRuleRecord[] }).data);
    }
    if (channelsRes.error) {
      setChannels(null);
    } else {
      setChannels((channelsRes.data as { data: AlertChannelRecord[] }).data);
    }
    setLoading(false);
  }, [projectId, appId]);

  useEffect(() => {
    load();
  }, [load]);

  const createRule = useCallback(async (draft: {
    name: string;
    metric: string;
    operator: ">" | "<";
    threshold: number;
    windowSeconds: number;
    channelIds: string[];
  }) => {
    const res = await api["api/admin/alerting"]["rules"].post({
      name: draft.name,
      trigger: "threshold",
      metric: draft.metric,
      operator: draft.operator === ">" ? "gt" : "lt",
      threshold: draft.threshold,
      windowSeconds: draft.windowSeconds,
      channelIds: draft.channelIds,
      appId,
      projectId,
      cooldownSeconds: 3600,
    });
    if (res.error) throw new Error("Failed to create rule");
    await load();
  }, [projectId, appId, load]);

  const toggleRule = useCallback(async (ruleId: string, enabled: boolean) => {
    const res = await api["api/admin/alerting"]["rules"][ruleId].patch({ isEnabled: enabled });
    if (res.error) throw new Error("Failed to toggle rule");
    await load();
  }, [load]);

  const deleteRule = useCallback(async (ruleId: string) => {
    const res = await api["api/admin/alerting"]["rules"][ruleId].delete();
    if (res.error) throw new Error("Failed to delete rule");
    await load();
  }, [load]);

  const testChannel = useCallback(async (channelId: string) => {
    const res = await api["api/admin/alerting"]["channels"][channelId].test.post();
    if (res.error) throw new Error("Failed to test channel");
    return res.data;
  }, []);

  return { rules, channels, loading, reload: load, createRule, toggleRule, deleteRule, testChannel };
}
