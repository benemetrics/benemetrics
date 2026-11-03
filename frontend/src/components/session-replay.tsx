import { useEffect, useRef } from "react";
import { MonitorPlay, X } from "lucide-react";
import rrwebPlayer from "rrweb-player";
import "rrweb-player/dist/style.css";
import { useReplay, type RrwebEvent } from "../hooks/use-replay";

/** Mounts the rrweb player once the session's rrweb events are assembled. */
function ReplayPlayer({ events }: { events: RrwebEvent[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const player = new rrwebPlayer({
      target: ref.current,
      props: {
        events: events as never,
        autoPlay: false,
        showController: true,
        speed: 1,
      },
    });
    return () => {
      (player as unknown as { $destroy: () => void }).$destroy();
    };
  }, [events]);

  return <div ref={ref} />;
}

export function SessionReplay({
  eventId,
  replayId,
}: {
  eventId: string;
  replayId: string;
}) {
  const { events, state } = useReplay(eventId, replayId, true);

  if (state === "loading") {
    return (
      <div className="flex h-40 items-center justify-center rounded-md border bg-card font-mono text-xs text-muted-foreground">
        Loading replay…
      </div>
    );
  }
  if (state === "missing") {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-1 rounded-md border bg-card text-center font-mono text-xs text-muted-foreground">
        <span>No rrweb data for this replay.</span>
        <span className="text-[11px]">The session may have expired.</span>
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className="flex h-40 items-center justify-center rounded-md border bg-card font-mono text-xs text-muted-foreground">
        Replay unavailable.
      </div>
    );
  }
  return events ? <ReplayPlayer events={events} /> : null;
}

export function ReplaySheet({
  open,
  onClose,
  eventId,
  replayId,
  title,
  meta,
}: {
  open: boolean;
  onClose: () => void;
  eventId: string;
  replayId: string;
  title: string;
  meta?: string | undefined;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Session replay"
        className="relative flex h-full w-full max-w-2xl flex-col overflow-y-auto border-l bg-background p-4 shadow-xl"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider text-primary">
              <MonitorPlay className="h-3.5 w-3.5" aria-hidden /> Session replay
            </div>
            <p className="mt-1 break-words text-sm font-semibold">{title}</p>
            {meta && (
              <p className="mt-0.5 break-words font-mono text-[11px] text-muted-foreground">
                {meta}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close replay"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <SessionReplay eventId={eventId} replayId={replayId} />
        <p className="mt-3 break-all font-mono text-[11px] text-muted-foreground">
          replay {replayId}
        </p>
      </div>
    </div>
  );
}
