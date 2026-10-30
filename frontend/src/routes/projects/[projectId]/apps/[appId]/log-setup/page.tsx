import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Copy } from "lucide-react";
import { useApp } from "../../../../../../hooks/use-app";
import type { Level } from "../../../../../../lib/data";
import {
  defaultRegex,
  fieldDefaults,
  runPipeline,
  sampleLogs,
  type ParserKind,
  type PipelineConfig,
} from "../../../../../../lib/log-pipeline";
import { copyToClipboard } from "../../../../../../lib/clipboard";
import { Btn, LevelBadge, Crumbs } from "../../../../../../components/ui-kit";
import { cn } from "../../../../../../lib/utils";
import { LoadingScreen } from "../../../../../../components/loading-screen";
import { NotFoundPage } from "../../../../../../components/not-found";

const input = "w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs";

// Copy button with a transient confirmation that flips only after the
// clipboard write actually succeeded.
function CopyBtn({ value, label, className }: { value: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Btn
      aria-label={`Copy ${label}`}
      className={className}
      onClick={async () => {
        if (await copyToClipboard(value)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }
      }}
    >
      <Copy className="h-4 w-4" />
      {copied ? "Copied" : `Copy ${label}`}
    </Btn>
  );
}

export default function LogSetupPage() {
  const { projectId, appId } = useParams<{ projectId: string; appId: string }>();
  if (!projectId || !appId) return null;
  return <LogSetupInner projectId={projectId} appId={appId} />;
}

