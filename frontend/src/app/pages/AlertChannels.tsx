import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Action } from "../Action";
import { ScreenIntro } from "../ScreenIntro";
import { api, type AlertChannelDto } from "../../lib/api";
import { notify } from "../../lib/toast";

type ChannelType = "slack" | "rocketchat" | "email" | "webhook";

const CHANNEL_TYPES: Array<{
  type: ChannelType;
  name: string;
  mark: string;
  copy: string;
}> = [
  {
    type: "slack",
    name: "Slack",
    mark: "S",
    copy: "Incoming webhook URL, or a bot token with a channel.",
  },
  {
    type: "rocketchat",
    name: "Rocket.Chat",
    mark: "R",
    copy: "Route alerts into your Rocket.Chat workspace.",
  },
  {
    type: "email",
    name: "Email",
    mark: "@",
    copy: "SMTP delivery is planned; the notifier is a stub for now.",
  },
  {
    type: "webhook",
    name: "Webhook",
    mark: "↗",
    copy: "Post the alert payload to a custom HTTP endpoint.",
  },
];

function unwrapList<T>(response: unknown): T[] {
  if (!response || typeof response !== "object") return [];
  const candidate = response as { data?: { data?: T[] } | null; error?: unknown };
  if (candidate.error) return [];
  return candidate.data?.data ?? [];
}

function unwrapOne<T>(response: unknown): T | null {
  if (!response || typeof response !== "object") return null;
  const candidate = response as { data?: T | null; error?: unknown };
  if (candidate.error) return null;
  return candidate.data ?? null;
}

