import { useState } from 'react';
import { MobileNavBar } from '../components/MobileNavBar';

const sdkSnippets = {
  node: `import * as Sentry from "@sentry/node";

// Use the official Sentry SDK as normal!
Sentry.init({
  dsn: "https://o450@benemetrics.app/ingest/42",
  environment: "production",
  tracesSampleRate: 1.0,
});`,
  python: `import sentry_sdk

# Use the official sentry-python package!
sentry_sdk.init(
    dsn="https://o450@benemetrics.app/ingest/42",
    traces_sample_rate=1.0,
    environment="production",
)`,
  go: `package main

import "github.com/getsentry/sentry-go"

func main() {
    sentry.Init(sentry.ClientOptions{
        Dsn: "https://o450@benemetrics.app/ingest/42",
        Environment: "production",
    })
}`,
  reactNative: `import * as Sentry from "@sentry/react-native";

Sentry.init({
  dsn: "https://o450@benemetrics.app/ingest/42",
  attachScreenshot: true,
});`,
  nextjs: `import * as Sentry from "@sentry/nextjs";

// sentry.client.config.ts
Sentry.init({
  dsn: "https://o450@benemetrics.app/ingest/42",
  tracesSampleRate: 0.8,
});`,
};

function cn(...classes: (string | undefined | false)[]) {
  return classes.filter(Boolean).join(' ');
}

