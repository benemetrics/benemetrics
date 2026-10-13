import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageShell } from '../components/PageShell';
import { GettingStarted } from '../components/GettingStarted';
import { cn, relativeTime } from '../lib/utils';
import { checkHealth, listEvents } from '../lib/api';

type Severity = 'critical' | 'recovered' | 'high' | 'warning';

interface IssueRow {
  id: string;
  title: string;
  severity: Severity;
  culprit: string;
  version: string | null;
  seen: string;
  hasUser: boolean;
}

const severityStyles: Record<Severity, { text: string; dot: string; label: string }> = {
  critical: { text: 'text-error', dot: 'bg-error', label: 'CRITICAL' },
  recovered: { text: 'text-secondary', dot: 'bg-secondary', label: 'INFO' },
  high: { text: 'text-error', dot: 'bg-error', label: 'HIGH' },
  warning: { text: 'text-primary', dot: 'bg-primary', label: 'WARNING' },
};

const RUNTIME_COLORS = ['bg-primary', 'bg-secondary', 'bg-tertiary', 'bg-error'];

// Map a stored event from the ingestion API to an issue row
function eventToRow(id: string, event: any, receivedAt: string): IssueRow {
  const ex = event?.exception?.values?.[0];
  const title = ex ? `${ex.type}: ${ex.value}` : (event?.message ?? 'Unknown Event');
  const level = event?.level;
  const severity: Severity = level === 'fatal' ? 'critical' : level === 'error' ? 'high' : level === 'warning' ? 'warning' : 'recovered';
  const frames = ex?.stacktrace?.frames ?? [];
  const frame = frames[frames.length - 1];
  const culprit = frame?.filename
    ? `${frame.filename}:${frame.lineno ?? '?'}`
    : (event?.culprit ?? 'unknown');
  return {
    id,
    title,
    severity,
    culprit,
    version: event?.release ?? null,
    seen: relativeTime(receivedAt),
    hasUser: Boolean(event?.user?.id ?? event?.user?.email),
  };
}

// Aggregate real runtime SDK names from stored events
function aggregateRuntimes(events: Array<{ event: any }>) {
  const counts = new Map<string, number>();
  for (const e of events) {
    const raw = e.event?.sdk?.name ?? e.event?.platform;
    if (typeof raw !== 'string' || !raw) continue;
    const label = raw.replace(/^sentry\./, '').replace(/[._]/g, ' ').trim();
    if (!label) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count], i) => ({
      name,
      count,
      pct: total > 0 ? Math.round((count / total) * 100) : 0,
      bar: RUNTIME_COLORS[i % RUNTIME_COLORS.length]!,
    }));
}

