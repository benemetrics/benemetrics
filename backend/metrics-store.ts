import { clickhouseClient } from "./clickhouse.ts";

export const metricsStore = {
  async query(sql: string, params?: Record<string, unknown>) {
    const result = await clickhouseClient.query({ query: sql });
    return result.json();
  },

  async series(params: {
    metric: string;
    projectId?: string;
    environmentId?: string;
    appId?: string;
    from: string;
    to: string;
    stepSeconds?: number;
  }) {
    const step = params.stepSeconds || this.autoStep(params.from, params.to);
    const where = this.buildWhere(params);

    const sql = `
      SELECT
        toStartOfInterval(timestamp, INTERVAL ${step} SECOND) AS bucketStart,
        count() AS count,
        avg(value) AS mean,
        quantile(0.5)(value) AS p50,
        quantile(0.95)(value) AS p95,
        quantile(0.99)(value) AS p99
      FROM sentry_metrics FINAL
      WHERE metric = {metric:String} ${where}
      GROUP BY bucketStart
      ORDER BY bucketStart
    `;

    const params_ = { metric: params.metric, ...this.whereParams(params) };
    const result = await this.query(sql, params_);
    return result;
  },

  async breakdown(params: {
    metric: string;
    projectId?: string;
    environmentId?: string;
    appId?: string;
    from: string;
    to: string;
    limit?: number;
  }) {
    const where = this.buildWhere(params);
    const limit = params.limit || 100;

    const sql = `
      SELECT dimension, count(), avg(value) AS mean, quantile(0.5)(value) AS p50, quantile(0.95)(value) AS p95
      FROM sentry_metrics FINAL
      WHERE metric = {metric:String} ${where}
      GROUP BY dimension
      ORDER BY count() DESC
      LIMIT ${limit}
    `;

    const params_ = { metric: params.metric, ...this.whereParams(params) };
    const result = await this.query(sql, params_);
    return result;
  },

  buildWhere(params: any): string {
    const conditions = [];
    if (params.projectId) conditions.push("projectId = {projectId:String}");
    if (params.environmentId) conditions.push("environmentId = {environmentId:String}");
    if (params.appId) conditions.push("appId = {appId:String}");
    if (params.from) conditions.push("timestamp >= {from:String}");
    if (params.to) conditions.push("timestamp <= {to:String}");
    return conditions.length > 0 ? "AND " + conditions.join(" AND ") : "";
  },

  whereParams(params: any): Record<string, unknown> {
    const p: Record<string, unknown> = {};
    if (params.projectId) p.projectId = params.projectId;
    if (params.environmentId) p.environmentId = params.environmentId;
    if (params.appId) p.appId = params.appId;
    if (params.from) p.from = params.from;
    if (params.to) p.to = params.to;
    return p;
  },

  autoStep(from: string, to: string): number {
    const fromMs = new Date(from).getTime();
    const toMs = new Date(to).getTime();
    const rangeMs = toMs - fromMs;
    if (rangeMs <= 6 * 60 * 60 * 1000) return 60; // 1m
    if (rangeMs <= 48 * 60 * 60 * 1000) return 300; // 5m
    return 3600; // 1h
  },
};