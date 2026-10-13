import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Modal } from '../components/ui';
import { cn } from '../lib/utils';
import { listEvents } from '../lib/api';

type Severity = 'critical' | 'recovered' | 'high' | 'warning';

interface IssueRow {
  id: string;
  title: string;
  severity: Severity;
  culprit: string;
  version: string;
  deploy: string;
  seen: string;
  events: string;
  users: string;
  assignee: string;
  assigneeTitle: string;
  assigneeClass: string;
  leftBar: string;
  bars: string[];
}

const severityStyles: Record<Severity, { text: string; dot: string; label: string }> = {
  critical: { text: 'text-error', dot: 'bg-error', label: 'CRITICAL' },
  recovered: { text: 'text-secondary', dot: 'bg-secondary', label: 'RECOVERED' },
  high: { text: 'text-error', dot: 'bg-error', label: 'HIGH LEVEL' },
  warning: { text: 'text-primary', dot: 'bg-primary', label: 'WARNING' },
};

const MOCK_ROWS: IssueRow[] = [
  {
    id: '1',
    title: 'DatabaseConnectionPoolTimeout: driver failed to allocate slot within 5000ms',
    severity: 'critical',
    culprit: 'postgres_pool.go:142',
    version: 'v2.4.1',
    deploy: 'deploy #8819',
    seen: 'seen 3m ago',
    events: '1.4k',
    users: '82',
    assignee: 'SL',
    assigneeTitle: 'Assigned to SRE_Lead',
    assigneeClass: 'bg-surface-container-highest text-primary font-bold',
    leftBar: 'bg-error',
    bars: [
      'bg-surface-container-highest h-2', 'bg-surface-container-highest h-2', 'bg-surface-container-highest h-3', 'bg-surface-container-highest h-2',
      'bg-error/40 h-4', 'bg-error/70 h-5', 'bg-error h-full shadow-[0_0_6px_rgba(255,180,171,0.5)]',
    ],
  },
  {
    id: '2',
    title: 'JsonWebTokenError: invalid algorithm RS256 expected EdDSA in token header',
    severity: 'recovered',
    culprit: 'auth.middleware.ts:89',
    version: 'v2.4.0',
    deploy: 'deploy #8812',
    seen: 'seen 18m ago',
    events: '892',
    users: '34',
    assignee: '--',
    assigneeTitle: 'Unassigned',
    assigneeClass: 'bg-surface-container-highest text-outline',
    leftBar: 'bg-secondary-container',
    bars: [
      'bg-secondary/70 h-4', 'bg-secondary h-full', 'bg-secondary/50 h-3', 'bg-surface-container-highest h-1',
      'bg-surface-container-highest h-1', 'bg-surface-container-highest h-1', 'bg-surface-container-highest h-1',
    ],
  },
  {
    id: '3',
    title: 'OutOfMemoryError: Java heap space during parallel parquet ledger deserialization',
    severity: 'high',
    culprit: 'SyncEngineJob.kt:204',
    version: 'v2.4.1',
    deploy: 'deploy #8819',
    seen: 'seen 41m ago',
    events: '412',
    users: '16',
    assignee: 'DE',
    assigneeTitle: 'Assigned to Data Eng',
    assigneeClass: 'bg-tertiary-container text-on-tertiary-container font-bold',
    leftBar: 'bg-error',
    bars: [
      'bg-surface-container-highest h-1', 'bg-surface-container-highest h-1', 'bg-error/30 h-2', 'bg-error/40 h-3',
      'bg-error/60 h-4', 'bg-error/90 h-5', 'bg-error h-full',
    ],
  },
  {
    id: '4',
    title: 'stripe.error.APIConnectionError: Request timed out idempotency_key=idmp_99182a',
    severity: 'warning',
    culprit: 'stripe_client.py:91',
    version: 'v2.3.9',
    deploy: 'deploy #8794',
    seen: 'seen 1h ago',
    events: '214',
    users: '10',
    assignee: '--',
    assigneeTitle: 'Unassigned',
    assigneeClass: 'bg-surface-container-highest text-outline',
    leftBar: 'bg-primary',
    bars: [
      'bg-primary/40 h-3', 'bg-primary/60 h-4', 'bg-primary/80 h-5', 'bg-primary/40 h-2',
      'bg-primary/30 h-2', 'bg-surface-container-highest h-1', 'bg-surface-container-highest h-1',
    ],
  },
  {
    id: '5',
    title: 'RedisClientException: ERR max number of clients reached (10000) on cache-shard-03',
    severity: 'high',
    culprit: 'session_store.go:77',
    version: 'v2.4.1',
    deploy: 'deploy #8819',
    seen: 'seen 2h ago',
    events: '330',
    users: '22',
    assignee: 'SL',
    assigneeTitle: 'Assigned to SRE_Lead',
    assigneeClass: 'bg-surface-container-highest text-primary font-bold',
    leftBar: 'bg-error',
    bars: [
      'bg-error/30 h-1', 'bg-error/30 h-2', 'bg-error/50 h-3', 'bg-error/70 h-4',
      'bg-error h-5', 'bg-error/60 h-3', 'bg-error/40 h-2',
    ],
  },
];

