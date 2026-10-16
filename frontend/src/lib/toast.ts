type ToastListener = (message: string) => void;

const listeners = new Set<ToastListener>();

/** Show a transient message (used to surface failed user actions). */
export function notify(message: string) {
  for (const listener of listeners) listener(message);
}

export function subscribeToasts(listener: ToastListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
