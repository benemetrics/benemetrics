import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../lib/utils';
import { checkHealth, getProject, ingestEnvelope, listProjects, type AppDto, type ProjectDto } from '../lib/api';

interface ConsoleLine {
  time: string;
  tag: string;
  tagClass: string;
  message: string;
}

const SDKS = [
  ['node', 'Node.js / TS'],
  ['python', 'Python'],
  ['go', 'Go'],
  ['reactNative', 'React Native'],
  ['nextjs', 'Next.js'],
] as const;

type SdkKey = (typeof SDKS)[number][0];

/**
 * Inline getting-started guide shown on the Issues page until the first
 * event lands. Replaces the standalone /setup screen: same content, but it
 * lives inside the app and disappears automatically once data flows.
 */
export function GettingStarted() {
  const [apps, setApps] = useState<AppDto[]>([]);
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [app, setApp] = useState<AppDto | null>(null);
  const [activeSdk, setActiveSdk] = useState<SdkKey>('node');
  const [copied, setCopied] = useState<string | null>(null);
  const [health, setHealth] = useState<{ status: string; eventsStored: number } | null>(null);
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const projectsRes = await listProjects();
        const projectList: ProjectDto[] = (projectsRes?.data as any)?.data ?? [];
        const allApps: AppDto[] = [];
        for (const p of projectList) {
          const detail = await getProject(p.id);
          const detailApps: AppDto[] = (detail?.data as any)?.apps ?? [];
          allApps.push(...detailApps);
        }
        if (!cancelled) {
          setProjects(projectList);
          setApps(allApps);
          setApp((current) => allApps.find((a) => a.id === current?.id) ?? allApps[0] ?? null);
        }
      } catch {
        // keep current state on failure
      }
      try {
        const h = await checkHealth();
        if (!cancelled && h?.data) setHealth(h.data);
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const dsn = app?.dsn ?? null;
  const missing = '<create an app to get a DSN>';

  const snippets: Record<SdkKey, string> = {
    node: `import * as Sentry from "@sentry/node";\n\nSentry.init({\n  dsn: "${dsn ?? missing}",\n  tracesSampleRate: 1.0,\n});`,
    python: `import sentry_sdk\n\nsentry_sdk.init(\n    dsn="${dsn ?? missing}",\n    traces_sample_rate=1.0,\n)`,
    go: `package main\n\nimport "github.com/getsentry/sentry-go"\n\nfunc main() {\n    sentry.Init(sentry.ClientOptions{\n        Dsn: "${dsn ?? missing}",\n    })\n}`,
    reactNative: `import * as Sentry from "@sentry/react-native";\n\nSentry.init({\n  dsn: "${dsn ?? missing}",\n});`,
    nextjs: `// sentry.client.config.ts\nimport * as Sentry from "@sentry/nextjs";\n\nSentry.init({\n  dsn: "${dsn ?? missing}",\n  tracesSampleRate: 0.8,\n});`,
  };

  const copy = (key: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const pushLine = (tag: string, tagClass: string, message: string) => {
    setLines((prev) => [...prev, { time: new Date().toLocaleTimeString(), tag, tagClass, message }]);
  };

  // Send a real synthetic event through the selected app's DSN
  const sendTestEvent = async () => {
    if (!app || testing) return;
    setTesting(true);
    const eventId = crypto.randomUUID();
    const envelope = [
      JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }),
      JSON.stringify({ type: 'event', length: 0 }),
      JSON.stringify({
        event_id: eventId,
        level: 'info',
        message: 'Getting started test event',
        tags: { 'synthetic-test': 'true' },
        timestamp: Math.floor(Date.now() / 1000),
      }),
    ].join('\n');

    pushLine('SEND', 'text-primary', `POST /api/${app.ingestKey}/envelope/`);
    try {
      const result = await ingestEnvelope(app.ingestKey, envelope, {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_key=${app.publicKey}, sentry_version=7`,
      });
      if (result?.id) {
        pushLine('ACCEPTED', 'text-secondary', `Stored as ${String(result.id).slice(0, 8)}… — it will appear in the list above within 2s`);
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
  const stepBadge = 'w-6 h-6 rounded-full bg-surface-container-high text-primary font-label-code-sm text-label-code-sm font-bold flex items-center justify-center shrink-0 mt-0.5';

  return (
    <div className="bg-surface-container-low rounded-xl overflow-hidden shadow-sm">
      {/* Header */}
      <div className="px-space-md py-space-md bg-surface-container-high flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm">
        <div className="flex items-center gap-space-sm">
          <div className="w-9 h-9 rounded-lg bg-primary-container text-on-primary-container flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[18px]">rocket_launch</span>
          </div>
          <div>
            <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold">Getting started</h3>
            <p className="font-body-sm text-body-sm text-on-surface-variant">Send your first event and watch it land here in real time.</p>
          </div>
        </div>
        <span className={cn('self-start sm:self-center font-label-code-sm text-label-code-sm px-space-sm py-0.5 rounded bg-surface-container flex items-center gap-1.5 shrink-0', online ? 'text-secondary' : 'text-error')}>
          <span className={cn('w-1.5 h-1.5 rounded-full', online ? 'bg-secondary' : 'bg-error')} />
          ingest {online ? 'online' : 'offline'}
        </span>
      </div>

      <div className="p-space-md flex flex-col gap-space-md">
        {/* Step 1 — create an app */}
        <div className="flex items-start gap-space-md">
          <span className={stepBadge}>1</span>
          <div className="flex-1 min-w-0">
            <div className="font-body-md text-body-md text-on-surface font-semibold">Create a project &amp; app</div>
            {app ? (
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Using <span className="text-on-surface font-medium">{app.name}</span>
                {(() => {
                  const p = projects.find((x) => x.id === app.projectId);
                  return p ? <> in <span className="text-on-surface font-medium">{p.name}</span></> : null;
                })()}
                <span className="text-secondary font-semibold"> ✓</span>
              </p>
            ) : (
              <div className="mt-1.5 flex flex-col sm:flex-row sm:items-center gap-space-sm">
                <p className="font-body-sm text-body-sm text-on-surface-variant">No apps registered yet — every app gets its own ingestion DSN.</p>
                <Link
                  to="/admin"
                  className="shrink-0 h-8 px-space-md rounded-lg bg-primary-container text-on-primary-container font-label-code-md text-label-code-md font-semibold flex items-center gap-1.5 w-fit"
                >
                  <span className="material-symbols-outlined text-[16px]">add</span>
                  <span>Create in Admin</span>
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Step 2 — DSN */}
        {app && (
          <div className="flex items-start gap-space-md">
            <span className={stepBadge}>2</span>
            <div className="flex-1 min-w-0 w-full">
              <div className="font-body-md text-body-md text-on-surface font-semibold">Point your SDK at this DSN</div>
              {apps.length > 1 && (
                <select
                  value={app.id}
                  onChange={(e) => setApp(apps.find((a) => a.id === e.target.value) ?? null)}
                  className="mt-1.5 h-9 px-2 rounded-lg bg-surface-container text-on-surface text-code-sm focus:outline-none max-w-full"
                >
                  {apps.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}{(() => { const p = projects.find((x) => x.id === a.projectId); return p ? ` (${p.slug})` : ''; })()}
                    </option>
                  ))}
                </select>
              )}
              <div className="relative flex items-center mt-1.5">
                <span className="material-symbols-outlined absolute left-2 text-outline text-[16px]">dns</span>
                <input
                  readOnly
                  value={dsn ?? ''}
                  className="w-full h-10 pl-8 pr-20 rounded-lg bg-surface-container text-on-surface text-label-code-md font-mono focus:outline-none select-all"
                />
                <button
                  onClick={() => copy('dsn', dsn ?? '')}
                  className="absolute right-1 h-7 px-2.5 rounded bg-surface-container-high hover:bg-surface-bright text-on-surface text-label-code-sm font-semibold flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[14px]">{copied === 'dsn' ? 'check' : 'content_copy'}</span>
                  <span>{copied === 'dsn' ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3 — SDK snippet */}
        {app && (
          <div className="flex items-start gap-space-md">
            <span className={stepBadge}>3</span>
            <div className="flex-1 min-w-0">
              <div className="font-body-md text-body-md text-on-surface font-semibold">Or paste this into your bootstrap</div>
              <div className="mt-1.5 flex items-center gap-1 bg-surface-container-lowest p-1 rounded-lg overflow-x-auto w-fit max-w-full">
                {SDKS.map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setActiveSdk(key)}
                    className={cn(
                      'px-2.5 py-1 rounded-md text-code-sm transition-all shrink-0',
                      activeSdk === key
                        ? 'text-primary bg-surface-container-high font-semibold'
                        : 'text-on-surface-variant hover:text-on-surface'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="relative mt-1.5 bg-surface-container-lowest rounded-lg overflow-hidden">
                <button
                  onClick={() => copy('snippet', snippets[activeSdk])}
                  className="absolute top-2 right-2 h-7 px-2.5 rounded bg-surface-container-high hover:bg-surface-bright text-on-surface text-label-code-sm font-semibold flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[14px]">{copied === 'snippet' ? 'check' : 'content_copy'}</span>
                  <span>{copied === 'snippet' ? 'Copied' : 'Copy'}</span>
                </button>
                <pre className="p-3 pr-24 overflow-x-auto text-code-sm text-on-surface"><code>{snippets[activeSdk]}</code></pre>
              </div>
            </div>
          </div>
        )}

        {/* Step 4 (or 2 without an app) — synthetic test event */}
        <div className="flex items-start gap-space-md">
          <span className={stepBadge}>{app ? '4' : '2'}</span>
          <div className="flex-1 min-w-0">
            <div className="font-body-md text-body-md text-on-surface font-semibold">Send a test event</div>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              {app
                ? 'Fire a real synthetic event through the DSN and watch the actual server response. This page polls every 2s — your event appears in the list the moment it lands.'
                : 'Register an app first — then fire a real synthetic event through its DSN and watch the actual server response.'}
            </p>
            <button
              onClick={sendTestEvent}
              disabled={!app || testing}
              className="mt-2 h-9 px-space-md rounded-lg bg-primary hover:opacity-90 text-on-primary font-label-code-md text-label-code-md font-semibold flex items-center gap-2 disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-[16px]">send</span>
              <span>{testing ? 'Sending…' : 'Send Test Event'}</span>
            </button>
            {lines.length > 0 && (
              <div className="mt-2 bg-surface-container-lowest rounded-lg overflow-hidden">
                <div className="h-8 px-3 bg-surface-container-high flex items-center justify-between">
                  <span className="text-code-sm text-outline">ingest-stream // stdout</span>
                  <button onClick={() => setLines([])} className="text-code-sm text-on-surface-variant hover:text-on-surface">Clear</button>
                </div>
                <div className="p-3 space-y-1.5 font-code-sm text-code-sm max-h-40 overflow-y-auto">
                  {lines.map((l, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="text-outline select-none">{l.time}</span>
                      <span className={l.tagClass}>[{l.tag}]</span>
                      <span className="text-on-surface break-all">{l.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
