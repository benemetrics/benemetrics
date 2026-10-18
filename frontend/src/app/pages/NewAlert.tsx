import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Action } from "../Action.tsx";
import { Icon } from "../Icon.tsx";
import { ScreenIntro } from "../ScreenIntro.tsx";
import { useWorkspace } from "../WorkspaceContext.tsx";
import { api, type AlertChannelDto } from "../../lib/api.ts";
import { notify } from "../../lib/toast.ts";

function unwrapList<T>(response: unknown): T[] {
  if (!response || typeof response !== "object") return [];
  const candidate = response as { data?: { data?: T[] } | null; error?: unknown };
  if (candidate.error) return [];
  return candidate.data?.data ?? [];
}

const METRICS = [
  ["event_count", "Event count"],
  ["error_count", "Error count"],
  ["fatal_count", "Fatal count"],
  ["new_issue_count", "New issues"],
  ["latency_p95", "Latency p95"],
  ["latency_p99", "Latency p99"],
] as const;

const WINDOW_UNITS = [
  [60, "minutes"],
  [3600, "hours"],
  [86400, "days"],
] as const;

const COOLDOWNS = [
  [300, "Every 5 minutes"],
  [900, "Every 15 minutes"],
  [1800, "Every 30 minutes"],
  [3600, "Every hour"],
  [21600, "Every 6 hours"],
] as const;

type Metric = (typeof METRICS)[number][0];
type Trigger = "threshold" | "new_issue" | "regression";

const TRIGGERS = [
  ["threshold", "Metric threshold"],
  ["new_issue", "New issue"],
  ["regression", "Regression"],
] as const;

const TRIGGER_HINTS: Record<Trigger, string> = {
  threshold: "Fires when a metric crosses the threshold within the window.",
  new_issue: "Fires the first time an issue is seen for the app.",
  regression: "Fires when a resolved issue receives a new event.",
};

const TRIGGER_LABELS: Record<Trigger, string> = {
  threshold: "Metric",
  new_issue: "New issue",
  regression: "Regression",
};

function unwrapOne<T>(response: unknown): T | null {
  if (!response || typeof response !== "object") return null;
  const candidate = response as { data?: T | null; error?: unknown };
  if (candidate.error) return null;
  return candidate.data ?? null;
}

