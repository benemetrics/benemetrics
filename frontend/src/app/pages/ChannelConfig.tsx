import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Action } from "../Action";
import { ScreenIntro } from "../ScreenIntro";
import { api, type AlertChannelDto, type AlertRuleDto } from "../../lib/api";
import { loadAllPages } from "../../lib/cursor";
import { notify } from "../../lib/toast";

type ChannelType =
  | "slack"
  | "rocketchat"
  | "email"
  | "webhook"
  | "pagerduty"
  | "opsgenie"
  | "msteams"
  | "victorops";

const TYPE_NAMES: Record<ChannelType, string> = {
  slack: "Slack",
  rocketchat: "Rocket.Chat",
  email: "Email",
  webhook: "Webhook",
  pagerduty: "PagerDuty",
  opsgenie: "Opsgenie",
  msteams: "Microsoft Teams",
  victorops: "VictorOps",
};

const TYPE_MARKS: Record<ChannelType, string> = {
  slack: "S",
  rocketchat: "R",
  email: "@",
  webhook: "↗",
  pagerduty: "P",
  opsgenie: "O",
  msteams: "T",
  victorops: "V",
};

function unwrapOne<T>(response: unknown): T | null {
  if (!response || typeof response !== "object") return null;
  const candidate = response as { data?: T | null; error?: unknown };
  if (candidate.error) return null;
  return candidate.data ?? null;
}

function configString(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  return typeof value === "string" ? value : "";
}

