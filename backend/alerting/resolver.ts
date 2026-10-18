import { alertChannelDAO } from "../../db/dao/alert-channels.ts";
import { alertRuleDAO } from "../../db/dao/alert-rules.ts";
import type { AlertChannelResponse, AlertRuleResponse } from "../protocol/alerting.ts";

export async function resolveEffectiveChannels(appId: string): Promise<AlertChannelResponse[]> {
  const [global, appSpecific] = await Promise.all([
    alertChannelDAO.list({ appId: undefined }),
    alertChannelDAO.list({ appId }),
  ]);

  const byName = new Map<string, AlertChannelResponse>();
  for (const ch of global.data) byName.set(ch.name, ch);
  for (const ch of appSpecific.data) byName.set(ch.name, ch);
  return Array.from(byName.values());
}

export async function resolveEffectiveRules(appId: string): Promise<AlertRuleResponse[]> {
  const [global, appSpecific] = await Promise.all([
    alertRuleDAO.list({ appId: undefined }),
    alertRuleDAO.list({ appId }),
  ]);

  const byName = new Map<string, AlertRuleResponse>();
  for (const rule of global.data) byName.set(rule.name, rule);
  for (const rule of appSpecific.data) byName.set(rule.name, rule);
  return Array.from(byName.values());
}