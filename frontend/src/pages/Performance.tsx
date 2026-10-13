import { useEffect, useMemo, useState } from 'react';
import { PageShell } from '../components/PageShell';
import { cn, formatMs, percentile } from '../lib/utils';
import { listEvents } from '../lib/api';

interface SpanRow {
  name: string;
  op: string | null;
  durationMs: number;
  status: string | null;
}

interface TxRow {
  id: string;
  name: string;
  durationMs: number;
  status: string | null;
  traceId: string | null;
  op: string | null;
  receivedAt: string;
  spans: SpanRow[];
}

interface TxAggregate {
  name: string;
  count: number;
  avgMs: number;
  p95Ms: number;
  failurePct: number | null;
}

const timeRanges = ['1h', '24h', '7d', '30d'] as const;
const rangeMs: Record<string, number> = { '1h': 3_600_000, '24h': 86_400_000, '7d': 604_800_000, '30d': 2_592_000_000 };

function toTxRow(id: string, tx: any, receivedAt: string): TxRow | null {
  if (!tx || typeof tx !== 'object') return null;
  const start = typeof tx.start_timestamp === 'number' ? tx.start_timestamp : null;
  const end = typeof tx.timestamp === 'number' ? tx.timestamp : null;
  const durationSec = typeof tx.duration === 'number'
    ? tx.duration
    : start != null && end != null ? end - start : null;
  const spans: SpanRow[] = Array.isArray(tx.spans)
    ? tx.spans
        .map((s: any) => {
          const sStart = typeof s?.start_timestamp === 'number' ? s.start_timestamp : null;
          const sEnd = typeof s?.timestamp === 'number' ? s.timestamp : null;
          const dur = sStart != null && sEnd != null ? (sEnd - sStart) * 1000 : null;
          if (dur == null) return null;
          return {
            name: String(s.name ?? 'unknown'),
            op: typeof s.op === 'string' ? s.op : null,
            durationMs: dur,
            status: typeof s.status === 'string' ? s.status : null,
          } satisfies SpanRow;
        })
        .filter((s: SpanRow | null): s is SpanRow => s !== null)
    : [];
  return {
    id,
    name: String(tx.transaction ?? 'unknown'),
    durationMs: durationSec != null ? durationSec * 1000 : Number.NaN,
    status: typeof tx.status === 'string' ? tx.status : null,
    traceId: typeof tx.trace_id === 'string' ? tx.trace_id : null,
    op: tx.contexts?.trace?.op ?? null,
    receivedAt,
    spans,
  };
}

function aggregate(rows: TxRow[]): TxAggregate[] {
  const byName = new Map<string, TxRow[]>();
  for (const row of rows) {
    const list = byName.get(row.name) ?? [];
    list.push(row);
    byName.set(row.name, list);
  }
  return [...byName.entries()]
    .map(([name, list]) => {
      const durations = list.map((r) => r.durationMs).filter((d) => !Number.isNaN(d));
      const known = list.filter((r) => r.status != null);
      const failed = known.filter((r) => r.status !== 'ok').length;
      return {
        name,
        count: list.length,
        avgMs: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : Number.NaN,
        p95Ms: percentile(durations, 95) ?? Number.NaN,
        failurePct: known.length ? Math.round((failed / known.length) * 100) : null,
      };
    })
    .sort((a, b) => (Number.isNaN(b.p95Ms) ? -1 : b.p95Ms) - (Number.isNaN(a.p95Ms) ? -1 : a.p95Ms));
}

