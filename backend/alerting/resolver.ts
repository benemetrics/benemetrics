import { appDAO } from "db/dao/apps";
import { ALERT_LIST_LIMIT } from "../limits";
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
    alertChannelDAO.list({ projectId: null }, { limit: ALERT_LIST_LIMIT }),
    projectId ? alertChannelDAO.list({ projectId }, { limit: ALERT_LIST_LIMIT }) : Promise.resolve([]),
    appId ? alertChannelDAO.list({ projectId: null }, { limit: ALERT_LIST_LIMIT }) : Promise.resolve([]),
    alertRuleDAO.listPaged({ appId: null, projectId: null, cursor: undefined, limit: ALERT_LIST_LIMIT }),
    projectId ? alertRuleDAO.listPaged({ appId: null, projectId, cursor: undefined, limit: ALERT_LIST_LIMIT }) : Promise.resolve([]),
    appId ? alertRuleDAO.listPaged({ appId, projectId: null, cursor: undefined, limit: ALERT_LIST_LIMIT }) : Promise.resolve([]),
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
      alertRuleDAO.listPaged({ appId: null, projectId: null, cursor: undefined, limit: ALERT_LIST_LIMIT }),
      alertRuleDAO.listPaged({ appId, projectId: null, cursor: undefined, limit: ALERT_LIST_LIMIT }),
    ]);
    return mergeByName(global, app);
  }
  if (projectId) return alertRuleDAO.listPaged({ appId: null, projectId, cursor: undefined, limit: ALERT_LIST_LIMIT });
  return alertRuleDAO.listPaged({ appId: null, projectId: null, cursor: undefined, limit: ALERT_LIST_LIMIT });
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
