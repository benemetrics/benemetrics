import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Gauge, Play } from "lucide-react";
import { getApp, getPerformance, timeAgo, type LoadTest } from "../../../../../../lib/data";
import { Btn, Pill, Stat } from "../../../../../../components/ui-kit";
import { cn } from "../../../../../../lib/utils";
import { AppLayout } from "../../../../../../components/app-layout";
import { LoadingScreen } from "../../../../../../components/loading-screen";
import { NotFoundPage } from "../../../../../../components/not-found";
import { useApp } from "../../../../../../hooks/use-app";

const inputCls =
  "w-full rounded-md border bg-card px-2 py-1.5 font-mono text-xs outline-none focus:border-primary";

function niceMax(v: number) {
  const step = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / step) * step;
}

function LineChart({ p95, p50 }: { p95: number[]; p50: number[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(...p95) * 1.05);
  const n = p95.length;
  const x = (i: number) => (i / (n - 1)) * 100;
  const y = (v: number) => 100 - (v / max) * 100;
  const line = (d: number[]) => d.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  const hourLabel = (i: number) => (i === n - 1 ? "now" : `-${n - 1 - i}h`);

  return (
    <div className="mt-3">
      <div className="mb-2 flex gap-4 font-mono text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="h-0.5 w-3 bg-primary" /> p95
        </span>
        <span className="flex items-center gap-1">
          <span className="h-0.5 w-3 bg-muted-foreground" /> p50
        </span>
      </div>
      <div className="flex gap-2">
        <div className="relative h-40 w-10 shrink-0 font-mono text-[10px] text-muted-foreground">
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute right-0 -translate-y-1/2"
              style={{ top: `${y(t)}%` }}
            >
              {t}ms
            </span>
          ))}
        </div>
        <div
          className="relative h-40 flex-1"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setHover(
              Math.min(n - 1, Math.max(0, Math.round(((e.clientX - r.left) / r.width) * (n - 1)))),
            );
          }}
        >
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
            {ticks.map((t) => (
              <line
                key={t}
                x1={0}
                x2={100}
                y1={y(t)}
                y2={y(t)}
                vectorEffect="non-scaling-stroke"
                className="stroke-border"
                strokeDasharray={t ? "3 3" : undefined}
              />
            ))}
            <polygon
              points={`0,100 ${line(p95)} 100,100`}
              className="fill-primary/10"
            />
            <polyline
              points={line(p50)}
              fill="none"
              vectorEffect="non-scaling-stroke"
              className="stroke-muted-foreground"
              strokeWidth={1.5}
            />
            <polyline
              points={line(p95)}
              fill="none"
              vectorEffect="non-scaling-stroke"
              className="stroke-primary"
              strokeWidth={2}
            />
            {hover !== null && (
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={0}
                y2={100}
                vectorEffect="non-scaling-stroke"
                className="stroke-foreground/30"
              />
            )}
          </svg>
          {hover !== null && (
            <div
              className="pointer-events-none absolute top-0 z-10 rounded-md border bg-card px-2 py-1 font-mono text-[11px] shadow-sm"
              style={{
                left: `${x(hover)}%`,
                transform: `translateX(${hover > n / 2 ? "-105%" : "5%"})`,
              }}
            >
              <div className="text-muted-foreground">{hourLabel(hover)}</div>
              <div className="text-primary">p95 {p95[hover]}ms</div>
              <div>p50 {p50[hover]}ms</div>
            </div>
          )}
        </div>
      </div>
      <div className="ml-12 mt-1 flex justify-between font-mono text-[10px] text-muted-foreground">
        {[0, 6, 12, 18, n - 1].map((i) => (
          <span key={i}>{hourLabel(i)}</span>
        ))}
      </div>
    </div>
  );
}

export default function PerformancePage() {
  const { projectId, appId } = useParams<{
    projectId: string;
    appId: string;
  }>();
  if (!projectId || !appId) return null;
  return (
    <AppLayout>
      <PerformanceInner projectId={projectId} appId={appId} />
    </AppLayout>
  );
}

