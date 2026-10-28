import { useParams, Link } from "react-router-dom";
import { useEventPayload } from "../../../../../../../hooks/use-event-payload";
import { Stacktrace, exceptionsFromPayload } from "../../../../../../../components/stacktrace";
import { LevelBadge, Pill } from "../../../../../../../components/ui-kit";
import { AppLayout } from "../../../../../../../components/app-layout";
import { LoadingScreen } from "../../../../../../../components/loading-screen";
import { NotFoundPage } from "../../../../../../../components/not-found";
import { timeAgo } from "../../../../../../../lib/utils";

export default function EventPage() {
  const { projectId, appId, eventId } = useParams<{ projectId: string; appId: string; eventId: string }>();
  if (!projectId || !appId || !eventId) return null;
  return (
    <AppLayout>
      <EventDetail eventId={eventId} appId={appId} projectId={projectId} />
    </AppLayout>
  );
}

function EventDetail({ eventId, appId, projectId }: { eventId: string; appId: string; projectId: string }) {
  const { payload, loading, notFound } = useEventPayload(eventId);

  if (loading) return <LoadingScreen />;
  if (notFound || !payload) return <NotFoundPage />;

  const level = (payload["level"] as string) ?? "info";
  const message = (payload["message"] as string) ?? (payload["transaction"] as string) ?? "Unknown";
  const tags = (payload["tags"] as Record<string, unknown> | undefined) ?? {};
  const user = payload["user"] as { email?: string; username?: string; id?: string } | undefined;
  const receivedAt = payload["timestamp"] as string | undefined;

  return (
    <div className="space-y-4">
      <Link to={`/projects/${projectId}/apps/${appId}/events`} className="font-mono text-xs text-muted-foreground hover:text-foreground">
        ← All events
      </Link>
      <div className="panel max-w-3xl space-y-4 p-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <LevelBadge level={level as any} />
            <span className="font-mono text-xs text-primary">{eventId.slice(0, 8)}</span>
            {receivedAt && <span className="font-mono text-xs text-muted-foreground">{timeAgo(receivedAt)}</span>}
          </div>
          <h2 className="mt-2 break-words text-lg font-bold">{message}</h2>
        </div>

        {Object.keys(tags).length > 0 && (
          <div className="flex flex-wrap gap-1">
            {Object.entries(tags).map(([k, v]) => (
              <Pill key={k}>{k}: <span className="text-foreground">{String(v)}</span></Pill>
            ))}
          </div>
        )}

        {user && (
          <section>
            <h3 className="mb-1 font-mono text-xs uppercase tracking-wider text-muted-foreground">User</h3>
            <div className="font-mono text-xs text-muted-foreground">
              {user.email ?? user.username ?? user.id ?? "unknown"}
            </div>
          </section>
        )}

        <Stacktrace exceptions={exceptionsFromPayload(payload)} />

        <section className="space-y-1 font-mono text-xs text-muted-foreground">
          <div>Event id: {eventId}</div>
          {typeof payload["environment"] === "string" && <div>Environment: {payload["environment"]}</div>}
          {typeof payload["release"] === "string" && <div>Release: {payload["release"]}</div>}
          {typeof payload["platform"] === "string" && <div>Platform: {payload["platform"]}</div>}
        </section>
      </div>
    </div>
  );
}