export function Performance() {
  const [activeTimeRange, setActiveTimeRange] = useState<(typeof timeRanges)[number]>('24h');
  const [allTx, setAllTx] = useState<TxRow[]>([]);
  const [selected, setSelected] = useState<TxRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await listEvents();
        const events = (result?.data ?? []) as Array<{ id: string; itemTypes: string[]; transaction: any; receivedAt: string }>;
        const mapped = events
          .filter((e) => e.itemTypes?.includes('transaction'))
          .map((e) => toTxRow(e.id, e.transaction, e.receivedAt))
          .filter((r): r is TxRow => r !== null);
        if (!cancelled) setAllTx(mapped);
      } catch {
        // keep last known data on fetch failure
      }
    };
    load();
    const interval = setInterval(load, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const windowStart = Date.now() - rangeMs[activeTimeRange]!;
  const rows = useMemo(
    () => allTx.filter((r) => new Date(r.receivedAt).getTime() >= windowStart),
    [allTx, windowStart]
  );

  const durations = useMemo(() => rows.map((r) => r.durationMs).filter((d) => !Number.isNaN(d)), [rows]);
  const p75 = percentile(durations, 75);
  const p50 = percentile(durations, 50);
  const knownStatus = rows.filter((r) => r.status != null);
  const failureRate = knownStatus.length
    ? Math.round((knownStatus.filter((r) => r.status !== 'ok').length / knownStatus.length) * 100)
    : null;
  const throughput = rows.length > 0 ? (rows.length / (rangeMs[activeTimeRange]! / 60_000)).toFixed(1) : null;

  const aggregates = useMemo(() => aggregate(rows), [rows]);

  return (
    <PageShell narrow>
      <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 mb-1">
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
        <span className="text-code-sm text-on-surface-variant">auto-reloading (2s)</span>
      </div>

      {rows.length === 0 ? (
        <div className="py-16 flex items-center justify-center">
          <div className="border border-dashed border-outline-variant rounded-xl p-8 flex flex-col items-center justify-center gap-3 text-center max-w-md">
            <span className="material-symbols-outlined text-[36px] text-outline">speed</span>
            <h3 className="text-headline-sm text-on-surface font-semibold">No transactions in this window</h3>
            <p className="text-body-sm text-on-surface-variant">
              Send traces with performance monitoring enabled (tracesSampleRate &gt; 0) and they will show up here.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* KPI tiles — computed from real transactions */}
          <div className="grid grid-cols-2 gap-2">
            <div className="p-3 rounded-xl bg-surface-container flex flex-col justify-between shadow-sm">
              <div className="flex items-center justify-between text-on-surface-variant mb-1">
                <span className="text-code-sm uppercase tracking-wider">P75 Duration</span>
                <span className="text-[16px] mds text-primary">timer</span>
              </div>
              <div className="flex items-baseline gap-1 my-0.5">
                <span className="text-headline-lg-mobile text-on-surface font-bold">{p75 != null ? formatMs(p75) : '—'}</span>
              </div>
              <span className="text-code-sm text-on-surface-variant">P50 {p50 != null ? formatMs(p50) : '—'}</span>
            </div>
            <div className="p-3 rounded-xl bg-surface-container flex flex-col justify-between shadow-sm">
              <div className="flex items-center justify-between text-on-surface-variant mb-1">
                <span className="text-code-sm uppercase tracking-wider">Throughput</span>
                <span className="text-[16px] mds text-primary">speed</span>
              </div>
              <div className="flex items-baseline gap-1 my-0.5">
                <span className="text-headline-lg-mobile text-on-surface font-bold">{throughput ?? '—'}</span>
                <span className="text-code-md text-on-surface-variant">tx/min</span>
              </div>
              <span className="text-code-sm text-on-surface-variant">{rows.length} transactions</span>
            </div>
            <div className="p-3 rounded-xl bg-surface-container flex flex-col justify-between shadow-sm">
              <div className="flex items-center justify-between text-on-surface-variant mb-1">
                <span className="text-code-sm uppercase tracking-wider">Fastest / Slowest</span>
                <span className="text-[16px] mds text-secondary">swap_vert</span>
              </div>
              <div className="flex items-baseline gap-1 my-0.5">
                <span className="text-headline-lg-mobile text-secondary font-bold">
                  {durations.length ? formatMs(Math.min(...durations)) : '—'}
                </span>
                <span className="text-code-md text-on-surface-variant">/</span>
                <span className="text-headline-lg-mobile text-error font-bold">
                  {durations.length ? formatMs(Math.max(...durations)) : '—'}
                </span>
              </div>
            </div>
            <div className="p-3 rounded-xl bg-surface-container flex flex-col justify-between shadow-sm">
              <div className="flex items-center justify-between text-on-surface-variant mb-1">
                <span className="text-code-sm uppercase tracking-wider">Failure Rate</span>
                <span className="text-[16px] mds text-tertiary">format_image_left</span>
              </div>
              <div className="flex items-baseline gap-1 my-0.5">
                <span className="text-headline-lg-mobile text-on-surface font-bold">{failureRate != null ? failureRate : '—'}</span>
                <span className="text-code-md text-on-surface-variant">%</span>
              </div>
              <span className="text-code-sm text-on-surface-variant">{knownStatus.length} with status</span>
            </div>
          </div>

          {/* Slowest Transactions — grouped from real data */}
          <div className="flex flex-col gap-1 mt-1 pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[18px] mds text-error">crisis_alert</span>
                <span className="text-headline-sm text-on-surface font-semibold">Slowest Transactions</span>
              </div>
              <span className="text-code-sm text-on-surface-variant">sorted by P95</span>
            </div>
            {aggregates.map((tx) => {
              const slowest = Math.max(...durations, 1);
              const barWidth = Math.max(4, Math.min(100, Math.round((tx.p95Ms / slowest) * 100)));
              const example = rows.find((r) => r.name === tx.name) ?? null;
              return (
                <div
                  key={tx.name}
                  onClick={() => example && setSelected(example)}
                  className="p-3 rounded-xl bg-surface-container flex flex-col gap-1 shadow-sm hover:bg-surface-container-high transition-colors cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-code-lg text-on-surface font-semibold truncate">{tx.name}</span>
                    <span className="px-1.5 py-0.5 rounded text-code-sm flex-shrink-0 bg-surface-container-high text-secondary">
                      {tx.count} tx
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-on-surface-variant text-code-md">
                    <div className="flex items-center gap-2">
                      <span>Avg <strong className="text-on-surface">{formatMs(tx.avgMs)}</strong></span>
                      <span className="text-outline">|</span>
                      <span>P95 <strong className={cn(tx.failurePct != null && tx.failurePct > 0 ? 'text-error font-semibold' : 'text-on-surface')}>
                        {formatMs(tx.p95Ms)}
                      </strong></span>
                    </div>
                    <span className={cn(tx.failurePct != null && tx.failurePct > 0 ? 'text-error' : 'text-secondary')}>
                      {tx.failurePct != null ? `${tx.failurePct}% failed` : 'no status'}
                    </span>
                  </div>
                  <div className="w-full bg-surface-container-high h-1.5 rounded-full overflow-hidden mt-0.5">
                    <div className={cn('h-full rounded-full', tx.failurePct != null && tx.failurePct > 0 ? 'bg-error' : 'bg-secondary')} style={{ width: `${barWidth}%` }}></div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {selected && (
        <div className="fixed inset-0 z-[60] bg-surface/90 backdrop-blur-md flex flex-col justify-end">
          <div className="flex-1 w-full" onClick={() => setSelected(null)} />
          <div className="w-full bg-surface-container rounded-t-2xl p-4 shadow-2xl flex flex-col gap-3 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex flex-col min-w-0">
                <span className="text-code-sm text-primary uppercase tracking-wider">Trace Investigation</span>
                <span className="text-headline-sm text-on-surface font-bold truncate">{selected.name}</span>
              </div>
              <button onClick={() => setSelected(null)} className="w-8 h-8 rounded-lg bg-surface-container-high text-on-surface flex items-center justify-center hover:bg-surface-bright">
                <span className="text-[18px] mds">close</span>
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 p-2 rounded-xl bg-surface-container-low text-center">
              <div>
                <span className="text-code-sm text-on-surface-variant block">Duration</span>
                <span className="text-code-lg text-error font-bold">{formatMs(selected.durationMs)}</span>
              </div>
              <div>
                <span className="text-code-sm text-on-surface-variant block">Status</span>
                <span className="text-code-lg text-on-surface font-semibold">{selected.status ?? '—'}</span>
              </div>
              <div>
                <span className="text-code-sm text-on-surface-variant block">Spans</span>
                <span className="text-code-lg text-secondary font-semibold">{selected.spans.length}</span>
              </div>
            </div>
            {selected.traceId && (
              <div className="p-2 rounded-lg bg-surface-container-low flex items-center justify-between">
                <span className="text-code-sm text-on-surface-variant">Trace ID</span>
                <span className="text-code-sm text-on-surface font-mono truncate">{selected.traceId}</span>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-on-surface-variant text-code-sm">
                <span>SPANS TIMELINE</span>
                <span className="text-primary">{selected.spans.length} span{selected.spans.length === 1 ? '' : 's'}</span>
              </div>
              {selected.spans.length === 0 ? (
                <p className="text-body-sm text-on-surface-variant">No child spans recorded for this transaction.</p>
              ) : (
                selected.spans.map((span, i) => {
                  const total = Math.max(selected.durationMs, 1);
                  const width = Math.max(3, Math.min(100, Math.round((span.durationMs / total) * 100)));
                  return (
                    <div key={i} className="flex flex-col gap-1 p-2 rounded-lg bg-surface-container-low">
                      <div className="flex items-center justify-between text-code-sm">
                        <span className="font-semibold text-on-surface truncate">
                          {span.op && <span className="text-primary mr-1">[{span.op}]</span>}
                          {span.name}
                        </span>
                        <span className={cn('font-semibold flex-shrink-0', span.durationMs > total * 0.5 ? 'text-error' : 'text-secondary')}>
                          {formatMs(span.durationMs)}
                        </span>
                      </div>
                      <div className="w-full bg-surface-container-high h-2 rounded-full overflow-hidden relative">
                        <div className={cn('absolute h-full rounded-full', span.durationMs > total * 0.5 ? 'bg-error' : 'bg-secondary')} style={{ width: `${width}%` }}></div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={() => navigator.clipboard.writeText(JSON.stringify(selected, null, 2))}
                className="flex-1 h-10 rounded-xl bg-surface-container-high text-on-surface text-code-md font-semibold hover:bg-surface-bright flex items-center justify-center gap-1.5"
              >
                <span className="text-[16px] mds">content_copy</span>
                Copy JSON
              </button>
              <button onClick={() => setSelected(null)} className="flex-1 h-10 rounded-xl bg-primary text-on-primary text-code-md font-semibold flex items-center justify-center gap-1.5">
                <span className="text-[16px] mds">done</span>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      </div>
    </PageShell>
  );
}
