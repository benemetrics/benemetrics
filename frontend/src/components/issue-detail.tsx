import { useState } from "react";
import { Check, EyeOff, MonitorPlay, RotateCcw, X } from "lucide-react";
import { Btn, formatReplayDuration, LevelBadge, Pill, ReplayBadge, Sparkline } from "./ui-kit";
import { ReplaySheet } from "./session-replay";
import { Stacktrace, exceptionsFromPayload } from "./stacktrace";
import { useIssueStats } from "../hooks/use-issue-stats";
import { useIssueEvents, type IssueOccurrence } from "../hooks/use-issue-events";
import { useEventPayload } from "../hooks/use-event-payload";
import { compact, timeAgo } from "../lib/utils";

// The structural subset both the issue list summary and the issue detail
// record satisfy; the release/event fields render only when present.
export interface IssueDetailFields {
  id: string;
  fingerprint: string;
  title: string;
  culprit: string | null;
  level: string;
  type: string;
  eventCount: number;
  userCount?: number;
  tags?: Record<string, string> | null;
  firstSeen: string;
  lastSeen: string;
  firstRelease?: string | null;
  lastRelease?: string | null;
  latestEventId?: string | null;
}

export function IssueDetail({
  issue,
  status,
  onStatus,
  onClose,
}: {
  issue: IssueDetailFields;
  status: string;
  onStatus: (s: "unresolved" | "resolved" | "ignored") => void;
  onClose?: () => void;
}) {
  const { points } = useIssueStats(issue.id);
  const { events: recent } = useIssueEvents(issue.id);
  const { payload } = useEventPayload(issue.latestEventId ?? undefined);
  const exceptions = exceptionsFromPayload(payload);
  const [replay, setReplay] = useState<IssueOccurrence | null>(null);

  const recentEvents = recent ?? [];
  const replayable = recentEvents.filter((e) => e.hasReplay);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <LevelBadge level={issue.level as any} />
            <span className="font-mono text-xs text-primary">
              {issue.fingerprint.slice(0, 8)}
            </span>
            <Pill
              tone={
                status === "resolved"
                  ? "primary"
                  : status === "ignored"
                    ? "muted"
                    : "destructive"
              }
            >
              {status}
            </Pill>
          </div>
          <h2 className="mt-2 text-lg font-bold">{issue.type}</h2>
          <p className="text-sm text-muted-foreground">{issue.title}</p>
          {issue.culprit && (
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              {issue.culprit}
            </p>
          )}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {status === "unresolved" ? (
          <>
            <Btn variant="primary" onClick={() => onStatus("resolved")}>
              <Check className="h-4 w-4" />
              Resolve
            </Btn>
            <Btn onClick={() => onStatus("ignored")}>
              <EyeOff className="h-4 w-4" />
              Ignore
            </Btn>
          </>
        ) : (
          <Btn onClick={() => onStatus("unresolved")}>
            <RotateCcw className="h-4 w-4" />
            Reopen
          </Btn>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2 font-mono text-xs">
        {(
          [
            ["events", compact(issue.eventCount)],
            ["users", compact(issue.userCount ?? 0)],
            ["first", timeAgo(issue.firstSeen)],
            ["last", timeAgo(issue.lastSeen)],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="rounded-md bg-muted px-2 py-1.5">
            <div className="text-[10px] uppercase text-muted-foreground">
              {k}
            </div>
            <div className="text-sm font-semibold">{v}</div>
          </div>
        ))}
      </div>

      {points && points.length > 0 && (
        <Sparkline data={points} className="h-12 w-full" />
      )}

      <Stacktrace exceptions={exceptions} />

      {issue.tags && Object.keys(issue.tags).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {Object.entries(issue.tags).map(([k, v]) => (
            <Pill key={k}>
              {k}: <span className="text-foreground">{v}</span>
            </Pill>
          ))}
        </div>
      )}

      {replayable.length > 0 && (
        <section>
          <h3 className="mb-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Session replay
          </h3>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-code p-3">
            <div className="flex h-12 w-16 shrink-0 items-center justify-center rounded-sm border border-primary/40 bg-primary/10 text-primary">
              <MonitorPlay className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0 flex-1 font-mono text-xs">
              <div className="font-semibold">rrweb recording</div>
              <div className="text-muted-foreground">
                {replayable.length} recent event{replayable.length > 1 ? "s" : ""} with replay · latest {formatReplayDuration(replayable[0]?.replayDuration)}
              </div>
            </div>
            <Btn variant="primary" onClick={() => setReplay(replayable[0] ?? null)}>
              <MonitorPlay className="h-4 w-4" />Watch replay
            </Btn>
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Recent events
        </h3>
        <div className="divide-y rounded-lg border">
          {!recent && (
            <div className="p-3 text-xs text-muted-foreground">
              Loading events…
            </div>
          )}
          {recent?.length === 0 && (
            <div className="p-3 text-xs text-muted-foreground">
              No recent events.
            </div>
          )}
          {recent?.map((e) => (
            <div
              key={e.messageId}
              className="flex justify-between gap-2 px-3 py-2 font-mono text-[11px]"
            >
              <span className="text-primary">{e.eventId.slice(0, 10)}</span>
              <span className="truncate text-muted-foreground">
                {e.user ?? "unknown"}
                {e.environment ? ` · ${e.environment}` : ""}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {timeAgo(e.receivedAt)}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-1 font-mono text-xs text-muted-foreground">
        {issue.firstRelease && <div>First release: {issue.firstRelease}</div>}
        {issue.lastRelease && <div>Last release: {issue.lastRelease}</div>}
        {issue.latestEventId && (
          <div>Latest event: {issue.latestEventId.slice(0, 16)}…</div>
        )}
      </section>

      <ReplaySheet
        open={!!replay}
        onClose={() => setReplay(null)}
        title={replay?.title ?? ""}
        duration={replay?.replayDuration ?? 0}
        meta={replay ? `${replay.user ?? "unknown"} · ${replay.environment ?? "unknown"}` : undefined}
      />
    </div>
  );
}
