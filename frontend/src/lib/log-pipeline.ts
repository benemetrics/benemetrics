// Browser-safe log-to-event pipeline: parse raw lines, map fields, group into issues.
import type { Level } from "./data";

export type ParserKind = "json" | "logfmt" | "regex";

export interface PipelineConfig {
  parser: ParserKind;
  regex: string;
  levelField: string;
  messageField: string;
  timeField: string;
  minLevel: Level;
  fingerprint: string[]; // fields used to group events into issues
  dropPattern: string;
}

export interface ParsedEvent {
  raw: string;
  fields: Record<string, string>;
  level: Level;
  message: string;
  timestamp?: string | undefined;
  fingerprint: string;
}

export interface PipelineResult {
  events: ParsedEvent[];
  issues: { fingerprint: string; title: string; level: Level; count: number }[];
  dropped: number;
  failed: number;
}

const rank: Record<Level, number> = { info: 0, warning: 1, error: 2, fatal: 3 };

export function normalizeLevel(v: string | undefined): Level {
  const s = (v ?? "").toLowerCase();
  if (/fatal|crit|panic|emerg/.test(s)) return "fatal";
  if (/err/.test(s)) return "error";
  if (/warn/.test(s)) return "warning";
  return "info";
}

export function parseLogfmt(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(\w[\w.]*)=("((?:\\.|[^"])*)"|\S+)/g;
  for (const m of line.matchAll(re)) out[m[1]!] = m[3] ?? m[2]!;
  return out;
}

export function parseLine(line: string, cfg: PipelineConfig): Record<string, string> | null {
  if (cfg.parser === "json") {
    try {
      const o = JSON.parse(line);
      if (!o || typeof o !== "object") return null;
      return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
    } catch {
      return null;
    }
  }
  if (cfg.parser === "logfmt") {
    const f = parseLogfmt(line);
    return Object.keys(f).length ? f : null;
  }
  try {
    const m = new RegExp(cfg.regex).exec(line);
    return m?.groups ? { ...m.groups } : null;
  } catch {
    return null;
  }
}

/** Normalizes variable parts (numbers, ids) so similar messages group together. */
export function normalizeMessage(msg: string) {
  return msg.replace(/[0-9a-f]{8,}/gi, "<id>").replace(/\d+/g, "<n>");
}

export function runPipeline(input: string, cfg: PipelineConfig): PipelineResult {
  let drop: RegExp | null = null;
  try {
    drop = cfg.dropPattern.trim() ? new RegExp(cfg.dropPattern) : null;
  } catch {
    drop = null;
  }
  const events: ParsedEvent[] = [];
  let dropped = 0,
    failed = 0;
  for (const raw of input
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)) {
    if (drop?.test(raw)) {
      dropped++;
      continue;
    }
    const fields = parseLine(raw, cfg);
    if (!fields) {
      failed++;
      continue;
    }
    const level = normalizeLevel(fields[cfg.levelField]);
    if (rank[level] < rank[cfg.minLevel]) {
      dropped++;
      continue;
    }
    const message = fields[cfg.messageField] ?? raw;
    const fp =
      cfg.fingerprint
        .map((k) => (k === cfg.messageField ? normalizeMessage(message) : fields[k] ?? ""))
        .join("|") || normalizeMessage(message);
    events.push({ raw, fields, level, message, timestamp: fields[cfg.timeField], fingerprint: fp });
  }
  const map = new Map<string, PipelineResult["issues"][number]>();
  for (const e of events) {
    const cur = map.get(e.fingerprint);
    if (cur) {
      cur.count++;
      if (rank[e.level] > rank[cur.level]) cur.level = e.level;
    } else map.set(e.fingerprint, { fingerprint: e.fingerprint, title: e.message, level: e.level, count: 1 });
  }
  return { events, issues: [...map.values()].sort((a, b) => b.count - a.count), dropped, failed };
}

export const sampleLogs: Record<ParserKind, string> = {
  json: [
    `{"ts":"2026-10-28T23:01:02Z","level":"error","msg":"payment 4821 failed: card_declined","service":"checkout"}`,
    `{"ts":"2026-10-28T23:01:05Z","level":"info","msg":"GET /health 200","service":"checkout"}`,
    `{"ts":"2026-10-28T23:01:09Z","level":"error","msg":"payment 4907 failed: card_declined","service":"checkout"}`,
    `{"ts":"2026-10-28T23:02:11Z","level":"fatal","msg":"db pool exhausted after 30000ms","service":"orders"}`,
    `{"ts":"2026-10-28T23:02:14Z","level":"warn","msg":"slow query 1840ms","service":"orders"}`,
  ].join("\n"),
  logfmt: [
    `time=2026-10-28T23:01:02Z level=error msg="payment 4821 failed: card_declined" service=checkout`,
    `time=2026-10-28T23:01:05Z level=info msg="GET /health 200" service=checkout`,
    `time=2026-10-28T23:01:09Z level=error msg="payment 4907 failed: card_declined" service=checkout`,
    `time=2026-10-28T23:02:11Z level=fatal msg="db pool exhausted after 30000ms" service=orders`,
  ].join("\n"),
  regex: [
    `2026-10-28 23:01:02 [ERROR] checkout: payment 4821 failed: card_declined`,
    `2026-10-28 23:01:05 [INFO] checkout: GET /health 200`,
    `2026-10-28 23:01:09 [ERROR] checkout: payment 4907 failed: card_declined`,
    `2026-10-28 23:02:11 [FATAL] orders: db pool exhausted after 30000ms`,
  ].join("\n"),
};

export const defaultRegex = String.raw`^(?<ts>\S+ \S+) \[(?<level>\w+)\] (?<service>[\w-]+): (?<msg>.*)$`;

export const fieldDefaults: Record<ParserKind, Pick<PipelineConfig, "levelField" | "messageField" | "timeField">> = {
  json: { levelField: "level", messageField: "msg", timeField: "ts" },
  logfmt: { levelField: "level", messageField: "msg", timeField: "time" },
  regex: { levelField: "level", messageField: "msg", timeField: "ts" },
};
