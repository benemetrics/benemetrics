import { Elysia } from "elysia";
import { type as arktype } from "arktype";
import { appDAO } from "db/dao/project";
import { alertChannelDAO } from "db/dao/alert-channels";
import { alertRuleDAO } from "db/dao/alert-rules";
import { alertIncidentDAO } from "db/dao/alert-incidents";
import { badRequest } from "../errors";
import { toChannel, toIncident, toRule } from "./serialize";
import { resolveEffectiveAlertConfig } from "./resolver";
import { buildTestNotification, deliverAlertToChannels } from "./notifiers";
import type {
  AlertMetric,
  AlertOperator,
  AlertTrigger,
} from "../protocol/alerting";

const channelType = "'email' | 'webhook' | 'slack' | 'rocketchat'";
const optionalChannelType = "'email' | 'webhook' | 'slack' | 'rocketchat'?";
const alertMetric =
  "'event_count' | 'error_count' | 'fatal_count' | 'new_issue_count' | 'latency_p95' | 'latency_p99'";
const optionalAlertMetric =
  "'event_count' | 'error_count' | 'fatal_count' | 'new_issue_count' | 'latency_p95' | 'latency_p99'?";
const alertOperator = "'gt' | 'lt'";
const optionalAlertOperator = "'gt' | 'lt'?";
const issueAlertTrigger = "'new_issue' | 'regression'";
const optionalAlertTrigger = "'threshold' | 'new_issue' | 'regression'?";

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
      const base = {
        name: body.name,
        trigger: body.trigger ?? "threshold",
        cooldownSeconds: body.cooldownSeconds ?? 3600,
        channelIds: JSON.stringify(body.channelIds ?? []),
        appId,
      };
      const created = await alertRuleDAO.create(
        "metric" in body
          ? {
              ...base,
              metric: body.metric,
              operator: body.operator,
              threshold: body.threshold,
              windowSeconds: body.windowSeconds,
              measurement: body.measurement ?? null,
            }
          : base,
      );
      return toRule(created);
    },
    {
      // Threshold rules carry the metric breach fields; issue triggers
      // are fired by issue-state transitions instead and reject them.
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
      }).or(
        arktype({
          name: "string",
          trigger: issueAlertTrigger,
          cooldownSeconds: "number.integer >= 0?",
          channelIds: "string.uuid[]?",
          appId: "string.uuid?",
        }).onUndeclaredKey("reject"),
      ),
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
      const current = await alertRuleDAO.findByIdOrThrow(id);
      const nextTrigger = (body.trigger ?? current.trigger) as AlertTrigger;
      const nextMetric =
        body.metric !== undefined
          ? body.metric
          : (current.metric as AlertMetric | null);
      const nextOperator =
        body.operator !== undefined
          ? body.operator
          : (current.operator as AlertOperator | null);
      const nextThreshold =
        body.threshold !== undefined ? body.threshold : current.threshold;
      const nextWindowSeconds =
        body.windowSeconds !== undefined
          ? body.windowSeconds
          : current.windowSeconds;

      if (nextTrigger === "threshold") {
        if (
          nextMetric === null ||
          nextOperator === null ||
          nextThreshold === null ||
          nextWindowSeconds === null
        ) {
          throw badRequest(
            "threshold rules require metric, operator, threshold and windowSeconds",
          );
        }
      } else if (
        body.metric !== undefined ||
        body.operator !== undefined ||
        body.threshold !== undefined ||
        body.windowSeconds !== undefined
      ) {
        throw badRequest(
          "issue triggers do not accept metric, operator, threshold or windowSeconds",
        );
      }

      // Switching to an issue trigger clears the metric-breach fields,
      // switching back requires them again.
      const thresholdFields =
        nextTrigger === "threshold"
          ? {
              metric: nextMetric,
              operator: nextOperator,
              threshold: nextThreshold,
              windowSeconds: nextWindowSeconds,
              ...(body.measurement !== undefined
                ? { measurement: body.measurement }
                : {}),
            }
          : {
              metric: null,
              operator: null,
              threshold: null,
              windowSeconds: null,
              measurement: null,
            };

      const updated = await alertRuleDAO.updateOrThrow(id, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.trigger !== undefined ? { trigger: body.trigger } : {}),
        ...thresholdFields,
        ...(body.cooldownSeconds !== undefined
          ? { cooldownSeconds: body.cooldownSeconds }
          : {}),
        ...(body.channelIds !== undefined
          ? { channelIds: JSON.stringify(body.channelIds) }
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
        trigger: optionalAlertTrigger,
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
