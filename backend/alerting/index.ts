import { Elysia } from "elysia";
import { type as arktype } from "arktype";
import { appDAO, projectDAO } from "db/dao/project";
import { alertChannelDAO } from "db/dao/alert-channels";
import { alertRuleDAO } from "db/dao/alert-rules";
import { alertIncidentDAO } from "db/dao/alert-incidents";
import { alertDeadLetterDAO } from "db/dao/alert-dead-letters";
import { badRequest } from "../errors";
import { resolveEffectiveAlertConfig } from "./resolver";
import { buildTestNotification, deliverAlertToChannels } from "./notifiers";
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
    async ({ body }) => {
      const appId = body.appId ?? null;
      const projectId = body.projectId ?? null;
      if (appId) await appDAO.findByIdOrThrow(appId);
      if (projectId) await projectDAO.findByIdOrThrow(projectId);
      const created = await alertChannelDAO.create({
        name: body.name,
        type: body.type,
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
      const updated = await alertChannelDAO.updateOrThrow(id, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.type !== undefined ? { type: body.type } : {}),
        ...(body.config !== undefined
          ? { config: JSON.stringify(body.config) }
          : {}),
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
    async ({ body }) => {
      const appId = body.appId ?? null;
      const projectId = body.projectId ?? null;
      if (appId) await appDAO.findByIdOrThrow(appId);
      if (projectId) await projectDAO.findByIdOrThrow(projectId);
      const base = { name: body.name, trigger: body.trigger ?? "threshold", cooldownSeconds: body.cooldownSeconds ?? 3600, channelIds: JSON.stringify(body.channelIds ?? []), appId, projectId, filters: JSON.stringify(body.filters ?? {}), message: body.message ?? null };
      return alertRuleDAO.create("metric" in body ? { ...base, metric: body.metric, operator: body.operator, threshold: body.threshold, windowSeconds: body.windowSeconds, measurement: body.measurement ?? null } : base);
    },
    {
      body: arktype({
        name: "string",
        trigger: "'threshold'?",
        metric: alertMetric,
        operator: alertOperator,
        threshold: "number",
        windowSeconds: "number.integer > 0",
        cooldownSeconds: "number.integer >= 0?",
        channelIds: "string.uuid[]?",
        measurement: "string?",
        appId: "string.uuid?",
        projectId: "string.uuid?",
        filters: ruleFiltersSchema.optional(),
        message: "string?",
      }).onUndeclaredKey("reject").or(
        arktype({
          name: "string",
          trigger: issueAlertTrigger,
          cooldownSeconds: "number.integer >= 0?",
          channelIds: "string.uuid[]?",
          appId: "string.uuid?",
          projectId: "string.uuid?",
          filters: ruleFiltersSchema.optional(),
          message: "string?",
        }).onUndeclaredKey("reject"),
      ),
    },
  )
  .get(
    "/rules/:id",
    async ({ params: { id } }) => alertRuleDAO.findByIdOrThrow(id),
    { params: arktype({ id: "string.uuid" }) },
  )
  .patch(
    "/rules/:id",
    async ({ params: { id }, body }) => {
      const current = await alertRuleDAO.findByIdOrThrow(id);
      const trigger = body.trigger ?? current.trigger;
      const next = { metric: body.metric ?? current.metric, operator: body.operator ?? current.operator, threshold: body.threshold ?? current.threshold, windowSeconds: body.windowSeconds ?? current.windowSeconds };
      if (trigger === "threshold" && Object.values(next).some((value) => value == null)) throw badRequest("threshold rules require metric, operator, threshold and windowSeconds");
      if (trigger !== "threshold" && [body.metric, body.operator, body.threshold, body.windowSeconds].some((value) => value !== undefined)) throw badRequest("issue triggers do not accept metric, operator, threshold or windowSeconds");
      return alertRuleDAO.updateOrThrow(id, { ...body, ...(trigger === "threshold" ? { ...next, measurement: body.measurement ?? current.measurement } : { metric: null, operator: null, threshold: null, windowSeconds: null, measurement: null }), channelIds: JSON.stringify(body.channelIds ?? current.channelIds), isEnabled: (body.isEnabled ?? current.isEnabled) ? 1 : 0 });
    },
    {
      params: arktype({ id: "string.uuid" }),
      body: arktype({
        name: "string?",
        trigger: optionalAlertTrigger,
        metric: optionalAlertMetric,
        operator: optionalAlertOperator,
        threshold: "number?",
        windowSeconds: "number.integer > 0?",
        cooldownSeconds: "number.integer >= 0?",
        channelIds: "string.uuid[]?",
        measurement: "string?",
        isEnabled: "boolean?",
        message: "string?",
      }),
    },
  )
  .delete(
    "/rules/:id",
    async ({ params: { id } }) => {
      await alertIncidentDAO.deleteByRule(id);
      await alertRuleDAO.delete(id);
      return { success: true };
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
      const targets = rule.channelIds.length > 0 ? rule.channelIds : channels.map((channel) => channel.id);
      const results = await deliverAlertToChannels(channels.filter((channel) => targets.includes(channel.id)), buildTestNotification(rule, rule.appId));
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
      if (assignee.length === 0) throw badRequest("The assignee cannot be empty");
      await alertIncidentDAO.findByIdOrThrow(id);
      return alertIncidentDAO.updateOrThrow(id, { assignee });
    },
    {
      params: arktype({ id: "string.uuid" }),
      body: arktype({ assignee: "string" }),
    },
  );
