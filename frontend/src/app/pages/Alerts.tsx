import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Action } from "../Action";
import { ScreenIntro } from "../ScreenIntro";
import { useWorkspace } from "../WorkspaceContext";
import {
  api,
  type AlertChannelDto,
  type AlertIncidentDto,
  type AlertRuleDto,
} from "../../lib/api";
import { notify } from "../../lib/toast";
import { POLL_INTERVAL_MS, relativeTime } from "../../lib/utils";

function unwrapList<T>(response: unknown): T[] {
  if (!response || typeof response !== "object") return [];
  const candidate = response as { data?: { data?: T[] } | null; error?: unknown };
  if (candidate.error) return [];
  return candidate.data?.data ?? [];
}

interface EffectiveAlertConfig {
  channels: AlertChannelDto[];
  rules: AlertRuleDto[];
}

export function Alerts() {
  const navigate = useNavigate();
  const { application } = useWorkspace();
  const [rules, setRules] = useState<AlertRuleDto[]>([]);
  const [channels, setChannels] = useState<AlertChannelDto[]>([]);
  const [incidents, setIncidents] = useState<AlertIncidentDto[]>([]);
  const [effective, setEffective] = useState<EffectiveAlertConfig | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [testing, setTesting] = useState<string | null>(null);
  const [busyRule, setBusyRule] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [rulesResult, channelsResult, incidentsResult] = await Promise.all([
          api.api.admin.alerting.rules.get(),
          api.api.admin.alerting.channels.get(),
          api.api.admin.alerting.incidents.get(),
        ]);
        if (cancelled) return;
        setRules(unwrapList(rulesResult));
        setChannels(unwrapList(channelsResult));
        setIncidents(unwrapList(incidentsResult));
        setStatus("ready");
      } catch {
        // keep the current lists on failure, but stop the loading state
        if (!cancelled) setStatus((current) => (current === "ready" ? current : "error"));
      }
      // The merged global + app-scoped view is only meaningful with an app selected.
      if (!application) {
        if (!cancelled) setEffective(null);
        return;
      }
      try {
        const result = await api.api.admin.alerting.apps[application.id].effective.get();
        const data =
          (result?.data as { channels?: AlertChannelDto[]; rules?: AlertRuleDto[] } | null) ??
          null;
        if (!cancelled) {
          setEffective({
            channels: data?.channels ?? [],
            rules: data?.rules ?? [],
          });
        }
      } catch {
        if (!cancelled) setEffective(null);
      }
    };
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [application]);

  const channelById = new Map(channels.map((channel) => [channel.id, channel]));
  const firing = incidents.filter((incident) => incident.status === "firing");
  const enabled = rules.filter((rule) => rule.isEnabled);
  const lastTriggered = rules
    .map((rule) => rule.lastTriggeredAt)
    .filter((timestamp): timestamp is string => Boolean(timestamp))
    .sort()
    .reverse()[0];

  const testRule = async (rule: AlertRuleDto) => {
    if (testing) return;
    setTesting(rule.id);
    try {
      const result = await api.api.admin.alerting.rules[rule.id].test.post();
      const results =
        (result?.data as { results?: Array<{ ok: boolean }> } | null)?.results ?? [];
      if (results.length === 0) {
        notify(`"${rule.name}" has no channels in scope to notify`);
      } else {
        const delivered = results.filter((item) => item.ok).length;
        notify(`Test notification for "${rule.name}": ${delivered}/${results.length} delivered`);
      }
    } catch {
      notify(`Could not send a test notification for "${rule.name}"`);
    } finally {
      setTesting(null);
    }
  };

  const toggleRule = async (rule: AlertRuleDto) => {
    if (busyRule) return;
    const next = !rule.isEnabled;
    setBusyRule(rule.id);
    try {
      const result = await api.api.admin.alerting.rules[rule.id].patch({ isEnabled: next });
      if ((result as { error?: unknown } | null)?.error) {
        notify(`Could not update "${rule.name}"`);
        return;
      }
      setRules((current) =>
        current.map((item) => (item.id === rule.id ? { ...item, isEnabled: next } : item)),
      );
      notify(`Rule "${rule.name}" ${next ? "enabled" : "paused"}`);
    } catch {
      notify("Could not reach the backend while updating the rule.");
    } finally {
      setBusyRule(null);
    }
  };

  const removeRule = async (rule: AlertRuleDto) => {
    if (busyRule) return;
    setBusyRule(rule.id);
    try {
      const result = await api.api.admin.alerting.rules[rule.id].delete();
      if ((result as { error?: unknown } | null)?.error) {
        notify(`Could not delete "${rule.name}"`);
        return;
      }
      setRules((current) => current.filter((item) => item.id !== rule.id));
      setConfirmDelete(null);
      notify(`Rule "${rule.name}" deleted with its incident history`);
    } catch {
      notify("Could not reach the backend while deleting the rule.");
    } finally {
      setBusyRule(null);
    }
  };

  return (
    <div className="screen-stack">
      <ScreenIntro
        eyebrow="ALERT MANAGEMENT"
        title="Alerts"
        subtitle="Rules created through the admin API route alerts to email, Slack, or Rocket.Chat."
        action={
          <div className="intro-actions">
            <Action variant="soft" onClick={() => navigate("/alerts/channels")}>
              Alert channels
            </Action>
            <Action variant="primary" onClick={() => navigate("/alerts/new")}>
              <span className="plus">+</span>Create alert
            </Action>
          </div>
        }
      />
      <section className="mini-metrics">
        <div>
          <span>Firing now</span>
          <strong>{firing.length}</strong>
        </div>
        <div>
          <span>Channels</span>
          <strong>{channels.length}</strong>
        </div>
        <div>
          <span>Last triggered</span>
          <strong>{lastTriggered ? relativeTime(lastTriggered) : "—"}</strong>
        </div>
      </section>
      <article className="panel list-screen alerts">
        <div className="list-screen-head">
          <strong>Rule</strong>
          <span>Scope</span>
          <span>Destination</span>
          <span>Status</span>
        </div>
        {rules.map((rule) => {
          const destination =
            rule.channelIds.length > 0
              ? rule.channelIds
                  .map((id) => channelById.get(id)?.name ?? id)
                  .join(" · ")
              : "All channels";
          return (
            <div className="list-screen-row" key={rule.id}>
              <strong>{rule.name}</strong>
              <span>{rule.appId ? "App scope" : "Global"}</span>
              <span>{destination}</span>
              <span className="row-status">
                <span className={`table-status ${rule.isEnabled ? "" : "draft"}`}>
                  <i></i>
                  {rule.isEnabled ? "Healthy" : "Disabled"}
                </span>
                <span className="row-actions">
                  <span
                    className={`row-action ${testing === rule.id ? "is-busy" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => testRule(rule)}
                    onKeyDown={(event) => event.key === "Enter" && testRule(rule)}
                  >
                    {testing === rule.id ? "Sending…" : "Send test"}
                  </span>
                  <span
                    className={`row-action ${busyRule === rule.id ? "is-busy" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleRule(rule)}
                    onKeyDown={(event) => event.key === "Enter" && toggleRule(rule)}
                  >
                    {busyRule === rule.id ? "Saving…" : rule.isEnabled ? "Pause" : "Enable"}
                  </span>
                  {confirmDelete === rule.id ? (
                    <>
                      <span
                        className={`row-action danger ${busyRule === rule.id ? "is-busy" : ""}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => removeRule(rule)}
                        onKeyDown={(event) => event.key === "Enter" && removeRule(rule)}
                      >
                        Confirm delete
                      </span>
                      <span
                        className="row-action"
                        role="button"
                        tabIndex={0}
                        onClick={() => setConfirmDelete(null)}
                        onKeyDown={(event) => event.key === "Enter" && setConfirmDelete(null)}
                      >
                        Cancel
                      </span>
                    </>
                  ) : (
                    <span
                      className="row-action"
                      role="button"
                      tabIndex={0}
                      onClick={() => setConfirmDelete(rule.id)}
                      onKeyDown={(event) => event.key === "Enter" && setConfirmDelete(rule.id)}
                    >
                      Delete
                    </span>
                  )}
                </span>
              </span>
            </div>
          );
        })}
        {status !== "ready" && (
          <div className="list-screen-row">
            <strong>{status === "loading" ? "Loading alert rules…" : "Could not load alert rules"}</strong>
            <span>—</span>
            <span>—</span>
            <span className="table-status draft">
              <i></i>—
            </span>
          </div>
        )}
        {status === "ready" && rules.length === 0 && (
          <div className="list-screen-row">
            <strong>No alert rules</strong>
            <span>—</span>
            <span>—</span>
            <span className="table-status draft">
              <i></i>—
            </span>
          </div>
        )}
      </article>
      {application && (
        <article className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Effective configuration · {application.name}</div>
              <div className="panel-subtitle">
                Global rows merged with app-scoped overrides — an override replaces the same-name
                global row.
              </div>
            </div>
          </div>
          {effective ? (
            <div className="effective-grid">
              <div>
                <div className="effective-head">Rules · {effective.rules.length}</div>
                <div className="context-list">
                  {effective.rules.map((rule) => (
                    <div key={rule.id}>
                      <span>{rule.name}</span>
                      <strong>{rule.appId ? "App override" : "Global"}</strong>
                    </div>
                  ))}
                  {effective.rules.length === 0 && (
                    <div>
                      <span>No rules apply to this app</span>
                      <strong>—</strong>
                    </div>
                  )}
                </div>
              </div>
              <div>
                <div className="effective-head">Channels · {effective.channels.length}</div>
                <div className="context-list">
                  {effective.channels.map((channel) => (
                    <div key={channel.id}>
                      <span>
                        {channel.name} · {channel.type}
                      </span>
                      <strong>{channel.appId ? "App override" : "Global"}</strong>
                    </div>
                  ))}
                  {effective.channels.length === 0 && (
                    <div>
                      <span>No channels route for this app</span>
                      <strong>—</strong>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="context-list">
              <div>
                <span>Loading effective configuration…</span>
                <strong>—</strong>
              </div>
            </div>
          )}
        </article>
      )}
      {enabled.length === 0 && (
        <div className="waiting-card">
          <div className="radar">
            <span></span>
          </div>
          <div>
            <strong>No rules evaluating</strong>
            <span>Alert rules created through the admin API evaluate here and trigger incidents.</span>
          </div>
          <div className="waiting-status">
            <span></span>Idle
          </div>
        </div>
      )}
    </div>
  );
}
