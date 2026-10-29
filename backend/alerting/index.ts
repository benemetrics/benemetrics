import { Elysia } from "elysia";
import { type as arktype } from "arktype";
import { appDAO, projectDAO } from "db/dao/project";
import { alertChannelDAO } from "db/dao/alert-channels";
import { alertRuleDAO } from "db/dao/alert-rules";
import { alertIncidentDAO } from "db/dao/alert-incidents";
import { alertDeadLetterDAO } from "db/dao/alert-dead-letters";
import { alertSilenceDAO } from "db/dao/alert-silences";
import { alertRuleHistoryDAO } from "db/dao/alert-rule-history";
import { badRequest } from "../errors";
import { resolveEffectiveAlertConfig } from "./resolver";
import {
  buildChannelTestNotification,
  buildTestNotification,
  deliverAlertToChannels,
  deliverNotificationToChannel,
} from "./notifiers";
import { resolveAdminId } from "../auth";
import { readAlertingStats } from "./stats";
import { retryDeadLetters } from "./dead-letters";

const channelType =
  "'email' | 'webhook' | 'slack' | 'rocketchat' | 'pagerduty' | 'opsgenie' | 'msteams' | 'victorops'";
const optionalChannelType = `${channelType}?`;
const alertMetric =
  "'event_count' | 'error_count' | 'fatal_count' | 'new_issue_count' | 'latency_p95' | 'latency_p99'";
const optionalAlertMetric =
  "'event_count' | 'error_count' | 'fatal_count' | 'new_issue_count' | 'latency_p95' | 'latency_p99'?";
const alertOperator = "'gt' | 'lt'";
const optionalAlertOperator = "'gt' | 'lt'?";
const issueAlertTrigger = "'new_issue' | 'regression'";
// The dimensions a rule matches on: the tags an event carries.
const ruleFiltersSchema = arktype({
  tags: arktype({ "[string]": "string" }).optional(),
});
const optionalAlertTrigger = "'threshold' | 'new_issue' | 'regression'?";
// A rule as it travels between installations: the channels travel by name
// (the ids are local to an installation) and the scope travels by id.
const importedRuleSchema = arktype({
  name: "string",
  trigger: "'threshold' | 'new_issue' | 'regression'?",
  metric: "string | null?",
  operator: "string | null?",
  threshold: "number | null?",
  windowSeconds: "number | null?",
  measurement: "string | null?",
  cooldownSeconds: "number | null?",
  filters: ruleFiltersSchema.optional(),
  message: "string | null?",
  folder: "string | null?",
  appId: "string.uuid | null?",
  projectId: "string.uuid | null?",
  channels: "string[]?",
});

