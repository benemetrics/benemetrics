import { Elysia } from "elysia";
import { type as arktype } from "arktype";
import { appDAO } from "db/dao/project";
import { alertChannelDAO } from "db/dao/alert-channels";
import { alertRuleDAO } from "db/dao/alert-rules";
import { alertIncidentDAO } from "db/dao/alert-incidents";
import { toChannel, toIncident, toRule } from "./serialize";
import { resolveEffectiveAlertConfig } from "./resolver";
import { buildTestNotification, deliverAlertToChannels } from "./notifiers";

const channelType = "'email' | 'webhook' | 'slack' | 'rocketchat'";
const optionalChannelType = "'email' | 'webhook' | 'slack' | 'rocketchat'?";
const alertMetric =
  "'event_count' | 'error_count' | 'fatal_count' | 'new_issue_count' | 'latency_p95' | 'latency_p99'";
const optionalAlertMetric =
  "'event_count' | 'error_count' | 'fatal_count' | 'new_issue_count' | 'latency_p95' | 'latency_p99'?";
const alertOperator = "'gt' | 'lt'";
const optionalAlertOperator = "'gt' | 'lt'?";

export const alertingRoutes = new Elysia({ prefix: "alerting" })
  // ---- Channels ----------------------------------------------------------
  .get(
    "/channels",
    async ({ query: { appId, page, limit } }) => {
      if (appId) await appDAO.findByIdOrThrow(appId);
      const { data, pagination } = await alertChannelDAO.listPaged({
        appId: appId ?? null,
        page,
        limit,
      });
      return { data: data.map(toChannel), pagination };
    },
    {
      query: arktype({
        appId: "string.uuid?",
        page: "string.integer.parse?",
        limit: "string.integer.parse?",
      }),
    },
  )
  .post(
    "/channels",
    async ({ body }) => {
      const appId = body.appId ?? null;
      if (appId) await appDAO.findByIdOrThrow(appId);
      const created = await alertChannelDAO.create({
        name: body.name,
        type: body.type,
        config: JSON.stringify(body.config ?? {}),
        appId,
      });
      return toChannel(created);
    },
    {
      body: arktype({
        name: "string",
        type: channelType,
        config: "object?",
        appId: "string.uuid?",
      }),
    },
  )
  .get(
    "/channels/:id",
    async ({ params: { id } }) =>
      toChannel(await alertChannelDAO.findByIdOrThrow(id)),
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
      return toChannel(updated);
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
      await alertChannelDAO.findByIdOrThrow(id);
      await alertChannelDAO.delete(id);
      return { success: true };
    },
    { params: arktype({ id: "string.uuid" }) },
  )

  // ---- Rules -------------------------------------------------------------
  .get(
    "/rules",
    async ({ query: { appId, page, limit } }) => {
      if (appId) await appDAO.findByIdOrThrow(appId);
      const { data, pagination } = await alertRuleDAO.listPaged({
        appId: appId ?? null,
        page,
        limit,
      });
      return { data: data.map(toRule), pagination };
    },
    {
      query: arktype({
        appId: "string.uuid?",
        page: "string.integer.parse?",
        limit: "string.integer.parse?",
      }),
    },
  )
  .post(
    "/rules",
    async ({ body }) => {
      const appId = body.appId ?? null;
      if (appId) await appDAO.findByIdOrThrow(appId);
      const created = await alertRuleDAO.create({
        name: body.name,
        metric: body.metric,
        operator: body.operator,
        threshold: body.threshold,
        windowSeconds: body.windowSeconds,
        cooldownSeconds: body.cooldownSeconds ?? 3600,
        channelIds: JSON.stringify(body.channelIds ?? []),
        measurement: body.measurement ?? null,
        appId,
      });
      return toRule(created);
    },
    {
      body: arktype({
        name: "string",
        metric: alertMetric,
        operator: alertOperator,
        threshold: "number",
        windowSeconds: "number.integer > 0",
        cooldownSeconds: "number.integer >= 0?",
        channelIds: "string.uuid[]?",
        measurement: "string?",
        appId: "string.uuid?",
      }),
    },
  )
  .get(
    "/rules/:id",
    async ({ params: { id } }) =>
      toRule(await alertRuleDAO.findByIdOrThrow(id)),
    { params: arktype({ id: "string.uuid" }) },
  )
  .patch(
    "/rules/:id",
    async ({ params: { id }, body }) => {
      const updated = await alertRuleDAO.updateOrThrow(id, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.metric !== undefined ? { metric: body.metric } : {}),
        ...(body.operator !== undefined ? { operator: body.operator } : {}),
        ...(body.threshold !== undefined ? { threshold: body.threshold } : {}),
        ...(body.windowSeconds !== undefined
          ? { windowSeconds: body.windowSeconds }
          : {}),
        ...(body.cooldownSeconds !== undefined
          ? { cooldownSeconds: body.cooldownSeconds }
          : {}),
        ...(body.channelIds !== undefined
          ? { channelIds: JSON.stringify(body.channelIds) }
          : {}),
        ...(body.measurement !== undefined
          ? { measurement: body.measurement }
          : {}),
        ...(body.isEnabled !== undefined
          ? { isEnabled: body.isEnabled ? 1 : 0 }
          : {}),
      });
      return toRule(updated);
    },
    {
      params: arktype({ id: "string.uuid" }),
      body: arktype({
        name: "string?",
        metric: optionalAlertMetric,
        operator: optionalAlertOperator,
        threshold: "number?",
        windowSeconds: "number.integer > 0?",
        cooldownSeconds: "number.integer >= 0?",
        channelIds: "string.uuid[]?",
        measurement: "string?",
        isEnabled: "boolean?",
      }),
    },
  )
  .delete(
    "/rules/:id",
    async ({ params: { id } }) => {
      await alertRuleDAO.findByIdOrThrow(id);
      // Incidents are history of the rule, so they are removed with it.
      await alertIncidentDAO.deleteByRule(id);
      await alertRuleDAO.delete(id);
      return { success: true };
    },
    { params: arktype({ id: "string.uuid" }) },
  )
  .post(
    "/rules/:id/test",
    async ({ params: { id } }) => {
      const rule = toRule(await alertRuleDAO.findByIdOrThrow(id));
      const channels = rule.appId
        ? (await resolveEffectiveAlertConfig(rule.appId)).channels
        : (await alertChannelDAO.list(null)).map(toChannel);
      const targets =
        rule.channelIds.length > 0
          ? rule.channelIds
          : channels.map((channel) => channel.id);
      const selected = channels.filter((channel) =>
        targets.includes(channel.id),
      );
      const results = await deliverAlertToChannels(
        selected,
        buildTestNotification(rule),
      );
      return { results };
    },
    { params: arktype({ id: "string.uuid" }) },
  )

  // ---- Effective config & incidents --------------------------------------
  .get(
    "/apps/:appId/effective",
    async ({ params: { appId } }) => {
      await appDAO.findByIdOrThrow(appId);
      return resolveEffectiveAlertConfig(appId);
    },
    { params: arktype({ appId: "string.uuid" }) },
  )
  .get(
    "/incidents",
    async ({ query: { appId, page, limit } }) => {
      if (appId) await appDAO.findByIdOrThrow(appId);
      const { data, pagination } = await alertIncidentDAO.list({
        appId,
        page,
        limit,
      });
      return { data: data.map(toIncident), pagination };
    },
    {
      query: arktype({
        appId: "string.uuid?",
        page: "string.integer.parse?",
        limit: "string.integer.parse?",
      }),
    },
  );
