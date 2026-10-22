/**
 * Shared event-payload helpers for the dashboard and event detail.
 *
 * Issue identity — fingerprint, status, counters — comes from the admin
 * issues API; the frontend only reads a stored event's payload here, to
 * title a row.
 */

export interface StoredEvent {
  id: string;
  itemTypes?: string[] | null;
  event: unknown;
  receivedAt: string;
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

export function eventTitle(event: StoredEvent): string {
  const payload = eventPayload(event);
  const first = payload.exception?.values?.[0];
  if (first) return `${first.type ?? "Error"}: ${first.value ?? ""}`;
  return payload.message ?? "Unknown Event";
}
