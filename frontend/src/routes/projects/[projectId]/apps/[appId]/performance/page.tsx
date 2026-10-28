import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Gauge, Play } from "lucide-react";
import { useMetrics, type MetricPoint } from "../../../../../../hooks/use-metrics";
import { Btn, Pill, Stat } from "../../../../../../components/ui-kit";
import { cn } from "../../../../../../lib/utils";
import { AppLayout } from "../../../../../../components/app-layout";
import { LoadingScreen } from "../../../../../../components/loading-screen";

const inputCls = "w-full rounded-md border bg-card px-2 py-1.5 font-mono text-xs outline-none focus:border-primary";

function LineChart({ data }: { data: number[] }) {
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${40 - (v / max) * 40}`).join(" ");
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-28 w-full">
      <polyline points={`0,40 ${pts} 100,40`} className="fill-primary/10" />
      <polyline points={pts} fill="none" vectorEffect="non-scaling-stroke" className="stroke-primary" strokeWidth={2} />
    </svg>
  );
}

export default function PerformancePage() {
  const { projectId, appId } = useParams<{ projectId: string; appId: string }>();
  if (!projectId || !appId) return null;
  return (
    <AppLayout>
      <PerformanceInner projectId={projectId} appId={appId} />
    </AppLayout>
  );
}

function PerformanceInner({ projectId, appId }: { projectId: string; appId: string }) {
  const { series, loading, live } = useMetrics(appId, "error_count");
  const [sel, setSel] = useState(0);
  const [tests, setTests] = useState<Array<{ id: string; scenario: string; target: string; vus: number; duration: string; rps: number; p95: number; errorRate: number; status: "passed" | "failed" | "running"; ranAt: string }>>([]);
  const [form, setForm] = useState({ scenario: "", target: "", vus: 100, duration: "5m", maxP95: 800 });
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  if (loading) return <LoadingScreen />;

  const points = series?.points ?? [];
  const tx = points[sel] ?? null;

  const run = () => {
    const id = crypto.randomUUID();
    setTests((t) => [{ id, scenario: form.scenario.trim() || "Ad-hoc run", target: form.target || "error_count", vus: form.vus, duration: form.duration, rps: 0, p95: 0, errorRate: 0, status: "running", ranAt: new Date().toISOString() }, ...t]);
    timers.current.push(
      window.setTimeout(() => {
        const p95 = Math.round((tx?.p95 ?? 100) * (0.8 + form.vus / 400));
        const errorRate = Math.round((form.vus / 300) * 100) / 100;
        setTests((t) => t.map((x) => (x.id === id ? { ...x, rps: Math.round(form.vus * 4.2), p95, errorRate, status: p95 > form.maxP95 || errorRate > 2 ? "failed" : "passed" } : x)));
      }, 2500),
    );
  };

  const vital = (v: number, good: number, poor: number) => (v <= good ? "text-success" : v <= poor ? "text-warning" : "text-destructive");

  return (
    <div className="space-y-6">
      <span className="flex items-center justify-end gap-2 font-mono text-xs text-muted-foreground">
        <span className={cn("h-2 w-2 rounded-full bg-primary", live === "connected" && "animate-pulse")} /> live
      </span>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="p50" value={<span className={vital(tx?.p50 ?? 0, 200, 500)}>{tx?.p50 ?? "—"}ms</span>} hint="Median latency" />
        <Stat label="p95" value={<span className={vital(tx?.p95 ?? 0, 500, 1000)}>{tx?.p95 ?? "—"}ms</span>} hint="95th percentile" />
        <Stat label="p99" value={<span className={vital(tx?.p99 ?? 0, 1000, 2000)}>{tx?.p99 ?? "—"}ms</span>} hint="99th percentile" />
      </div>

      {points.length > 0 && (
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="panel overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="border-b text-left font-mono text-[11px] uppercase text-muted-foreground">
                <tr><th className="p-3 font-normal">Metric</th><th className="font-normal">count</th><th className="font-normal">mean</th><th className="font-normal">p50</th><th className="font-normal">p95</th><th className="pr-3 font-normal">p99</th></tr>
              </thead>
              <tbody className="font-mono text-xs">
                {points.map((p: MetricPoint, i: number) => (
                  <tr key={p.bucketStart} onClick={() => setSel(i)} className={cn("cursor-pointer border-b last:border-0 hover:bg-muted/60", sel === i && "bg-accent")}>
                    <td className="p-3"><div className="font-sans text-sm font-medium">{p.bucketStart}</div></td>
                    <td>{p.count}</td>
                    <td>{Math.round(p.mean)}</td>
                    <td>{p.p50}ms</td>
                    <td className={cn(p.p95 > 1000 && "text-destructive")}>{p.p95}ms</td>
                    <td className="pr-3">{p.p99}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel p-4">
            <div className="font-mono text-[11px] uppercase text-muted-foreground">p95 latency · recent</div>
            <div className="mt-1 font-semibold">error_count</div>
            <LineChart data={points.map((p) => p.p95)} />
            <div className="flex justify-between font-mono text-[11px] text-muted-foreground">
              <span>min {Math.min(...points.map((p) => p.p95))}ms</span>
              <span>max {Math.max(...points.map((p) => p.p95))}ms</span>
            </div>
          </div>
        </section>
      )}

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="panel space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-2 font-semibold"><Gauge className="h-4 w-4 text-primary" />New load test</h3><Pill>simulation</Pill></div>
          <label className="block space-y-1 text-xs text-muted-foreground">Scenario name
            <input value={form.scenario} onChange={(e) => setForm({ ...form, scenario: e.target.value })} placeholder="Checkout spike" className={inputCls} />
          </label>
          <label className="block space-y-1 text-xs text-muted-foreground">Target
            <select value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} className={inputCls}>
              <option value="error_count">error_count</option>
            </select>
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="space-y-1 text-xs text-muted-foreground">Virtual users
              <input type="number" min={1} value={form.vus} onChange={(e) => setForm({ ...form, vus: Math.max(1, Number(e.target.value)) })} className={inputCls} />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">Duration
              <select value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} className={inputCls}>{["1m", "5m", "15m", "30m"].map((d) => <option key={d}>{d}</option>)}</select>
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">Fail if p95 &gt; (ms)
              <input type="number" min={1} value={form.maxP95} onChange={(e) => setForm({ ...form, maxP95: Number(e.target.value) })} className={inputCls} />
            </label>
          </div>
          <Btn variant="primary" onClick={run} className="w-full justify-center"><Play className="h-4 w-4" />Run test</Btn>
        </div>

        <div className="panel divide-y">
          {tests.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{t.scenario}</span>
                  <Pill tone={t.status === "passed" ? "primary" : t.status === "failed" ? "destructive" : "warning"}>{t.status === "running" ? "running…" : t.status}</Pill>
                </div>
                <div className="truncate font-mono text-[11px] text-muted-foreground">{t.target} · {t.vus} VUs · {t.duration} · {t.status === "running" ? "now" : new Date(t.ranAt).toLocaleDateString()}</div>
              </div>
              {t.status !== "running" && (
                <div className="shrink-0 text-right font-mono text-[11px]">
                  <div>{t.rps} rps</div>
                  <div className="text-muted-foreground">p95 {t.p95}ms · err {t.errorRate}%</div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
