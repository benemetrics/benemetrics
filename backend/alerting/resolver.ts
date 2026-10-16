// Resolves the effective alerting configuration for an app by merging
// the global (app_id IS NULL) rows with the app-scoped rows.
//
// Override semantics: per-name. An app-scoped row whose `name` matches
// a global row replaces it; every other global row still applies.

import { alertChannelDAO } from "db/dao/alert-channels";
import { alertRuleDAO } from "db/dao/alert-rules";
import type { AlertChannel, AlertRule } from "../protocol/alerting";
import { toChannel, toRule } from "./serialize";

export interface EffectiveAlertConfig {
  channels: AlertChannel[];
  rules: AlertRule[];
}

export async function resolveEffectiveAlertConfig(
  appId: string,
): Promise<EffectiveAlertConfig> {
  const [globalChannels, appChannels, globalRules, appRules] =
    await Promise.all([
      alertChannelDAO.list(null),
      alertChannelDAO.list(appId),
      alertRuleDAO.list(null),
      alertRuleDAO.list(appId),
    ]);

  return {
    channels: mergeByName(
      globalChannels.map(toChannel),
      appChannels.map(toChannel),
    ),
    rules: mergeByName(globalRules.map(toRule), appRules.map(toRule)),
  };
}

function mergeByName<T extends { name: string }>(
  globals: T[],
  overrides: T[],
): T[] {
  const merged = new Map<string, T>();
  for (const item of globals) merged.set(item.name, item);
  for (const item of overrides) merged.set(item.name, item);
  return [...merged.values()];
}
