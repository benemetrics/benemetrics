import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Action } from "../Action";
import { Icon } from "../Icon";
import { ScreenIntro } from "../ScreenIntro";
import { useWorkspace } from "../WorkspaceContext";
import { api, type AlertChannelDto } from "../../lib/api";
import { notify } from "../../lib/toast";

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

function unwrapOne<T>(response: unknown): T | null {
  if (!response || typeof response !== "object") return null;
  const candidate = response as { data?: T | null; error?: unknown };
  if (candidate.error) return null;
  return candidate.data ?? null;
}

export function NewAlert() {
  const navigate = useNavigate();
  const { application } = useWorkspace();
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [metric, setMetric] = useState<Metric>("error_count");
  const [operator, setOperator] = useState<"gt" | "lt">("gt");
  const [threshold, setThreshold] = useState("50");
  const [windowValue, setWindowValue] = useState("5");
  const [windowUnit, setWindowUnit] = useState(60);
  const [scope, setScope] = useState<"global" | "app">("global");
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
          application
            ? api.api.admin.alerting.channels.get({ $query: { appId: application.id } })
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
  }, [application]);

  const seconds = Math.max(60, Math.round(Number(windowValue) * windowUnit));
  const thresholdNumber = Number(threshold);
  const conditionValid =
    name.trim().length > 0 &&
    Number.isFinite(thresholdNumber) &&
    Number.isFinite(seconds) &&
    seconds > 0;
  const metricLabel = METRICS.find(([value]) => value === metric)?.[1] ?? metric;
  const operatorLabel = operator === "gt" ? "is above" : "is below";
  const windowLabel =
    windowUnit === 60
      ? `${windowValue || 0} min`
      : windowUnit === 3600
        ? `${windowValue || 0} h`
        : `${windowValue || 0} d`;
  const scopeLabel = scope === "app" && application ? application.name : "Global";
  const severity = metric === "fatal_count" ? "critical" : "warning";
  const selectedChannel = channels.find((channel) => channelIds.includes(channel.id));

  const create = async () => {
    if (creating || !conditionValid) return;
    const ruleName = name.trim();
    setCreating(true);
    try {
      const result = await api.api.admin.alerting.rules.post({
        name: ruleName,
        metric,
        operator,
        threshold: thresholdNumber,
        windowSeconds: seconds,
        cooldownSeconds: cooldown,
        channelIds,
        ...(scope === "app" && application ? { appId: application.id } : {}),
      });
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
        subtitle="Turn a metric threshold into an actionable notification."
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
            </div>
          )}

          {step === 2 && (
            <div className="form-grid">
              <div className="form-field">
                <span>Scope</span>
                <select
                  className="field-control"
                  value={scope}
                  onChange={(event) => setScope(event.target.value as "global" | "app")}
                >
                  <option value="global">Global (all apps)</option>
                  {application && <option value="app">{application.name}</option>}
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
                <small>Minimum time between two notifications for this rule.</small>
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
                  Fires when {metricLabel.toLowerCase()} {operatorLabel} {thresholdNumber || 0} over{" "}
                  {windowLabel} in {scopeLabel.toLowerCase()} scope.
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
              {metricLabel} is {operatorLabel.replace("is ", "")} {thresholdNumber || 0} over the last{" "}
              {seconds}s for {scope === "app" && application ? `app ${application.name}` : "global"}.
            </div>
            <div className="notification-stats">
              <span>
                <b>{thresholdNumber || 0}</b> threshold
              </span>
              <span>
                <b>{windowLabel}</b> window
              </span>
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
