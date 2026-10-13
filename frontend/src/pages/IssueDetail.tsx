import { useState } from 'react';
import { MobileNavBar } from '../components/MobileNavBar';
import { cn } from '../lib/utils';

export function IssueDetail() {
  const [inAppOnly, setInAppOnly] = useState(true);
  const [isResolved, setIsResolved] = useState(false);

  const stackFrames = [
    {
      file: 'checkout_flow.go:88',
      func: '(*Handler).FinalizeCart',
      label: 'checkout.FinalizeCart()',
      isActive: false,
      isApp: true,
      isHidden: false,
      codeLines: [
        { num: 138, code: 'ctx, cancel := context.WithTimeout(p.ctx, p.timeout)', muted: true },
        { num: 139, code: 'defer cancel()', muted: true },
        { num: 140, code: 'select {', muted: true },
        { num: 141, code: 'case conn := <-p.idlePool:', muted: true },
        { num: 142, code: 'case <-ctx.Done(): panic(ErrPoolExhausted)', active: true, error: true },
        { num: 143, code: '\treturn nil, fmt.Errorf("pool timeout (%dms)", p.timeout)', muted: true },
        { num: 144, code: '}', muted: true },
        { num: 145, code: 'return conn, nil', muted: true },
        { num: 146, code: '}', muted: true },
      ],
    },
    {
      file: 'services/order/checkout_flow.go:88',
      func: '(*Handler).FinalizeCart',
      label: 'checkout.FinalizeCart()',
      isActive: false,
      isApp: true,
      isHidden: false,
      isParent: true,
    },
  ];

  const systemFrames = [
    { file: 'net/http.(*conn).serve', func: '', label: 'net/http.(*conn).serve', isApp: false, isHidden: true },
    { file: 'runtime.goexit', func: '', label: 'runtime.goexit', isApp: false, isHidden: true },
  ];

  const breadcrumbs = [
    { icon: 'route', label: 'navigation', time: '14:22:01', detail: 'Route changed to /api/v1/checkout/finalize', color: 'primary' },
    { icon: 'cloud_sync', label: 'http', time: '14:22:02', detail: 'POST https://auth.internal/verify', color: 'secondary', sub: '200 OK (18ms)' },
    { icon: 'database', label: 'db.query', time: '14:22:03', detail: 'SELECT * FROM users WHERE id = $1', color: 'tertiary', sub: '(2ms)' },
    { icon: 'error', label: 'error', time: '14:22:04', detail: 'pool timeout waiting for available connection (5000ms)', color: 'error', sub: '5000ms timeout' },
  ];

  const runtimeContext = [
    { label: 'Operating System', value: 'Linux (Alpine 3.19)' },
    { label: 'Go Runtime', value: 'go1.22.1 linux/amd64' },
    { label: 'Kubernetes Pod', value: 'k8s-pod-us-east-4a' },
    { label: 'HTTP Transaction', value: 'POST /api/v1/checkout/finalize' },
  ];

  const shownCount = stackFrames.filter(f => !f.isHidden).length;
  const hiddenCount = systemFrames.length;

  return (
    <div className="flex flex-col h-screen bg-surface pt-safe">
      <div className="px-4 pt-3 pb-2">
        <div className="bg-surface-container-low p-3 rounded-xl flex flex-col gap-2 relative overflow-hidden shadow-sm">
          <div className="absolute -right-6 -bottom-6 w-28 h-28 rounded-full bg-primary/10 blur-xl pointer-events-none" />
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-error-container text-on-error-container text-code-sm uppercase tracking-wide font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-error animate-ping" />
                Critical
              </span>
              <span className="px-2 py-0.5 rounded bg-surface-container-high text-primary text-code-sm">v2.4.1</span>
            </div>
            <div className="flex items-center gap-1.5 text-on-surface-variant text-code-sm">
              <span className="text-[14px] mds">history</span>
              Last seen 2m ago
            </div>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-error text-code-md tracking-tight">Unhandled RuntimeException</span>
            <h2 className="text-headline-md text-on-surface break-words leading-tight">
              connection pool exhausted
            </h2>
            <span className="text-on-surface-variant text-code-sm truncate">
              database/sql/postgres_pool.go:142
            </span>
          </div>
          <div className="flex items-center justify-between pt-1 mt-1 bg-surface-container-lowest/60 -mx-3 -mb-3 px-3 py-1.5">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center text-code-sm font-bold">AD</div>
              <span className="text-code-sm text-on-surface">@alex-dev</span>
              <span className="w-1 h-1 rounded-full bg-outline-variant" />
              <span className="text-code-sm text-on-surface-variant">First seen 2h ago</span>
            </div>
            <div className="flex items-center gap-1 text-secondary text-code-sm">
              <span className="text-[14px] mds">deployed_code</span>
              deploy #8819
            </div>
          </div>
        </div>

        <div className="overflow-x-auto no-scrollbar -mx-4 px-4 flex items-center gap-1 py-0.5">
          <button
            onClick={() => setIsResolved(!isResolved)}
            className={cn(
              'flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg font-semibold text-code-sm active:scale-95 transition-all flex items-center gap-1',
              isResolved
                ? 'bg-surface-container-high text-secondary'
                : 'bg-secondary text-on-secondary shadow-sm'
            )}
          >
            <span className="text-[16px] mds">check_circle</span>
            {isResolved ? 'Unresolve' : 'Resolve'}
          </button>
          <button className="flex-shrink-0 flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-on-surface text-code-sm active:scale-95 transition-all flex items-center gap-1">
            <span className="text-[16px] mds text-on-surface-variant">snooze</span>
            Snooze
          </button>
          <button className="flex-shrink-0 flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-on-surface text-code-sm active:scale-95 transition-all flex items-center gap-1">
            <span className="text-[16px] mds text-on-surface-variant">person_add</span>
            Reassign
          </button>
          <button className="flex-shrink-0 flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-on-surface text-code-sm active:scale-95 transition-all flex items-center gap-1">
            <span className="text-[16px] mds text-on-surface-variant">ios_share</span>
            Share
          </button>
          <button className="flex-shrink-0 flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-primary text-code-sm active:scale-95 transition-all flex items-center gap-1">
            <span className="text-[16px] mds text-primary">code</span>
            GitHub #4402
          </button>
        </div>

        <div className="bg-surface-container-low p-3 rounded-xl flex flex-col gap-2 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[18px] mds text-primary">query_stats</span>
              <span className="text-headline-sm text-on-surface">Event Volume</span>
            </div>
            <span className="text-code-sm text-error bg-error-container/40 px-2 py-0.5 rounded font-semibold">
              +340% anomaly
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-surface-container p-2 rounded-lg flex flex-col">
              <span className="text-code-sm text-on-surface-variant uppercase tracking-wider">Total Occurrences</span>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="text-headline-md text-on-surface font-bold">1,428</span>
                <span className="text-code-sm text-error">events</span>
              </div>
            </div>
            <div className="bg-surface-container p-2 rounded-lg flex flex-col">
              <span className="text-code-sm text-on-surface-variant uppercase tracking-wider">Impacted Users</span>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="text-headline-md text-on-surface font-bold">82</span>
                <span className="text-code-sm text-tertiary">sessions</span>
              </div>
            </div>
          </div>
          <div className="bg-surface-container-lowest/80 p-2 rounded-lg flex flex-col gap-1 mt-1">
            <div className="flex items-center justify-between text-on-surface-variant text-code-sm">
              <span>T-2h (Deploy #8819)</span>
              <span className="text-primary font-medium">Now (50 events/min)</span>
            </div>
            <svg className="w-full h-14 overflow-visible" preserveAspectRatio="none" viewBox="0 0 240 60">
              <defs>
                <linearGradient id="spikeGrad" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#ffb4ab" stopOpacity="0.85" />
                  <stop offset="60%" stopColor="#06b6d4" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
                </linearGradient>
              </defs>
              <rect fill="#31353e" height="6" rx="1" width="7" x="0" y="54" />
              <rect fill="#31353e" height="5" rx="1" width="7" x="9" y="55" />
              <rect fill="#31353e" height="8" rx="1" width="7" x="18" y="52" />
              <rect fill="#31353e" height="5" rx="1" width="7" x="27" y="55" />
              <rect fill="#31353e" height="7" rx="1" width="7" x="36" y="53" />
              <rect fill="#31353e" height="4" rx="1" width="7" x="45" y="56" />
              <rect fill="#31353e" height="7" rx="1" width="7" x="54" y="53" />
              <rect fill="#31353e" height="5" rx="1" width="7" x="63" y="55" />
              <line stroke="#4cd7f6" strokeDasharray="2,2" strokeWidth="1.5" x1="74" x2="74" y1="4" y2="58" />
              <rect fill="#06b6d4" height="16" rx="1" width="7" x="76" y="44" />
              <rect fill="#06b6d4" height="24" rx="1" width="7" x="85" y="36" />
              <rect fill="#ffb4ab" height="36" rx="1" width="7" x="94" y="24" />
              <rect fill="#ffb4ab" height="44" rx="1" width="7" x="103" y="16" />
              <rect fill="#ffb4ab" height="50" rx="1" width="7" x="112" y="10" />
              <rect fill="#ffb4ab" height="52" rx="1" width="7" x="121" y="8" />
              <rect fill="#ffb4ab" height="54" rx="1" width="7" x="130" y="6" />
              <rect fill="#ffb4ab" height="48" rx="1" width="7" x="139" y="12" />
              <rect fill="#ffb4ab" height="51" rx="1" width="7" x="148" y="9" />
              <rect fill="#ffb4ab" height="49" rx="1" width="7" x="157" y="11" />
              <rect fill="#ffb4ab" height="53" rx="1" width="7" x="166" y="7" />
              <rect fill="#ffb4ab" height="55" rx="1" width="7" x="175" y="5" />
              <rect fill="#ffb4ab" height="52" rx="1" width="7" x="184" y="8" />
              <rect fill="#ffb4ab" height="54" rx="1" width="7" x="193" y="6" />
              <rect fill="#ffb4ab" height="50" rx="1" width="7" x="202" y="10" />
              <rect fill="#ffb4ab" height="53" rx="1" width="7" x="211" y="7" />
              <rect fill="#ffb4ab" height="54" rx="1" width="7" x="220" y="6" />
              <rect fill="#ffb4ab" height="56" rx="1" width="7" x="229" y="4" />
            </svg>
            <div className="flex items-center gap-1.5 text-on-surface-variant text-code-sm">
              <span className="w-2 h-2 rounded-full bg-primary" />
              Deploy #8819 merged PR #4391 (DB max_open_conns tuned to 20)
            </div>
          </div>
        </div>

        <div className="bg-surface-container-low p-3 rounded-xl flex flex-col gap-2 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[18px] mds text-primary">terminal</span>
              <span className="text-headline-sm text-on-surface">Stack Trace</span>
            </div>
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={inAppOnly}
                onChange={(e) => setInAppOnly(e.target.checked)}
                className="sr-only"
              />
              <span className="w-8 h-4.5 bg-primary-container rounded-full flex items-center p-0.5 transition-colors">
                <span className={cn('w-3.5 h-3.5 bg-surface rounded-full absolute shadow-sm transition-transform', inAppOnly ? 'translate-x-3.5' : 'translate-x-0')} />
              </span>
              <span className="text-code-sm text-on-surface">In-App only</span>
            </label>
          </div>

          <div className="bg-surface-container rounded-lg overflow-hidden flex flex-col">
            <div className="bg-surface-container-high px-2 py-1 flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[14px] mds text-error flex-shrink-0">crisis_alert</span>
                <span className="text-code-md text-on-surface truncate">acquireConnection()</span>
              </div>
              <span className="text-code-sm text-primary flex-shrink-0">postgres_pool.go:142</span>
            </div>
            <div className="bg-surface-container-lowest font-code-sm py-2 px-1 overflow-x-auto text-on-surface">
              {stackFrames[0]?.codeLines?.map((line) => (
                <div
                  key={line.num}
                  className={cn(
                    'flex items-center px-2 py-0.5',
                    line.muted ? 'opacity-60' : '',
                    line.error && 'bg-error-container text-on-error-container font-semibold rounded -mx-1 pl-1'
                  )}
                >
                  {line.error ? (
                    <span className="w-7 text-right select-none text-error mr-3 flex items-center justify-end gap-1">
                      <span className="text-[12px] mds">arrow_right</span>
                      {line.num}
                    </span>
                  ) : (
                    <span className="w-7 text-right select-none text-outline mr-3">{line.num}</span>
                  )}
                  <code>{line.code ?? ''}</code>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-surface-container rounded-lg p-2 flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-code-md text-on-surface">checkout.FinalizeCart()</span>
              <span className="text-code-sm text-on-surface-variant">checkout_flow.go:88</span>
            </div>
            <span className="text-code-sm text-outline truncate">services/order/checkout_flow.go:88 in (*Handler).FinalizeCart</span>
          </div>

          <button
            onClick={() => setInAppOnly(!inAppOnly)}
            className="text-center text-code-sm text-primary py-1"
          >
            Showing {shownCount} In-App frames ({hiddenCount} runtime frames hidden)
          </button>
        </div>

        <div className="bg-surface-container-low p-3 rounded-xl flex flex-col gap-2 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[18px] mds text-secondary">timeline</span>
              <span className="text-headline-sm text-on-surface">Breadcrumbs Trail</span>
            </div>
            <span className="text-code-sm text-on-surface-variant">4 recorded</span>
          </div>
          <div className="flex flex-col relative pl-6 mt-1">
            <div className="absolute left-2.5 top-2.5 bottom-2.5 w-0.5 bg-surface-container-highest" />
            {breadcrumbs.map((bc, i) => (
              <div key={i} className="relative flex flex-col pb-4 last:pb-0">
                <div className="absolute -left-6 top-1 w-5 h-5 rounded-full bg-surface-container-high flex items-center justify-center">
                  <span className="text-[12px] mds">{bc.icon}</span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className={cn('text-code-sm font-semibold', `text-${bc.color}`)}>{bc.label}</span>
                  <span className="text-code-sm text-outline">{bc.time}</span>
                </div>
                <p className="text-body-sm text-on-surface mt-0.5">{bc.detail}</p>
                {bc.sub && (
                  <span className={cn('text-code-sm mt-0.5', bc.color === 'error' ? 'text-error bg-error-container/40 px-1 rounded' : `text-${bc.color === 'secondary' ? 'secondary' : 'outline'}`)}>
                    {bc.sub}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="bg-surface-container-low p-3 rounded-xl flex flex-col gap-2 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[18px] mds text-primary">dns</span>
              <span className="text-headline-sm text-on-surface">Runtime Context</span>
            </div>
            <span className="text-code-sm text-primary">k8s-prod</span>
          </div>
          <div className="grid grid-cols-1 gap-2">
            {runtimeContext.map((rc) => (
              <div key={rc.label} className="bg-surface-container p-2 rounded-lg flex items-center justify-between">
                <span className="text-code-sm text-on-surface-variant">{rc.label}</span>
                <span className="text-code-sm text-on-surface bg-surface-container-high px-2 py-0.5 rounded">{rc.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <MobileNavBar links={[
        { path: '/issues', label: 'Issues', icon: 'bug_report' },
        { path: '/performance', label: 'Perf', icon: 'speed' },
        { path: '/replays', label: 'Replays', icon: 'play_circle' },
        { path: '/setup', label: 'Setup', icon: 'settings_input_component' },
      ]} />
    </div>
  );
}