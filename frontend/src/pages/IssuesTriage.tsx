import { useState } from 'react';
import { MobileNavBar } from '../components/MobileNavBar';
import { StatusPill, SparklineChart, Modal, TelemetryChip } from '../components/ui';

interface Issue {
  id: string;
  severity: 'critical' | 'error' | 'warning';
  title: string;
  culprit: string;
  timeAgo: string;
  events: number;
  users: number;
  sparklineData: number[];
  tags: { label: string; icon: string; color: 'primary' | 'secondary' | 'error' | 'tertiary' }[];
}

const mockIssues: Issue[] = [
  {
    id: '1',
    severity: 'critical',
    title: 'Unhandled RuntimeException: connection pool exhausted',
    culprit: 'postgres_pool.go:142 • AcquireContext',
    timeAgo: '2m ago',
    events: 1400,
    users: 82,
    sparklineData: [2, 3, 3, 5, 8, 10, 12],
    tags: [
      { label: 'env:prod', icon: 'dns', color: 'secondary' },
      { label: 'release:v2.4.1', icon: 'sell', color: 'primary' },
      { label: 'p99: 4.8s', icon: 'timer', color: 'error' },
    ],
  },
  {
    id: '2',
    severity: 'error',
    title: "TypeError: Cannot read properties of undefined (reading 'token')",
    culprit: 'auth.middleware.ts:89 • verifyBearer',
    timeAgo: '14m ago',
    events: 840,
    users: 45,
    sparklineData: [1, 2, 3, 4, 3, 2, 1],
    tags: [
      { label: 'nodejs', icon: 'javascript', color: 'tertiary' },
      { label: 'next-auth@4.24', icon: 'code', color: 'primary' },
      { label: 'handled: false', icon: 'bolt', color: 'secondary' },
    ],
  },
  {
    id: '3',
    severity: 'critical',
    title: 'OutOfMemoryError: Java heap space during batch sync',
    culprit: 'SyncEngineJob.kt:204 • runBatchTransform',
    timeAgo: '45m ago',
    events: 312,
    users: 11,
    sparklineData: [1, 1, 2, 3, 4, 5, 4],
    tags: [
      { label: 'worker-jvm', icon: 'memory', color: 'tertiary' },
      { label: 'mem-limit: 2048MB', icon: 'settings', color: 'primary' },
      { label: 'SIGKILL (9)', icon: 'error', color: 'error' },
    ],
  },
  {
    id: '4',
    severity: 'warning',
    title: 'StripeWebhookTimeout: Request timeout 15000ms',
    culprit: 'stripe_client.py:91 • handle_charge_succeeded',
    timeAgo: '1h ago',
    events: 42,
    users: 4,
    sparklineData: [1, 2, 2, 2, 1, 1, 1],
    tags: [
      { label: 'payments', icon: 'payments', color: 'secondary' },
      { label: 'python-celery', icon: 'code', color: 'primary' },
      { label: 'retries: 3', icon: 'refresh', color: 'primary' },
    ],
  },
];

function cn(...classes: (string | undefined | false)[]) {
  return classes.filter(Boolean).join(' ');
}

