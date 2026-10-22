import type { ItemHeader } from "backend/protocol/item-header";

/**
 * The issue grouping protocol — one implementation, used by the ingest
 * handler, the consumer and the release metrics.
 */

interface ExceptionFrame {
  filename?: string;
  function?: string;
  lineno?: number;
  in_app?: boolean;
}

export interface IssueDigest {
  eventId: string;
  fingerprint: string;
  title: string;
  culprit: string | null;
  level: string;
  type: "error" | "message";
  release: string | null;
  environment: string | null;
  user: string | null;
}

const ISSUE_LEVELS = new Set([
  "fatal",
  "error",
  "warning",
  "info",
  "debug",
]);

// The newest in_app frame with a filename, else the newest frame with a
// filename, else the last frame (SDKs send frames oldest-first).
function crashFrame(
  frames: ExceptionFrame[] | undefined,
): ExceptionFrame | undefined {
  if (!Array.isArray(frames) || frames.length === 0) return undefined;
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const frame = frames[index];
    if (frame?.in_app === true && frame.filename) return frame;
  }
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const frame = frames[index];
    if (frame?.filename) return frame;
  }
  return frames[frames.length - 1];
}

function topException(
  payload: Record<string, unknown>,
): { type?: string; value?: string; stacktrace?: { frames?: ExceptionFrame[] } } | undefined {
  const exception = payload.exception as
    | { values?: Array<{ type?: string; value?: string; stacktrace?: { frames?: ExceptionFrame[] } }> }
    | undefined;
  return exception?.values?.[0];
}

export function issueFingerprint(payload: Record<string, unknown>): string {
  if (Array.isArray(payload.fingerprint) && payload.fingerprint.length > 0) {
    // An explicit fingerprint is a list of components; `{{ default }}`
    // stands for the default component and the rest join with `::`.
    const components = payload.fingerprint.map(String);
    const defaultComponent = defaultFingerprintComponent(payload);
    const resolved = components.map((component) =>
      component.trim() === "{{ default }}" ? defaultComponent : component,
    );
    return resolved.join("::").slice(0, 500);
  }

  const top = topException(payload);
  if (top) {
    const frame = crashFrame(top.stacktrace?.frames);
    if (!frame) return "unknown";
    return `${top.type ?? "Error"}@${frame.filename ?? ""}:${frame.function ?? ""}`;
  }

  if (typeof payload.message === "string" && payload.message.trim()) {
    return `msg:${payload.message.slice(0, 200)}`;
  }

  return "unknown";
}

// The component an explicit fingerprint's `{{ default }}` expands to: the
// default fingerprint of the same payload.
function defaultFingerprintComponent(payload: Record<string, unknown>): string {
  const top = topException(payload);
  if (top) {
    const frame = crashFrame(top.stacktrace?.frames);
    if (!frame) return "unknown";
    return `${top.type ?? "Error"}@${frame.filename ?? ""}:${frame.function ?? ""}`;
  }
  if (typeof payload.message === "string" && payload.message.trim()) {
    return `msg:${payload.message.slice(0, 200)}`;
  }
  return "unknown";
}

export function issueTitle(payload: Record<string, unknown>): string {
  const top = topException(payload);
  if (top) return `${top.type ?? "Error"}: ${top.value ?? ""}`.trim();
  if (typeof payload.message === "string" && payload.message.trim()) {
    return payload.message.slice(0, 200);
  }
  return issueFingerprint(payload);
}

export function issueCulprit(payload: Record<string, unknown>): string | null {
  const culprit = payload.culprit;
  if (typeof culprit === "string" && culprit) return culprit;
  const frame = crashFrame(topException(payload)?.stacktrace?.frames);
  if (!frame?.filename) return null;
  return `${frame.filename}:${frame.lineno ?? 1}`;
}

export function issueLevel(payload: Record<string, unknown>): string {
  const raw = payload.level;
  if (typeof raw !== "string") return "error";
  const level = raw.toLowerCase();
  return ISSUE_LEVELS.has(level) ? level : "error";
}

export function issueType(payload: Record<string, unknown>): "error" | "message" {
  return topException(payload) ? "error" : "message";
}

export function issueUser(payload: Record<string, unknown>): string | null {
  const user = payload.user as
    | { id?: unknown; email?: unknown; username?: unknown }
    | undefined;
  if (!user) return null;
  for (const value of [user.id, user.email, user.username]) {
    if (typeof value === "string" && value) return value;
  }
  return null;
}

export function issueRelease(payload: Record<string, unknown>): string | null {
  const release = payload.release;
  return typeof release === "string" && release ? release : null;
}

export function issueEnvironment(
  payload: Record<string, unknown>,
): string | null {
  const environment = payload.environment;
  return typeof environment === "string" && environment ? environment : null;
}

export interface IssuePresentation {
  title: string;
  culprit: string | null;
  level: string;
  type: "error" | "message";
  release: string | null;
}

// The presentation fields of an occurrence: the title, the culprit, the
// level, the type and the release.
export function issuePresentation(
  payload: Record<string, unknown>,
): IssuePresentation {
  return {
    title: issueTitle(payload),
    culprit: issueCulprit(payload),
    level: issueLevel(payload),
    type: issueType(payload),
    release: issueRelease(payload),
  };
}

export function issueEventId(
  payload: Record<string, unknown>,
  fallback: string,
): string {
  const eventId = payload.event_id;
  return typeof eventId === "string" && eventId ? eventId : fallback;
}

// The digest of one occurrence.
export function issueDigest(
  payload: Record<string, unknown>,
): IssueDigest {
  return {
    eventId: issueEventId(payload, crypto.randomUUID()),
    fingerprint: issueFingerprint(payload),
    title: issueTitle(payload),
    culprit: issueCulprit(payload),
    level: issueLevel(payload),
    type: issueType(payload),
    release: issueRelease(payload),
    environment: issueEnvironment(payload),
    user: issueUser(payload),
  };
}

export function issueDigestsFromPayloads(
  payloads: Array<Record<string, unknown>>,
): IssueDigest[] {
  return payloads.map((payload) => issueDigest(payload));
}

// The digests of an envelope's event items — the grouping keys the
// consumer applies. One digest per event item; the fingerprint decides
// which issue it belongs to.
export function extractIssueDigests(
  items: Array<{ header: ItemHeader; payload: unknown }>,
): IssueDigest[] {
  const payloads: Array<Record<string, unknown>> = [];
  for (const item of items) {
    if (item.header.type !== "event") continue;
    if (!item.payload || typeof item.payload !== "object") continue;
    payloads.push(item.payload as Record<string, unknown>);
  }
  return issueDigestsFromPayloads(payloads);
}
