import { appDAO } from "db/dao/apps";
import { alertChannelDAO } from "db/dao/alerts/channels";
import { alertRuleDAO } from "db/dao/alerts/rules";
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
    alertChannelDAO.list({ projectId: null }, { limit: 200 }),
    projectId ? alertChannelDAO.list({ projectId }, { limit: 200 }) : Promise.resolve([]),
    appId ? alertChannelDAO.list({ projectId: null }, { limit: 200 }) : Promise.resolve([]),
    alertRuleDAO.listPaged({ appId: null, projectId: null, cursor: undefined, limit: 200 }),
    projectId ? alertRuleDAO.listPaged({ appId: null, projectId, cursor: undefined, limit: 200 }) : Promise.resolve([]),
    appId ? alertRuleDAO.listPaged({ appId, projectId: null, cursor: undefined, limit: 200 }) : Promise.resolve([]),
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
      alertRuleDAO.listPaged({ appId: null, projectId: null, cursor: undefined, limit: 200 }),
      alertRuleDAO.listPaged({ appId, projectId: null, cursor: undefined, limit: 200 }),
    ]);
    return mergeByName(global, app);
  }
  if (projectId) return alertRuleDAO.listPaged({ appId: null, projectId, cursor: undefined, limit: 200 });
  return alertRuleDAO.listPaged({ appId: null, projectId: null, cursor: undefined, limit: 200 });
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
