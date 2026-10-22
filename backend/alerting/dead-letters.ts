/**
 * The dead letter queue: the deliveries that failed are retried with a
 * backoff, and the ones that keep failing stay in the queue for an
 * operator to look at.
 */
import { alertDeadLetterDAO } from "db/dao/alert-dead-letters";
import { alertChannelDAO } from "db/dao/alert-channels";
import type { AlertNotification } from "../protocol/alerting";
import { enqueueDelivery } from "./notifiers";

// The first retry waits a minute; every further attempt doubles it, up to
// an hour.
const RETRY_BASE_MS = Number(process.env.ALERT_DEAD_LETTER_BASE_MS) || 60_000;
const RETRY_MAX_MS = Number(process.env.ALERT_DEAD_LETTER_MAX_MS) || 3_600_000;

function backoffMs(attempts: number): number {
  const delay = RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1);
  return Math.min(delay, RETRY_MAX_MS);
}

/** Retries the deliveries that are due. */
export async function retryDeadLetters(): Promise<void> {
  const due = await alertDeadLetterDAO.listDue(new Date().toISOString());
  for (const letter of due) {
    const channel = await alertChannelDAO.findById(letter.channelId);
    if (!channel) {
      // The channel is gone — the delivery has nowhere to go.
      await alertDeadLetterDAO.delete(letter.id);
      continue;
    }
    const result = await enqueueDelivery(
      channel,
      letter.notification as AlertNotification,
    );
    if (result.ok) {
      await alertDeadLetterDAO.delete(letter.id);
      continue;
    }
    const attempts = letter.attempts + 1;
    await alertDeadLetterDAO.recordAttempt(
      letter.id,
      result.error ?? "the delivery failed",
      new Date(Date.now() + backoffMs(attempts)).toISOString(),
    );
  }
}

let workerTimer: ReturnType<typeof setInterval> | null = null;

/** Starts the retry worker (the interval is unref'd — it never keeps the
 * process alive). */
export function startDeadLetterWorker(): void {
  if (workerTimer !== null) return;
  const intervalMs = Number(process.env.ALERT_DEAD_LETTER_INTERVAL_MS) || 60_000;
  workerTimer = setInterval(() => {
    void retryDeadLetters().catch((error: unknown) => {
      console.error(
        "[alerting] the dead letter retry failed:",
        error instanceof Error ? error.message : error,
      );
    });
  }, intervalMs);
  workerTimer.unref();
}

export function stopDeadLetterWorker(): void {
  if (workerTimer === null) return;
  clearInterval(workerTimer);
  workerTimer = null;
}
