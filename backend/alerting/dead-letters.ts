/**
 * The dead letter queue: the deliveries that failed are retried with a
 * backoff, and the ones that keep failing stay in the queue for an
 * operator to look at.
 *
 * No-op stub: the alert_dead_letters table is not provisioned in the
 * schema, so the retry worker does nothing.
 */

// The first retry waits a minute; every further attempt doubles it, up to
// an hour.
const RETRY_BASE_MS = Number(process.env.ALERT_DEAD_LETTER_BASE_MS) || 60_000;
const RETRY_MAX_MS = Number(process.env.ALERT_DEAD_LETTER_MAX_MS) || 3_600_000;

function backoffMs(attempts: number): number {
  const delay = RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1);
  return Math.min(delay, RETRY_MAX_MS);
}

/** Retries the deliveries that are due — no-op (no dead letter table). */
export async function retryDeadLetters(): Promise<void> {
  return;
}

let workerTimer: ReturnType<typeof setInterval> | null = null;

/** Starts the retry worker — no-op (no dead letter table). */
export function startDeadLetterWorker(): void {
  return;
}

export function stopDeadLetterWorker(): void {
  return;
}