export function ChannelConfig() {
  const navigate = useNavigate();
  const { channelId = "" } = useParams();
  const [channel, setChannel] = useState<AlertChannelDto | null>(null);
  const [rules, setRules] = useState<AlertRuleDto[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [token, setToken] = useState("");
  const [slackChannel, setSlackChannel] = useState("");
  const [routingKey, setRoutingKey] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = unwrapOne<AlertChannelDto>(
          await api.api.admin.alerting.channels[channelId].get(),
        );
        if (cancelled) return;
        if (!loaded) {
          setStatus("error");
          return;
        }
        setChannel(loaded);
        setName(loaded.name);
        setUrl(configString(loaded.config, "url"));
        setWebhookUrl(configString(loaded.config, "webhookUrl"));
        setSecret(configString(loaded.config, "secret"));
        setToken(configString(loaded.config, "token"));
        setSlackChannel(configString(loaded.config, "channel"));
        setStatus("ready");

        const [globalRules, appRules] = await Promise.all([
          loadAllPages<AlertRuleDto>(async (cursor, limit) => {
            const result = await api.api.admin.alerting.rules.get({
              $query: { limit, ...(cursor ? { cursor } : {}) },
            });
            return (result?.data as { data?: AlertRuleDto[] } | null)?.data ?? [];
          }),
          loaded.appId
            ? loadAllPages<AlertRuleDto>(async (cursor, limit) => {
                const result = await api.api.admin.alerting.rules.get({
                  $query: { appId: loaded.appId, limit, ...(cursor ? { cursor } : {}) },
                });
                return (result?.data as { data?: AlertRuleDto[] } | null)?.data ?? [];
              })
            : Promise.resolve([] as AlertRuleDto[]),
        ]);
        if (!cancelled) {
          const byId = new Map<string, AlertRuleDto>();
          for (const rule of globalRules) byId.set(rule.id, rule);
          for (const rule of appRules) byId.set(rule.id, rule);
          setRules([...byId.values()]);
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  const type = (channel?.type ?? "webhook") as ChannelType;
  const usedBy = rules.filter((rule) => rule.channelIds.includes(channelId));

  const save = async () => {
    if (!channel || saving) return;
    let config: Record<string, unknown> = {};
    if (type === "webhook") {
      config = {
        url: url.trim(),
        ...(secret.trim() ? { secret: secret.trim() } : {}),
      };
    }
    if (type === "rocketchat") config = { webhookUrl: webhookUrl.trim() };
    if (type === "slack") {
      config = webhookUrl.trim()
        ? { webhookUrl: webhookUrl.trim() }
        : { token: token.trim(), channel: slackChannel.trim() };
    }
    if (type === "pagerduty") config = { routing_key: routingKey.trim() };
    if (type === "opsgenie") config = { api_key: apiKey.trim() };
    if (type === "msteams") config = { webhookUrl: webhookUrl.trim() };
    if (type === "victorops") {
      config = { api_key: apiKey.trim(), routing_key: routingKey.trim() };
    }
    setSaving(true);
    try {
      const updated = unwrapOne<AlertChannelDto>(
        await api.api.admin.alerting.channels[channelId].patch({
          name: name.trim() || channel.name,
          config,
        }),
      );
      if (!updated) {
        notify("Could not save the channel — the name may already be taken.");
        return;
      }
      notify(`Channel "${updated.name}" saved`);
    } catch {
      notify("Could not reach the backend while saving the channel.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!channel || deleting) return;
    setDeleting(true);
    try {
      const result = await api.api.admin.alerting.channels[channelId].delete();
      if (result?.error) {
        notify("Could not delete the channel.");
        return;
      }
      notify(`Channel "${channel.name}" deleted`);
      navigate("/alerts/channels");
    } catch {
      notify("Could not reach the backend while deleting the channel.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="screen-stack">
      <div
        className="back-link"
        role="button"
        tabIndex={0}
        onClick={() => navigate("/alerts/channels")}
      >
        ← Back to alert channels
      </div>
      <ScreenIntro
        eyebrow="CHANNEL CONFIGURATION"
        title={status === "ready" && channel ? `Configure ${channel.name}` : "Channel"}
        subtitle={
          status === "error"
            ? "This channel could not be loaded — it may have been removed."
            : "Manage credentials and destinations used for alert delivery."
        }
      />
      {status === "ready" && channel && (
        <section className="channel-config-layout">
          <article className="panel channel-config-card">
            <div className="config-section">
              <div className="config-heading">
                <div className={`channel-logo ${type}`}>{TYPE_MARKS[type]}</div>
                <div>
                  <strong>{TYPE_NAMES[type]} connection</strong>
                  <span>{channel.appId ? "App-scoped channel" : "Global channel"}</span>
                </div>
                <div className="connection-status connected">Connected</div>
              </div>
              <div className="form-grid">
                <div className="form-field">
                  <span>Channel name</span>
                  <input
                    className="field-control"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                  <small>An app-scoped channel with this name replaces the global one.</small>
                </div>
                {type === "webhook" && (
                  <>
                    <div className="form-field">
                      <span>Endpoint URL</span>
                      <input
                        className="field-control code-value"
                        value={url}
                        onChange={(event) => setUrl(event.target.value)}
                      />
                    </div>
                    <div className="form-field">
                      <span>Signing secret</span>
                      <input
                        className="field-control code-value"
                        type="password"
                        value={secret}
                        onChange={(event) => setSecret(event.target.value)}
                      />
                      <small>
                        The payload is signed with HMAC-SHA256; the receiver
                        verifies the X-Sentry-Hook-Signature header.
                      </small>
                    </div>
                  </>
                )}
                {type === "rocketchat" && (
                  <div className="form-field">
                    <span>Webhook URL</span>
                    <input
                      className="field-control code-value"
                      value={webhookUrl}
                      onChange={(event) => setWebhookUrl(event.target.value)}
                    />
                  </div>
                )}
                {type === "pagerduty" && (
                  <div className="form-field full">
                    <span>Routing key</span>
                    <input
                      className="field-control code-value"
                      value={routingKey}
                      onChange={(event) => setRoutingKey(event.target.value)}
                    />
                  </div>
                )}
                {type === "opsgenie" && (
                  <div className="form-field full">
                    <span>API key</span>
                    <input
                      className="field-control code-value"
                      type="password"
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                    />
                  </div>
                )}
                {type === "msteams" && (
                  <div className="form-field full">
                    <span>Incoming webhook URL</span>
                    <input
                      className="field-control code-value"
                      value={webhookUrl}
                      onChange={(event) => setWebhookUrl(event.target.value)}
                    />
                  </div>
                )}
                {type === "victorops" && (
                  <>
                    <div className="form-field">
                      <span>API key</span>
                      <input
                        className="field-control code-value"
                        type="password"
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                      />
                    </div>
                    <div className="form-field">
                      <span>Routing key</span>
                      <input
                        className="field-control code-value"
                        value={routingKey}
                        onChange={(event) => setRoutingKey(event.target.value)}
                      />
                    </div>
                  </>
                )}
                {type === "slack" && (
                  <>
                    <div className="form-field full">
                      <span>Incoming webhook URL</span>
                      <input
                        className="field-control code-value"
                        value={webhookUrl}
                        onChange={(event) => setWebhookUrl(event.target.value)}
                      />
                      <small>Leave empty to use the bot token and channel below.</small>
                    </div>
                    {!webhookUrl.trim() && (
                      <>
                        <div className="form-field">
                          <span>Bot token</span>
                          <input
                            className="field-control"
                            type="password"
                            value={token}
                            onChange={(event) => setToken(event.target.value)}
                          />
                        </div>
                        <div className="form-field">
                          <span>Channel</span>
                          <input
                            className="field-control"
                            value={slackChannel}
                            onChange={(event) => setSlackChannel(event.target.value)}
                          />
                        </div>
                      </>
                    )}
                  </>
                )}
                {type === "email" && (
                  <div className="form-field full">
                    <span>Delivery</span>
                    <div className="channel-pick">
                      <span>
                        The email notifier is a stub — alerts routed here report a delivery
                        failure until SMTP support lands.
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="config-section">
              <div className="config-title">
                <strong>Used by</strong>
                <span>
                  {usedBy.length === 0
                    ? "No alert rules reference this channel yet — rules without explicit destinations fall back to every channel in scope."
                    : `${usedBy.length} alert rule${usedBy.length === 1 ? "" : "s"}: ${usedBy
                        .map((rule) => rule.name)
                        .join(", ")}`}
                </span>
              </div>
              <Action variant="soft" onClick={() => navigate("/alerts")}>
                Send a test from a rule
              </Action>
            </div>
            <div className="builder-actions">
              <Action variant="soft" onClick={remove}>
                {deleting ? "Deleting…" : "Delete channel"}
              </Action>
              <Action variant="primary" onClick={save}>
                {saving ? "Saving…" : "Save changes"}
              </Action>
            </div>
          </article>
          <aside className="issue-context">
            <article className="panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Delivery</div>
                  <div className="panel-subtitle">How this channel is used</div>
                </div>
              </div>
              <div className="context-list">
                <div>
                  <span>Type</span>
                  <strong>{channel.type}</strong>
                </div>
                <div>
                  <span>Scope</span>
                  <strong>{channel.appId ? channel.appId.slice(0, 8) : "global"}</strong>
                </div>
                <div>
                  <span>Used by rules</span>
                  <strong>{usedBy.length}</strong>
                </div>
                <div>
                  <span>Updated</span>
                  <strong>{channel.updatedAt.slice(0, 10)}</strong>
                </div>
              </div>
            </article>
          </aside>
        </section>
      )}
    </div>
  );
}