export function Setup() {
  const [activeSdk, setActiveSdk] = useState<'node' | 'python' | 'go' | 'reactNative' | 'nextjs'>('node');
  const [copied, setCopied] = useState(false);
  const [revealToken, setRevealToken] = useState(false);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(sdkSnippets[activeSdk]);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-screen bg-surface pt-safe">
      <div className="px-4 pt-3 pb-2">
        {/* Compatibility Headline Banner */}
        <div className="mb-6 px-4">
          <div className="flex items-start gap-3.5 max-w-3xl">
            <div className="w-10 h-10 rounded-xl bg-primary-container text-on-primary-container flex items-center justify-center shrink-0 shadow-md">
              <span className="mds text-[22px]">swap_calls</span>
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-code-sm text-primary font-bold px-1.5 py-0.5 rounded bg-surface-container-highest">Wire Compatible</span>
                <span className="text-code-sm text-on-surface-variant flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-secondary" /> Sentry Envelope v7 / HTTP Store
                </span>
              </div>
              <h2 className="text-headline-sm text-on-surface font-bold tracking-tight">
                100% Sentry SDK Compatible. Keep @sentry/node, @sentry/react, or sentry-python.
              </h2>
              <p className="text-body-md text-on-surface-variant mt-0.5">
                Zero migration overhead. No custom client libraries to vendor - simply redirect your project DSN endpoint to Benemetrics high-throughput ingest edge.
              </p>
            </div>
          </div>
        </div>

        {/* Ingestion DSN & Credential Config Bento */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-6">
          <div className="lg:col-span-8 bg-surface-container-low rounded-xl p-4 shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="mds text-[20px] text-primary">key</span>
                  <span className="text-headline-sm text-on-surface font-semibold">Production Ingest Credentials</span>
                </div>
                <span className="text-code-sm text-secondary bg-surface-container px-2 py-0.5 rounded-full flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-secondary" />
                  TLS v1.3 Armed
                </span>
              </div>
              <p className="text-body-md text-on-surface-variant mb-4">
                Paste the target DSN directly into your existing <code className="text-code-sm text-primary bg-surface-container px-1 rounded">SENTRY_DSN</code> environment variables or application bootstrap configs.
              </p>
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-code-sm uppercase tracking-wider text-outline font-semibold">Client Ingestion DSN (Envelope / Store API)</label>
                    <span className="text-code-sm text-primary">Target Cluster: us-east-prod</span>
                  </div>
                  <div className="relative flex items-center">
                    <span className="mds absolute left-2 text-outline text-[18px]" />dns
                    <input
                      readOnly
                      value="https://o450@benemetrics.app/ingest/42"
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
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-code-sm uppercase tracking-wider text-outline font-semibold">Security Ingest Secret Token</label>
                    <span className="text-code-sm text-outline">Bearer Auth Header (Optional Proxy)</span>
                  </div>
                  <div className="relative flex items-center">
                    <span className="mds absolute left-2 text-outline text-[18px]" />lock
                    <input
                      type={revealToken ? 'text' : 'password'}
                      value="bm_live_9f8a3c••••••••••"
                      className="w-full h-11 pl-9 pr-36 rounded-lg bg-surface-container text-on-surface text-code-md focus:outline-none select-all transition-all"
                      readOnly
                    />
                    <div className="absolute right-1.5 flex items-center gap-1">
                      <button
                        onClick={() => setRevealToken(!revealToken)}
                        className="h-8 px-2.5 rounded bg-surface-container-high hover:bg-surface-bright text-on-surface text-code-sm flex items-center gap-1 transition-all"
                      >
                        <span className="text-[15px] mds">{revealToken ? 'visibility_off' : 'visibility'}</span>
                        <span id="token-toggle-label">{revealToken ? 'Hide' : 'Reveal'}</span>
                      </button>
                      <button
                        onClick={copyToClipboard}
                        className="h-8 px-3 rounded bg-surface-container-high hover:bg-surface-bright text-on-surface text-code-sm font-semibold flex items-center gap-1 transition-all"
                      >
                        <span className="text-[15px] mds">content_copy</span>
                        Copy
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Gateway Telemetry & Health Gauges */}
          <div className="lg:col-span-4 bg-surface-container-low rounded-xl p-4 shadow-sm flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="mds text-[20px] text-secondary">monitor_heart</span>
                <span className="text-headline-sm text-on-surface font-semibold">Edge Ingestion Status</span>
              </div>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-secondary" />
              </span>
            </div>
            <div className="space-y-3 mb-4">
              <div className="bg-surface-container p-2 rounded-lg flex items-center justify-between">
                <div>
                  <div className="text-code-sm uppercase tracking-wider text-outline">Throughput Status</div>
                  <div className="text-headline-sm text-secondary font-bold mt-0.5">Active, 182 req/s</div>
                </div>
                <div className="w-9 h-9 rounded bg-surface-container-high flex items-center justify-center text-secondary">
                  <span className="mds text-[20px]">speed</span>
                </div>
              </div>
              <div className="bg-surface-container p-2 rounded-lg flex items-center justify-between">
                <div>
                  <div className="text-code-sm uppercase tracking-wider text-outline">Tunnel Ingest Latency</div>
                  <div className="text-headline-sm text-primary font-bold mt-0.5">11ms <span className="text-body-sm font-normal text-on-surface-variant">(p95 edge)</span></div>
                </div>
                <div className="w-9 h-9 rounded bg-surface-container-high flex items-center justify-center text-primary">
                  <span className="mds text-[20px]">timer</span>
                </div>
              </div>
              <div className="bg-surface-container p-2 rounded-lg flex items-center justify-between">
                <div>
                  <div className="text-code-sm uppercase tracking-wider text-outline">Packet Retention / Spans</div>
                  <div className="text-headline-sm text-on-surface font-bold mt-0.5">0.00% <span className="text-body-sm text-body-sm font-normal text-secondary">Loss</span></div>
                </div>
                <div className="w-9 h-9 rounded bg-surface-container-high flex items-center justify-center text-on-surface-variant">
                  <span className="mds text-[20px]">format_image_left</span>
                </div>
              </div>
            </div>
            <div className="bg-surface-container p-2 rounded-lg">
              <div className="flex items-center justify-between mb-1">
                <span className="text-code-sm text-outline">24H Latency Curve (W3C Transport)</span>
                <span className="text-code-sm text-secondary">Mean: 9.4ms</span>
              </div>
              <svg className="w-full h-10 text-primary overflow-visible" viewBox="0 0 300 48" fill="none">
                <defs>
                  <linearGradient id="curveGradient" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d="M0,38 Q25,32 50,35 T100,24 T150,28 T200,16 T250,20 T300,12 L300,48 L0,48 Z" fill="url(#curveGradient)" />
                <path d="M0,38 Q25,32 50,35 T100,24 T150,28 T200,16 T250,20 T300,12" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
              </svg>
            </div>

            {/* Multi-runtime SDK Code Configurator */}
            <div className="bg-surface-container-low rounded-xl shadow-sm mb-6 overflow-hidden" id="code-configurator">
              <div className="p-4 bg-surface-container-high flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-primary">
                    <span className="mds text-[18px]">terminal</span>
                  </div>
                  <div>
                    <h3 className="text-headline-sm text-on-surface font-semibold">Drop-in SDK Code Configurator</h3>
                    <p className="text-body-sm text-on-surface-variant">Switch target language runtime. Sentry libraries are imported unchanged.</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 bg-surface-container-lowest p-1 rounded-lg overflow-x-auto">
                  <button
                    onClick={() => setActiveSdk('node')}
                    className={cn(
                      'px-3 py-1.5 rounded-md text-code-md flex items-center gap-1.5 transition-all',
                      activeSdk === 'node'
                        ? 'text-primary bg-surface-container-high font-semibold'
                        : 'text-on-surface-variant hover:text-on-surface'
                    )}
                  >
                    <span className="mds text-[15px]">javascript</span>
                    Node.js / TS
                  </button>
                  <button
                    onClick={() => setActiveSdk('python')}
                    className={cn(
                      'px-3 py-1.5 rounded-md text-code-md flex items-center gap-1.5 transition-all',
                      activeSdk === 'python'
                        ? 'text-primary bg-surface-container-high font-semibold'
                        : 'text-on-surface-variant hover:text-on-surface'
                    )}
                  >
                    <span className="mds text-[15px]">code_blocks</span>
                    Python
                  </button>
                  <button
                    onClick={() => setActiveSdk('go')}
                    className={cn(
                      'px-3 py-1.5 rounded-md text-code-md flex items-center gap-1.5 transition-all',
                      activeSdk === 'go'
                        ? 'text-primary bg-surface-container-high font-semibold'
                        : 'text-on-surface-variant hover:text-on-surface'
                    )}
                  >
                    <span className="mds text-[15px]">bolt</span>
                    Go
                  </button>
                  <button
                    onClick={() => setActiveSdk('reactNative')}
                    className={cn(
                      'px-3 py-1.5 rounded-md text-code-md flex items-center gap-1.5 transition-all',
                      activeSdk === 'reactNative'
                        ? 'text-primary bg-surface-container-high font-semibold'
                        : 'text-on-surface-variant hover:text-on-surface'
                    )}
                  >
                    <span className="mds text-[15px]">smartphone</span>
                    React Native
                  </button>
                  <button
                    onClick={() => setActiveSdk('nextjs')}
                    className={cn(
                      'px-3 py-1.5 rounded-md text-code-md flex items-center gap-1.5 transition-all',
                      activeSdk === 'nextjs'
                        ? 'text-primary bg-surface-container-high font-semibold'
                        : 'text-on-surface-variant hover:text-on-surface'
                    )}
                  >
                    <span className="mds text-[15px]">web</span>
                    Next.js
                  </button>
                </div>
              </div>
              <div className="relative bg-surface-container-lowest p-5 font-code-md text-code-md overflow-x-auto">
                <div className="absolute top-3 right-3 flex items-center gap-2 z-10">
                  <span className="text-code-sm text-outline px-2 py-1 rounded bg-surface-container">zero code modification</span>
                  <button
                    onClick={copyToClipboard}
                    className="h-8 px-3 rounded bg-surface-container-high hover:bg-surface-bright text-on-surface text-code-sm font-semibold flex items-center gap-1.5 shadow-sm transition-all"
                  >
                    <span className="text-[15px] mds">{copied ? 'check' : 'content_copy'}</span>
                    <span>{copied ? 'Copied Snippet!' : 'Copy Snippet'}</span>
                  </button>
                </div>
                <pre className="text-on-surface selection:bg-primary-container selection:text-on-primary-container">
                  <code>{sdkSnippets[activeSdk]}</code>
                </pre>
              </div>
            </div>

            {/* Feature Parity & Sentry Envelope Protocol Checklist */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-headline-sm text-on-surface font-semibold">Wire Protocol Parity Matrix</h3>
                  <p className="text-body-sm text-on-surface-variant">Native implementation status for Sentry Envelope payload items & telemetry schemas</p>
                </div>
                <span className="text-code-sm text-secondary bg-surface-container-low px-2 py-1 rounded flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-secondary" />
                  6/6 Protocols Operational
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3">
                {[
                  { icon: 'timeline', title: 'Automatic Breadcrumbs', status: 'Active' },
                  { icon: 'bug_report', title: 'Unhandled Exception Handlers', status: 'Active' },
                  { icon: 'account_tree', title: 'Distributed Tracing & W3C', status: 'Active' },
                  { icon: 'slow_motion_video', title: 'rrweb Session Replay', status: 'Active' },
                  { icon: 'sell', title: 'Custom Context & Tags', status: 'Active' },
                  { icon: 'integration_instructions', title: 'Source Maps Upload CLI', status: 'Active' },
                ].map((item) => (
                  <div key={item.title} className="bg-surface-container-low p-2 rounded-xl shadow-sm hover:bg-surface-container transition-all">
                    <div className="flex items-start justify-between mb-2">
                      <div className="w-8 h-8 rounded-lg bg-surface-container-high flex items-center justify-center text-primary">
                        <span className="mds text-[18px]">{item.icon}</span>
                      </div>
                      <span className="text-code-sm text-secondary px-2 py-0.5 rounded-full bg-surface-container font-semibold">{item.status}</span>
                    </div>
                    <h4 className="text-headline-sm text-on-surface font-semibold text-sm mb-1">{item.title}</h4>
                    <p className="text-body-sm text-on-surface-variant">
                      {item.title.includes('Breadcrumbs') && 'HTTP requests, console.* streams, DOM clicks, UI navigation transitions, and database queries recorded sequentially.'}
                      {item.title.includes('Exceptions') && 'Deep stack unwinding, OS signal traps (SIGSEGV, SIGABRT), and uncaught promise rejections captured without missing frames.'}
                      {item.title.includes('Tracing') && 'sentry-trace and baggage header propagation fully reconciled into OpenTelemetry trace trees.'}
                      {item.title.includes('Replay') && 'DOM mutations, cursor motions, and canvas rendering snapshots parsed and playable inside the Benemetrics Replay theater.'}
                      {item.title.includes('Context') && 'setTag(), setUser(), and setExtra() metadata indexed instantaneously with ClickHouse high-speed columnar indexing.'}
                      {item.title.includes('Maps') && 'Compatible with @sentry/cli releases files upload-sourcemaps. Instant de-minification down to original TS/JSX source lines.'}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Ingestion Health Verification */}
            <div className="bg-surface-container-low rounded-xl p-4 shadow-sm mb-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="mds text-[20px] text-primary">science</span>
                    <h3 className="text-headline-sm text-on-surface font-semibold">Pipeline Health Verification</h3>
                  </div>
                  <p className="text-body-sm text-on-surface-variant">Send a live synthetic test exception to confirm ingress authentication, relay ingestion, and real-time socket processing.</p>
                </div>
                <button
                  onClick={() => {}}
                  className="h-10 px-4 rounded-lg bg-primary hover:opacity-90 text-on-primary text-code-md font-semibold flex items-center gap-2 shadow-sm transition-all"
                >
                  <span className="mds text-[18px]">send</span>
                  <span>Send Synthetic Test Crash</span>
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
                    <span className="text-code-sm text-outline ml-2">ingest-stream.benemetrics.internal // stdout</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-code-sm text-outline" id="console-timestamp">READY</span>
                    <button className="text-code-sm text-on-surface-variant hover:text-on-surface">Clear</button>
                  </div>
                </div>
                <div className="p-4 space-y-2 font-code-sm text-code-sm overflow-y-auto max-h-44" id="console-logs">
                  <div className="text-outline flex items-start gap-2">
                    <span className="text-outline select-none">14:02:10.012</span>
                    <span className="text-secondary">[CONNECTED]</span>
                    <span>Listening on secure envelope intake: <code className="text-primary font-semibold">https://o450@benemetrics.app/ingest/42</code></span>
                  </div>
                  <div className="text-outline flex items-start gap-2">
                    <span className="text-outline select-none">14:02:10.015</span>
                    <span className="text-primary">[HEARTBEAT]</span>
                    <span>Cluster node: <code className="text-on-surface">edge-us-east-prod-08</code> reporting 0 backpressure events. Ready for inbound payloads.</span>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between text-on-surface-variant text-code-sm">
                <span className="flex items-center gap-1.5">
                  <span className="mds text-[16px] text-secondary">security</span>
                  Synthetic events are marked with <code className="text-primary px-1 bg-surface-container rounded">tag:synthetic-test</code> and can be flushed or muted at any time.
                </span>
                <span className="text-outline">Schema version: Sentry Event Format 7</span>
              </div>
            </div>
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