export function IssuesTriage() {
  const [searchQuery, setSearchQuery] = useState('is:unresolved level:error');
  const [showUnhandledOnly, setShowUnhandledOnly] = useState(true);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warning' } | null>(null);

  const handleTriageAction = (_id: string, action: 'resolved' | 'ignored', message: string) => {
    setToast({ message, type: action === 'resolved' ? 'success' : 'warning' });
    setTimeout(() => setToast(null), 2200);
  };

  const handleAssign = (_id: string) => {
    setAssignModalOpen(true);
  };

  return (
    <div className="flex flex-col h-screen bg-surface">
      <section className="px-4 pt-3 pb-2 flex flex-col gap-2 bg-surface">
        <div className="flex items-center justify-between gap-2">
          <button className="flex items-center gap-2 bg-surface-container-low hover:bg-surface-container active:scale-[0.98] px-3 py-1.5 rounded-xl transition-all shadow-sm">
            <span className="w-2 h-2 rounded-full bg-secondary shadow-[0_0_8px_rgba(78,222,163,0.6)]" />
            <span className="text-code-md text-on-surface font-semibold tracking-tight">api-gateway</span>
            <span className="text-code-sm text-on-surface-variant px-1 rounded bg-surface-container-high">prod</span>
            <span className="text-[16px] mds text-on-surface-variant">expand_more</span>
          </button>
          <div className="flex items-center gap-1 bg-surface-container-low px-2 py-1 rounded-full shadow-sm">
            <span className="text-code-sm text-on-surface-variant">Unhandled</span>
            <button
              onClick={() => setShowUnhandledOnly(!showUnhandledOnly)}
              className={cn(
                'w-8 h-4 rounded-full relative transition-colors',
                showUnhandledOnly ? 'bg-primary-container' : 'bg-surface-container-highest'
              )}
            >
              <span
                className={cn(
                  'w-3 h-3 bg-surface rounded-full absolute top-0.5 shadow-sm transition-transform',
                  showUnhandledOnly ? 'right-0.5' : 'left-0.5'
                )}
              />
            </button>
          </div>
        </div>
        <div className="relative flex items-center">
          <span className="absolute left-3 text-[18px] mds text-primary">terminal</span>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-surface-container-low text-on-surface text-code-md pl-10 pr-20 py-2 rounded-xl focus:bg-surface-container focus:text-primary-fixed focus:outline-none transition-colors shadow-inner"
            placeholder="query: is:unresolved..."
            spellCheck={false}
          />
          <div className="absolute right-2 flex items-center gap-1">
            <span className="px-1.5 py-0.5 rounded bg-surface-container-highest text-code-sm text-on-surface-variant">4 active</span>
            <button className="w-6 h-6 flex items-center justify-center text-on-surface-variant hover:text-on-surface">
              <span className="text-[16px] mds">tune</span>
            </button>
          </div>
        </div>
      </section>

      <section className="px-4 py-2">
        <div className="grid grid-cols-4 gap-2 bg-surface-container-low p-2 rounded-xl shadow-sm">
          <div className="flex flex-col">
            <span className="text-code-sm text-on-surface-variant truncate">Unresolved</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-headline-sm text-error font-bold tracking-tight">14</span>
              <span className="text-code-sm text-error">+2</span>
            </div>
          </div>
          <div className="flex flex-col">
            <span className="text-code-sm text-on-surface-variant truncate">24h Events</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-headline-sm text-on-surface font-bold tracking-tight">3.2k</span>
              <span className="text-code-sm text-on-surface-variant">evt</span>
            </div>
          </div>
          <div className="flex flex-col">
            <span className="text-code-sm text-on-surface-variant truncate">Impacted</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-headline-sm text-tertiary-fixed-dim font-bold tracking-tight">142</span>
              <span className="text-code-sm text-on-surface-variant">usr</span>
            </div>
          </div>
          <div className="flex flex-col">
            <span className="text-code-sm text-on-surface-variant truncate">Crash-Free</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-headline-sm text-secondary font-bold tracking-tight">99.82%</span>
            </div>
          </div>
        </div>
      </section>

      <section className="py-1 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-2 px-4 min-w-max">
          <button className="px-3 py-1 rounded-full bg-primary text-on-primary text-code-sm font-semibold shadow-[0_0_12px_rgba(76,215,246,0.35)] flex items-center gap-1.5">
            <span>All Issues</span>
            <span className="w-1.5 h-1.5 rounded-full bg-on-primary" />
          </button>
          <button className="px-3 py-1 rounded-full bg-surface-container-high text-on-surface hover:bg-surface-container-highest text-code-sm flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-error" />
            <span>Unhandled (8)</span>
          </button>
          <button className="px-3 py-1 rounded-full bg-surface-container-high text-on-surface hover:bg-surface-container-highest text-code-sm flex items-center gap-1.5">
            <span className="text-[13px] mds text-tertiary">replay</span>
            <span>Regressions (2)</span>
          </button>
          <button className="px-3 py-1 rounded-full bg-surface-container-high text-on-surface hover:bg-surface-container-highest text-code-sm flex items-center gap-1.5">
            <span>Handled</span>
          </button>
            <button className="px-3 py-1 rounded-full bg-surface-container-high text-secondary hover:bg-surface-container-highest text-code-sm flex items-center gap-1.5">
              <span className="text-[13px] mds">bolt</span>
              <span>New &lt;1h</span>
            </button>
        </div>
      </section>

      <section className="px-4 py-2 flex flex-col gap-3 flex-1 overflow-y-auto">
        {mockIssues.map((issue) => (
          <article
            key={issue.id}
            className={cn(
              'relative overflow-hidden bg-surface-container-low rounded-xl p-3 shadow-md transition-all duration-200 hover:bg-surface-container'
            )}
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="flex items-center gap-1">
                <StatusPill
                  level={issue.severity}
                  pulse={issue.severity === 'critical'}
                />
                <span className="text-code-sm text-on-surface-variant flex items-center gap-0.5">
                  <span className="text-[13px] mds">schedule</span> {issue.timeAgo}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex flex-col items-end">
                  <span className="text-code-sm text-error font-semibold">{issue.events.toLocaleString()} events</span>
                  <span className="text-code-sm text-on-surface-variant">{issue.users} users</span>
                </div>
                <SparklineChart
                  data={issue.sparklineData}
                  color={issue.severity === 'critical' ? 'error' : issue.severity === 'error' ? 'primary' : 'tertiary'}
                  showArea
                  animateEnd
                />
              </div>
            </div>
            <h3 className="text-headline-sm text-on-surface font-semibold tracking-tight leading-snug">
              {issue.title}
            </h3>
            <p className="text-code-sm text-primary mt-1 truncate">
              {issue.culprit}
            </p>
            <div className="flex flex-wrap items-center gap-1 mt-2">
              {issue.tags.map((tag, i) => (
                <TelemetryChip
                  key={i}
                  label={tag.label}
                  color={tag.color}
                />
              ))}
            </div>
            <div className="flex items-center justify-between mt-3 pt-2">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleTriageAction(issue.id, 'resolved', 'Issue marked as RESOLVED')}
                  className="px-3 py-1.5 bg-secondary text-on-secondary rounded-lg text-code-sm font-semibold active:scale-95 transition-all flex items-center gap-1 shadow-sm"
                >
                  <span className="text-[16px] mds">check_circle</span>
                  Resolve
                </button>
                <button
                  onClick={() => handleTriageAction(issue.id, 'ignored', 'Issue silenced for 24h')}
                  className="px-2 py-1.5 bg-surface-container-high hover:bg-surface-container-highest text-on-surface rounded-lg text-code-sm active:scale-95 transition-all flex items-center gap-1"
                >
                  <span className="text-[16px] mds text-on-surface-variant">volume_off</span> Ignore
                </button>
              </div>
              <button
                onClick={() => handleAssign(issue.id)}
                className="px-2 py-1.5 bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant hover:text-on-surface rounded-lg text-code-sm flex items-center gap-1 transition-all"
              >
                <span className="text-[16px] mds text-primary">person_add</span> Assign
              </button>
            </div>
          </article>
        ))}
      </section>

      <section className="mx-4 mt-2 mb-4 p-3 bg-surface-container-low rounded-xl flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-secondary" />
          </span>
          <span className="text-code-sm text-on-surface-variant">Telemetry Ingestion Socket: Connected</span>
        </div>
        <span className="text-code-sm text-primary">42 e/s</span>
      </section>

      <Modal open={assignModalOpen} onClose={() => setAssignModalOpen(false)} title="Assign Incident">
        <div className="flex flex-col gap-1 py-2">
          <button
            onClick={() => {
              setAssignModalOpen(false);
              setToast({ message: 'Assigned to Alex Rivera (SRE On-Call)', type: 'success' });
            }}
            className="flex items-center justify-between p-3 rounded-lg bg-surface-container hover:bg-surface-container-highest transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center text-code-sm font-bold">AR</span>
              <div className="flex flex-col text-left">
                <span className="text-body-md text-on-surface font-semibold">Alex Rivera</span>
                <span className="text-code-sm text-secondary">Primary On-Call</span>
              </div>
            </div>
            <span className="text-[18px] mds text-on-surface-variant">chevron_right</span>
          </button>
          <button
            onClick={() => {
              setAssignModalOpen(false);
              setToast({ message: 'Assigned to Devon Vance (Backend)', type: 'success' });
            }}
            className="flex items-center justify-between p-3 rounded-lg bg-surface-container hover:bg-surface-container-highest transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center text-code-sm font-bold">DV</span>
              <div className="flex flex-col text-left">
                <span className="text-body-md text-on-surface font-semibold">Devon Vance</span>
                <span className="text-code-sm text-on-surface-variant">Core Infrastructure</span>
              </div>
            </div>
            <span className="text-[18px] mds text-on-surface-variant">chevron_right</span>
          </button>
          <button
            onClick={() => {
              setAssignModalOpen(false);
              setToast({ message: 'Assigned to Release Guard Bot', type: 'success' });
            }}
            className="flex items-center justify-between p-3 rounded-lg bg-surface-container hover:bg-surface-container-highest transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-tertiary-container text-on-tertiary-container flex items-center justify-center text-code-sm font-bold">RB</span>
              <div className="flex flex-col text-left">
                <span className="text-body-md text-on-surface font-semibold">Release Guard Bot</span>
                <span className="text-code-sm text-on-surface-variant">Automated Escalation</span>
              </div>
            </div>
            <span className="text-[18px] mds text-on-surface-variant">chevron_right</span>
          </button>
        </div>
      </Modal>

      {toast && (
        <div className="fixed top-20 inset-x-4 z-50 pointer-events-none transform -translate-y-0 opacity-100 transition-all duration-300 flex justify-center">
          <div className="px-3 py-2 bg-surface-container-highest shadow-xl rounded-full flex items-center gap-2 text-on-surface">
            <span className="text-[18px] mds">{toast.type === 'success' ? 'check_circle' : 'volume_off'}</span>
            <span className="text-code-sm">{toast.message}</span>
          </div>
        </div>
      )}

      <MobileNavBar links={[
        { path: '/issues', label: 'Issues', icon: 'bug_report' },
        { path: '/performance', label: 'Perf', icon: 'speed' },
        { path: '/replays', label: 'Replays', icon: 'play_circle' },
        { path: '/setup', label: 'Setup', icon: 'settings_input_component' },
      ]} />
    </div>
  );
}