const RUNTIMES = [
  { name: 'Go (Golang)', dot: 'bg-primary', bar: 'bg-primary', count: '1,730 (53%)', width: '53%' },
  { name: 'Node.js / TS', dot: 'bg-secondary', bar: 'bg-secondary', count: '892 (28%)', width: '28%' },
  { name: 'JVM / Kotlin', dot: 'bg-tertiary', bar: 'bg-tertiary', count: '412 (13%)', width: '13%' },
  { name: 'Python 3.12', dot: 'bg-error', bar: 'bg-error', count: '214 (6%)', width: '6%' },
];

const SIDEBAR_LINKS = [
  { path: '/issues', icon: 'error_outline', label: 'Issues', badge: '14' },
  { path: '/performance', icon: 'speed', label: 'Performance & APM' },
  { path: '/tracing', icon: 'account_tree', label: 'Distributed Tracing' },
  { path: '/replays', icon: 'slow_motion_video', label: 'Session Replays' },
  { path: '/setup', icon: 'integration_instructions', label: 'Setup & SDK' },
];

const TILE_STEM_CLASSES = [
  'bg-error/30 h-[40%]', 'bg-error/40 h-[60%]', 'bg-error/30 h-[30%]', 'bg-error/70 h-[85%]', 'bg-error h-full',
];

const LIVE_BARS = [
  'bg-surface-container-highest h-1', 'bg-surface-container-highest h-2', 'bg-error/30 h-2', 'bg-error/50 h-3',
  'bg-error/70 h-4', 'bg-error h-5', 'bg-error/60 h-3',
];

// Map a stored event from the ingestion API to an issue row
function eventToRow(id: string, event: any): IssueRow {
  const ex = event?.exception?.values?.[0];
  const title = ex ? `${ex.type}: ${ex.value}` : (event?.message ?? 'Unknown Event');
  const level = event?.level;
  const severity: Severity = level === 'fatal' ? 'critical' : level === 'error' ? 'high' : level === 'warning' ? 'warning' : 'recovered';
  const frame = ex?.stacktrace?.frames?.[0];
  const culprit = frame ? `${frame.filename ?? 'unknown'}:${frame.lineno ?? '?'}` : (event?.culprit ?? 'unknown');
  return {
    id,
    title,
    severity,
    culprit,
    version: event?.release ?? 'dev',
    deploy: 'live event',
    seen: 'seen just now',
    events: '1',
    users: '1',
    assignee: '--',
    assigneeTitle: 'Unassigned',
    assigneeClass: 'bg-surface-container-highest text-outline',
    leftBar: severity === 'critical' || severity === 'high' ? 'bg-error' : 'bg-primary',
    bars: LIVE_BARS,
  };
}

