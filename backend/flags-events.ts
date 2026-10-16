import { publishFlagChangeEvent } from "./nats";

export interface FlagChangeEvent {
  type: "create" | "update" | "status" | "delete";
  flagKey: string;
  flag?: unknown;
}

type FlagChangeListener = (event: FlagChangeEvent) => void;

const listeners = new Set<FlagChangeListener>();

export function subscribeFlagChanges(listener: FlagChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishFlagChange(event: FlagChangeEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // A broken listener must not block the other listeners (or the
      // NATS publish below).
    }
  }
  void publishFlagChangeEvent(event);
}
