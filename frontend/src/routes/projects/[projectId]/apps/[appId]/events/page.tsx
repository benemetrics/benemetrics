import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useEvents, type EventRecord } from "../../../../../../hooks/use-events";
import { LevelBadge } from "../../../../../../components/ui-kit";
import { cn } from "../../../../../../lib/utils";
import { AppLayout } from "../../../../../../components/app-layout";
import { LoadingScreen } from "../../../../../../components/loading-screen";

function EventsInner({ projectId, appId }: { projectId: string; appId: string }) {
  const { events, loading } = useEvents(projectId, appId);
  const [level, setLevel] = useState<string | "all">("all");

  const list = (events ?? []).filter((e: EventRecord) => level === "all" || (e.event as Record<string, unknown>)?.["level"] === level || (e.transaction as Record<string, unknown>)?.["type"] === level);

  if (loading) return <LoadingScreen />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {(["all", "fatal", "error", "warning"] as const).map((l) => (
          <button key={l} onClick={() => setLevel(l)} className={cn("rounded-sm border px-2 py-1 font-mono text-xs", level === l ? "border-primary text-primary" : "text-muted-foreground")}>
            {l}
          </button>
        ))}
      </div>
      <div className="overflow-hidden rounded-lg border bg-code font-mono text-xs">
        {list.length === 0 && <div className="p-4 text-center text-muted-foreground">No events.</div>}
        {list.map((e: EventRecord) => {
          const payload = (e.event ?? e.transaction) as Record<string, unknown> | null;
          return (
            <Link
              key={e.id}
              to={`/projects/${projectId}/apps/${appId}/events/${e.id}`}
              className="flex flex-col gap-1 border-b px-3 py-2 text-foreground last:border-0 hover:bg-muted/40 md:flex-row md:items-center md:gap-3"
            >
              <span className="w-20 shrink-0 text-muted-foreground">{new Date(e.receivedAt).toLocaleDateString()}</span>
              <span className="shrink-0"><LevelBadge level={(payload as any)?.level ?? "info"} /></span>
              <span className="min-w-0 flex-1 truncate">{(e.event as any)?.message ?? (e.transaction as any)?.name ?? "Unknown"}</span>
              <span className="shrink-0 text-muted-foreground">{e.itemTypes.join(", ")}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export default function EventsPage() {
  const { projectId, appId } = useParams<{ projectId: string; appId: string }>();
  if (!projectId || !appId) return null;
  return (
    <AppLayout>
      <EventsInner projectId={projectId} appId={appId} />
    </AppLayout>
  );
}