function LogSetupInner({ projectId, appId }: { projectId: string; appId: string }) {
  const { app, loading, notFound } = useApp(projectId, appId);
  const [cfg, setCfg] = useState<PipelineConfig>({
    parser: "json",
    regex: defaultRegex,
    ...fieldDefaults.json,
    minLevel: "warning",
    fingerprint: ["service", "msg"],
    dropPattern: "/health",
  });
  const [logs, setLogs] = useState(sampleLogs.json);
  const result = useMemo(() => runPipeline(logs, cfg), [logs, cfg]);
  const set = (p: Partial<PipelineConfig>) => setCfg((c) => ({ ...c, ...p }));
  const fields = [...new Set(result.events.flatMap((e) => Object.keys(e.fields)))];

  if (loading) return <LoadingScreen />;
  if (notFound || !app) return <NotFoundPage />;

  // The DSN is composed from the app's ingredients (never stored); log lines
  // ship to the store endpoint as JSON events, authenticated with the DSN's
  // public key — the same credential an SDK uses.
  const storeEndpoint = `${window.location.origin}/api/${app.number}/store/`;
  const agent = `# Ship parsed log lines from any agent (one HTTP call per line):
curl ${storeEndpoint} \\
  -H 'X-Sentry-Auth: Sentry sentry_key=${app.publicKey}' \\
  -H 'Content-Type: application/json' \\
  -d '{"message":"<message>","level":"<level>","fingerprint":["<pipeline fingerprint>"]}'`;

  const pickParser = (parser: ParserKind) => {
    set({ parser, ...fieldDefaults[parser] });
    setLogs(sampleLogs[parser]);
  };

  return (
    <div className="grid gap-4">
      <Crumbs
        items={[
          { label: "projects", to: "/" },
          { label: app.id, to: `/projects/${projectId}` },
          { label: app.name },
        ]}
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="min-w-0 space-y-4">
          <div className="rounded-lg border p-4">
            <h2 className="font-semibold">1 · Send your logs</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              No SDK? POST each parsed error line to this app's store endpoint
              as a JSON event — the fingerprint from the pipeline below keeps
              the same messages grouped into one issue.
            </p>
            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <code className="min-w-0 truncate rounded-md bg-code px-2 py-1.5 font-mono text-xs">
                {storeEndpoint}
              </code>
              <CopyBtn value={storeEndpoint} label="endpoint" />
            </div>
            <pre className="mt-2 overflow-x-auto rounded-md bg-code p-3 font-mono text-[11px]">
              {agent}
            </pre>
            <CopyBtn className="mt-2 px-2 py-1 text-xs" value={agent} label="snippet" />
          </div>

          <div className="space-y-3 rounded-lg border p-4">
            <h2 className="font-semibold">2 · Parse</h2>
            <div role="group" aria-label="Log format" className="flex flex-wrap gap-1">
              {(["json", "logfmt", "regex"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => pickParser(p)}
                  className={cn(
                    "rounded-sm border px-2 py-1 font-mono text-xs",
                    cfg.parser === p ? "border-primary text-primary" : "text-muted-foreground",
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
            {cfg.parser === "regex" && (
              <label className="block text-xs">
                Pattern (named groups become fields)
                <input className={input} value={cfg.regex} onChange={(e) => set({ regex: e.target.value })} />
              </label>
            )}
            <label className="block text-xs">
              Sample log lines
              <textarea className={cn(input, "h-36")} value={logs} onChange={(e) => setLogs(e.target.value)} />
            </label>
          </div>

          <div className="space-y-3 rounded-lg border p-4">
            <h2 className="font-semibold">3 · Map & group</h2>
            <div className="grid gap-2 sm:grid-cols-3">
              {(
                [
                  ["levelField", "Level field"],
                  ["messageField", "Message field"],
                  ["timeField", "Time field"],
                ] as const
              ).map(([k, l]) => (
                <label key={k} className="text-xs">
                  {l}
                  <input
                    className={input}
                    list="pipeline-fields"
                    value={cfg[k]}
                    onChange={(e) => set({ [k]: e.target.value })}
                  />
                </label>
              ))}
              <datalist id="pipeline-fields">
                {fields.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </div>
            <label className="block text-xs">
              Keep from level
              <select
                className={input}
                value={cfg.minLevel}
                onChange={(e) => set({ minLevel: e.target.value as Level })}
              >
                {(["info", "warning", "error", "fatal"] as const).map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs">
              Drop lines matching
              <input
                className={input}
                value={cfg.dropPattern}
                onChange={(e) => set({ dropPattern: e.target.value })}
                placeholder="e.g. /health"
              />
            </label>
            <div className="text-xs">
              Group into one issue by
              <div className="mt-1 flex flex-wrap gap-1">
                {fields.map((f) => {
                  const on = cfg.fingerprint.includes(f);
                  return (
                    <button
                      key={f}
                      onClick={() =>
                        set({
                          fingerprint: on
                            ? cfg.fingerprint.filter((x) => x !== f)
                            : [...cfg.fingerprint, f],
                        })
                      }
                      className={cn(
                        "rounded-sm border px-2 py-0.5 font-mono",
                        on ? "border-primary text-primary" : "text-muted-foreground",
                      )}
                    >
                      {f}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-muted-foreground">
                Numbers and ids in the message are ignored, so "payment 4821 failed" and "payment 4907
                failed" become one issue.
              </p>
            </div>
          </div>
        </section>

        <section className="min-w-0 space-y-4">
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              ["events", result.events.length],
              ["issues", result.issues.length],
              ["dropped / failed", `${result.dropped} / ${result.failed}`],
            ].map(([l, v]) => (
              <div key={l as string} className="rounded-lg border p-3">
                <div className="text-xl font-bold">{v}</div>
                <div className="text-xs text-muted-foreground">{l}</div>
              </div>
            ))}
          </div>
          <div className="rounded-lg border">
            <h2 className="border-b px-4 py-2 font-semibold">Resulting issues</h2>
            {result.issues.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">
                No issues yet — check the format and field names.
              </p>
            )}
            {result.issues.map((i) => (
              <div key={i.fingerprint} className="flex items-center gap-3 border-b px-4 py-2 last:border-0">
                <LevelBadge level={i.level} />
                <span className="min-w-0 flex-1 truncate text-sm">{i.title}</span>
                <span className="font-mono text-xs text-muted-foreground">{i.count}×</span>
              </div>
            ))}
          </div>
          <div className="rounded-lg border">
            <h2 className="border-b px-4 py-2 font-semibold">Parsed events</h2>
            <div className="max-h-80 overflow-auto bg-code font-mono text-[11px]">
              {result.events.map((e, n) => (
                <div key={n} className="border-b px-3 py-2 last:border-0">
                  <div className="flex items-center gap-2">
                    <LevelBadge level={e.level} />
                    <span className="truncate">{e.message}</span>
                  </div>
                  <div className="mt-1 break-all text-muted-foreground">
                    {Object.entries(e.fields)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(" ")}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            The pipeline is a preview: the grouping shown here is what you get when the fingerprint is
            sent with each event.
          </p>
        </section>
      </div>
    </div>
  );
}