// The rule's change is recorded with the actor and the state after it.
async function recordRuleChange(
  rule: { id: string; name: string },
  action: "created" | "updated" | "deleted",
  actor: string,
): Promise<void> {
  try {
    await alertRuleHistoryDAO.create({
      ruleId: rule.id,
      name: rule.name,
      action,
      snapshot: JSON.stringify({ name: rule.name }),
      actor,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      "[alerting] the rule change could not be recorded:",
      error instanceof Error ? error.message : error,
    );
  }
}

// ── oidc surface: the admin reads and writes ─────────────
export const alertingRoutes = new Elysia({ prefix: "/api/admin/alerting" })
  .resolve(resolveAdminId)
  .get("/stats", () => readAlertingStats())
  .get(
    "/channels",
    async ({ query: { appId, projectId, cursor, limit } }) => {
      if (appId) await appDAO.findByIdOrThrow(appId);
      if (projectId) await projectDAO.findByIdOrThrow(projectId);
      return alertChannelDAO.listPaged({
        appId: appId ?? null,
        projectId: projectId ?? null,
        cursor,
        limit,
      });
    },
    {
      query: arktype({
        appId: "string.uuid?",
        projectId: "string.uuid?",
        cursor: "string?",
        limit: "string.integer.parse?",
      }),
    },
  )
  .post(
    "/channels",
    async ({ body, adminId }) => {
      const appId = body.appId ?? null;
      const projectId = body.projectId ?? null;
      if (appId) await appDAO.findByIdOrThrow(appId);
      if (projectId) await projectDAO.findByIdOrThrow(projectId);
      const created = await alertChannelDAO.create({
        ...body,
        config: JSON.stringify(body.config ?? {}),
        appId,
        projectId,
      });
      return created;
    },
    {
      body: arktype({
        name: "string",
        type: channelType,
        config: "object?",
        appId: "string.uuid?",
        projectId: "string.uuid?",
      }),
    },
  )
  .get(
    "/channels/:id",
    async ({ params: { id } }) => alertChannelDAO.findByIdOrThrow(id),
    { params: arktype({ id: "string.uuid" }) },
  )
  .patch(
    "/channels/:id",
    async ({ params: { id }, body }) => {
      // name/type pass through; config is the stringified JSON column
      const { config, ...passthrough } = body;
      const updated = await alertChannelDAO.updateOrThrow(id, {
        ...passthrough,
        ...(config !== undefined ? { config: JSON.stringify(config) } : {}),
      });
      return updated;
    },
    {
      params: arktype({ id: "string.uuid" }),
      body: arktype({
        name: "string?",
        type: optionalChannelType,
        config: "object?",
      }),
    },
  )
  .delete(
    "/channels/:id",
    async ({ params: { id } }) => {
      await alertChannelDAO.delete(id);
      return { success: true };
    },
    { params: arktype({ id: "string.uuid" }) },
  )

  .get(
    "/rules",
    async ({ query: { appId, projectId, cursor, limit } }) => {
      if (appId) await appDAO.findByIdOrThrow(appId);
      if (projectId) await projectDAO.findByIdOrThrow(projectId);
      return alertRuleDAO.listPaged({
        appId: appId ?? null,
        projectId: projectId ?? null,
        cursor,
        limit,
      });
    },
    {
      query: arktype({
        appId: "string.uuid?",
        projectId: "string.uuid?",
        cursor: "string?",
        limit: "string.integer.parse?",
      }),
    },
  )
  .post(
    "/rules",
    async ({ body, adminId }) => {
      const appId = body.appId ?? null;
      const projectId = body.projectId ?? null;
      if (appId) await appDAO.findByIdOrThrow(appId);
      if (projectId) await projectDAO.findByIdOrThrow(projectId);
      const base = {
        ...body,
        trigger: body.trigger ?? "threshold",
        cooldownSeconds: body.cooldownSeconds ?? 3600,
        channelIds: JSON.stringify(body.channelIds ?? []),
        appId,
        projectId,
        filters: JSON.stringify(body.filters ?? {}),
        message: body.message ?? null,
        folder: body.folder ?? null,
      };
      if (
        "metric" in body &&
        base.trigger === "threshold" &&
        body.threshold == null &&
        body.thresholdFactor == null
      ) {
        throw badRequest(
          "threshold rules require a static threshold or a thresholdFactor",
        );
      }
      const rule = await alertRuleDAO.create(
        "metric" in body
          ? {
              ...base,
              metric: body.metric,
              operator: body.operator,
              threshold: body.threshold ?? null,
              thresholdFactor: body.thresholdFactor ?? null,
              measurement: body.measurement ?? null,
            }
          : { ...base, thresholdFactor: null },
      );
      await recordRuleChange(rule, "created", adminId);
      return rule;
    },
    {
      body: arktype({
        name: "string",
        trigger: "'threshold'?",
        metric: alertMetric,
        operator: alertOperator,
        threshold: "number?",
        thresholdFactor: "number > 0?",
        windowSeconds: "number.integer > 0",
        cooldownSeconds: "number.integer >= 0?",
        channelIds: "string.uuid[]?",
        measurement: "string?",
        appId: "string.uuid?",
        projectId: "string.uuid?",
        filters: ruleFiltersSchema.optional(),
        message: "string?",
        folder: "string?",
      })
        .onUndeclaredKey("reject")
        .or(
          arktype({
            name: "string",
            trigger: issueAlertTrigger,
            cooldownSeconds: "number.integer >= 0?",
            channelIds: "string.uuid[]?",
            appId: "string.uuid?",
            projectId: "string.uuid?",
            filters: ruleFiltersSchema.optional(),
            message: "string?",
            folder: "string?",
          }).onUndeclaredKey("reject"),
        ),
    },
  )
  .get(
    "/rules/:id/history",
    async ({ params: { id }, query }) => {
      await alertRuleDAO.findByIdOrThrow(id);
      return alertRuleHistoryDAO.list({ ruleId: id, ...query });
    },
    {
      params: arktype({ id: "string.uuid" }),
      query: arktype({
        cursor: "string?",
        limit: "string.integer.parse?",
      }),
    },
  )
  .get(
    "/rules/:id",
    async ({ params: { id } }) => alertRuleDAO.findByIdOrThrow(id),
    { params: arktype({ id: "string.uuid" }) },
  )
  .patch(
    "/rules/:id",
    async ({ params: { id }, body, adminId }) => {
      const current = await alertRuleDAO.findByIdOrThrow(id);
      const trigger = body.trigger ?? current.trigger;
      const next = {
        metric: body.metric ?? current.metric,
        operator: body.operator ?? current.operator,
        threshold: body.threshold ?? current.threshold,
        windowSeconds: body.windowSeconds ?? current.windowSeconds,
      };
      const thresholdFactor = body.thresholdFactor ?? current.thresholdFactor;
      // A dynamic rule ("3x baseline") does not need a static threshold.
      const thresholdMissing =
        next.threshold == null && thresholdFactor == null;
      if (
        trigger === "threshold" &&
        (Object.entries(next).some(
          ([key, value]) => value == null && key !== "threshold",
        ) ||
          thresholdMissing)
      )
        throw badRequest(
          "threshold rules require metric, operator, windowSeconds and a static threshold or a thresholdFactor",
        );
      if (
        trigger !== "threshold" &&
        [
          body.metric,
          body.operator,
          body.threshold,
          body.windowSeconds,
          body.thresholdFactor,
        ].some((value) => value !== undefined)
      )
        throw badRequest(
          "issue triggers do not accept metric, operator, threshold, thresholdFactor or windowSeconds",
        );
      // The JSON columns travel stringified on write; an emptied filter set
      // normalizes to the unfiltered shape like the create surface.
      const { filters, folder, ...rest } = body;
      const nextFilters =
        filters !== undefined && Object.keys(filters.tags ?? {}).length === 0
          ? "{}"
          : filters !== undefined
            ? JSON.stringify(filters)
            : JSON.stringify(current.filters);
      const updated = await alertRuleDAO.updateOrThrow(id, {
        ...rest,
        ...(trigger === "threshold"
          ? {
              ...next,
              thresholdFactor,
              measurement: body.measurement ?? current.measurement,
            }
          : {
              metric: null,
              operator: null,
              threshold: null,
              thresholdFactor: null,
              windowSeconds: null,
              measurement: null,
            }),
        filters: nextFilters,
        folder: folder !== undefined ? (folder ?? null) : current.folder,
        channelIds: JSON.stringify(body.channelIds ?? current.channelIds),
        isEnabled: (body.isEnabled ?? current.isEnabled) ? 1 : 0,
      });
      await recordRuleChange(updated, "updated", adminId);
      return updated;
    },
    {
      params: arktype({ id: "string.uuid" }),
      body: arktype({
        name: "string?",
        trigger: optionalAlertTrigger,
        metric: optionalAlertMetric,
        operator: optionalAlertOperator,
        threshold: "number?",
        thresholdFactor: "number > 0?",
        windowSeconds: "number.integer > 0?",
        cooldownSeconds: "number.integer >= 0?",
        channelIds: "string.uuid[]?",
        measurement: "string?",
        isEnabled: "boolean?",
        message: "string | null?",
        folder: "string | null?",
        filters: ruleFiltersSchema.optional(),
      }),
    },
  )
  .delete(
    "/rules/:id",
    async ({ params: { id }, adminId }) => {
      const current = await alertRuleDAO.findById(id);
      await alertIncidentDAO.deleteByRule(id);
      await alertRuleDAO.delete(id);
      if (current) await recordRuleChange(current, "deleted", adminId);
      return { success: true };
    },
    { params: arktype({ id: "string.uuid" }) },
  )
  .post(
    "/channels/:id/test",
    async ({ params: { id } }) => {
      const channel = await alertChannelDAO.findByIdOrThrow(id);
      const result = await deliverNotificationToChannel(
        channel,
        buildChannelTestNotification(channel.name, channel.appId),
      );
      return { result };
    },
    { params: arktype({ id: "string.uuid" }) },
  )
  .post(
    "/rules/:id/test",
    async ({ params: { id } }) => {
      const rule = await alertRuleDAO.findByIdOrThrow(id);
      const channels = rule.appId
        ? (await resolveEffectiveAlertConfig({ appId: rule.appId })).channels
        : await alertChannelDAO.list(null);
      const targets =
        rule.channelIds.length > 0
          ? rule.channelIds
          : channels.map((channel) => channel.id);
      const results = await deliverAlertToChannels(
        channels.filter((channel) => targets.includes(channel.id)),
        buildTestNotification(rule, rule.appId),
      );
      return { results };
    },
    { params: arktype({ id: "string.uuid" }) },
  )

  .get(
    "/apps/:appId/effective",
    async ({ params: { appId } }) => {
      await appDAO.findByIdOrThrow(appId);
      return resolveEffectiveAlertConfig({ appId });
    },
    { params: arktype({ appId: "string.uuid" }) },
  )
  .get(
    "/incidents",
    async ({ query: { appId, cursor, limit } }) => {
      if (appId) await appDAO.findByIdOrThrow(appId);
      return alertIncidentDAO.list({
        appId,
        cursor,
        limit,
      });
    },
    {
      query: arktype({
        appId: "string.uuid?",
        cursor: "string?",
        limit: "string.integer.parse?",
      }),
    },
  )
  .get(
    "/dead-letters",
    async ({ query: { cursor, limit } }) =>
      alertDeadLetterDAO.list({ cursor, limit }),
    {
      query: arktype({
        cursor: "string?",
        limit: "string.integer.parse?",
      }),
    },
  )
  .post(
    "/dead-letters/:id/retry",
    async ({ params: { id } }) => {
      const letter = await alertDeadLetterDAO.findByIdOrThrow(id);
      await alertDeadLetterDAO.scheduleNow(id);
      await retryDeadLetters();
      return alertDeadLetterDAO.findById(id) ?? letter;
    },
    { params: arktype({ id: "string.uuid" }) },
  )
  .delete(
    "/dead-letters/:id",
    async ({ params: { id } }) => {
      await alertDeadLetterDAO.delete(id);
      return { success: true };
    },
    { params: arktype({ id: "string.uuid" }) },
  )
  .get(
    "/export",
    async ({ query }) => {
      if (query.appId) await appDAO.findByIdOrThrow(query.appId);
      // The export covers everything; the query narrows it in memory.
      const all = await alertRuleDAO.listAll();
      const rules = all.filter(
        (rule) =>
          (!query.appId || rule.appId === query.appId) &&
          (!query.projectId || rule.projectId === query.projectId),
      );
      const channels = await alertChannelDAO.listAll();
      const channelNames = new Map(channels.map((c) => [c.id, c.name]));
      return {
        version: 1,
        exportedAt: new Date().toISOString(),
        rules: rules.map((rule) => ({
          name: rule.name,
          trigger: rule.trigger,
          metric: rule.metric,
          operator: rule.operator,
          threshold: rule.threshold,
          windowSeconds: rule.windowSeconds,
          measurement: rule.measurement,
          cooldownSeconds: rule.cooldownSeconds,
          filters: rule.filters,
          message: rule.message,
          folder: rule.folder,
          appId: rule.appId,
          projectId: rule.projectId,
          channels: rule.channelIds.map((id) => channelNames.get(id) ?? id),
        })),
      };
    },
    {
      query: arktype({
        appId: "string.uuid?",
        projectId: "string.uuid?",
      }),
    },
  )
  .post(
    "/import",
    async ({ body, adminId }) => {
      const created: string[] = [];
      const skipped: string[] = [];
      // The channels travel by name: the ids are local to an installation.
      const channelsByName = new Map(
        (await alertChannelDAO.listAll()).map((channel) => [
          channel.name,
          channel.id,
        ]),
      );
      const existingNames = new Set(
        (await alertRuleDAO.listAll()).map((rule) => rule.name),
      );
      for (const rule of body.rules ?? []) {
        const channelIds: string[] = [];
        for (const name of rule.channels ?? []) {
          const channelId = channelsByName.get(name);
          if (channelId) channelIds.push(channelId);
        }
        const appId = rule.appId ?? null;
        const projectId = rule.projectId ?? null;
        if (appId) await appDAO.findByIdOrThrow(appId);
        if (projectId) await projectDAO.findByIdOrThrow(projectId);
        const name = rule.name.trim();
        if (name.length === 0) {
          skipped.push("(unnamed)");
          continue;
        }
        if (existingNames.has(name)) {
          skipped.push(name);
          continue;
        }
        existingNames.add(name);
        const createdRule = await alertRuleDAO.create(
          rule.trigger === "threshold"
            ? {
                name,
                trigger: "threshold",
                metric: rule.metric ?? "error_count",
                operator: rule.operator ?? "gt",
                threshold: rule.threshold ?? 1,
                windowSeconds: rule.windowSeconds ?? 300,
                measurement: rule.measurement ?? null,
                cooldownSeconds: rule.cooldownSeconds ?? 3600,
                channelIds: JSON.stringify(channelIds),
                appId,
                projectId,
                filters: JSON.stringify(rule.filters ?? {}),
                message: rule.message ?? null,
                folder: rule.folder ?? null,
              }
            : {
                name,
                trigger: rule.trigger ?? "new_issue",
                cooldownSeconds: rule.cooldownSeconds ?? 3600,
                channelIds: JSON.stringify(channelIds),
                appId,
                projectId,
                filters: JSON.stringify(rule.filters ?? {}),
                message: rule.message ?? null,
                folder: rule.folder ?? null,
              },
        );
        await recordRuleChange(createdRule, "created", adminId);
        created.push(name);
      }
      return { created, skipped };
    },
    {
      body: arktype({
        version: "number?",
        rules: importedRuleSchema.array().optional(),
      }),
    },
  )
  .get(
    "/silences",
    async ({ query: { cursor, limit } }) =>
      alertSilenceDAO.list({ cursor, limit }),
    {
      query: arktype({
        cursor: "string?",
        limit: "string.integer.parse?",
      }),
    },
  )
  .post(
    "/silences",
    async ({ body, adminId }) => {
      const scopeType = body.scopeType ?? "global";
      if (scopeType === "app" && !body.scopeId) {
        throw badRequest("An app silence needs the app id");
      }
      if (scopeType === "project" && !body.scopeId) {
        throw badRequest("A project silence needs the project id");
      }
      if (scopeType === "app" && body.scopeId) {
        await appDAO.findByIdOrThrow(body.scopeId);
      }
      if (scopeType === "project" && body.scopeId) {
        await projectDAO.findByIdOrThrow(body.scopeId);
      }
      const startsAt = body.startsAt ?? new Date().toISOString();
      if (body.endsAt && body.endsAt <= startsAt) {
        throw badRequest("The silence must end after it starts");
      }
      const now = new Date().toISOString();
      return alertSilenceDAO.create({
        name: body.name,
        scopeType,
        scopeId: scopeType === "global" ? null : body.scopeId!,
        startsAt,
        endsAt: body.endsAt ?? null,
        reason: body.reason ?? null,
        createdBy: adminId,
        createdAt: now,
        updatedAt: now,
      });
    },
    {
      body: arktype({
        name: "string",
        scopeType: "'global' | 'project' | 'app'?",
        scopeId: "string.uuid?",
        startsAt: "string?",
        endsAt: "string?",
        reason: "string?",
      }),
    },
  )
  .delete(
    "/silences/:id",
    async ({ params: { id } }) => {
      await alertSilenceDAO.delete(id);
      return { success: true };
    },
    { params: arktype({ id: "string.uuid" }) },
  )
  .post(
    "/incidents/:id/acknowledge",
    async ({ params: { id }, adminId }) => {
      const incident = await alertIncidentDAO.findByIdOrThrow(id);
      // The acknowledgment is one unit: the timestamp and who took it.
      return alertIncidentDAO.updateOrThrow(id, {
        acknowledgedAt: new Date().toISOString(),
        acknowledgedBy: adminId,
      });
    },
    { params: arktype({ id: "string.uuid" }) },
  )
  .post(
    "/incidents/:id/assign",
    async ({ params: { id }, body }) => {
      const assignee = body.assignee.trim();
      if (assignee.length === 0)
        throw badRequest("The assignee cannot be empty");
      await alertIncidentDAO.findByIdOrThrow(id);
      return alertIncidentDAO.updateOrThrow(id, { assignee });
    },
    {
      params: arktype({ id: "string.uuid" }),
      body: arktype({ assignee: "string" }),
    },
  );