export function NewAlert() {
  const navigate = useNavigate();
  const { application, applications } = useWorkspace();
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<Trigger>("threshold");
  const [metric, setMetric] = useState<Metric>("error_count");
  const [operator, setOperator] = useState<"gt" | "lt">("gt");
  const [threshold, setThreshold] = useState("50");
  const [windowValue, setWindowValue] = useState("5");
  const [windowUnit, setWindowUnit] = useState(60);
  // App the rule is attached to; null keeps it global. Preselects the app
  // currently picked in the topbar, but any app of the current project can
  // be chosen without switching the workspace.
  const [scopeAppId, setScopeAppId] = useState<string | null>(application?.id ?? null);
  const [cooldown, setCooldown] = useState(3600);
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [channels, setChannels] = useState<AlertChannelDto[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [globalResult, appResult] = await Promise.all([
          api.api.admin.alerting.channels.get(),
          scopeAppId
            ? api.api.admin.alerting.channels.get({ $query: { appId: scopeAppId } })
            : Promise.resolve(null),
        ]);
        // Same override semantics as the backend resolver: an app-scoped
        // channel with the same name replaces the global one.
        const byName = new Map<string, AlertChannelDto>();
        for (const channel of unwrapList<AlertChannelDto>(globalResult)) {
          byName.set(channel.name, channel);
        }
        for (const channel of unwrapList<AlertChannelDto>(appResult)) {
          byName.set(channel.name, channel);
        }
        if (!cancelled) setChannels([...byName.values()]);
      } catch {
        if (!cancelled) setChannels([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scopeAppId]);

  const seconds = Math.max(60, Math.round(Number(windowValue) * windowUnit));
  const thresholdNumber = Number(threshold);
  const conditionValid =
    name.trim().length > 0 &&
    (trigger !== "threshold" ||
      (Number.isFinite(thresholdNumber) && Number.isFinite(seconds) && seconds > 0));
  const metricLabel = METRICS.find(([value]) => value === metric)?.[1] ?? metric;
  const operatorLabel = operator === "gt" ? "is above" : "is below";
  const windowLabel =
    windowUnit === 60
      ? `${windowValue || 0} min`
      : windowUnit === 3600
        ? `${windowValue || 0} h`
        : `${windowValue || 0} d`;
  const scopedApp = applications.find((app) => app.id === scopeAppId) ?? null;
  const scopeLabel = scopedApp ? scopedApp.name : "Global";
  const severity = trigger === "threshold" && metric === "fatal_count" ? "critical" : "warning";
  const selectedChannel = channels.find((channel) => channelIds.includes(channel.id));

  const create = async () => {
    if (creating || !conditionValid) return;
    const ruleName = name.trim();
    setCreating(true);
    try {
      const shared = {
        name: ruleName,
        cooldownSeconds: cooldown,
        channelIds,
        ...(scopeAppId ? { appId: scopeAppId } : {}),
      };
      const result =
        trigger === "threshold"
          ? await api.api.admin.alerting.rules.post({
              ...shared,
              trigger,
              metric,
              operator,
              threshold: thresholdNumber,
              windowSeconds: seconds,
            })
          : await api.api.admin.alerting.rules.post({ ...shared, trigger });
      const created = unwrapOne<{ id: string }>(result);
      if (!created?.id) {
        notify(`Could not create "${ruleName}" — the name may already be taken in this scope.`);
        return;
      }
      notify(`Alert rule "${ruleName}" created`);
      if (channelIds.length > 0) {
        try {
          const testResult = await api.api.admin.alerting.rules[created.id].test.post();
          const results =
            unwrapOne<{ results?: Array<{ ok: boolean }> }>(testResult)?.results ?? [];
          if (results.length === 0) {
            notify("No channels to notify for the test alert");
          } else {
            const delivered = results.filter((item) => item.ok).length;
            notify(`Test notification: ${delivered}/${results.length} channels delivered`);
          }
        } catch {
          notify("The test notification could not be delivered");
        }
      }
      navigate("/alerts");
    } catch {
      notify("Could not reach the backend while creating the alert rule.");
    } finally {
      setCreating(false);
    }
  };

  const toggleChannel = (id: string) =>
    setChannelIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );

  const notificationMark = useMemo(() => {
    const type = selectedChannel?.type ?? "slack";
    if (type === "rocketchat") return { className: "rocket", mark: "R" };
    if (type === "email") return { className: "mail", mark: "@" };
    if (type === "webhook") return { className: "webhook", mark: "↗" };
    return { className: "slack", mark: "S" };
  }, [selectedChannel]);

  return (
    <div className="screen-stack">
      <div className="back-link" role="button" tabIndex={0} onClick={() => navigate("/alerts")}>
        ← Back to alerts
      </div>
      <ScreenIntro
        eyebrow="NEW ALERT"
        title="Create an alert"
        subtitle="Turn metric thresholds, new issues and regressions into actionable notifications."
      />
      <div className="builder-layout">
        <article className="panel builder-card">
          <div className="builder-steps">
            <span className={step === 1 ? "active" : ""}>1 · Condition</span>
            <span className={step === 2 ? "active" : ""}>2 · Routing</span>
            <span className={step === 3 ? "active" : ""}>3 · Review</span>
          </div>

          {step === 1 && (
            <div className="form-grid">
              <div className="form-field full">
                <span>Alert name</span>
                <input
                  className="field-control"
                  placeholder="Checkout error spike"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="form-field">
                <span>Alert type</span>
                <select
                  className="field-control"
                  value={trigger}
                  onChange={(event) => setTrigger(event.target.value as Trigger)}
                >
                  {TRIGGERS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <small>{TRIGGER_HINTS[trigger]}</small>
              </div>
              {trigger === "threshold" && (
                <>
                  <div className="form-field">
                    <span>Metric</span>
                    <select
                      className="field-control"
                      value={metric}
                      onChange={(event) => setMetric(event.target.value as Metric)}
                    >
                      {METRICS.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-field">
                    <span>Trigger when</span>
                    <select
                      className="field-control"
                      value={operator}
                      onChange={(event) => setOperator(event.target.value as "gt" | "lt")}
                    >
                      <option value="gt">Is above</option>
                      <option value="lt">Is below</option>
                    </select>
                  </div>
                  <div className="form-field">
                    <span>Threshold</span>
                    <input
                      className="field-control"
                      type="number"
                      min="0"
                      value={threshold}
                      onChange={(event) => setThreshold(event.target.value)}
                    />
                  </div>
                  <div className="form-field">
                    <span>Window</span>
                    <div className="form-inline">
                      <input
                        className="field-control"
                        type="number"
                        min="1"
                        value={windowValue}
                        onChange={(event) => setWindowValue(event.target.value)}
                      />
                      <select
                        className="field-control"
                        value={windowUnit}
                        onChange={(event) => setWindowUnit(Number(event.target.value))}
                      >
                        {WINDOW_UNITS.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="form-grid">
              <div className="form-field">
                <span>Scope</span>
                <select
                  className="field-control"
                  value={scopeAppId ?? "global"}
                  onChange={(event) =>
                    setScopeAppId(event.target.value === "global" ? null : event.target.value)
                  }
                >
                  <option value="global">Global (all apps)</option>
                  {applications.map((app) => (
                    <option key={app.id} value={app.id}>
                      {app.name}
                    </option>
                  ))}
                </select>
                <small>App-scoped rules override a global rule with the same name.</small>
              </div>
              <div className="form-field">
                <span>Repeat interval</span>
                <select
                  className="field-control"
                  value={cooldown}
                  onChange={(event) => setCooldown(Number(event.target.value))}
                >
                  {COOLDOWNS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <small>
                  {trigger === "threshold"
                    ? "Minimum time between two notifications for this rule."
                    : "Minimum time between two notifications for the same issue."}
                </small>
              </div>
              <div className="form-field full">
                <span>Destinations</span>
                {channels.length === 0 ? (
                  <div className="channel-select">
                    <div className="channel-pick">
                      <span>No channels yet — the rule will notify every channel once one exists.</span>
                    </div>
                  </div>
                ) : (
                  <div className="channel-select">
                    {channels.map((channel) => (
                      <label
                        key={channel.id}
                        className={`channel-pick ${channelIds.includes(channel.id) ? "selected" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={channelIds.includes(channel.id)}
                          onChange={() => toggleChannel(channel.id)}
                        />
                        <span>{channel.name}</span>
                        <small>{channel.type}</small>
                      </label>
                    ))}
                  </div>
                )}
                <small>
                  With no destinations selected, the rule notifies every channel in scope.
                </small>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="review-alert">
              <div className="review-icon">
                <Icon name="bell" />
              </div>
              <div>
                <strong>{name.trim() || "Untitled alert"}</strong>
                <span>
                  {trigger === "threshold"
                    ? `Fires when ${metricLabel.toLowerCase()} ${operatorLabel} ${thresholdNumber || 0} over ${windowLabel} in ${scopeLabel.toLowerCase()} scope.`
                    : trigger === "new_issue"
                      ? `Fires the first time an issue is seen in ${scopeLabel.toLowerCase()} scope.`
                      : `Fires when a resolved issue sees a new event in ${scopeLabel.toLowerCase()} scope.`}
                </span>
              </div>
              <div className="severity-pill">{severity}</div>
            </div>
          )}

          <div className="builder-actions">
            <Action
              variant="soft"
              onClick={() => (step > 1 ? setStep(step - 1) : navigate("/alerts"))}
            >
              {step > 1 ? "Back" : "Cancel"}
            </Action>
            <Action
              variant="primary"
              onClick={() => (step < 3 ? conditionValid && setStep(step + 1) : create())}
            >
              {step < 3 ? "Continue" : creating ? "Creating…" : "Create alert"}{" "}
              {step < 3 && <Icon name="chevron" size={14} />}
            </Action>
          </div>
        </article>

        <aside className="builder-preview">
          <div className="preview-label">NOTIFICATION PREVIEW</div>
          <div className="notification-preview">
            <div className="notification-top">
              <div className={`channel ${notificationMark.className}`}>{notificationMark.mark}</div>
              <strong>{selectedChannel?.name ?? "All channels"}</strong>
              <span>now</span>
            </div>
            <div className="notification-title">Alert: {name.trim() || "Untitled alert"}</div>
            <div className="notification-copy">
              {trigger === "threshold"
                ? `${metricLabel} is ${operatorLabel.replace("is ", "")} ${thresholdNumber || 0} over the last ${seconds}s for ${scopedApp ? `app ${scopedApp.name}` : "global"}.`
                : trigger === "new_issue"
                  ? `New issue in ${scopedApp ? `app ${scopedApp.name}` : "global"}: TypeError: Cannot read properties of undefined`
                  : `Regression in ${scopedApp ? `app ${scopedApp.name}` : "global"}: TypeError: Cannot read properties of undefined`}
            </div>
            <div className="notification-stats">
              {trigger === "threshold" ? (
                <>
                  <span>
                    <b>{thresholdNumber || 0}</b> threshold
                  </span>
                  <span>
                    <b>{windowLabel}</b> window
                  </span>
                </>
              ) : (
                <span>
                  <b>{TRIGGER_LABELS[trigger]}</b> trigger
                </span>
              )}
              <span>
                <b>{scopeLabel}</b> scope
              </span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
