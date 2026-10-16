import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Icon } from "../Icon";
import { Action } from "../Action";
import {
  api,
  ingestEnvelope,
  type AppDto,
  type ProjectDto,
} from "../../lib/api";
import { platformSymbol } from "../../lib/platform";
import { notify } from "../../lib/toast";
import { POLL_INTERVAL_MS } from "../../lib/utils";

const SDKS = [
  ["node", "Node.js / TS"],
  ["python", "Python"],
  ["go", "Go"],
  ["reactNative", "React Native"],
  ["nextjs", "Next.js"],
] as const;

type SdkKey = (typeof SDKS)[number][0];

const FILE_NAMES: Record<SdkKey, string> = {
  node: "server.ts",
  python: "app.py",
  go: "main.go",
  reactNative: "App.tsx",
  nextjs: "sentry.client.config.ts",
};

const INSTALL_COMMANDS: Record<SdkKey, string[]> = {
  node: ["bun add @sentry/node", "# or: npm install @sentry/node"],
  python: ["pip install sentry-sdk"],
  go: ["go get github.com/getsentry/sentry-go"],
  reactNative: ["bun add @sentry/react-native"],
  nextjs: ["bun add @sentry/nextjs"],
};

export function Setup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedAppId = searchParams.get("app");
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [apps, setApps] = useState<AppDto[]>([]);
  const [app, setApp] = useState<AppDto | null>(null);
  const [activeSdk, setActiveSdk] = useState<SdkKey>("node");
  const [step, setStep] = useState(1);
  const [testing, setTesting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<number | null>(null);
  const [received, setReceived] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const projectsResult = await api.api.admin.projects.get();
        const projectList: ProjectDto[] =
          (projectsResult?.data as { data?: ProjectDto[] } | null)?.data ?? [];
        const allApps: AppDto[] = [];
        for (const project of projectList) {
          const detail = await api.api.admin.projects[project.id].get();
          const detailApps: AppDto[] =
            (detail?.data as { apps?: AppDto[] } | null)?.apps ?? [];
          allApps.push(...detailApps);
        }
        if (cancelled) return;
        setProjects(projectList);
        setApps(allApps);
        setApp((current) => allApps.find((item) => item.id === current?.id) ?? allApps[0] ?? null);
      } catch {
        // keep the empty state on failure
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Deep link from the Projects page: /setup?app=<id> preselects the app.
  useEffect(() => {
    if (!requestedAppId) return;
    const match = apps.find((item) => item.id === requestedAppId);
    if (match) setApp(match);
  }, [requestedAppId, apps]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await api.health.get();
        const stored = result?.data?.eventsStored;
        if (cancelled || stored == null) return;
        if (baseline != null && stored > baseline) {
          setReceived(true);
        }
      } catch {
        // keep waiting on failure
      }
    };
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [baseline]);

  const dsn = app?.dsn ?? null;
  const appProject = projects.find((item) => item.id === app?.projectId) ?? null;
  const symbol = platformSymbol(app?.platform ?? "web");

  const snippets: Record<SdkKey, string[]> = {
    node: [
      'import * as Sentry from "@sentry/node";',
      "",
      "Sentry.init({",
      `  dsn: "${dsn ?? ""}",`,
      "  tracesSampleRate: 1.0,",
      "});",
    ],
    python: [
      "import sentry_sdk",
      "",
      "sentry_sdk.init(",
      `    dsn="${dsn ?? ""}",`,
      "    traces_sample_rate=1.0,",
      ")",
    ],
    go: [
      "package main",
      "",
      'import "github.com/getsentry/sentry-go"',
      "",
      "func main() {",
      "    sentry.Init(sentry.ClientOptions{",
      `        Dsn: "${dsn ?? ""}",`,
      "    })",
      "}",
    ],
    reactNative: [
      'import * as Sentry from "@sentry/react-native";',
      "",
      "Sentry.init({",
      `  dsn: "${dsn ?? ""}",`,
      "});",
    ],
    nextjs: [
      "// sentry.client.config.ts",
      'import * as Sentry from "@sentry/nextjs";',
      "",
      "Sentry.init({",
      `  dsn: "${dsn ?? ""}",`,
      "  tracesSampleRate: 0.8,",
      "});",
    ],
  };

  const codeLines =
    step === 1
      ? INSTALL_COMMANDS[activeSdk]
      : step === 2
        ? snippets[activeSdk]
        : [`# Your project DSN`, dsn ?? "# no DSN yet — create an application first"];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codeLines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      notify("Could not copy — clipboard access was blocked by the browser.");
    }
  };

  const sendTestEvent = async () => {
    if (!app || testing) return;
    setTesting(true);
    const eventId = crypto.randomUUID();
    const envelope = [
      JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }),
      JSON.stringify({ type: "event", length: 0 }),
      JSON.stringify({
        event_id: eventId,
        level: "info",
        message: "Getting started test event",
        tags: { "synthetic-test": "true" },
        timestamp: Math.floor(Date.now() / 1000),
      }),
    ].join("\n");

    try {
      const result = await ingestEnvelope(app.ingestKey, envelope, {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_key=${app.publicKey}, sentry_version=7`,
      });
      if (result?.id) {
        setOutput(`Accepted — stored as ${String(result.id).slice(0, 8)}…`);
        const healthResult = await api.health.get();
        setBaseline(healthResult?.data?.eventsStored ?? null);
      } else {
        setOutput(`Rejected — ${JSON.stringify(result)}`);
        notify("The test event was rejected. Check the application's ingest key.");
      }
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Request failed");
      notify("Could not send the test event — check the backend connection.");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="screen-stack">
      <div className="onboarding">
        <Link to="/projects" className="back-link">
          ← Back to applications
        </Link>
        <section className="onboarding-head">
          <div className={`app-symbol ${symbol.className} large`}>{symbol.label}</div>
          <div>
            <div className="eyebrow">
              {(appProject?.name ?? "WORKSPACE").toUpperCase()} / {(app?.name ?? "APP").toUpperCase()}
            </div>
            <div className="page-title">Let&apos;s get your first event</div>
            <div className="page-subtitle">
              Connect the SDK and verify your application in a few minutes.
            </div>
          </div>
          {app && (
            <div className="setup-progress">
              <strong>{step}/3</strong>
              <span>steps complete</span>
            </div>
          )}
        </section>
        {!app ? (
          <article className="panel" style={{ padding: "48px", textAlign: "center" }}>
            <div className="panel-title">Create an application first</div>
            <div className="panel-subtitle">
              The setup guide needs an application to generate a DSN for. Create one, then come
              back to this page.
            </div>
            <div className="setup-actions" style={{ justifyContent: "center", marginTop: 18 }}>
              <Action variant="primary" onClick={() => navigate("/projects")}>
                Go to Projects <Icon name="chevron" size={14} />
              </Action>
            </div>
          </article>
        ) : (
          <>
            <section className="setup-layout">
              <div className="setup-steps">
                {["Install the SDK", "Configure your app", "Send a test event"].map(
                  (label, index) => (
                    <div
                      className={`setup-step ${step > index ? "complete" : ""} ${
                        step === index + 1 ? "current" : ""
                      }`}
                      key={label}
                    >
                      <div className="step-number">{step > index ? "✓" : index + 1}</div>
                      <div>
                        <strong>{label}</strong>
                        <span>
                          {index === 0
                            ? "Add the SDK to your project"
                            : index === 1
                              ? "Initialize monitoring with your DSN"
                              : "Confirm your integration"}
                        </span>
                      </div>
                    </div>
                  ),
                )}
              </div>
              <article className="setup-card">
                <div className="setup-card-top">
                  <div>
                    <div className="setup-label">STEP {step} OF 3</div>
                    <div className="setup-title">
                      {step === 1
                        ? "Install the SDK"
                        : step === 2
                          ? "Initialize the SDK"
                          : "Send your first event"}
                    </div>
                    <div className="setup-description">
                      {step === 1
                        ? "Install the package for your platform, then import it in your application."
                        : step === 2
                          ? "Point the SDK at your project DSN at application startup."
                          : "Trigger a sample event to make sure everything is connected correctly."}
                    </div>
                  </div>
                </div>
                <div className="platform-pills" role="group" aria-label="SDK platform">
                  {SDKS.map(([key, label]) => (
                    <div
                      key={key}
                      className={`platform-pill ${activeSdk === key ? "is-active" : ""}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => setActiveSdk(key)}
                      onKeyDown={(event) => event.key === "Enter" && setActiveSdk(key)}
                    >
                      {label}
                    </div>
                  ))}
                </div>
                {apps.length > 1 && (
                  <select
                    value={app.id}
                    onChange={(event) =>
                      setApp(apps.find((item) => item.id === event.target.value) ?? null)
                    }
                    className="app-select"
                  >
                    {apps.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                )}
                <div className="code-block">
                  <div className="code-bar">
                    <span>{step === 1 ? "terminal" : FILE_NAMES[activeSdk]}</span>
                    <span
                      className="code-copy"
                      role="button"
                      tabIndex={0}
                      onClick={copy}
                      onKeyDown={(event) => event.key === "Enter" && copy()}
                    >
                      {copied ? "Copied ✓" : "Copy"}
                    </span>
                  </div>
                  <div className="code-block-body">
                    {codeLines.map((line, index) => (
                      <div className="code-line" key={index}>
                        <span>{index + 1}</span>
                        {line}
                      </div>
                    ))}
                  </div>
                </div>
                {step === 3 && (
                  <div className="setup-actions" style={{ justifyContent: "flex-start" }}>
                    <Action variant="primary" onClick={sendTestEvent}>
                      {testing ? "Sending…" : "Send test event"} <Icon name="chevron" size={14} />
                    </Action>
                    {output && <span className="setup-output">{output}</span>}
                  </div>
                )}
                <div className="setup-tip">
                  <Icon name="spark" size={17} />
                  <span>
                    <strong>Tip</strong>Your first event can take up to a minute to appear after
                    sending.
                  </span>
                </div>
                <div className="setup-actions">
                  <a
                    className="action action-soft"
                    href="https://docs.sentry.io/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Read the docs
                  </a>
                  <Action variant="primary" onClick={() => setStep(step === 3 ? 1 : step + 1)}>
                    {step === 3 ? "Start over" : "Continue"} <Icon name="chevron" size={14} />
                  </Action>
                </div>
              </article>
            </section>
            <section className="waiting-card">
              <div className="radar">
                <span></span>
              </div>
              <div>
                <strong>{received ? "Event received" : "Listening for your first event"}</strong>
                <span>
                  {received
                    ? "Your application is connected and sending data."
                    : "Keep this page open while you finish the setup."}
                </span>
              </div>
              <div className={`waiting-status ${received ? "connected" : ""}`}>
                <span></span>
                {received ? "Connected" : "Waiting"}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
