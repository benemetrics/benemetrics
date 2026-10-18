import { clickhouseClient } from "./clickhouse.ts";

export const eventsStore = {
  async query(sql: string, params?: Record<string, unknown>) {
    const result = await clickhouseClient.query({ query: sql });
    return result.json();
  },

  async list(params: {
    page?: number;
    limit?: number;
    projectId?: string;
    environmentId?: string;
    appId?: string;
  } = {}) {
    const page = params.page || 1;
    const limit = Math.min(params.limit || 20, 100);
    const offset = (page - 1) * limit;

    const where = [];
    const params_: Record<string, unknown> = {};

    if (params.projectId) {
      where.push("projectId = {projectId:String}");
      params_.projectId = params.projectId;
    }
    if (params.appId) {
      where.push("appId = {appId:String}");
      params_.appId = params.appId;
    }
    if (params.environmentId) {
      where.push("environmentId = {environmentId:String}");
      params_.environmentId = params.environmentId;
    }

    const whereClause = where.length > 0 ? "WHERE " + where.join(" AND ") : "";

    const sql = `
      SELECT id, projectId, appId, envelopeHeader, envelopeItems, receivedAt
      FROM sentry_events FINAL
      ${whereClause}
      ORDER BY receivedAt DESC
      LIMIT {limit:UInt32} OFFSET {offset:UInt32}
    `;

    params_.limit = limit;
    params_.offset = offset;

    const [data, totalResult] = await Promise.all([
      this.query(sql, { ...params_, limit, offset }),
      clickhouseClient.query({
        query: `SELECT count() AS count FROM sentry_events FINAL ${whereClause}`,
      }).then(r => r.json()),
    ]);

    const totalRecord = Array.isArray(totalResult) ? totalResult[0] : totalResult;
    const total = (totalRecord as { count?: number })?.count ?? 0;

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  async get(eventId: string) {
    const result = await clickhouseClient.query({
      query: `SELECT id, projectId, appId, envelopeHeader, envelopeItems, receivedAt FROM sentry_events FINAL WHERE id = {eventId:String} LIMIT 1`,
    }, { eventId });

    const data = await result.json();
    return Array.isArray(data) ? data[0] || null : null;
  },
};