import { Elysia } from "elysia";
import { type } from "arktype";
import { alertChannelDAO } from "../../db/dao/alert-channels.ts";
import { alertRuleDAO } from "../../db/dao/alert-rules.ts";
import { alertIncidentDAO } from "../../db/dao/alert-incidents.ts";
import { toChannelResponse, toRuleResponse, toIncidentResponse } from "./serialize.ts";
import { resolveEffectiveChannels, resolveEffectiveRules } from "./resolver.ts";
import { deliverAlertToChannels } from "./notifiers.ts";

export const alertingRoutes = new Elysia({ prefix: "alerting" })
  .get(
    "/channels",
    async ({ query }) => {
      const { data, pagination } = await alertChannelDAO.list({ appId: query.appId, page: query.page, limit: query.limit });
      return { data: data.map(toChannelResponse), pagination };
    },
    { query: type({ appId: "string.uuid?", page: "string.integer.parse?", limit: "string.integer.parse?" }) }
  )
  .post(
    "/channels",
    async ({ body }) => {
      const channel = await alertChannelDAO.create({ name: body.name, type: body.type, config: body.config, appId: body.appId });
      return toChannelResponse(channel);
    },
    { body: type({ name: "string", type: "'webhook' | 'slack' | 'rocketchat' | 'email'", config: "Record<string, unknown>?", appId: "string.uuid?" }) }
  )
  .get(
    "/channels/:id",
    async ({ params: { id } }) => toChannelResponse(await alertChannelDAO.findByIdOrThrow(id)),
    { params: type({ id: "string.uuid" }) }
  )
  .patch(
    "/channels/:id",
    async ({ params: { id }, body }) => toChannelResponse(await alertChannelDAO.updateOrThrow(id, body)),
    { params: type({ id: "string.uuid" }), body: type({ name: "string?", type: "'webhook' | 'slack' | 'rocketchat' | 'email'?", config: "Record<string, unknown>?" }) }
  )
  .delete(
    "/channels/:id",
    async ({ params: { id } }) => { await alertChannelDAO.delete(id); return { success: true }; },
    { params: type({ id: "string.uuid" }) }
  )
  .get(
    "/rules",
    async ({ query }) => {
      const { data, pagination } = await alertRuleDAO.list({ appId: query.appId, page: query.page, limit: query.limit });
      return { data: data.map(toRuleResponse), pagination };
    },
    { query: type({ appId: "string.uuid?", page: "string.integer.parse?", limit: "string.integer.parse?" }) }
  )
  .post(
    "/rules",
    async ({ body }) => {
      const rule = await alertRuleDAO.create({
        name: body.name,
        trigger: body.trigger,
        metric: body.metric,
        operator: body.operator,
        threshold: body.threshold,
        windowSeconds: body.windowSeconds,
        cooldownSeconds: body.cooldownSeconds,
        channelIds: body.channelIds,
        measurement: body.measurement,
        appId: body.appId,
      });
      return toRuleResponse(rule);
    },
    {
      body: type({
        name: "string",
        trigger: "'threshold' | 'new_issue' | 'regression'",
        metric: "'event_count' | 'error_count' | 'fatal_count' | 'new_issue_count' | 'latency_p95' | 'latency_p99'?",
        operator: "'gt' | 'lt'?",
        threshold: "number?",
        windowSeconds: "number?",
        cooldownSeconds: "number?",
        channelIds: "string[]?",
        measurement: "string?",
        appId: "string.uuid?",
      }),
    }
  )
  .get(
    "/rules/:id",
    async ({ params: { id } }) => toRuleResponse(await alertRuleDAO.findByIdOrThrow(id)),
    { params: type({ id: "string.uuid" }) }
  )
  .patch(
    "/rules/:id",
    async ({ params: { id }, body }) => toRuleResponse(await alertRuleDAO.updateOrThrow(id, body)),
    { params: type({ id: "string.uuid" }), body: type({ name: "string?", trigger: "'threshold' | 'new_issue' | 'regression'?", metric: "string?", operator: "string?", threshold: "number?", windowSeconds: "number?", cooldownSeconds: "number?", channelIds: "string[]?", measurement: "string?", appId: "string.uuid?", isEnabled: "number?" }) }
  )
  .delete(
    "/rules/:id",
    async ({ params: { id } }) => { await alertRuleDAO.delete(id); return { success: true }; },
    { params: type({ id: "string.uuid" }) }
  )
  .post(
    "/rules/:id/test",
    async ({ params: { id } }) => {
      const rule = await alertRuleDAO.findByIdOrThrow(id);
      const channels = rule.channelIds.length > 0
        ? (await Promise.all(rule.channelIds.map(id => import("../../db/dao/alert-channels.ts").then(m => m.alertChannelDAO.findById(id))))).filter(Boolean)
        : (await import("../../db/dao/alert-channels.ts").then(m => m.alertChannelDAO.list({ appId: rule.appId }))).data;

      const notification = {
        title: `Test: ${rule.name}`,
        message: "This is a test notification",
        severity: "info",
        ruleName: rule.name,
        trigger: rule.trigger,
        metric: rule.metric,
        value: null,
        threshold: rule.threshold,
        projectId: "test",
        environmentId: null,
        occurredAt: new Date().toISOString(),
      };

      const results = await import("./notifiers.ts").then(m => m.deliverAlertToChannels(notification, channels.map(c => ({ id: c.id, name: c.name, type: c.type, config: c.config }))));
      return { results };
    },
    { params: type({ id: "string.uuid" }) }
  )
  .get(
    "/apps/:appId/effective",
    async ({ params: { appId } }) => {
      const [channels, rules] = await Promise.all([resolveEffectiveChannels(appId), resolveEffectiveRules(appId)]);
      return { channels: channels.map(toChannelResponse), rules: rules.map(toRuleResponse) };
    },
    { params: type({ appId: "string.uuid" }) }
  )
  .get(
    "/incidents",
    async ({ query }) => {
      const { data, pagination } = await import("../../db/dao/alert-incidents.ts").then(m => m.alertIncidentDAO.list({ appId: query.appId, page: query.page, limit: query.limit }));
      return { data: data.map(toIncidentResponse), pagination };
    },
    { query: type({ appId: "string.uuid?", page: "string.integer.parse?", limit: "string.integer.parse?" }) }
  );