import { appDAO } from "db/dao/project";
import { alertChannelDAO } from "db/dao/alert-channels";
import { alertRuleDAO } from "db/dao/alert-rules";
import type { AlertChannel, AlertRule } from "../protocol/alerting";

export interface EffectiveAlertConfig {
  channels: AlertChannel[];
  rules: AlertRule[];
}

/**
 * The effective configuration for a scope. The scopes are global, project
 * and app; a narrower entry with the same name replaces the wider one.
 */
export async function resolveEffectiveAlertConfig(scope: {
  projectId?: string | null;
  appId?: string | null;
}): Promise<EffectiveAlertConfig> {
  let { projectId = null, appId = null } = scope;
  // An app inherits its project's scope.
  if (appId && !projectId) {
    const app = await appDAO.findById(appId);
    projectId = app?.projectId ?? null;
  }
  const [
    globalChannels,
    projectChannels,
    appChannels,
    globalRules,
    projectRules,
    appRules,
  ] = await Promise.all([
    alertChannelDAO.list(null),
    projectId ? alertChannelDAO.list({ projectId }) : Promise.resolve([]),
    appId ? alertChannelDAO.list({ appId }) : Promise.resolve([]),
    alertRuleDAO.list(null),
    projectId ? alertRuleDAO.list({ projectId }) : Promise.resolve([]),
    appId ? alertRuleDAO.list({ appId }) : Promise.resolve([]),
  ]);

  return {
    channels: mergeByName(
      mergeByName(globalChannels, projectChannels),
      appChannels,
    ),
    rules: mergeByName(mergeByName(globalRules, projectRules), appRules),
  };
}

/**
 * The rules of exactly one scope. The app scope covers the global rules
 * and the app's own; the project scope covers the project's rules (they
 * are evaluated per project, not per app).
 */
export async function resolveScopedRules(scope: {
  appId?: string | null;
  projectId?: string | null;
}): Promise<AlertRule[]> {
  const { projectId = null, appId = null } = scope;
  if (appId) {
    const [global, app] = await Promise.all([
      alertRuleDAO.list(null),
      alertRuleDAO.list({ appId }),
    ]);
    return mergeByName(global, app);
  }
  if (projectId) return alertRuleDAO.list({ projectId });
  return alertRuleDAO.list(null);
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