export function IssuesTriage() {
  const [liveRows, setLiveRows] = useState<IssueRow[]>([]);
  const [txCount, setTxCount] = useState(0);
  const [rawEvents, setRawEvents] = useState<Array<{ event: any }>>([]);
  const [health, setHealth] = useState<{ status: string; eventsStored: number } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warning' } | null>(null);

  // Poll the ingestion API for live events + server health
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await listEvents();
        const events = (result?.data ?? []) as Array<{ id: string; itemTypes: string[]; event: any; receivedAt: string }>;
        const errorEvents = events.filter((e) => e.itemTypes?.includes('event'));
        const mapped = errorEvents.map((e) => eventToRow(e.id, e.event, e.receivedAt));
        const transactions = events.filter((e) => e.itemTypes?.includes('transaction')).length;
        if (!cancelled) {
          setLiveRows(mapped);
          setRawEvents(errorEvents);
          setTxCount(transactions);
        }
      } catch {
        // keep showing whatever we have on fetch failure
      }
      try {
        const h = await checkHealth();
        if (!cancelled && h?.data) setHealth(h.data);
      } catch {
        if (!cancelled) setHealth(null);
      }
    };
    load();
    const interval = setInterval(load, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const rows = liveRows;

  const runtimes = useMemo(() => aggregateRuntimes(rawEvents), [rawEvents]);
  const uniqueUsers = useMemo(() => {
    const ids = new Set<string>();
    for (const e of rawEvents) {
      const uid = e.event?.user?.id ?? e.event?.user?.email;
      if (uid) ids.add(String(uid));
    }
    return ids.size;
  }, [rawEvents]);

  const showToast = (message: string, type: 'success' | 'warning') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2200);
  };

  const toggleRow = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(rows.map((r) => r.id)) : new Set());
  };

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const someSelected = selected.size > 0 && selected.size < rows.length;
  const online = health?.status === 'ok';
  // Until the first event fires, the workspace is replaced by the getting-started guide
  const noEvents = rows.length === 0 && txCount === 0;

  const search = (
    <div className="relative w-full max-w-2xl">
      <span className="material-symbols-outlined absolute left-space-md top-1/2 -translate-y-1/2 text-outline text-[18px]">search</span>
      <input className="w-full h-9 pl-9 pr-14 bg-surface-container-low text-on-surface placeholder:text-outline text-body-md font-body-md rounded-xl focus:outline-none focus:bg-surface-container transition-all" placeholder="Search issues, transactions, tags or press ⌘K" type="text" />
      <div className="absolute right-space-sm top-1/2 -translate-y-1/2 flex items-center gap-0.5 px-space-xs py-0.5 bg-surface-container-highest rounded-DEFAULT text-outline font-label-code-sm text-label-code-sm">⌘K</div>
    </div>
  );

  const actions = (
    <button className="h-8 px-space-md bg-surface-container-low hover:bg-surface-container text-on-surface font-label-code-md text-label-code-md rounded-lg flex items-center gap-space-xs transition-colors" title="Create Alert Rule" type="button">
      <span className="material-symbols-outlined text-[16px] text-primary">add_alert</span>
      <span className="hidden sm:inline">New Alert</span>
    </button>
  );

  return (
    <PageShell search={search} actions={actions}>
      <div className="flex flex-col w-full pb-space-xl">
        {/* Top Context Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-md py-space-md mb-space-sm">
          <div className="flex items-center gap-space-md flex-wrap">
            <div className="flex items-center gap-space-xs">
              <span className={cn('w-2.5 h-2.5 rounded-full', online ? 'bg-secondary shadow-[0_0_8px_rgba(78,222,163,0.6)]' : 'bg-error')}></span>
              <span className="font-label-code-md text-label-code-md uppercase tracking-wider text-on-surface font-semibold">Live Triage</span>
            </div>
            <span className="text-outline-variant font-label-code-sm text-label-code-sm hidden sm:inline">/</span>
            <span className="font-label-code-sm text-label-code-sm text-primary bg-surface-container-high px-space-sm py-0.5 rounded-DEFAULT">polling every 2s</span>
          </div>
          <div className="flex items-center gap-space-sm">
            <div className="flex items-center bg-surface-container-low px-space-sm py-1 rounded-xl">
              <span className="material-symbols-outlined text-outline text-[16px] mr-1">history</span>
              <span className="font-label-code-sm text-label-code-sm text-on-surface-variant">Auto-reloading (2s)</span>
            </div>
            <button className="h-8 px-space-md bg-surface-container-low hover:bg-surface-container text-on-surface rounded-lg font-label-code-md text-label-code-md flex items-center gap-space-xs transition-colors" type="button">
              <span className="material-symbols-outlined text-[15px]">tune</span>
              <span>Configure Alerts</span>
            </button>
          </div>
        </div>

        {/* Metric Grid — all values derived from stored events */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-space-md mb-space-lg">
          <div className="bg-surface-container-low rounded-xl p-space-md flex flex-col justify-between relative overflow-hidden group hover:bg-surface-container transition-colors">
            <div className="flex items-start justify-between mb-space-sm">
              <span className="font-label-code-sm text-label-code-sm uppercase tracking-wider text-outline">Stored Error Events</span>
            </div>
            <div className="flex items-baseline justify-between mt-space-xs">
              <span className="font-headline-lg text-headline-lg text-on-surface tracking-tight">{rows.length}</span>
              <span className="font-label-code-sm text-label-code-sm text-outline">events</span>
            </div>
          </div>
          <div className="bg-surface-container-low rounded-xl p-space-md flex flex-col justify-between relative overflow-hidden group hover:bg-surface-container transition-colors">
            <div className="flex items-start justify-between mb-space-sm">
              <span className="font-label-code-sm text-label-code-sm uppercase tracking-wider text-outline">Total Envelopes</span>
            </div>
            <div className="flex items-baseline justify-between mt-space-xs">
              <span className="font-headline-lg text-headline-lg text-on-surface tracking-tight">{health?.eventsStored ?? '—'}</span>
              <span className="font-label-code-sm text-label-code-sm text-outline">stored</span>
            </div>
          </div>
          <div className="bg-surface-container-low rounded-xl p-space-md flex flex-col justify-between relative overflow-hidden group hover:bg-surface-container transition-colors">
            <div className="flex items-start justify-between mb-space-sm">
              <span className="font-label-code-sm text-label-code-sm uppercase tracking-wider text-outline">Transactions</span>
            </div>
            <div className="flex items-baseline justify-between mt-space-xs">
              <span className="font-headline-lg text-headline-lg text-primary tracking-tight">{txCount}</span>
              <span className="font-label-code-sm text-label-code-sm text-outline">traces</span>
            </div>
          </div>
          <div className="bg-surface-container-low rounded-xl p-space-md flex flex-col justify-between relative overflow-hidden group hover:bg-surface-container transition-colors">
            <div className="flex items-start justify-between mb-space-sm">
              <span className="font-label-code-sm text-label-code-sm uppercase tracking-wider text-outline">Impacted Users</span>
            </div>
            <div className="flex items-baseline justify-between mt-space-xs">
              <span className="font-headline-lg text-headline-lg text-on-surface tracking-tight">{uniqueUsers}</span>
              <span className="font-label-code-sm text-label-code-sm text-outline">unique</span>
            </div>
          </div>
        </div>

        {/* Workspace — replaced by the getting-started guide until the first event fires */}
        {noEvents ? (
          <GettingStarted />
        ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-space-md">
          {/* Left Column: Master Issues Feed */}
          <div className="xl:col-span-9 flex flex-col gap-space-xs">
            {/* Table Header Bar */}
            <div className="bg-surface-container-low px-space-md py-space-xs rounded-xl flex items-center justify-between text-outline font-label-code-sm text-label-code-sm tracking-wider uppercase">
              <div className="flex items-center gap-space-md flex-1">
                <label className="flex items-center cursor-pointer">
                  <input
                    checked={allSelected}
                    className="rounded bg-surface-container text-primary focus:ring-0 focus:outline-none w-3.5 h-3.5 border-0"
                    ref={(el) => { if (el) el.indeterminate = someSelected; }}
                    type="checkbox"
                    onChange={(e) => toggleAll(e.target.checked)}
                  />
                </label>
                <span>Issue / Root Culprit</span>
              </div>
              <div className="hidden md:flex items-center gap-space-lg w-40 justify-between">
                <span className="w-16 text-right">Events</span>
                <span className="w-14 text-right">Users</span>
              </div>
              <div className="w-20 text-right hidden sm:block">Action</div>
            </div>

            {/* Issues List */}
            <div className="flex flex-col gap-1.5">
              {rows.map((issue) => {
                const sev = severityStyles[issue.severity];
                return (
                  <div
                    key={issue.id}
                    className="issue-row bg-surface-container-low hover:bg-surface-container rounded-xl p-space-md transition-all flex flex-col md:flex-row items-start md:items-center justify-between gap-space-md relative overflow-hidden group"
                  >
                    <div className={cn('absolute left-0 top-0 bottom-0 w-1', issue.severity === 'critical' || issue.severity === 'high' ? 'bg-error' : 'bg-primary')}></div>
                    <div className="flex items-start gap-space-md flex-1 min-w-0">
                      <div className="pt-0.5">
                        <input
                          checked={selected.has(issue.id)}
                          className="issue-check rounded bg-surface-container text-primary focus:ring-0 focus:outline-none w-3.5 h-3.5 border-0 cursor-pointer"
                          type="checkbox"
                          onChange={(e) => toggleRow(issue.id, e.target.checked)}
                        />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-space-xs flex-wrap mb-1">
                          <Link
                            to={`/issue/${issue.id}`}
                            className="font-headline-sm text-headline-sm text-on-surface font-semibold hover:text-primary cursor-pointer truncate"
                          >
                            {issue.title}
                          </Link>
                        </div>
                        <div className="flex items-center gap-space-sm flex-wrap font-label-code-sm text-label-code-sm">
                          <span className={cn(sev.text, 'font-semibold flex items-center gap-1')}>
                            <span className={cn('w-1.5 h-1.5 rounded-full', sev.dot)}></span>
                            {sev.label}
                          </span>
                          <span className="text-outline-variant">•</span>
                          <span className="text-on-surface-variant font-mono">{issue.culprit}</span>
                          {issue.version && (
                            <>
                              <span className="text-outline-variant">•</span>
                              <span className="bg-surface-container px-1 rounded text-primary">{issue.version}</span>
                            </>
                          )}
                          <span className="text-outline-variant">•</span>
                          <span className="text-outline">{issue.seen}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between w-full md:w-auto md:gap-space-lg shrink-0">
                      <div className="hidden md:block w-16 text-right">
                        <span className="font-label-code-md text-label-code-md text-on-surface font-bold block">1</span>
                        <span className="font-label-code-sm text-label-code-sm text-outline block leading-none">event</span>
                      </div>
                      <div className="hidden md:block w-14 text-right">
                        <span className={cn('font-label-code-md text-label-code-md font-bold block', issue.hasUser ? 'text-on-surface' : 'text-outline')}>{issue.hasUser ? '1' : '—'}</span>
                        <span className="font-label-code-sm text-label-code-sm text-outline block leading-none">user</span>
                      </div>
                      <div className="flex items-center gap-space-xs md:w-20 justify-end">
                        <button className="w-7 h-7 rounded hover:bg-surface-container-highest text-outline hover:text-secondary flex items-center justify-center transition-colors" title="Resolve issue" type="button" onClick={() => showToast('Issue marked as RESOLVED', 'success')}>
                          <span className="material-symbols-outlined text-[16px]">check_circle</span>
                        </button>
                        <button className="w-7 h-7 rounded hover:bg-surface-container-highest text-outline hover:text-on-surface flex items-center justify-center transition-colors" title="Snooze alert" type="button" onClick={() => showToast('Issue silenced for 24h', 'warning')}>
                          <span className="material-symbols-outlined text-[16px]">notifications_paused</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Stream State Footer */}
            <div className="bg-surface-container-low px-space-md py-space-sm rounded-xl flex items-center justify-between text-outline font-label-code-sm text-label-code-sm mt-space-xs">
              <div className="flex items-center gap-space-sm">
                <span>Showing {rows.length} stored event{rows.length === 1 ? '' : 's'}</span>
                <span className="text-outline-variant">•</span>
                <span className={cn('flex items-center gap-1', online ? 'text-secondary' : 'text-error')}>
                  <span className={cn('w-1.5 h-1.5 rounded-full', online ? 'bg-secondary' : 'bg-error')}></span>
                  {online ? 'Stream connected' : 'Stream offline'}
                </span>
              </div>
              <span className="hidden sm:inline">refreshed every 2s</span>
            </div>
          </div>

          {/* Right Column: Live Context & Runtime Breakdown */}
          <div className="xl:col-span-3 flex flex-col gap-space-md">
            {/* Server Health Card */}
            <div className="bg-surface-container-low rounded-xl p-space-md flex flex-col gap-space-md shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-space-xs">
                  <span className={cn('relative flex h-2 w-2', online && 'animate-ping')}>
                    <span className={cn('relative inline-flex rounded-full h-2 w-2', online ? 'bg-primary' : 'bg-error')}></span>
                  </span>
                  <span className="font-label-code-sm text-label-code-sm uppercase tracking-wider text-on-surface font-semibold">Server Health</span>
                </div>
                <span className={cn('font-label-code-sm text-label-code-sm bg-surface-container px-space-xs py-0.5 rounded', online ? 'text-primary' : 'text-error')}>
                  {health ? health.status : 'unreachable'}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-space-sm pt-space-xs">
                <div className="bg-surface-container p-space-sm rounded-lg flex items-center justify-between">
                  <div>
                    <span className="font-label-code-sm text-label-code-sm text-outline block">Events Stored</span>
                    <span className="font-headline-sm text-headline-sm text-on-surface font-bold mt-0.5">{health?.eventsStored ?? '—'}</span>
                  </div>
                  <div className="w-9 h-9 rounded bg-surface-container-high flex items-center justify-center text-primary">
                    <span className="material-symbols-outlined text-[20px]">database</span>
                  </div>
                </div>
                <div className="bg-surface-container p-space-sm rounded-lg flex items-center justify-between">
                  <div>
                    <span className="font-label-code-sm text-label-code-sm text-outline block">Error Events</span>
                    <span className="font-headline-sm text-headline-sm text-on-surface font-bold mt-0.5">{rows.length}</span>
                  </div>
                  <div className="w-9 h-9 rounded bg-surface-container-high flex items-center justify-center text-error">
                    <span className="material-symbols-outlined text-[20px]">bug_report</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Runtime Triage Breakdown — aggregated from real SDK names */}
            <div className="bg-surface-container-low rounded-xl p-space-md flex flex-col gap-space-md shadow-sm">
              <div className="flex items-center justify-between">
                <span className="font-label-code-sm text-label-code-sm uppercase tracking-wider text-outline">Runtime Distribution</span>
                <span className="material-symbols-outlined text-outline text-[16px]">pie_chart</span>
              </div>
              {runtimes.length === 0 ? (
                <p className="font-body-sm text-body-sm text-on-surface-variant">No SDK metadata in stored events yet.</p>
              ) : (
                <div className="flex flex-col gap-space-sm">
                  {runtimes.map((rt) => (
                    <div key={rt.name} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between font-label-code-sm text-label-code-sm">
                        <span className="text-on-surface font-semibold flex items-center gap-1.5">
                          <span className={cn('w-2 h-2 rounded-full', rt.bar)}></span>
                          {rt.name}
                        </span>
                        <span className="text-on-surface font-mono">{rt.count} ({rt.pct}%)</span>
                      </div>
                      <div className="w-full bg-surface-container h-1.5 rounded-full overflow-hidden">
                        <div className={cn('h-full rounded-full', rt.bar)} style={{ width: `${rt.pct}%` }}></div>
                      </div>
                    </div>
                  ))}
                </div>
                  )}
                </div>
              </div>
            </div>
        )}
      </div>

      <ToastBubble toast={toast} />
    </PageShell>
  );
}

function ToastBubble({ toast }: { toast: { message: string; type: 'success' | 'warning' } | null }) {
  if (!toast) return null;
  return (
    <div className="fixed bottom-20 right-4 lg:bottom-6 lg:right-6 z-[60] px-4 py-2.5 rounded-xl bg-surface-container-high shadow-lg flex items-center gap-2">
      <span className={cn('w-2 h-2 rounded-full', toast.type === 'success' ? 'bg-secondary' : 'bg-error')} />
      <span className="font-body-sm text-body-sm text-on-surface">{toast.message}</span>
    </div>
  );
}
