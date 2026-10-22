import { useEffect, useMemo, useState } from "react";
import { Action } from "./Action";
import { Icon } from "./Icon";
import { useWorkspace } from "./WorkspaceContext";
import { api, type AlertChannelDto, type AlertRuleDto } from "../lib/api";
import { loadAllPages } from "../lib/cursor";
import { notify } from "../lib/toast";

const METRICS = [
  ["event_count", "Event count"],
  ["error_count", "Error count"],
  ["fatal_count", "Fatal count"],
  ["new_issue_count", "New issues"],
  ["latency_p95", "Latency p95"],
  ["latency_p99", "Latency p99"],
] as const;

const WINDOW_UNITS = [
  [1, "seconds"],
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

export type Metric = (typeof METRICS)[number][0];
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

// The rule definition the consumer submits; create posts it, edit patches it.
export interface AlertBuilderPayload {
  name: string;
  trigger: Trigger;
  metric: Metric | null;
  operator: "gt" | "lt" | null;
  threshold: number | null;
  /** A dynamic threshold ("3x baseline"); null keeps the static one. */
  thresholdFactor: number | null;
  windowSeconds: number | null;
  cooldownSeconds: number;
  channelIds: string[];
  appId: string | null;
  filters?: { tags: Record<string, string> };
  message: string | null;
  folder: string | null;
}

function splitWindow(seconds: number | null): { value: string; unit: number } {
  if (!seconds || seconds <= 0) return { value: "5", unit: 60 };
  if (seconds % 86400 === 0) return { value: String(seconds / 86400), unit: 86400 };
  if (seconds % 3600 === 0 && seconds !== 0) return { value: String(seconds / 3600), unit: 3600 };
  if (seconds % 60 === 0) return { value: String(seconds / 60), unit: 60 };
  return { value: String(seconds), unit: 1 };
}

function cooldownOptions(cooldownSeconds: number): Array<readonly [number, string]> {
  const known = COOLDOWNS.find(([value]) => value === cooldownSeconds);
  if (known) return [...COOLDOWNS];
  const label = "Every " + (cooldownSeconds % 60 === 0 ? `${cooldownSeconds / 60} minutes` : `${cooldownSeconds} seconds`);
  return [...COOLDOWNS, [cooldownSeconds, label] as const];
}

const unwrapOne = (response: unknown): AlertRuleDto | null => {
  if (!response || typeof response !== "object") return null;
  const candidate = response as { data?: AlertRuleDto | null; error?: unknown };
  if (candidate.error) return null;
  return candidate.data ?? null;
};

export function AlertBuilder({
  initial,
  defaultAppId = null,
  lockScope = false,
  submitLabel,
  busyLabel,
  onSubmit,
  busy,
  onCancel,
}: {
  initial?: AlertRuleDto | null;
  defaultAppId?: string | null;
  /** The scope of an existing rule cannot change over the PATCH surface. */
  lockScope?: boolean;
  /** Navigates back when the user cancels the first step. */
  onCancel: () => void;
  submitLabel: string;
  busyLabel: string;
  busy: boolean;
  onSubmit: (payload: AlertBuilderPayload) => Promise<void>;
}) {
  const { application, applications } = useWorkspace();
  const [step, setStep] = useState(1);
  const [name, setName] = useState(initial?.name ?? "");
  const [trigger, setTrigger] = useState<Trigger>((initial?.trigger as Trigger) ?? "threshold");
  const [metric, setMetric] = useState<Metric>((initial?.metric as Metric) ?? "error_count");
  const [operator, setOperator] = useState<"gt" | "lt">((initial?.operator as "gt" | "lt") ?? "gt");
  const [threshold, setThreshold] = useState(
    initial?.threshold != null ? String(initial.threshold) : "50",
  );
  const [dynamicThreshold, setDynamicThreshold] = useState((initial?.thresholdFactor ?? null) != null);
  const [thresholdFactor, setThresholdFactor] = useState(
    initial?.thresholdFactor != null ? String(initial.thresholdFactor) : "3",
  );
  const initialWindow = splitWindow(initial?.windowSeconds ?? null);
  const [windowValue, setWindowValue] = useState(initialWindow.value);
  const [windowUnit, setWindowUnit] = useState(initialWindow.unit);
  const [scopeAppId, setScopeAppId] = useState<string | null>(initial?.appId ?? defaultAppId);
  const [cooldown, setCooldown] = useState(initial?.cooldownSeconds ?? 3600);
  const [tagFilters, setTagFilters] = useState<Array<{ key: string; value: string }>>(
    Object.entries(initial?.filters?.tags ?? {}).map(([key, value]) => ({ key, value })),
  );
  const [message, setMessage] = useState(initial?.message ?? "");
  const [folder, setFolder] = useState(initial?.folder ?? "");
  const [channelIds, setChannelIds] = useState<string[]>(initial?.channelIds ?? []);
  const [channels, setChannels] = useState<AlertChannelDto[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [globalChannels, appChannels] = await Promise.all([
          loadAllPages<AlertChannelDto>(async (cursor, limit) => {
            const result = await api.api.admin.alerting.channels.get({
              $query: { limit, ...(cursor ? { cursor } : {}) },
            });
            return (result?.data as { data?: AlertChannelDto[] } | null)?.data ?? [];
          }),
          scopeAppId
            ? loadAllPages<AlertChannelDto>(async (cursor, limit) => {
                const result = await api.api.admin.alerting.channels.get({
                  $query: { appId: scopeAppId, limit, ...(cursor ? { cursor } : {}) },
                });
                return (result?.data as { data?: AlertChannelDto[] } | null)?.data ?? [];
              })
            : Promise.resolve([] as AlertChannelDto[]),
        ]);
        // Same override semantics as the backend resolver: an app-scoped
        // channel with the same name replaces the global one.
        const byName = new Map<string, AlertChannelDto>();
        for (const channel of globalChannels) {
          byName.set(channel.name, channel);
        }
        for (const channel of appChannels) {
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

  const seconds = Math.max(1, Math.round(Number(windowValue) * windowUnit));
  const thresholdNumber = Number(threshold);
  const factorNumber = Number(thresholdFactor);
  const conditionValid =
    name.trim().length > 0 &&
    (trigger !== "threshold" ||
      (Number.isFinite(thresholdNumber) &&
        Number.isFinite(seconds) &&
        seconds > 0 &&
        (!dynamicThreshold || (Number.isFinite(factorNumber) && factorNumber > 0))));
  const metricLabel = METRICS.find(([value]) => value === metric)?.[1] ?? metric;
  const operatorLabel = operator === "gt" ? "is above" : "is below";
  const windowLabel =
    windowUnit === 1
      ? `${windowValue || 0} s`
      : windowUnit === 60
        ? `${windowValue || 0} min`
        : windowUnit === 3600
          ? `${windowValue || 0} h`
          : `${windowValue || 0} d`;
  const scopedApp = applications.find((app) => app.id === scopeAppId) ?? null;
  const scopeLabel = scopedApp ? scopedApp.name : "Global";
  const severity = trigger === "threshold" && metric === "fatal_count" ? "critical" : "warning";
  const selectedChannel = channels.find((channel) => channelIds.includes(channel.id));
  const lockedUnknownApp = lockScope && scopeAppId && !scopedApp;

  const submit = async () => {
    if (busy || !conditionValid) return;
    const tags = Object.fromEntries(
      tagFilters
        .map((filter) => [filter.key.trim(), filter.value.trim()] as const)
        .filter(([key, value]) => key.length > 0 && value.length > 0),
    );
    await onSubmit({
      name: name.trim(),
      trigger,
      metric: trigger === "threshold" ? metric : null,
      operator: trigger === "threshold" ? operator : null,
      threshold:
        trigger === "threshold" && !dynamicThreshold ? thresholdNumber : null,
      thresholdFactor:
        trigger === "threshold" && dynamicThreshold && factorNumber > 0
          ? factorNumber
          : null,
      windowSeconds: trigger === "threshold" ? seconds : null,
      cooldownSeconds: cooldown,
      channelIds,
      appId: scopeAppId,
      // Always present; create drops it when empty, edit uses `{ tags: {} }` to clear.
      filters: { tags },
      message: message.trim() || null,
      folder: folder.trim() || null,
    });
  };

  const toggleChannel = (id: string) =>
    setChannelIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );

  const notificationMark = useMemo(() => {
    const type = selectedChannel?.type ?? "slack";
    if (type === "rocketchat") return { className: "rocket", mark: "R" };
    if (type === "pagerduty") return { className: "pagerduty", mark: "P" };
    if (type === "opsgenie") return { className: "opsgenie", mark: "O" };
    if (type === "msteams") return { className: "msteams", mark: "T" };
    if (type === "victorops") return { className: "victorops", mark: "V" };
    if (type === "email") return { className: "mail", mark: "@" };
    if (type === "webhook") return { className: "webhook", mark: "↗" };
    return { className: "slack", mark: "S" };
  }, [selectedChannel]);

  return (
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
                  <div className="toggle-row">
                    <input
                      type="checkbox"
                      checked={dynamicThreshold}
                      aria-label="Dynamic threshold"
                      onChange={(event) => setDynamicThreshold(event.target.checked)}
                    />
                    <span>{dynamicThreshold ? "Dynamic (baseline)" : "Static"}</span>
                  </div>
                  {dynamicThreshold ? (
                    <>
                      <input
                        className="field-control"
                        type="number"
                        min="0"
                        step="0.1"
                        aria-label="Baseline factor"
                        value={thresholdFactor}
                        onChange={(event) => setThresholdFactor(event.target.value)}
                      />
                      <small>
                        Fires when the metric crosses the factor times its
                        per-window average over the last day.
                      </small>
                    </>
                  ) : (
                    <input
                      className="field-control"
                      type="number"
                      min="0"
                      value={threshold}
                      onChange={(event) => setThreshold(event.target.value)}
                    />
                  )}
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
                disabled={lockScope}
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
                {lockedUnknownApp && <option value={scopeAppId ?? ""}>{scopeAppId}</option>}
              </select>
              <small>
                {lockScope
                  ? "The scope of an existing rule cannot change — create a new rule to move it."
                  : "App-scoped rules override a global rule with the same name."}
              </small>
            </div>
            <div className="form-field">
              <span>Folder</span>
              <input
                className="field-control"
                placeholder="Checkout team"
                aria-label="Folder"
                value={folder}
                onChange={(event) => setFolder(event.target.value)}
              />
              <small>Optional. The rules page groups the rules by folder.</small>
            </div>
            <div className="form-field full">
              <span>Message template</span>
              <input
                className="field-control code-value"
                placeholder="{{rule.name}}: {{metric}} is {{value}}"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
              <small>
                Optional. The variables are rule.name, metric, value,
                threshold, operator, windowSeconds and appId.
              </small>
            </div>
            <div className="form-field full">
              <span>Tag filters</span>
              {tagFilters.length === 0 ? (
                <small>
                  Without filters the rule counts every event. Add a tag to
                  match only the events that carry it.
                </small>
              ) : (
                tagFilters.map((filter, index) => (
                  <div className="filter-row" key={index}>
                    <input
                      className="field-control"
                      placeholder="tag"
                      aria-label="Filter tag"
                      value={filter.key}
                      onChange={(event) =>
                        setTagFilters((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, key: event.target.value }
                              : item,
                            ),
                          )
                        }
                    />
                    <input
                      className="field-control"
                      placeholder="value"
                      aria-label="Filter value"
                      value={filter.value}
                      onChange={(event) =>
                        setTagFilters((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, value: event.target.value }
                              : item,
                            ),
                          )
                        }
                    />
                    <Action
                      variant="soft"
                      onClick={() =>
                        setTagFilters((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                    >
                      Remove
                    </Action>
                  </div>
                ))
              )}
              <Action
                variant="soft"
                onClick={() =>
                  setTagFilters((current) => [...current, { key: "", value: "" }])
                }
              >
                Add tag filter
              </Action>
            </div>
            <div className="form-field">
              <span>Repeat interval</span>
              <select
                className="field-control"
                value={cooldown}
                onChange={(event) => setCooldown(Number(event.target.value))}
              >
                {cooldownOptions(cooldown).map(([value, label]) => (
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
                  ? `Fires when ${metricLabel.toLowerCase()} ${operatorLabel} ${dynamicThreshold ? `${factorNumber}× the baseline` : thresholdNumber || 0} over ${windowLabel} in ${scopeLabel.toLowerCase()} scope.`
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
            onClick={() => (step > 1 ? setStep(step - 1) : onCancel())}
          >
            {step > 1 ? "Back" : "Cancel"}
          </Action>
          <Action
            variant="primary"
            onClick={() => (step < 3 ? conditionValid && setStep(step + 1) : submit())}
          >
            {step < 3 ? "Continue" : busy ? busyLabel : submitLabel}{" "}
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
              ? `${metricLabel} is ${operatorLabel.replace("is ", "")} ${dynamicThreshold ? `${factorNumber}× the baseline` : thresholdNumber || 0} over the last ${seconds}s for ${scopedApp ? `app ${scopedApp.name}` : "global"}.`
              : trigger === "new_issue"
                ? `New issue in ${scopedApp ? `app ${scopedApp.name}` : "global"}: TypeError: Cannot read properties of undefined`
                : `Regression in ${scopedApp ? `app ${scopedApp.name}` : "global"}: TypeError: Cannot read properties of undefined`}
          </div>
          <div className="notification-stats">
            {trigger === "threshold" ? (
              <>
                <span>
                  <b>{dynamicThreshold ? `${factorNumber}× baseline` : thresholdNumber || 0}</b> threshold
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
  );
}

export { unwrapOne as unwrapRuleResponse };
