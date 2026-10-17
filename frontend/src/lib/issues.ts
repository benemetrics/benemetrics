/**
 * Client-side issue grouping for the dashboard and event detail.
 *
 * The Issues page reads the admin issues API (backend fingerprints, with
 * resolve/reopen). The Overview dashboard intentionally stays on the loaded
 * event window, so it groups error events by their signature — the first
 * exception's type + value, or the message for events without a stack
 * trace — to show per-issue counts, user counts, and timestamps.
 */

export interface StoredEvent {
  id: string;
  itemTypes?: string[] | null;
  event: unknown;
  receivedAt: string;
}

export type IssueSeverity = "critical" | "warning" | "info";

export interface IssueGroup {
  /** Grouping key: "Type: value" for exceptions, the message otherwise. */
  key: string;
  /** Newest event in the group, used for the detail link and the code label. */
  latestEventId: string;
  code: string;
  title: string;
  source: string;
  /** Release or level shown next to the source. */
  tag: string;
  level: string;
  severity: IssueSeverity;
  events: number;
  users: number;
  firstSeen: string;
  lastSeen: string;
}

export interface ExceptionFrame {
  filename?: string;
  function?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
  context_line?: string;
  pre_context?: string[];
  post_context?: string[];
  /** Original position added by read-time source map symbolication. */
  original_filename?: string;
  original_lineno?: number;
  original_colno?: number;
}

interface ExceptionValue {
  type?: string;
  value?: string;
  stacktrace?: { frames?: ExceptionFrame[] };
}

interface EventPayload {
  exception?: { values?: ExceptionValue[] };
  message?: string;
  culprit?: string;
  release?: string;
  level?: string;
  fingerprint?: unknown[];
  user?: { id?: string; email?: string; username?: string };
}

export function eventPayload(event: StoredEvent): EventPayload {
  return (event.event ?? {}) as EventPayload;
}

// SDKs order stack frames oldest-first (crash site last), so the crash
// frame is the newest in-app frame — falling back to the newest frame
// with a filename, then the newest frame.
export function crashFrame(
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

// Mirrors the ingestion-time grouping key (backend/events/utils.ts
// issueFingerprint): explicit fingerprint, else the crash frame, else the
// message. The issue details page matches an issue's events this way, so
// its list and metrics line up with the backend's issue rows.
export function payloadFingerprint(payload: unknown): string {
  const parsed = (payload ?? {}) as EventPayload;
  if (Array.isArray(parsed.fingerprint) && parsed.fingerprint.length > 0) {
    return parsed.fingerprint.map(String).join("::");
  }
  const first = parsed.exception?.values?.[0];
  if (first) {
    const frame = crashFrame(first.stacktrace?.frames);
    return `${first.type ?? "Error"}@${frame?.filename ?? ""}:${frame?.function ?? ""}`;
  }
  if (typeof parsed.message === "string" && parsed.message.trim()) {
    return `msg:${parsed.message.slice(0, 200)}`;
  }
  return "unknown";
}

export function eventTitle(event: StoredEvent): string {
  const payload = eventPayload(event);
  const first = payload.exception?.values?.[0];
  if (first) return `${first.type ?? "Error"}: ${first.value ?? ""}`;
  return payload.message ?? "Unknown Event";
}

export function issueSeverity(level: string | undefined): IssueSeverity {
  if (level === "warning") return "warning";
  if (level === "info" || level === "debug") return "info";
  return "critical";
}

/** Grouping key for a raw event payload (not the stored event wrapper). */
export function payloadSignature(payload: unknown): string {
  const parsed = (payload ?? {}) as EventPayload;
  const first = parsed.exception?.values?.[0];
  if (first) return `${first.type ?? "Error"}: ${first.value ?? ""}`;
  return parsed.message ?? "Unknown Event";
}

function groupKey(event: StoredEvent): string {
  return payloadSignature(event.event);
}

function userKey(payload: EventPayload): string | null {
  const user = payload.user;
  return user?.id ?? user?.email ?? user?.username ?? null;
}

interface Accumulator {
  count: number;
  users: Set<string>;
  latest: StoredEvent;
  firstSeen: string;
}

/** Groups error events by signature, newest groups first. */
export function groupIssues(events: StoredEvent[]): IssueGroup[] {
  const groups = new Map<string, Accumulator>();

  for (const event of events) {
    if (!event.itemTypes?.includes("event")) continue;
    const key = groupKey(event);
    const existing = groups.get(key);
    if (!existing) {
      const user = userKey(eventPayload(event));
      groups.set(key, {
        count: 1,
        users: new Set(user ? [user] : []),
        latest: event,
        firstSeen: event.receivedAt,
      });
      continue;
    }
    existing.count += 1;
    const user = userKey(eventPayload(event));
    if (user) existing.users.add(user);
    if (Date.parse(event.receivedAt) > Date.parse(existing.latest.receivedAt)) {
      existing.latest = event;
    }
    if (Date.parse(event.receivedAt) < Date.parse(existing.firstSeen)) {
      existing.firstSeen = event.receivedAt;
    }
  }

  return Array.from(groups, ([key, group]) => {
    const payload = eventPayload(group.latest);
    const first = payload.exception?.values?.[0];
    const frame = crashFrame(first?.stacktrace?.frames);
    const file = frame?.original_filename ?? frame?.filename;
    const line = frame?.original_lineno ?? frame?.lineno;
    const level = payload.level ?? "error";
    return {
      key,
      latestEventId: group.latest.id,
      code: group.latest.id.slice(0, 6).toUpperCase(),
      title: key,
      source: file
        ? `${file}:${line ?? "?"}`
        : payload.culprit ?? "unknown",
      tag: payload.release ?? payload.level ?? "—",
      level,
      severity: issueSeverity(level),
      events: group.count,
      users: group.users.size,
      firstSeen: group.firstSeen,
      lastSeen: group.latest.receivedAt,
    };
  }).sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen));
}