function PerformanceInner({
  projectId,
  appId,
}: {
  projectId: string;
  appId: string;
}) {
  const { app, notFound: appNotFound, loading: appLoading } = useApp(
    projectId,
    appId,
  );
  const perf = app ? useMemo(() => getPerformance(app), [app]) : null;
  const [sel, setSel] = useState(0);
  const [tests, setTests] = useState<LoadTest[]>(
    perf?.loadTests ?? [],
  );
  const [form, setForm] = useState({
    scenario: "",
    target: perf?.transactions[0]?.name ?? "",
    vus: 100,
    duration: "5m",
    maxP95: 800,
  });
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const tx = perf?.transactions[sel];
  const transactions = perf?.transactions ?? [];
  if (appLoading) return <LoadingScreen />;
  if (appNotFound || !app || !tx) return <NotFoundPage />;

  const run = () => {
    const id = crypto.randomUUID();
    const base = transactions.find((t) => t.name === form.target);
    if (!base || !Number.isFinite(form.vus) || form.vus < 1 || !Number.isFinite(form.maxP95) || form.maxP95 < 1) return;
    setTests((t) => [
      {
        id,
        scenario: form.scenario.trim() || "Ad-hoc run",
        target: form.target,
        vus: form.vus,
        duration: form.duration,
        rps: 0,
        p95: 0,
        errorRate: 0,
        status: "running",
        ranAt: new Date().toISOString(),
      },
      ...t,
    ]);
    timers.current.push(
      window.setTimeout(() => {
        const p95 = Math.round(base.p95 * (0.8 + form.vus / 400));
        const errorRate = Math.round((form.vus / 300) * 100) / 100;
        setTests((t) =>
          t.map((x) =>
            x.id === id
              ? {
                  ...x,
                  rps: Math.round(form.vus * 4.2),
                  p95,
                  errorRate,
                  status: p95 > form.maxP95 || errorRate > 2 ? "failed" : "passed",
                }
              : x,
          ),
        );
      }, 2500),
    );
  };

  const vital = (v: number, good: number, poor: number) =>
    v <= good
      ? "text-success"
      : v <= poor
        ? "text-warning"
        : "text-destructive";

  return (
    <div className="space-y-6">
      {/* Web vitals strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label="LCP"
          value={
            <span className={vital(perf.vitals.lcp, 2.5, 4)}>
              {perf.vitals.lcp}s
            </span>
          }
          hint="Largest paint"
        />
        <Stat
          label="INP"
          value={
            <span className={vital(perf.vitals.inp, 200, 500)}>
              {perf.vitals.inp}ms
            </span>
          }
          hint="Interaction delay"
        />
        <Stat
          label="CLS"
          value={<span className={vital(perf.vitals.cls, 0.1, 0.25)}>{perf.vitals.cls}</span>}
          hint="Layout shift"
        />
      </div>

      {/* Latency stats */}
      <div className="grid grid-cols-3 gap-3">
        <Stat
          label="p50"
          value={
            <span className={vital(tx.p50, 200, 500)}>{tx.p50}ms</span>
          }
          hint="Median latency"
        />
        <Stat
          label="p95"
          value={
            <span className={vital(tx.p95, 500, 1000)}>{tx.p95}ms</span>
          }
          hint="95th percentile"
        />
        <Stat
          label="p99"
          value={
            <span className={vital(tx.p99, 1000, 2000)}>{tx.p99}ms</span>
          }
          hint="99th percentile"
        />
      </div>

      {/* Transactions table + chart */}
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="border-b text-left font-mono text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="p-3 font-normal">Transaction</th>
                <th className="font-normal">tpm</th>
                <th className="font-normal">p50</th>
                <th className="font-normal">p95</th>
                <th className="font-normal">fail</th>
                <th className="pr-3 font-normal">apdex</th>
              </tr>
            </thead>
            <tbody className="font-mono text-xs">
              {perf.transactions.map((t, i) => (
                <tr
                  key={t.name}
                  onClick={() => setSel(i)}
                  className={cn(
                    "cursor-pointer border-b last:border-0 hover:bg-muted/60",
                    sel === i && "bg-accent",
                  )}
                >
                  <td className="p-3">
                    <div className="font-sans text-sm font-medium">{t.name}</div>
                    <div className="text-muted-foreground">{t.op}</div>
                  </td>
                  <td>{t.throughput}</td>
                  <td>{t.p50}ms</td>
                  <td className={cn(t.p95 > 1000 && "text-destructive")}>
                    {t.p95}ms
                  </td>
                  <td className={cn(t.failureRate > 2 && "text-destructive")}>
                    {t.failureRate}%
                  </td>
                  <td className="pr-3">{t.apdex}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel p-4">
          <div className="font-mono text-[11px] uppercase text-muted-foreground">
            Response time · last 24h, hourly
          </div>
          <div className="mt-1 font-semibold">{tx.name}</div>
          <p className="text-xs text-muted-foreground">
            How long requests took. p50 = typical user, p95 = slowest 5%. Pick a
            row to compare.
          </p>
          <LineChart p95={tx.series} p50={tx.p50Series} />
          <div className="flex justify-between font-mono text-[11px] text-muted-foreground">
            <span>p50 {tx.p50}ms</span>
            <span>p95 {tx.p95}ms</span>
            <span>p99 {tx.p99}ms</span>
          </div>
        </div>
      </section>

      {/* Load tests */}
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="panel space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 font-semibold">
              <Gauge className="h-4 w-4 text-primary" />
              New load test
            </h3>
            <Pill>simulation</Pill>
          </div>
          <label className="block space-y-1 text-xs text-muted-foreground">
            Scenario name
            <input
              value={form.scenario}
              onChange={(e) => setForm({ ...form, scenario: e.target.value })}
              placeholder="Checkout spike"
              className={inputCls}
            />
          </label>
          <label className="block space-y-1 text-xs text-muted-foreground">
            Target
            <select
              value={form.target}
              onChange={(e) => setForm({ ...form, target: e.target.value })}
              className={inputCls}
            >
              {perf.transactions.map((t) => (
                <option key={t.name}>{t.name}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="space-y-1 text-xs text-muted-foreground">
              Virtual users
              <input
                type="number"
                min={1}
                value={form.vus}
                onChange={(e) =>
                  setForm({
                    ...form,
                    vus: Math.max(1, Number(e.target.value)),
                  })
                }
                className={inputCls}
              />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Duration
              <select
                value={form.duration}
                onChange={(e) =>
                  setForm({ ...form, duration: e.target.value })
                }
                className={inputCls}
              >
                {["1m", "5m", "15m", "30m"].map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Fail if p95 &gt; (ms)
              <input
                type="number"
                min={1}
                value={form.maxP95}
                onChange={(e) =>
                  setForm({ ...form, maxP95: Number(e.target.value) })
                }
                className={inputCls}
              />
            </label>
          </div>
          <Btn variant="primary" onClick={run} className="w-full justify-center">
            <Play className="h-4 w-4" />
            Run test
          </Btn>
        </div>

        <div className="panel divide-y">
          {tests.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between gap-3 p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{t.scenario}</span>
                  <Pill
                    tone={
                      t.status === "passed"
                        ? "primary"
                        : t.status === "failed"
                          ? "destructive"
                          : "warning"
                    }
                  >
                    {t.status === "running" ? "running…" : t.status}
                  </Pill>
                </div>
                <div className="truncate font-mono text-[11px] text-muted-foreground">
                  {t.target} · {t.vus} VUs · {t.duration} ·{" "}
                  {t.status === "running"
                    ? "now"
                    : new Date(t.ranAt).toLocaleDateString()}
                </div>
              </div>
              {t.status !== "running" && (
                <div className="shrink-0 text-right font-mono text-[11px]">
                  <div>{t.rps} rps</div>
                  <div className="text-muted-foreground">
                    p95 {t.p95}ms · err {t.errorRate}%
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
