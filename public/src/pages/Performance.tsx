import { useState } from 'react';
import { MobileNavBar } from '../components/MobileNavBar';
import { cn } from '../lib/utils';

export function Performance() {
  const [activeTimeRange, setActiveTimeRange] = useState('24h');
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedTrace, setSelectedTrace] = useState<{ title: string; avg: string; p95: string; req: string } | null>(null);

  const timeRanges = ['1h', '24h', '7d', '30d'];
  const timeKPIs: Record<string, { p75: string; throughput: string; apdex: string; failure: string }> = {
    '1h': { p75: '128ms', throughput: '4,512 rpm', apdex: '0.94', failure: '0.12%' },
    '24h': { p75: '142ms', throughput: '4,820 rpm', apdex: '0.96', failure: '0.08%' },
    '7d': { p75: '156ms', throughput: '4,690 rpm', apdex: '0.95', failure: '0.09%' },
    '30d': { p75: '162ms', throughput: '4,555 rpm', apdex: '0.93', failure: '0.11%' },
  };
  const kpi = timeKPIs[activeTimeRange];

  const slowestTx = [
    { title: 'POST /api/v2/reports/export', avg: '1,840ms', p95: '4.2s', req: '340 req/min', bar: 88, status: 'Regressed +40%', color: 'error' },
    { title: 'GET /api/v1/feed/personal', avg: '310ms', p95: '640ms', req: '2.8k req/min', bar: 24, status: 'Normal', color: 'primary' },
    { title: 'POST /auth/oauth/token', avg: '220ms', p95: '410ms', req: '1.2k req/min', bar: 16, status: 'Normal', color: 'primary' },
    { title: 'DELETE /api/v1/team/member', avg: '85ms', p95: '120ms', req: '45 req/min', bar: 6, status: 'Fast', color: 'secondary' },
  ];

  const traceModalData = [
    { name: 'express.middleware: authenticate', duration: '14ms', pct: '5%', color: 'secondary' },
    { name: 'postgres.query: SELECT * FROM telemetry_events', duration: '1,240ms (67%)', pct: '68%', color: 'error', warning: true },
    { name: 'aws.s3: putObject (compressed_report.zip)', duration: '480ms', pct: '26%', color: 'primary' },
  ];

  return (
    <div className="flex flex-col h-screen bg-surface">
      <div className="flex items-center justify-between gap-2 mb-2 px-4 mt-3">
        <div className="flex items-center p-1 rounded-xl bg-surface-container-low shadow-sm">
          {timeRanges.map((range) => (
            <button
              key={range}
              onClick={() => setActiveTimeRange(range)}
              className={cn(
                'px-2.5 py-1 rounded-lg text-code-sm transition-colors',
                activeTimeRange === range
                  ? 'bg-surface-container text-primary shadow-sm'
                  : 'text-on-surface-variant hover:text-on-surface'
              )}
            >
              {range}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-surface-container-low text-secondary text-code-md shadow-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />
            <span className="tracking-wide">prod-us-east-1</span>
          </div>
          <button className="w-8 h-8 rounded-xl bg-surface-container-low flex items-center justify-center text-on-surface-variant active:scale-95 transition-transform">
            <span className="text-[16px] mds">sync</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 px-4">
        <div className="p-3 rounded-xl bg-surface-container flex flex-col justify-between shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between text-on-surface-variant mb-1">
            <span className="text-code-sm uppercase tracking-wider">P75 Latency</span>
            <span className="text-[16px] mds text-primary">timer</span>
          </div>
          <div className="flex items-baseline gap-1 my-0.5">
            <span className="text-headline-lg-mobile text-on-surface font-bold">{kpi.p75.replace('ms', '')}</span>
            <span className="text-code-md text-on-surface-variant">ms</span>
          </div>
          <div className="flex items-center justify-between mt-1">
            <div className="flex items-center gap-0.5 text-secondary text-code-sm">
              <span className="text-[13px] mds">trending_down</span>
              <span>-18ms</span>
            </div>
          </div>
        </div>
        <div className="p-3 rounded-xl bg-surface-container flex flex-col justify-between shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between text-on-surface-variant mb-1">
            <span className="text-code-sm uppercase tracking-wider">Throughput</span>
            <span className="text-[16px] mds text-primary">speed</span>
          </div>
          <div className="flex items-baseline gap-1 my-0.5">
            <span className="text-headline-lg-mobile text-on-surface font-bold">{kpi.throughput}</span>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-code-sm text-on-surface-variant">peak 6.1k</span>
          </div>
        </div>
        <div className="p-3 rounded-xl bg-surface-container flex flex-col justify-between shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between text-on-surface-variant mb-1">
            <span className="text-code-sm uppercase tracking-wider">Apdex</span>
            <span className="text-[16px] mds text-secondary">sentiment_very_satisfied</span>
          </div>
          <div className="flex items-baseline gap-1 my-0.5">
            <span className="text-headline-lg-mobile text-secondary font-bold">{kpi.apdex}</span>
            <span className="text-code-sm text-on-surface-variant">/1.0</span>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="px-1.5 py-0.5 rounded bg-surface-container-high text-secondary text-code-sm">Excellent</span>
            <span className="text-code-sm text-on-surface-variant">T = 200ms</span>
          </div>
        </div>
        <div className="p-3 rounded-xl bg-surface-container flex flex-col justify-between shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between text-on-surface-variant mb-1">
            <span className="text-code-sm uppercase tracking-wider">Failure Rate</span>
            <span className="text-[16px] mds text-tertiary">format_image_left</span>
          </div>
          <div className="flex items-baseline gap-1 my-0.5">
            <span className="text-headline-lg-mobile text-on-surface font-bold">{kpi.failure.replace('%', '')}</span>
            <span className="text-code-md text-on-surface-variant">%</span>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-code-sm text-secondary">38 err/24h</span>
            <div className="w-10 h-1.5 rounded-full bg-surface-container-high overflow-hidden">
              <div className="h-full bg-secondary rounded-full" style={{ width: kpi.failure }}></div>
            </div>
          </div>
        </div>
      </div>

      <div className="p-3 rounded-xl bg-surface-container shadow-sm flex flex-col gap-2 mt-2 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[18px] mds text-primary">monitoring</span>
            <span className="text-headline-sm text-on-surface font-semibold">Latency Dynamics</span>
          </div>
          <div className="flex items-center gap-2 text-code-sm">
            <div className="flex items-center gap-1">
              <span className="w-2 h-0.5 rounded-full bg-primary" />
              <span className="text-on-surface-variant">P95</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-2 h-0.5 rounded-full bg-secondary" />
              <span className="text-on-surface-variant">P50</span>
            </div>
          </div>
        </div>
        <div className="w-full h-24 relative flex items-center justify-center">
          <svg className="w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 320 80">
            <defs>
              <linearGradient id="cyanFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#4cd7f6" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#4cd7f6" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="emeraldFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#4edea3" stopOpacity="0.18" />
                <stop offset="100%" stopColor="#4edea3" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d="M0 45 C30 38, 60 52, 90 32 C120 18, 150 48, 180 28 C210 12, 240 30, 270 20 C295 12, 310 16, 320 15 L320 80 L0 80 Z" fill="url(#cyanFill)" />
            <path d="M0 45 C30 38, 60 52, 90 32 C120 18, 150 48, 180 28 C210 12, 240 30, 270 20 C295 12, 310 16, 320 15" fill="none" stroke="#4cd7f6" strokeLinecap="round" strokeWidth="1.5" />
            <path d="M0 64 C35 60, 70 66, 110 58 C150 50, 190 62, 230 52 C270 44, 300 48, 320 46 L320 80 L0 80 Z" fill="url(#emeraldFill)" />
            <path d="M0 64 C35 60, 70 66, 110 58 C150 50, 190 62, 230 52 C270 44, 300 48, 320 46" fill="none" stroke="#4edea3" strokeLinecap="round" strokeWidth="1.5" />
            <circle cx="270" cy="20" fill="#4cd7f6" r="3" />
            <circle cx="270" cy="20" fill="#4cd7f6" opacity="0.3" r="6" className="animate-ping" />
          </svg>
        </div>
        <div className="flex items-center justify-between text-on-surface-variant text-code-sm">
          <span>24h ago</span>
          <span>12h ago</span>
          <span>6h ago</span>
          <span className="text-primary font-bold">Now</span>
        </div>
      </div>

      <div className="flex flex-col gap-1 mt-2 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[18px] mds text-secondary">vital_signs</span>
            <span className="text-headline-sm text-on-surface font-semibold">Vitals Matrix</span>
          </div>
          <span className="text-code-sm text-on-surface-variant">75th Percentile</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'LCP', value: '1.1', unit: 's', pct: '44%' },
            { label: 'FID / INP', value: '42', unit: 'ms', pct: '21%' },
            { label: 'CLS', value: '0.02', unit: 'score', pct: '20%' },
            { label: 'Warm Start', value: '420', unit: 'ms', pct: '42%', color: 'primary' },
          ].map((v) => (
            <div key={v.label} className="p-3 rounded-xl bg-surface-container flex flex-col justify-between shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-code-sm text-on-surface-variant">{v.label}</span>
                <span className="px-1.5 py-0.5 rounded bg-surface-container-high text-secondary text-code-sm">Good</span>
              </div>
              <div className="flex items-baseline gap-1 my-1">
                <span className="text-headline-md text-on-surface font-bold">{v.value}</span>
                <span className="text-code-md text-on-surface-variant">{v.unit}</span>
              </div>
              <div className="w-full bg-surface-container-high h-1 rounded-full overflow-hidden">
                <div className="bg-secondary h-full rounded-full" style={{ width: v.pct }}></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1 mt-2 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[18px] mds text-error">crisis_alert</span>
            <span className="text-headline-sm text-on-surface font-semibold">Slowest Transactions</span>
          </div>
          <span className="text-code-sm text-on-surface-variant">Sorted by P95</span>
        </div>
        {slowestTx.map((tx, i) => (
          <div
            key={i}
            onClick={() => {
              setSelectedTrace(tx);
              setModalOpen(true);
            }}
            className={cn(
              'p-3 rounded-xl bg-surface-container flex flex-col gap-1 shadow-sm hover:bg-surface-container-high transition-colors cursor-pointer'
            )}
          >
            <div className="flex items-center justify-between gap-1">
              <span className="text-code-lg text-on-surface font-semibold truncate">{tx.title}</span>
              <span className={cn(
                'px-1.5 py-0.5 rounded text-code-sm flex-shrink-0',
                tx.status === 'Regressed +40%' ? 'bg-error-container text-on-error-container animate-pulse font-semibold' :
                  tx.status === 'Fast' ? 'bg-surface-container-high text-secondary' :
                  tx.status === 'Normal' ? 'bg-surface-container-high text-secondary' : ''
              )}>
                {tx.status}
              </span>
            </div>
            <div className="flex items-center justify-between text-on-surface-variant text-code-md">
              <div className="flex items-center gap-2">
                <span>Avg <strong className="text-on-surface">{tx.avg}</strong></span>
                <span className="text-outline">|</span>
                <span>P95 <strong className={tx.status === 'Regressed +40%' ? 'text-error font-semibold' : 'text-on-surface'}>
                  {tx.p95}
                </strong></span>
              </div>
              <span className="text-on-surface-variant">{tx.req}</span>
            </div>
            <div className="w-full bg-surface-container-high h-1.5 rounded-full overflow-hidden mt-0.5">
              <div className="bg-error h-full rounded-full" style={{ width: tx.bar }}></div>
            </div>
          </div>
        ))}
        <button
          onClick={() => {
            setSelectedTrace(slowestTx[0]);
            setModalOpen(true);
          }}
          className="w-full h-11 px-3 rounded-xl bg-primary text-on-primary text-code-lg font-semibold flex items-center justify-center gap-2 shadow-sm active:opacity-90 active:scale-[0.99] transition-transform mt-2"
        >
          <span className="text-[20px] mds">account_tree</span>
          <span>Inspect Distributed Trace Waterfall</span>
        </button>
      </div>

      {modalOpen && selectedTrace && (
        <div className="fixed inset-0 z-50 bg-surface/90 backdrop-blur-md hidden flex-col justify-end">
          <div className="flex-1 w-full" onClick={() => setModalOpen(false)} />
          <div className="w-full bg-surface-container rounded-t-2xl p-4 shadow-2xl flex flex-col gap-3 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex flex-col min-w-0">
                <span className="text-code-sm text-primary uppercase tracking-wider">Trace Investigation</span>
                <span className="text-headline-sm text-on-surface font-bold truncate">{selectedTrace.title}</span>
              </div>
              <button onClick={() => setModalOpen(false)} className="w-8 h-8 rounded-lg bg-surface-container-high text-on-surface flex items-center justify-center hover:bg-surface-bright">
                <span className="text-[18px] mds">close</span>
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 p-2 rounded-xl bg-surface-container-low text-center">
              <div>
                <span className="text-code-sm text-on-surface-variant block">Duration</span>
                <span className="text-code-lg text-error font-bold">{selectedTrace.avg}</span>
              </div>
              <div>
                <span className="text-code-sm text-on-surface-variant block">P95</span>
                <span className="text-code-lg text-on-surface font-semibold">{selectedTrace.p95}</span>
              </div>
              <div>
                <span className="text-code-sm text-on-surface-variant block">Throughput</span>
                <span className="text-code-lg text-secondary font-semibold">{selectedTrace.req}</span>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-on-surface-variant text-code-sm">
                <span>SPANS TIMELINE (0ms - {selectedTrace.avg})</span>
                <span className="text-primary">8 Spans Total</span>
              </div>
              {traceModalData.map((span, i) => (
                <div key={i} className="flex flex-col gap-1 p-2 rounded-lg bg-surface-container-low">
                  <div className="flex items-center justify-between text-code-sm">
                    <span className={cn('font-semibold', span.warning ? 'text-error flex items-center gap-1' : span.color === 'error' ? 'text-error' : 'text-on-surface')}>
                      {span.warning && <span className="text-[14px] mds">warning</span>}
                      {span.name}
                    </span>
                    <span className={cn('font-semibold', span.color === 'error' ? 'text-error' : span.color === 'primary' ? 'text-primary' : 'text-secondary')}>{span.duration}</span>
                  </div>
                  <div className="w-full bg-surface-container-high h-2 rounded-full overflow-hidden relative">
                    <div className={cn('absolute bg-secondary h-full rounded-full', span.color === 'error' ? '!bg-error' : span.color === 'primary' ? '!bg-primary' : '')} style={{ left: '6%', width: span.pct }}></div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 pt-2">
              <button className="flex-1 h-10 rounded-xl bg-surface-container-high text-on-surface text-code-md font-semibold hover:bg-surface-bright flex items-center justify-center gap-1.5">
                <span className="text-[16px] mds">content_copy</span>
                Copy JSON Span
              </button>
              <button onClick={() => setModalOpen(false)} className="flex-1 h-10 rounded-xl bg-primary text-on-primary text-code-md font-semibold flex items-center justify-center gap-1.5">
                <span className="text-[16px] mds">done</span>
                Done
              </button>
            </div>
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