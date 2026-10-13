import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MobileNavBar } from '../components/MobileNavBar';
import { cn } from '../lib/utils';
import { checkHealth, getProject, ingestEnvelope, listProjects, type AppDto, type ProjectDto } from '../lib/api';

interface ConsoleLine {
  time: string;
  tag: string;
  tagClass: string;
  message: string;
}

export function Setup() {
  const [activeSdk, setActiveSdk] = useState<'node' | 'python' | 'go' | 'reactNative' | 'nextjs'>('node');
  const [copied, setCopied] = useState(false);
  const [app, setApp] = useState<AppDto | null>(null);
  const [apps, setApps] = useState<AppDto[]>([]);
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [health, setHealth] = useState<{ status: string; eventsStored: number } | null>(null);
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    try {
      const projectsRes = await listProjects();
      const projectList: ProjectDto[] = (projectsRes?.data as any)?.data ?? [];
      setProjects(projectList);
      const allApps: AppDto[] = [];
      for (const p of projectList) {
        const detail = await getProject(p.id);
        const detailApps: AppDto[] = (detail?.data as any)?.apps ?? [];
        allApps.push(...detailApps);
      }
      setApps(allApps);
      setApp((current) => allApps.find((a) => a.id === current?.id) ?? allApps[0] ?? null);
    } catch {
      // keep current state on failure
    }
    try {
      const h = await checkHealth();
      if (h?.data) setHealth(h.data);
    } catch {
      setHealth(null);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const dsn = app?.dsn ?? null;

  const snippets = {
    node: `import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: "${dsn ?? '<create an app to get a DSN>'}",
  tracesSampleRate: 1.0,
});`,
    python: `import sentry_sdk

sentry_sdk.init(
    dsn="${dsn ?? '<create an app to get a DSN>'}",
    traces_sample_rate=1.0,
)`,
    go: `package main

import "github.com/getsentry/sentry-go"

func main() {
    sentry.Init(sentry.ClientOptions{
        Dsn: "${dsn ?? '<create an app to get a DSN>'}",
    })
}`,
    reactNative: `import * as Sentry from "@sentry/react-native";

Sentry.init({
  dsn: "${dsn ?? '<create an app to get a DSN>'}",
});`,
    nextjs: `// sentry.client.config.ts
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "${dsn ?? '<create an app to get a DSN>'}",
  tracesSampleRate: 0.8,
});`,
  };

  const copyToClipboard = () => {
    if (!dsn) return;
    navigator.clipboard.writeText(dsn);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const pushLine = (tag: string, tagClass: string, message: string) => {
    setConsoleLines((prev) => [...prev, {
      time: new Date().toLocaleTimeString(),
      tag,
      tagClass,
      message,
    }]);
  };

  // Send a real synthetic event through the selected app's DSN
  const sendSyntheticTest = async () => {
    if (!app || testing) return;
    setTesting(true);
    const eventId = crypto.randomUUID();
    const envelope = [
      JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }),
      JSON.stringify({ type: 'event', length: 0 }),
      JSON.stringify({
        event_id: eventId,
        level: 'info',
        message: 'Synthetic test event from Setup page',
        tags: { 'synthetic-test': 'true' },
        timestamp: Math.floor(Date.now() / 1000),
      }),
    ].join('\n');

    pushLine('SEND', 'text-primary', `POST /api/${app.ingestKey}/envelope/ (event ${eventId.slice(0, 8)}…)`);
    try {
      const result = await ingestEnvelope(app.ingestKey, envelope, {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_key=${app.publicKey}, sentry_version=7`,
      });
      if (result?.id) {
        pushLine('ACCEPTED', 'text-secondary', `Stored with event_id ${result.id}`);
      } else {
        pushLine('REJECTED', 'text-error', JSON.stringify(result));
      }
    } catch (e) {
      pushLine('ERROR', 'text-error', e instanceof Error ? e.message : 'Request failed');
    } finally {
      setTesting(false);
    }
  };

  const online = health?.status === 'ok';

  return (
    <div className="flex flex-col h-screen bg-surface pt-safe">
      <div className="px-4 pt-3 pb-2 overflow-y-auto flex-1">
        {/* App / DSN Selection */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-headline-sm text-on-surface font-bold tracking-tight">Your ingestion DSN</h2>
            <Link to="/admin" className="text-code-sm text-primary">Manage projects →</Link>
          </div>
          {dsn && app ? (
            <>
              {apps.length > 1 && (
                <select
                  value={app.id}
                  onChange={(e) => setApp(apps.find((a) => a.id === e.target.value) ?? null)}
                  className="w-full h-10 px-3 mb-2 rounded-lg bg-surface-container text-on-surface text-code-md focus:outline-none"
                >
                  {apps.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({projects.find((p) => p.id === a.projectId)?.slug ?? a.projectId.slice(0, 8)})
                    </option>
                  ))}
                </select>
              )}
              <div className="relative flex items-center">
                <span className="mds absolute left-2 text-outline text-[18px]">dns</span>
                <input
                  readOnly
                  value={dsn}
                  className="w-full h-11 pl-9 pr-24 rounded-lg bg-surface-container text-on-surface text-code-md focus:outline-none select-all transition-all"
                />
                <button
                  onClick={copyToClipboard}
                  className="absolute right-1.5 h-8 px-3 rounded bg-primary hover:opacity-90 text-on-primary text-code-sm font-semibold flex items-center gap-1 transition-all"
                >
                  <span className="text-[15px] mds">{copied ? 'check' : 'content_copy'}</span>
                  <span>{copied ? 'Copied!' : 'Copy'}</span>
                </button>
              </div>
              <p className="text-code-sm text-outline mt-1.5">
                app: <span className="text-on-surface-variant">{app.name}</span> · ingest key: <span className="text-on-surface-variant font-mono">{app.ingestKey}</span>
              </p>
            </>
          ) : (
            <div className="border border-dashed border-outline-variant rounded-xl p-6 flex flex-col items-center gap-2 text-center">
              <span className="material-symbols-outlined text-[28px] text-outline">key_off</span>
              <p className="text-body-md text-on-surface-variant max-w-sm">
                No apps registered yet. Create a project and an app in the Admin panel to get a real DSN.
              </p>
              <Link to="/admin" className="h-9 px-4 rounded-lg bg-primary-container text-on-primary-container text-code-md font-semibold flex items-center">
                Open Admin Panel
              </Link>
            </div>
          )}
        </div>

        {/* SDK Code Configurator */}
        {dsn && (
          <div className="rounded-xl shadow-sm mb-4 overflow-hidden">
            <div className="p-3 bg-surface-container-high flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="mds text-[18px] text-primary">terminal</span>
                <h3 className="text-headline-sm text-on-surface font-semibold">SDK Setup</h3>
              </div>
              <div className="flex items-center gap-1 bg-surface-container-lowest p-1 rounded-lg overflow-x-auto">
                {([
                  ['node', 'Node.js / TS'],
                  ['python', 'Python'],
                  ['go', 'Go'],
                  ['reactNative', 'React Native'],
                  ['nextjs', 'Next.js'],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setActiveSdk(key)}
                    className={cn(
                      'px-3 py-1.5 rounded-md text-code-md transition-all',
                      activeSdk === key
                        ? 'text-primary bg-surface-container-high font-semibold'
                        : 'text-on-surface-variant hover:text-on-surface'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="relative bg-surface-container-lowest p-4 font-code-md text-code-md overflow-x-auto">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(snippets[activeSdk]);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="absolute top-2 right-2 h-8 px-3 rounded bg-surface-container-high hover:bg-surface-bright text-on-surface text-code-sm font-semibold flex items-center gap-1.5 shadow-sm transition-all"
              >
                <span className="text-[15px] mds">content_copy</span>
                <span>Copy Snippet</span>
              </button>
              <pre className="text-on-surface selection:bg-primary-container selection:text-on-primary-container">
                <code>{snippets[activeSdk]}</code>
              </pre>
            </div>
          </div>
        )}

        {/* Server Health — real /health data */}
        <div className="bg-surface-container-low rounded-xl p-4 shadow-sm mb-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="mds text-[20px] text-secondary">monitor_heart</span>
              <span className="text-headline-sm text-on-surface font-semibold">Server Status</span>
            </div>
            <span className={cn('text-code-sm bg-surface-container px-2 py-0.5 rounded-full', online ? 'text-secondary' : 'text-error')}>
              {health ? health.status : 'unreachable'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-surface-container p-2 rounded-lg">
              <div className="text-code-sm uppercase tracking-wider text-outline">Events Stored</div>
              <div className="text-headline-sm text-on-surface font-bold mt-0.5">{health?.eventsStored ?? '—'}</div>
            </div>
            <div className="bg-surface-container p-2 rounded-lg">
              <div className="text-code-sm uppercase tracking-wider text-outline">Registered Apps</div>
              <div className="text-headline-sm text-primary font-bold mt-0.5">{apps.length}</div>
            </div>
          </div>
        </div>

        {/* Pipeline Health Verification — sends a real synthetic event */}
        <div className="bg-surface-container-low rounded-xl p-4 shadow-sm mb-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="mds text-[20px] text-primary">science</span>
                <h3 className="text-headline-sm text-on-surface font-semibold">Pipeline Health Verification</h3>
              </div>
              <p className="text-body-sm text-on-surface-variant">
                {dsn
                  ? 'Sends a real synthetic event through your app DSN and shows the actual server response.'
                  : 'Register an app to enable synthetic ingestion tests.'}
              </p>
            </div>
            <button
              onClick={sendSyntheticTest}
              disabled={!dsn || testing}
              className="h-10 px-4 rounded-lg bg-primary hover:opacity-90 text-on-primary text-code-md font-semibold flex items-center gap-2 shadow-sm transition-all disabled:opacity-40"
            >
              <span className="mds text-[18px]">send</span>
              <span>{testing ? 'Sending…' : 'Send Synthetic Test Event'}</span>
            </button>
          </div>
          <div className="bg-surface-container-lowest rounded-lg overflow-hidden shadow-inner">
            <div className="h-9 px-4 bg-surface-container-high flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-error/80" />
                  <span className="w-2.5 h-2.5 rounded-full bg-primary/80" />
                  <span className="w-2.5 h-2.5 rounded-full bg-secondary/80" />
                </div>
                <span className="text-code-sm text-outline ml-2">ingest-stream // stdout</span>
              </div>
              <button onClick={() => setConsoleLines([])} className="text-code-sm text-on-surface-variant hover:text-on-surface">Clear</button>
            </div>
            <div className="p-4 space-y-2 font-code-sm text-code-sm overflow-y-auto max-h-44">
              {consoleLines.length === 0 ? (
                <div className="text-outline">READY — no test events sent yet.</div>
              ) : (
                consoleLines.map((line, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-outline select-none">{line.time}</span>
                    <span className={line.tagClass}>[{line.tag}]</span>
                    <span className="text-on-surface break-all">{line.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
          {dsn && (
            <div className="mt-4 flex flex-wrap items-center justify-between text-on-surface-variant text-code-sm">
              <span className="flex items-center gap-1.5">
                <span className="mds text-[16px] text-secondary">security</span>
                Synthetic events are tagged <code className="text-primary px-1 bg-surface-container rounded">synthetic-test</code> and appear on the Issues page.
              </span>
            </div>
          )}
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
