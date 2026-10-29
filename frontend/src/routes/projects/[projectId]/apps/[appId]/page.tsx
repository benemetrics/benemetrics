import { useState } from "react";
import { useParams } from "react-router-dom";
import { Search } from "lucide-react";
import {
  useAppIssues,
  type IssueSummary,
} from "../../../../../hooks/use-app-issues";
import { useIssueStats } from "../../../../../hooks/use-issue-stats";
import { LevelBadge, Sparkline } from "../../../../../components/ui-kit";
import { IssueDetail } from "../../../../../components/issue-detail";
import { compact, timeAgo } from "../../../../../lib/utils";
import { cn } from "../../../../../lib/utils";
import { AppLayout } from "../../../../../components/app-layout";

// Each row trend is its own ClickHouse query — bound them to the first page
// (the backend default page size) so a long list can't fan out into hundreds.
const TROW_LIMIT = 20;

function RowTrend({ issueId, index }: { issueId: string; index: number }) {
  const { points } = useIssueStats(issueId, index < TROW_LIMIT);
  if (!points || points.length === 0) return null;
  return <Sparkline data={points} className="hidden w-16 sm:block" />;
}

export default function AppIssuesPage() {
  const { projectId, appId } = useParams<{
    projectId: string;
    appId: string;
  }>();
  if (!projectId || !appId) return null;
  return (
    <AppLayout>
      <AppIssuesInner projectId={projectId} appId={appId} />
    </AppLayout>
  );
}

function AppIssuesInner({
  projectId,
  appId,
}: {
  projectId: string;
  appId: string;
}) {
  const [statusFilter, setStatusFilter] = useState<
    "unresolved" | "resolved" | "ignored"
  >("unresolved");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { issues, loading, live, updateIssueStatus } = useAppIssues(
    projectId,
    appId,
  );

  const list = (issues ?? [])
    .filter((i: IssueSummary) => i.status === statusFilter)
    .filter(
      (i: IssueSummary) =>
        !q ||
        `${i.title} ${i.culprit} ${i.fingerprint} ${i.level}`
          .toLowerCase()
          .includes(q.toLowerCase()),
    )
    .sort((a: IssueSummary, b: IssueSummary) => b.eventCount - a.eventCount);

  const counts = {
    unresolved: (issues ?? []).filter((i) => i.status === "unresolved").length,
    resolved: (issues ?? []).filter((i) => i.status === "resolved").length,
    ignored: 0,
  };

  const selected =
    issues?.find((i: IssueSummary) => i.id === selectedId) ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-1 rounded-md bg-muted p-1">
            {(["unresolved", "resolved", "ignored"] as const).map(
              (s: "unresolved" | "resolved" | "ignored") => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={cn(
                    "rounded-sm px-3 py-1 text-xs capitalize",
                    statusFilter === s
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground",
                  )}
                >
                  {s} <span className="font-mono opacity-60">{counts[s]}</span>
                </button>
              ),
            )}
          </div>
          <label className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 sm:w-56">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={q}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setQ(e.target.value)
              }
              placeholder="Search issues…"
              className="w-full bg-transparent font-mono text-xs outline-none placeholder:text-muted-foreground"
            />
          </label>
          <span className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
            <span
              className={cn(
                "h-2 w-2 rounded-full bg-primary",
                live === "connected" && "animate-pulse",
              )}
            />{" "}
            live
          </span>
        </div>

        {loading ? (
          <div className="panel p-8 text-center font-mono text-sm text-muted-foreground">
            Loading issues…
          </div>
        ) : (
          <div className="panel divide-y">
            {list.length === 0 && (
              <div className="p-8 text-center font-mono text-sm text-muted-foreground">
                No {statusFilter} issues.
              </div>
            )}
            {list.map((i: IssueSummary, idx: number) => (
              <button
                key={i.id}
                onClick={() => setSelectedId(i.id)}
                className={cn(
                  "flex w-full items-center gap-3 p-3 text-left hover:bg-muted/60",
                  selectedId === i.id && "bg-accent",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <LevelBadge
                      level={i.level as "fatal" | "error" | "warning" | "info"}
                    />
                    <span className="truncate font-semibold">{i.type}</span>
                  </div>
                  <div className="mt-0.5 truncate text-sm text-muted-foreground">
                    {i.title}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 font-mono text-[11px] text-muted-foreground">
                    <span className="text-primary">
                      {i.fingerprint.slice(0, 8)}
                    </span>
                    <span>{timeAgo(i.lastSeen)}</span>
                    {i.userCount > 0 && (
                      <span>{compact(i.userCount)} users</span>
                    )}
                  </div>
                </div>
                <RowTrend issueId={i.id} index={idx} />
                <div className="w-12 text-right">
                  <div className="font-mono text-sm">
                    {compact(i.eventCount)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    events
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Desktop: side panel. Mobile: slide-over sheet. */}
      <div className="hidden lg:block">
        <div className="panel sticky top-16 max-h-[calc(100vh-5rem)] overflow-y-auto p-5">
          {selected ? (
            <IssueDetail
              issue={selected}
              status={selected.status}
              onStatus={(s: "unresolved" | "resolved" | "ignored") => {
                if (s !== "ignored") updateIssueStatus(selected.id, s);
              }}
            />
          ) : (
            <div className="py-20 text-center font-mono text-sm text-muted-foreground">
              ← Pick an issue to see its stack trace
            </div>
          )}
        </div>
      </div>
      {selected && (
        <div
          className="fixed inset-0 z-30 flex flex-col bg-foreground/20 lg:hidden"
          onClick={() => setSelectedId(null)}
        >
          <div
            className="mt-auto max-h-[88vh] overflow-y-auto rounded-t-xl border-t bg-card p-4"
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            <IssueDetail
              issue={selected}
              status={selected.status}
              onStatus={(s: "unresolved" | "resolved" | "ignored") => {
                if (s !== "ignored") updateIssueStatus(selected.id, s);
              }}
              onClose={() => setSelectedId(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
