import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, BellDot, Trash2 } from "lucide-react";
import { useNotifications } from "../../hooks/use-notifications";
import { Btn, Crumbs } from "../../components/ui-kit";
import { LoadingScreen } from "../../components/loading-screen";
import { cn } from "../../lib/utils";
import { useSession } from "../../hooks/use-session";

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { status } = useSession();
  if (status === "loading") return <LoadingScreen />;
  const { letters, loading, error, reload, dismiss } = useNotifications();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Btn
          variant="ghost"
          onClick={() => navigate(-1)}
          className="text-xs"
        >
          <ArrowLeft className="h-3 w-3 mr-1" /> Back to settings
        </Btn>
        <div className="flex items-center gap-2">
          <Badge tone={letters.length ? "destructive" : "muted"}>
            {letters.length}
          </Badge>
          <Btn variant="ghost" onClick={reload} disabled={loading} className="text-xs">
            <BellDot className="h-3 w-3 mr-1" /> Refresh
          </Btn>
        </div>
      </div>

      <div>
        <Crumbs items={[{ label: "settings" }, { label: "notifications" }]} />
        <h1 className="mt-3 text-3xl font-bold tracking-tight">
          Notifications
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Dead-lettered deliveries — notifications that could not be delivered
          after retries and now wait in JetStream for you to dismiss.
        </p>
      </div>

      {loading && <LoadingScreen />}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <section className="space-y-3">
        {letters.length === 0 && !loading && (
          <div className="panel p-8 text-center font-mono text-sm text-muted-foreground">
            No dead-lettered notifications.
          </div>
        )}
        {letters.map((letter) => {
          const n = letter.notification as { title?: string; message?: string };
          const c = letter.channel as { name?: string; type?: string };
          return (
            <div
              key={letter.seq}
              className="panel p-4 border-l-2 border-destructive"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <PillInline tone="destructive">{c.type}</PillInline>
                    <span className="font-mono text-xs text-muted-foreground">
                      {new Date(letter.failedAt).toLocaleString()}
                    </span>
                  </div>
                  <h3 className="font-bold text-sm">{n.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground break-all">
                    {n.message}
                  </p>
                  <div className="mt-2 flex gap-2 font-mono text-xs">
                    <span>channel: {c.name}</span>
                    <span>attempts: {letter.attempts}</span>
                    <span className="text-destructive">{letter.error}</span>
                  </div>
                </div>
                <Btn variant="danger" onClick={() => dismiss(letter.seq)}>
                  <Trash2 className="h-3 w-3 mr-1" /> Dismiss
                </Btn>
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}

function PillInline({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "destructive";
}) {
  const tones = {
    muted: "bg-muted text-muted-foreground border-border",
    destructive: "bg-destructive/10 text-destructive border-destructive/30",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

function Badge({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "destructive";
}) {
  const tones = {
    muted: "bg-muted text-muted-foreground border-border",
    destructive: "bg-destructive/10 text-destructive border-destructive/30",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}
