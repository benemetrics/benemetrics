import { Elysia } from "elysia";
import { type as arktype } from "arktype";
import { issueDAO } from "db/dao/issues";
import {
  clickHouseIssueStats,
  clickHouseIssueUserCounts,
  listClickHouseIssueOccurrences,
} from "../clickhouse";
import { autoStepSeconds } from "../metrics";
import { badRequest, notFound } from "../errors";
import { parseIssueQuery, parseIssueSort, summarizeTerm } from "./query";
import { narrowToScope, resolveIssueFilters } from "./resolve";
import { scopedViewFor } from "../permissions/engine";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

// ── oidc surface: the admin reads and writes ─────────────
export const issueRoutes = new Elysia({ prefix: "/api/admin/issues" })
  .get(
    "/",
    async ({
      query: { query, sort, cursor, limit },
      request,
    }) => {
      const groups = parseIssueQuery(query ?? "");
      const view = await scopedViewFor({ request, isAdmin: false, adminScope: null });
      // A scoped identity gets an empty list for a name that does not
      // exist — the same answer as a name that exists but is out of
      // scope, so the list cannot be used to probe what exists.
      let filters = await resolveIssueFilters(groups, {
        unknownIsEmpty: view !== null,
      });
      if (view) filters = narrowToScope(filters, [...view.appIds]);
      const sortValue = parseIssueSort(sort);
      // `sort=users` orders on the distinct-user count, which the issues
      // table only knows after it is synced from the ClickHouse issue index.
      if (sortValue === "users" && view) {
        const appIds = [...view.appIds];
        const counts = await clickHouseIssueUserCounts({ appIds });
        await issueDAO.syncUserCounts(counts, appIds);
      }
      const page = await issueDAO.listPaged({
        filters,
        sort: sortValue,
        cursor,
        limit,
      });
      return {
        data: page,
        meta: {
          terms: groups.flat().map(summarizeTerm),
          sort: sortValue,
        },
      };
    },
    {
      query: arktype({
        query: "string?",
        sort: "'new' | 'frequent' | 'first-seen' | 'users'?",
        cursor: "string?",
        limit: "string.integer.parse?",
      }),
    },
  )
  .get(
    "/:id",
    async ({ params: { id }, request }) => {
      const view = await scopedViewFor({ request, isAdmin: false, adminScope: null });
      const issue = await issueDAO.findByIdOrThrow(id);
      if (view && !view.appIds.has(issue.appId)) throw notFound("Issue", id);
      return issue;
    },
    { params: arktype({ id: "string.uuid" }) },
  )
  .get(
    "/:id/events",
    async ({ params: { id }, query, request }) => {
      const issue = await issueDAO.findByIdOrThrow(id);
      const view = await scopedViewFor({ request, isAdmin: false, adminScope: null });
      if (view && !view.appIds.has(issue.appId)) throw notFound("Issue", id);
      const page = await listClickHouseIssueOccurrences({
        appId: issue.appId,
        fingerprint: issue.fingerprint,
        cursor: query.cursor,
        limit: Math.min(
          Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1),
          MAX_PAGE_SIZE,
        ),
      });
      return { data: page.data };
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
    "/:id/stats",
    async ({ params: { id }, query, request }) => {
      const issue = await issueDAO.findByIdOrThrow(id);
      const view = await scopedViewFor({ request, isAdmin: false, adminScope: null });
      if (view && !view.appIds.has(issue.appId)) throw notFound("Issue", id);
      const to = query.to ? new Date(query.to) : new Date();
      const from = query.from
        ? new Date(query.from)
        : new Date(issue.firstSeen);
      if (Number.isNaN(from.getTime()))
        throw badRequest('"from" is not a valid date');
      if (Number.isNaN(to.getTime()))
        throw badRequest('"to" is not a valid date');
      if (from.getTime() > to.getTime()) {
        throw badRequest('"from" must not be after "to"');
      }
      const stepSeconds =
        query.stepSeconds ?? autoStepSeconds(to.getTime() - from.getTime());
      const stats = await clickHouseIssueStats({
        appId: issue.appId,
        fingerprint: issue.fingerprint,
        from: from.toISOString(),
        to: to.toISOString(),
        stepSeconds,
      });
      return {
        from: from.toISOString(),
        to: to.toISOString(),
        stepSeconds,
        points: stats.points,
        totals: stats.totals,
      };
    },
    {
      params: arktype({ id: "string.uuid" }),
      query: arktype({
        from: "string?",
        to: "string?",
        stepSeconds: "number.integer > 0?",
      }),
    },
  )
  .patch(
    "/:id",
    async ({ params: { id }, body }) =>
      issueDAO.updateOrThrow(id, { status: body.status }),
    {
      params: arktype({ id: "string.uuid" }),
      body: arktype({ status: "'unresolved' | 'resolved'" }),
    },
  );