export function AlertChannels() {
  const navigate = useNavigate();
  const [channels, setChannels] = useState<AlertChannelDto[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [formType, setFormType] = useState<ChannelType | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [token, setToken] = useState("");
  const [slackChannel, setSlackChannel] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api.api.admin.alerting.channels.get();
      setChannels(unwrapList<AlertChannelDto>(result));
      setStatus("ready");
    } catch {
      setStatus((current) => (current === "ready" ? current : "error"));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openForm = (type: ChannelType) => {
    setFormType(type);
    setName("");
    setUrl("");
    setWebhookUrl("");
    setToken("");
    setSlackChannel("");
  };

  const create = async () => {
    if (!formType || saving) return;
    const meta = CHANNEL_TYPES.find((item) => item.type === formType)!;
    const count = channels.filter((channel) => channel.type === formType).length;
    const channelName = name.trim() || `${formType}-${count + 1}`;
    let config: Record<string, unknown> = {};
    if (formType === "webhook") config = { url: url.trim() };
    if (formType === "rocketchat") config = { webhookUrl: webhookUrl.trim() };
    if (formType === "slack") {
      config = webhookUrl.trim()
        ? { webhookUrl: webhookUrl.trim() }
        : { token: token.trim(), channel: slackChannel.trim() };
    }
    setSaving(true);
    try {
      const created = unwrapOne<AlertChannelDto>(
        await api.api.admin.alerting.channels.post({
          name: channelName,
          type: formType,
          config,
        }),
      );
      if (!created) {
        notify(`Could not connect "${channelName}" — the name may already be taken.`);
        return;
      }
      notify(`Channel "${channelName}" connected`);
      setFormType(null);
      await load();
    } catch {
      notify(`Could not reach the backend while connecting ${meta.name}.`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="screen-stack">
      <div className="back-link" role="button" tabIndex={0} onClick={() => navigate("/alerts")}>
        ← Back to alerts
      </div>
      <ScreenIntro
        eyebrow="ALERT ROUTING"
        title="Alert channels"
        subtitle="Connect destinations and decide where notifications are delivered."
      />
      <section className="channels-grid">
        {CHANNEL_TYPES.map((meta) => {
          const list = channels.filter((channel) => channel.type === meta.type);
          const connected = list.length > 0;
          return (
            <article className="channel-card" key={meta.type}>
              <div className={`channel-logo ${meta.type}`}>{meta.mark}</div>
              <div className="channel-card-copy">
                <strong>{meta.name}</strong>
                <span>{meta.copy}</span>
                {list.map((channel) => (
                  <span
                    key={channel.id}
                    className="channel-name-pill"
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/alerts/channels/${channel.id}`)}
                    onKeyDown={(event) =>
                      event.key === "Enter" && navigate(`/alerts/channels/${channel.id}`)
                    }
                  >
                    {channel.name}
                    {channel.appId ? " · app" : ""}
                  </span>
                ))}
              </div>
              <div className={`connection-status ${connected ? "connected" : ""}`}>
                {connected ? `${list.length} connected` : status === "loading" ? "…" : "Not connected"}
              </div>
              <Action
                variant={connected ? "soft" : "primary"}
                onClick={() =>
                  connected
                    ? navigate(`/alerts/channels/${[...list].sort((a, b) => a.name.localeCompare(b.name))[0]!.id}`)
                    : openForm(meta.type)
                }
              >
                {connected ? "Configure" : "Connect"}
              </Action>
            </article>
          );
        })}
      </section>

      {formType && (
        <article className="panel channel-config-card">
          <div className="config-heading">
            <div className={`channel-logo ${formType}`}>
              {CHANNEL_TYPES.find((item) => item.type === formType)!.mark}
            </div>
            <div>
              <strong>Connect {CHANNEL_TYPES.find((item) => item.type === formType)!.name} channel</strong>
              <span>Credentials are stored in the channel config and used by the notifier.</span>
            </div>
            <div className="connection-status">Draft</div>
          </div>
          <div className="form-grid">
            <div className="form-field">
              <span>Channel name</span>
              <input
                className="field-control"
                placeholder={`${formType}-${channels.filter((channel) => channel.type === formType).length + 1}`}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <small>Names are unique per scope; an app-scoped channel overrides a global one.</small>
            </div>
            {formType === "webhook" && (
              <div className="form-field">
                <span>Endpoint URL</span>
                <input
                  className="field-control code-value"
                  placeholder="https://example.com/hooks/sentry"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                />
              </div>
            )}
            {formType === "rocketchat" && (
              <div className="form-field">
                <span>Webhook URL</span>
                <input
                  className="field-control code-value"
                  placeholder="https://chat.example.com/hooks/…"
                  value={webhookUrl}
                  onChange={(event) => setWebhookUrl(event.target.value)}
                />
              </div>
            )}
            {formType === "slack" && (
              <>
                <div className="form-field full">
                  <span>Incoming webhook URL</span>
                  <input
                    className="field-control code-value"
                    placeholder="https://hooks.slack.com/services/…"
                    value={webhookUrl}
                    onChange={(event) => setWebhookUrl(event.target.value)}
                  />
                  <small>Leave empty to use a bot token with a channel instead.</small>
                </div>
                {!webhookUrl.trim() && (
                  <>
                    <div className="form-field">
                      <span>Bot token</span>
                      <input
                        className="field-control"
                        type="password"
                        placeholder="xoxb-…"
                        value={token}
                        onChange={(event) => setToken(event.target.value)}
                      />
                    </div>
                    <div className="form-field">
                      <span>Channel</span>
                      <input
                        className="field-control"
                        placeholder="#incidents"
                        value={slackChannel}
                        onChange={(event) => setSlackChannel(event.target.value)}
                      />
                    </div>
                  </>
                )}
              </>
            )}
            {formType === "email" && (
              <div className="form-field full">
                <span>Delivery</span>
                <div className="channel-pick">
                  <span>
                    The email notifier is a stub — alerts routed here report a delivery failure
                    until SMTP support lands.
                  </span>
                </div>
              </div>
            )}
          </div>
          <div className="builder-actions">
            <Action variant="soft" onClick={() => setFormType(null)}>
              Cancel
            </Action>
            <Action variant="primary" onClick={create}>
              {saving ? "Connecting…" : "Connect channel"}
            </Action>
          </div>
        </article>
      )}

      <article className="panel routing-defaults">
        <div>
          <strong>Default routing</strong>
          <span>
            Alert rules without explicit destinations notify every channel in scope. Only the
            webhook, Slack, and Rocket.Chat notifiers deliver today.
          </span>
        </div>
        <Action variant="soft" onClick={() => navigate("/alerts")}>
          View alert rules
        </Action>
      </article>
    </div>
  );
}