export function IssuesTriage() {
  const location = useLocation();
  const [liveRows, setLiveRows] = useState<IssueRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warning' } | null>(null);

  // Poll the ingestion API for live events
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await listEvents();
        const events = (result?.data ?? []) as Array<{ id: string; itemTypes: string[]; event: any }>;
        const mapped = events
          .filter((e) => e.itemTypes?.includes('event'))
          .map((e) => eventToRow(e.id, e.event));
        if (!cancelled) setLiveRows(mapped);
      } catch {
        // keep showing whatever we have on fetch failure
      }
    };
    load();
    const interval = setInterval(load, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const rows: IssueRow[] = [...liveRows, ...MOCK_ROWS];

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

  return (
    <div className="bg-background font-body-md text-on-surface antialiased min-h-screen selection:bg-primary-container selection:text-on-primary-container">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 h-full w-64 bg-surface-container-lowest z-50 flex flex-col justify-between shadow-[0_1px_8px_rgba(0,0,0,0.2)]">
        <div className="flex flex-col">
          <div className="h-14 px-margin flex items-center justify-between">
            <div className="flex items-center gap-space-sm">
              <div className="w-7 h-7 rounded-xl bg-primary-container flex items-center justify-center text-on-primary-container">
                <span className="material-symbols-outlined text-[18px]">radar</span>
              </div>
              <span className="font-headline-sm text-headline-sm text-on-surface tracking-tight font-bold">Benemetrics</span>
            </div>
            <span className="px-space-xs py-0.5 rounded-DEFAULT bg-surface-container font-label-code-sm text-label-code-sm text-primary uppercase">v2.4</span>
          </div>
          <div className="px-margin py-space-xs">
            <button className="w-full flex items-center justify-between px-space-md py-space-xs bg-surface-container-low hover:bg-surface-container hover:text-on-surface rounded-xl transition-all text-left group" type="button">
              <div className="flex items-center gap-space-sm min-w-0">
                <span className="material-symbols-outlined text-secondary text-[16px]">terminal</span>
                <div className="truncate">
                  <div className="font-label-code-md text-label-code-md text-on-surface font-semibold truncate">api-gateway</div>
                  <div className="font-label-code-sm text-label-code-sm text-on-surface-variant flex items-center gap-space-xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-secondary inline-block"></span>env:production
                  </div>
                </div>
              </div>
              <span className="material-symbols-outlined text-on-surface-variant group-hover:text-on-surface text-[18px]">unfold_more</span>
            </button>
          </div>
          <div className="px-margin pt-space-md pb-space-xs">
            <span className="font-label-code-sm text-label-code-sm uppercase tracking-wider text-outline px-space-xs">Telemetry Observability</span>
          </div>
          <nav className="px-space-sm space-y-0.5 flex flex-col">
            {SIDEBAR_LINKS.map((link) => {
              const active = location.pathname === link.path;
              return (
                <Link
                  key={link.path}
                  to={link.path}
                  className={cn(
                    'flex items-center justify-between px-space-md py-space-xs rounded-xl transition-colors group',
                    active
                      ? 'bg-surface-container-high text-primary font-semibold'
                      : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                  )}
                >
                  <div className="flex items-center gap-space-md">
                    <span className={cn('material-symbols-outlined text-[18px] transition-colors', !active && 'group-hover:text-primary')}>
                      {link.icon}
                    </span>
                    <span className="font-body-md text-body-md">{link.label}</span>
                  </div>
                  {link.badge && (
                    <span className="px-space-xs py-0.5 rounded-DEFAULT bg-error-container text-on-error-container font-label-code-sm text-label-code-sm font-semibold">
                      {link.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex flex-col gap-space-xs px-space-sm pb-space-md">
          <div className="px-space-md py-space-xs rounded-xl bg-surface-container-low flex items-center justify-between mb-space-xs">
            <div className="flex items-center gap-space-sm">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-secondary"></span>
              </span>
              <span className="font-label-code-sm text-label-code-sm text-on-surface">42 e/s Connected</span>
            </div>
            <span className="font-label-code-sm text-label-code-sm text-outline">18ms</span>
          </div>
          <nav className="space-y-0.5 flex flex-col">
            <a className="flex items-center gap-space-md px-space-md py-space-xs rounded-xl text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors group" href="#">
              <span className="material-symbols-outlined text-[18px] group-hover:text-primary transition-colors">menu_book</span>
              <span className="font-body-md text-body-md">Docs</span>
            </a>
            <a className="flex items-center gap-space-md px-space-md py-space-xs rounded-xl text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors group" href="#">
              <span className="material-symbols-outlined text-[18px] group-hover:text-primary transition-colors">settings</span>
              <span className="font-body-md text-body-md">Settings</span>
            </a>
          </nav>
        </div>
      </aside>

      <div className="pl-64">
        {/* Header */}
        <header className="fixed top-0 left-64 right-0 h-14 bg-surface/80 backdrop-blur-xl z-40 flex items-center justify-between px-margin-tablet shadow-[0_1px_8px_rgba(0,0,0,0.06)]">
          <div className="flex items-center gap-space-lg flex-1 max-w-2xl">
            <div className="relative w-full">
              <span className="material-symbols-outlined absolute left-space-md top-1/2 -translate-y-1/2 text-outline text-[18px]">search</span>
              <input className="w-full h-9 pl-9 pr-14 bg-surface-container-low text-on-surface placeholder:text-outline text-body-md font-body-md rounded-xl focus:outline-none focus:bg-surface-container transition-all" placeholder="Search issues, transactions, tags or press ⌘K" type="text" />
              <div className="absolute right-space-sm top-1/2 -translate-y-1/2 flex items-center gap-0.5 px-space-xs py-0.5 bg-surface-container-highest rounded-DEFAULT text-outline font-label-code-sm text-label-code-sm">⌘K</div>
            </div>
          </div>
          <div className="flex items-center gap-space-lg">
            <div className="hidden lg:flex items-center gap-space-sm px-space-md py-1 rounded-full bg-surface-container-low">
              <span className="w-2 h-2 rounded-full bg-secondary"></span>
              <span className="font-label-code-sm text-label-code-sm text-on-surface-variant">Cluster: us-east-prod</span>
              <span className="font-label-code-sm text-label-code-sm text-secondary font-semibold">99.98%</span>
            </div>
            <div className="flex items-center gap-space-xs">
              <button className="h-8 px-space-md bg-surface-container-low hover:bg-surface-container text-on-surface font-label-code-md text-label-code-md rounded-lg flex items-center gap-space-xs transition-colors" title="Create Alert Rule" type="button">
                <span className="material-symbols-outlined text-[16px] text-primary">add_alert</span>
                <span className="hidden sm:inline">New Alert</span>
              </button>
              <button className="w-8 h-8 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface-variant hover:text-on-surface flex items-center justify-center transition-colors relative" title="Notifications" type="button">
                <span className="material-symbols-outlined text-[18px]">notifications</span>
                <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-primary"></span>
              </button>
            </div>
            <div className="h-6 w-px bg-surface-container-highest"></div>
            <div className="flex items-center gap-space-sm">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <span className="material-symbols-outlined text-on-primary text-[18px]">person</span>
              </div>
              <div className="hidden xl:flex flex-col text-left">
                <span className="font-body-sm text-body-sm font-semibold text-on-surface leading-none">sre_lead</span>
                <span className="font-label-code-sm text-label-code-sm text-outline leading-tight">admin</span>
              </div>
            </div>
          </div>
        </header>

        <main className="w-full pt-14 bg-background min-h-screen px-margin-tablet">
          <div className="flex flex-col w-full pb-space-xl">
            {/* Top Command Context Bar */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-space-md py-space-md mb-space-sm">
              <div className="flex items-center gap-space-md">
                <div className="flex items-center gap-space-xs">
                  <span className="w-2.5 h-2.5 rounded-full bg-secondary shadow-[0_0_8px_rgba(78,222,163,0.6)]"></span>
                  <span className="font-label-code-md text-label-code-md uppercase tracking-wider text-on-surface font-semibold">Triage Orchestrator</span>
                </div>
                <span className="text-outline-variant font-label-code-sm text-label-code-sm">/</span>
                <span className="font-label-code-sm text-label-code-sm text-on-surface-variant bg-surface-container px-space-sm py-0.5 rounded-DEFAULT">tenant: prod-core-alpha</span>
                <span className="font-label-code-sm text-label-code-sm text-primary bg-surface-container-high px-space-sm py-0.5 rounded-DEFAULT">sync: real-time</span>
              </div>
              <div className="flex items-center gap-space-sm">
                <div className="flex items-center bg-surface-container-low px-space-sm py-1 rounded-xl">
                  <span className="material-symbols-outlined text-outline text-[16px] mr-1">history</span>
                  <span className="font-label-code-sm text-label-code-sm text-on-surface-variant">Auto-reloading (15s)</span>
                </div>
                <button className="h-8 px-space-md bg-surface-container-low hover:bg-surface-container text-on-surface rounded-lg font-label-code-md text-label-code-md flex items-center gap-space-xs transition-colors" type="button">
                  <span className="material-symbols-outlined text-[15px]">tune</span>
                  <span>Configure Alerts</span>
                </button>
                <button className="h-8 px-space-md bg-primary-container text-on-primary-container hover:brightness-110 rounded-lg font-label-code-md text-label-code-md flex items-center gap-space-xs transition-all shadow-[0_0_12px_rgba(6,182,212,0.3)]" type="button">
                  <span className="material-symbols-outlined text-[16px]">bolt</span>
                  <span>Run Diagnostics</span>
                </button>
              </div>
            </div>

            {/* Telemetry 4-Metric Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-md mb-space-lg">
              {/* Tile 1: Unresolved */}
              <div className="bg-surface-container-low rounded-xl p-space-md flex flex-col justify-between relative overflow-hidden group hover:bg-surface-container transition-colors">
                <div className="absolute right-0 top-0 w-24 h-24 bg-error-container/10 rounded-full blur-2xl pointer-events-none"></div>
                <div className="flex items-start justify-between mb-space-sm">
                  <span className="font-label-code-sm text-label-code-sm uppercase tracking-wider text-outline">Unresolved Exceptions</span>
                  <span className="px-space-xs py-0.5 rounded-DEFAULT bg-error-container text-on-error-container font-label-code-sm text-label-code-sm font-semibold flex items-center gap-0.5">
                    <span className="material-symbols-outlined text-[12px]">trending_up</span>
                    +2 / hr
                  </span>
                </div>
                <div className="flex items-baseline justify-between mt-space-xs">
                  <div className="flex items-baseline gap-space-xs">
                    <span className="font-headline-lg text-headline-lg text-on-surface tracking-tight">14</span>
                    <span className="font-label-code-sm text-label-code-sm text-error font-medium">crítico</span>
                  </div>
                  <div className="w-16 h-6 flex items-end gap-0.5">
                    {TILE_STEM_CLASSES.map((cls, i) => (
                      <div key={i} className={cn('flex-1 rounded-xs', cls)}></div>
                    ))}
                  </div>
                </div>
              </div>
              {/* Tile 2: 24h Event Volume */}
              <div className="bg-surface-container-low rounded-xl p-space-md flex flex-col justify-between relative overflow-hidden group hover:bg-surface-container transition-colors">
                <div className="absolute right-0 top-0 w-24 h-24 bg-primary/10 rounded-full blur-2xl pointer-events-none"></div>
                <div className="flex items-start justify-between mb-space-sm">
                  <span className="font-label-code-sm text-label-code-sm uppercase tracking-wider text-outline">24h Event Volume</span>
                  <span className="px-space-xs py-0.5 rounded-DEFAULT bg-surface-container-highest text-primary font-label-code-sm text-label-code-sm font-semibold flex items-center gap-0.5">
                    <span className="material-symbols-outlined text-[12px]">arrow_upward</span>
                    +12.4%
                  </span>
                </div>
                <div className="flex items-baseline justify-between mt-space-xs">
                  <div className="flex items-baseline gap-space-xs">
                    <span className="font-headline-lg text-headline-lg text-on-surface tracking-tight">3,248</span>
                    <span className="font-label-code-sm text-label-code-sm text-outline">evt</span>
                  </div>
                  <svg className="w-20 h-7 text-primary overflow-visible" fill="none" viewBox="0 0 80 24">
                    <path d="M0 18 Q 15 22, 25 14 T 50 12 T 70 4 T 80 7" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
                    <path d="M0 18 Q 15 22, 25 14 T 50 12 T 70 4 T 80 7 L 80 24 L 0 24 Z" fill="currentColor" fillOpacity="0.15" />
                  </svg>
                </div>
              </div>
              {/* Tile 3: Impacted Users */}
              <div className="bg-surface-container-low rounded-xl p-space-md flex flex-col justify-between relative overflow-hidden group hover:bg-surface-container transition-colors">
                <div className="absolute right-0 top-0 w-24 h-24 bg-tertiary/10 rounded-full blur-2xl pointer-events-none"></div>
                <div className="flex items-start justify-between mb-space-sm">
                  <span className="font-label-code-sm text-label-code-sm uppercase tracking-wider text-outline">Impacted Users</span>
                  <span className="px-space-xs py-0.5 rounded-DEFAULT bg-surface-container-highest text-tertiary-fixed-dim font-label-code-sm text-label-code-sm font-semibold">
                    0.8% of DAU
                  </span>
                </div>
                <div className="flex items-baseline justify-between mt-space-xs">
                  <div className="flex items-baseline gap-space-xs">
                    <span className="font-headline-lg text-headline-lg text-on-surface tracking-tight">142</span>
                    <span className="font-label-code-sm text-label-code-sm text-outline">unq</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-[16px] text-tertiary">group_remove</span>
                    <span className="font-label-code-sm text-label-code-sm text-on-surface-variant font-mono">p99 isolated</span>
                  </div>
                </div>
              </div>
              {/* Tile 4: Crash-Free Sessions */}
              <div className="bg-surface-container-low rounded-xl p-space-md flex flex-col justify-between relative overflow-hidden group hover:bg-surface-container transition-colors">
                <div className="absolute right-0 top-0 w-24 h-24 bg-secondary/10 rounded-full blur-2xl pointer-events-none"></div>
                <div className="flex items-start justify-between mb-space-sm">
                  <span className="font-label-code-sm text-label-code-sm uppercase tracking-wider text-outline">Crash-Free Sessions</span>
                  <span className="px-space-xs py-0.5 rounded-DEFAULT bg-secondary/15 text-secondary font-label-code-sm text-label-code-sm font-semibold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-secondary"></span>
                    SLO Met
                  </span>
                </div>
                <div className="flex items-baseline justify-between mt-space-xs">
                  <div className="flex items-baseline gap-space-xs">
                    <span className="font-headline-lg text-headline-lg text-secondary tracking-tight">99.82%</span>
                    <span className="font-label-code-sm text-label-code-sm text-outline">target 99.5%</span>
                  </div>
                  <div className="w-12 h-6 flex items-center">
                    <div className="w-full bg-surface-container-highest h-2 rounded-full overflow-hidden">
                      <div className="bg-secondary h-full rounded-full" style={{ width: '99.82%' }}></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Filter, Query Console & Triage Actions Bar */}
            <div className="bg-surface-container-low rounded-xl p-space-md mb-space-md flex flex-col gap-space-md shadow-sm">
              <div className="flex flex-col md:flex-row items-stretch md:items-center gap-space-sm">
                <div className="relative flex-1">
                  <span className="material-symbols-outlined absolute left-space-md top-1/2 -translate-y-1/2 text-primary text-[18px]">filter_alt</span>
                  <input className="w-full h-9 pl-9 pr-24 bg-surface-container text-on-surface font-label-code-md text-label-code-md rounded-lg focus:outline-none focus:bg-surface-container-high transition-colors tracking-wide" type="text" defaultValue="is:unresolved level:error environment:production" />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    <button className="px-space-xs py-0.5 rounded bg-surface-container-highest text-outline hover:text-on-surface font-label-code-sm text-label-code-sm" type="button">Syntax Help</button>
                  </div>
                </div>
                <div className="flex items-center gap-space-xs shrink-0">
                  <button className="h-9 px-space-md bg-surface-container hover:bg-surface-container-high text-on-surface font-label-code-md text-label-code-md rounded-lg flex items-center gap-space-xs transition-colors" type="button">
                    <span className="material-symbols-outlined text-[16px] text-outline">calendar_today</span>
                    <span>Last 24 hours</span>
                    <span className="material-symbols-outlined text-[16px] text-outline">expand_more</span>
                  </button>
                  <button className="h-9 px-space-md bg-surface-container hover:bg-surface-container-high text-on-surface font-label-code-md text-label-code-md rounded-lg flex items-center gap-space-xs transition-colors" type="button">
                    <span className="material-symbols-outlined text-[16px] text-outline">sort</span>
                    <span>Sort: Most Frequent</span>
                    <span className="material-symbols-outlined text-[16px] text-outline">expand_more</span>
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-space-sm pt-space-xs">
                <div className="flex items-center gap-space-xs flex-wrap">
                  <span className="font-label-code-sm text-label-code-sm uppercase tracking-wider text-outline mr-1">Views:</span>
                  <button className="h-7 px-space-sm bg-surface-container-highest text-primary font-label-code-sm text-label-code-sm rounded flex items-center gap-1 font-semibold" type="button">
                    <span>Unhandled</span>
                    <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                  </button>
                  <button className="h-7 px-space-sm bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface font-label-code-sm text-label-code-sm rounded flex items-center gap-1 transition-colors" type="button">
                    <span>Regressed</span>
                    <span className="px-1 py-0 rounded bg-error-container text-on-error-container text-[9px] font-bold">3</span>
                  </button>
                  <button className="h-7 px-space-sm bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface font-label-code-sm text-label-code-sm rounded transition-colors" type="button">
                    <span>Handled</span>
                  </button>
                  <button className="h-7 px-space-sm bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface font-label-code-sm text-label-code-sm rounded transition-colors" type="button">
                    <span>All Events</span>
                  </button>
                  <div className="h-4 w-px bg-surface-container-highest mx-1"></div>
                  <button className="h-7 px-space-sm bg-surface-container hover:bg-surface-container-high text-outline hover:text-on-surface font-label-code-sm text-label-code-sm rounded flex items-center gap-1" type="button">
                    <span className="material-symbols-outlined text-[14px]">add</span>
                    <span>Custom Filter</span>
                  </button>
                </div>
                <div className="flex items-center gap-space-xs">
                  <span className="font-label-code-sm text-label-code-sm text-outline mr-2">Selected: <strong className="text-on-surface">{selected.size}</strong></span>
                  <button
                    className="h-7 px-space-sm bg-surface-container hover:bg-secondary-container hover:text-on-secondary font-label-code-sm text-label-code-sm rounded text-on-surface-variant flex items-center gap-1 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                    disabled={selected.size === 0}
                    type="button"
                    onClick={() => showToast(`${selected.size} issue(s) marked as RESOLVED`, 'success')}
                  >
                    <span className="material-symbols-outlined text-[14px]">check_circle</span>
                    <span>Resolve</span>
                  </button>
                  <button
                    className="h-7 px-space-sm bg-surface-container hover:bg-surface-container-high font-label-code-sm text-label-code-sm rounded text-on-surface-variant flex items-center gap-1 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                    disabled={selected.size === 0}
                    type="button"
                    onClick={() => showToast(`${selected.size} issue(s) silenced`, 'warning')}
                  >
                    <span className="material-symbols-outlined text-[14px]">notifications_off</span>
                    <span>Ignore</span>
                  </button>
                  <button
                    className="h-7 px-space-sm bg-surface-container hover:bg-surface-container-high font-label-code-sm text-label-code-sm rounded text-on-surface-variant flex items-center gap-1 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                    disabled={selected.size === 0}
                    type="button"
                    onClick={() => showToast(`${selected.size} issue(s) merged`, 'success')}
                  >
                    <span className="material-symbols-outlined text-[14px]">call_merge</span>
                    <span>Merge</span>
                  </button>
                  <button
                    className="h-7 px-space-sm bg-surface-container hover:bg-error-container hover:text-on-error-container font-label-code-sm text-label-code-sm rounded text-on-surface-variant flex items-center gap-1 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                    disabled={selected.size === 0}
                    type="button"
                    onClick={() => showToast(`${selected.size} issue(s) deleted`, 'warning')}
                  >
                    <span className="material-symbols-outlined text-[14px]">delete</span>
                    <span>Delete</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Main Asymmetric Workspace Layout */}
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
                  <div className="hidden md:flex items-center gap-space-lg w-72 justify-between">
                    <span className="w-24 text-center">24h Frequency</span>
                    <span className="w-16 text-right">Events</span>
                    <span className="w-14 text-right">Users</span>
                  </div>
                  <div className="w-32 text-right hidden sm:block">Assignee / Action</div>
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
                        <div className={cn('absolute left-0 top-0 bottom-0 w-1', issue.leftBar)}></div>
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
                              <span className="font-headline-sm text-headline-sm text-on-surface font-semibold hover:text-primary cursor-pointer truncate">
                                {issue.title}
                              </span>
                            </div>
                            <div className="flex items-center gap-space-sm flex-wrap font-label-code-sm text-label-code-sm">
                              <span className={cn(sev.text, 'font-semibold flex items-center gap-1')}>
                                <span className={cn('w-1.5 h-1.5 rounded-full', sev.dot)}></span>
                                {sev.label}
                              </span>
                              <span className="text-outline-variant">•</span>
                              <span className="text-on-surface-variant font-mono">{issue.culprit}</span>
                              <span className="text-outline-variant">•</span>
                              <span className="bg-surface-container px-1 rounded text-primary">{issue.version}</span>
                              <span className="text-outline-variant">•</span>
                              <span className="text-outline">{issue.deploy}</span>
                              <span className="text-outline-variant">•</span>
                              <span className="text-outline">{issue.seen}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center justify-between w-full md:w-auto md:gap-space-lg shrink-0">
                          <div className="w-24 h-6 flex items-end gap-0.5 py-0.5">
                            {issue.bars.map((cls, i) => (
                              <div key={i} className={cn('flex-1 rounded-xs', cls)}></div>
                            ))}
                          </div>
                          <div className="w-16 text-right">
                            <span className="font-label-code-md text-label-code-md text-on-surface font-bold block">{issue.events}</span>
                            <span className="font-label-code-sm text-label-code-sm text-outline block leading-none">events</span>
                          </div>
                          <div className="w-14 text-right">
                            <span className="font-label-code-md text-label-code-md text-on-surface font-bold block">{issue.users}</span>
                            <span className="font-label-code-sm text-label-code-sm text-outline block leading-none">users</span>
                          </div>
                          <div className="flex items-center gap-space-xs w-32 justify-end">
                            <div className={cn('w-6 h-6 rounded-full flex items-center justify-center font-label-code-sm text-label-code-sm', issue.assigneeClass)} title={issue.assigneeTitle}>
                              {issue.assignee}
                            </div>
                            <button className="w-7 h-7 rounded hover:bg-surface-container-highest text-outline hover:text-secondary flex items-center justify-center transition-colors" title="Resolve issue" type="button" onClick={() => showToast('Issue marked as RESOLVED', 'success')}>
                              <span className="material-symbols-outlined text-[16px]">check_circle</span>
                            </button>
                            <button className="w-7 h-7 rounded hover:bg-surface-container-highest text-outline hover:text-on-surface flex items-center justify-center transition-colors" title="Snooze alert" type="button" onClick={() => showToast('Issue silenced for 24h', 'warning')}>
                              <span className="material-symbols-outlined text-[16px]">notifications_paused</span>
                            </button>
                            <button className="w-7 h-7 rounded hover:bg-surface-container-highest text-outline hover:text-on-surface flex items-center justify-center transition-colors" title="Assignee" type="button" onClick={() => setAssignModalOpen(true)}>
                              <span className="material-symbols-outlined text-[16px]">person_add</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Pagination & Stream State Footer */}
                <div className="bg-surface-container-low px-space-md py-space-sm rounded-xl flex items-center justify-between text-outline font-label-code-sm text-label-code-sm mt-space-xs">
                  <div className="flex items-center gap-space-sm">
                    <span>Showing 1 - 5 of 14 unresolved issues</span>
                    <span className="text-outline-variant">•</span>
                    <span className="text-secondary flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-secondary"></span>
                      Buffer clean
                    </span>
                  </div>
                  <div className="flex items-center gap-space-xs">
                    <button className="px-space-sm py-1 bg-surface-container hover:bg-surface-container-high rounded text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-40" disabled type="button">
                      Previous
                    </button>
                    <span className="px-space-sm py-1 bg-surface-container-highest text-primary font-bold rounded">1</span>
                    <button className="px-space-sm py-1 bg-surface-container hover:bg-surface-container-high rounded text-on-surface-variant hover:text-on-surface transition-colors" type="button">2</button>
                    <button className="px-space-sm py-1 bg-surface-container hover:bg-surface-container-high rounded text-on-surface-variant hover:text-on-surface transition-colors" type="button">3</button>
                    <button className="px-space-sm py-1 bg-surface-container hover:bg-surface-container-high rounded text-on-surface-variant hover:text-on-surface transition-colors" type="button">
                      Next
                    </button>
                  </div>
                </div>
              </div>

              {/* Right Column: Live Context & Cluster Health */}
              <div className="xl:col-span-3 flex flex-col gap-space-md">
                {/* Realtime Ingestion Card */}
                <div className="bg-surface-container-low rounded-xl p-space-md flex flex-col gap-space-md shadow-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-space-xs">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                      </span>
                      <span className="font-label-code-sm text-label-code-sm uppercase tracking-wider text-on-surface font-semibold">Cluster Ingestion</span>
                    </div>
                    <span className="font-label-code-sm text-label-code-sm text-primary bg-surface-container px-space-xs py-0.5 rounded">Healthy</span>
                  </div>
                  <div className="grid grid-cols-2 gap-space-sm pt-space-xs">
                    <div className="bg-surface-container p-space-sm rounded-lg">
                      <span className="font-label-code-sm text-label-code-sm text-outline block">Throughput</span>
                      <span className="font-headline-sm text-headline-sm text-on-surface font-bold">42.4</span>
                      <span className="font-label-code-sm text-label-code-sm text-on-surface-variant block">evt / sec</span>
                    </div>
                    <div className="bg-surface-container p-space-sm rounded-lg">
                      <span className="font-label-code-sm text-label-code-sm text-outline block">p95 Latency</span>
                      <span className="font-headline-sm text-headline-sm text-secondary font-bold">11.2</span>
                      <span className="font-label-code-sm text-label-code-sm text-on-surface-variant block">milliseconds</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 pt-1">
                    <div className="flex justify-between items-center text-outline font-label-code-sm text-label-code-sm">
                      <span>Inbound Pipeline</span>
                      <span className="text-on-surface-variant font-mono">2.4 MB/s</span>
                    </div>
                    <div className="h-16 w-full bg-surface-container rounded-lg p-1 overflow-hidden flex items-end">
                      <svg className="w-full h-full text-secondary" preserveAspectRatio="none" viewBox="0 0 100 40">
                        <defs>
                          <linearGradient id="ingest-grad" x1="0" x2="0" y1="0" y2="1">
                            <stop offset="0%" stopColor="currentColor" stopOpacity="0.3"></stop>
                            <stop offset="100%" stopColor="currentColor" stopOpacity="0.0"></stop>
                          </linearGradient>
                        </defs>
                        <polygon fill="url(#ingest-grad)" points="0,40 0,25 15,30 30,18 45,22 60,10 75,16 90,8 100,12 100,40"></polygon>
                        <polyline fill="none" points="0,25 15,30 30,18 45,22 60,10 75,16 90,8 100,12" stroke="currentColor" strokeLinecap="round" strokeWidth="2"></polyline>
                      </svg>
                    </div>
                  </div>
                </div>

                {/* Runtime Triage Breakdown */}
                <div className="bg-surface-container-low rounded-xl p-space-md flex flex-col gap-space-md shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-label-code-sm text-label-code-sm uppercase tracking-wider text-outline">Runtime Distribution</span>
                    <span className="material-symbols-outlined text-outline text-[16px]">pie_chart</span>
                  </div>
                  <div className="flex flex-col gap-space-sm">
                    {RUNTIMES.map((rt) => (
                      <div key={rt.name} className="flex flex-col gap-1">
                        <div className="flex items-center justify-between font-label-code-sm text-label-code-sm">
                          <span className="text-on-surface font-semibold flex items-center gap-1.5">
                            <span className={cn('w-2 h-2 rounded-full', rt.dot)}></span>
                            {rt.name}
                          </span>
                          <span className="text-on-surface font-mono">{rt.count}</span>
                        </div>
                        <div className="w-full bg-surface-container h-1.5 rounded-full overflow-hidden">
                          <div className={cn('h-full rounded-full', rt.bar)} style={{ width: rt.width }}></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Quick Triage Rules / SLO Notice */}
                <div className="bg-surface-container-low rounded-xl p-space-md flex flex-col gap-space-sm relative overflow-hidden">
                  <div className="flex items-center gap-space-xs text-primary">
                    <span className="material-symbols-outlined text-[16px]">auto_fix_high</span>
                    <span className="font-label-code-sm text-label-code-sm uppercase font-semibold">Triage Heuristics</span>
                  </div>
                  <p className="font-body-sm text-body-sm text-on-surface-variant">
                    3 issues automatically flagged for rollback consideration due to regression match against git tag <code className="text-on-surface bg-surface-container px-1 rounded">v2.4.1</code>.
                  </p>
                  <div className="pt-space-xs">
                    <button className="w-full py-1.5 px-space-md bg-surface-container hover:bg-surface-container-high rounded text-on-surface font-label-code-sm text-label-code-sm transition-colors text-left flex items-center justify-between" type="button">
                      <span>View Affected Commits</span>
                      <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      <Modal open={assignModalOpen} onClose={() => setAssignModalOpen(false)} title="Assign Incident">
        <div className="flex flex-col gap-1 py-2">
          {[
            { initials: 'AR', name: 'Alex Rivera', role: 'Primary On-Call', roleClass: 'text-secondary', avatar: 'bg-primary-container text-on-primary-container' },
            { initials: 'DV', name: 'Devon Vance', role: 'Core Infrastructure', roleClass: 'text-on-surface-variant', avatar: 'bg-secondary-container text-on-secondary-container' },
            { initials: 'RB', name: 'Release Guard Bot', role: 'Automated Escalation', roleClass: 'text-on-surface-variant', avatar: 'bg-tertiary-container text-on-tertiary-container' },
          ].map((person) => (
            <button
              key={person.initials}
              onClick={() => {
                setAssignModalOpen(false);
                showToast(`Assigned to ${person.name} (${person.role})`, 'success');
              }}
              className="flex items-center justify-between p-3 rounded-lg bg-surface-container hover:bg-surface-container-highest transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className={cn('w-7 h-7 rounded-full flex items-center justify-center text-code-sm font-bold', person.avatar)}>{person.initials}</span>
                <div className="flex flex-col text-left">
                  <span className="text-body-md text-on-surface font-semibold">{person.name}</span>
                  <span className={cn('text-code-sm', person.roleClass)}>{person.role}</span>
                </div>
              </div>
              <span className="text-[18px] mds text-on-surface-variant">chevron_right</span>
            </button>
          ))}
        </div>
      </Modal>

      {toast && (
        <div className="fixed top-20 inset-x-4 z-50 pointer-events-none flex justify-center">
          <div className="px-3 py-2 bg-surface-container-highest shadow-xl rounded-full flex items-center gap-2 text-on-surface">
            <span className="text-[18px] mds">{toast.type === 'success' ? 'check_circle' : 'volume_off'}</span>
            <span className="text-code-sm">{toast.message}</span>
          </div>
        </div>
      )}
    </div>
  );
}
