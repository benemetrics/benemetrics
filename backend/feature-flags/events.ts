import { consumeFlagChanges, publishFlagChangeEvent } from "../nats";

export interface FlagChangeEvent {
  type: "create" | "update" | "status" | "delete";
  flagKey: string;
  flag?: unknown;
}

type FlagChangeListener = (event: FlagChangeEvent) => void;

const listeners = new Set<FlagChangeListener>();

// The stream echoes a change back to its publisher; the origin skips it.
const ORIGIN = crypto.randomUUID();

export function subscribeFlagChanges(listener: FlagChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(event: FlagChangeEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // A broken listener must not block the other listeners.
    }
  }
}

export async function publishFlagChange(event: FlagChangeEvent): Promise<void> {
  emit(event);
  try {
    await publishFlagChangeEvent({ ...event, origin: ORIGIN });
  } catch (err) {
    // The change is already committed; a failed publish only means other
    // instances did not hear about it.
    console.error(
      "[flags] Failed to publish the change to NATS:",
      err instanceof Error ? err.message : err,
    );
  }
}

export function subscribeRemoteFlagChanges(): void {
  void consumeFlagChanges((event) => {
    if (event.origin === ORIGIN) return;
    emit({
      type: event.type as FlagChangeEvent["type"],
      flagKey: event.flagKey,
      flag: event.flag,
    });
  }).catch((err: unknown) => {
    console.error(
      "[flags] The flag change consumer stopped:",
      err instanceof Error ? err.message : err,
    );
  });
}
