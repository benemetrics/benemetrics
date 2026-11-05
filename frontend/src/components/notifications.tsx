import { useState } from "react";
import { BellRing, Bell, CheckCircle2, RotateCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { useNotifications, type NotificationDeadLetter } from "../hooks/use-notifications";

interface NotificationBellProps {
  letters?: NotificationDeadLetter[];
  loading?: boolean;
  dismiss?: (seq: number) => Promise<boolean>;
  resend?: (seq: number) => Promise<boolean>;
}

/**
 * Harbor-style notification bell: a popover listing undelivered (dead-lettered)
 * alerts with resend/delete actions. Backed by the JetStream DLQ endpoints
 * (GET/DELETE/PATCH /api/admin/notifications/dlq/*). When no props are passed
 * it subscribes to its own `useNotifications()` instance.
 */
export function NotificationBell({
  letters: lettersProp,
  loading: loadingProp,
  dismiss: dismissProp,
  resend: resendProp,
}: NotificationBellProps = {}) {
  const { letters: hookLetters, loading: hookLoading, dismiss: hookDismiss, resend: hookResend } = useNotifications();
  const letters = lettersProp ?? hookLetters;
  const loading = loadingProp ?? hookLoading;
  const dismiss = dismissProp ?? hookDismiss;
  const resend = resendProp ?? hookResend;
  const [open, setOpen] = useState(false);

  const count = letters.length;

  const handleResend = async (id: string, alert: string, channel: string) => {
    const ok = await resend(Number(id));
    if (!ok) {
      toast.error(`Failed to resend "${alert}" to ${channel}`);
      return;
    }
    toast.success(`Resent "${alert}" to ${channel}`);
    setOpen(false);
  };

  const handleDismiss = async (id: string, alert: string, channel: string) => {
    const ok = await dismiss(Number(id));
    if (!ok) {
      toast.error(`Failed to dismiss "${alert}"`);
      return;
    }
    toast.success(`Deleted "${alert}" notification`);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label={`Notifications, ${count} undelivered`}
          className="relative flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted"
        >
          <Bell className="h-4 w-4" />
          {count > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-semibold text-destructive-foreground ring-2 ring-background">
              {count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[min(92vw,380px)] overflow-hidden p-0 shadow-md">
        <div className="flex items-center gap-2.5 border-b bg-muted/50 px-3 py-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-destructive/10 text-destructive">
            <BellRing className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Undelivered alerts</p>
            <p className="text-xs text-muted-foreground">Fired, but failed after retries.</p>
          </div>
          {count > 0 && (
            <span className="rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 font-mono text-[10px] text-destructive">
              {count}
            </span>
          )}
        </div>
        {count === 0 && !loading ? (
          <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
            <CheckCircle2 className="h-6 w-6 text-primary" />
            <p className="text-sm font-medium">All caught up</p>
            <p className="text-xs text-muted-foreground">Every alert was delivered.</p>
          </div>
        ) : (
          <ul className="max-h-96 divide-y overflow-auto">
            {letters.map((letter) => {
              const n = letter.notification as { title?: string; message?: string };
              const c = letter.channel as { name?: string; type?: string };
              return (
                <li key={letter.seq} className="relative space-y-1.5 py-3 pl-4 pr-3 transition-colors before:absolute before:inset-y-3 before:left-0 before:w-0.5 before:rounded-full before:bg-destructive hover:bg-muted/40">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 text-sm font-medium">{n.title}</p>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{letter.failedAt}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{n.message}</p>
                  <p className="break-words rounded-sm bg-destructive/5 px-1.5 py-1 font-mono text-[11px] text-destructive">
                    {letter.attempts} attempts · {letter.error}
                  </p>
                  <div className="flex gap-1.5 pt-0.5">
                    <button
                      onClick={() => handleResend(String(letter.seq), n.title ?? "alert", c.name ?? "channel")}
                      className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      disabled={loading}
                    >
                      <RotateCw className="h-3 w-3" /> Resend
                    </button>
                    <button
                      onClick={() => handleDismiss(String(letter.seq), n.title ?? "alert", c.name ?? "channel")}
                      className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                      disabled={loading}
                    >
                      <Trash2 className="h-3 w-3" /> Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
