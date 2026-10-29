import { useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { Btn } from "./ui-kit";
import { cn } from "../lib/utils";

const inputCls =
  "w-full rounded-md border bg-code px-2 py-1.5 text-sm outline-none focus:border-primary";

// Eden wraps non-2xx responses as { status, value: { error } } — surface the
// server's message (e.g. an unauthorized/stale admin token) instead of a guess.
function serverError(res: { error?: unknown }): string | null {
  const err = res.error as { value?: { error?: string } } | undefined;
  return err?.value?.error ?? null;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1 text-xs text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

// The forms own the POST and the pending/error state; the page stays a thin
// wire-up that reacts to onDone (navigate / reload).
function Shell({
  title,
  error,
  onCancel,
  onSubmit,
  canSubmit,
  submitting,
  submitLabel,
  children,
}: {
  title: string;
  error: string | null;
  onCancel: () => void;
  onSubmit: () => void;
  canSubmit: boolean;
  submitting: boolean;
  submitLabel: string;
  children: ReactNode;
}) {
  return (
    <form
      className="panel space-y-3 p-4"
      style={{ boxShadow: "var(--glow)" }}
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit && !submitting) onSubmit();
      }}
    >
      <h3 className="font-semibold">{title}</h3>
      {children}
      {error && <p className="font-mono text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Btn type="button" onClick={onCancel} disabled={submitting}>
          Cancel
        </Btn>
        <Btn
          type="submit"
          variant="primary"
          disabled={!canSubmit || submitting}
          data-submitting={submitting || undefined}
        >
          {submitting ? "Saving…" : submitLabel}
        </Btn>
      </div>
    </form>
  );
}

// Eden's composed tree is not typed through treaty here (same as lib/api.ts),
// so each form declares the record shape it reads back.
interface CreatedProject {
  id: string;
  name: string;
  slug: string;
  description: string;
}

export function ProjectForm({
  onDone,
  onCancel,
}: {
  onDone: (p: CreatedProject) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState({ name: "", description: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const res = await api["api/admin/projects"].post({
      name: f.name.trim(),
      description: f.description.trim() || undefined,
    });
    setSubmitting(false);
    if (res.error) {
      setError(serverError(res) ?? "Failed to create the project.");
      return;
    }
    onDone(res.data as CreatedProject);
  };

  return (
    <Shell
      title="New project"
      error={error}
      onCancel={onCancel}
      onSubmit={submit}
      canSubmit={!!f.name.trim()}
      submitting={submitting}
      submitLabel="Create project"
    >
      <Field label="Name">
        <input
          autoFocus
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
          placeholder="Payments"
          className={inputCls}
        />
      </Field>
      <Field label="Description">
        <input
          value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })}
          placeholder="What ships together"
          className={inputCls}
        />
      </Field>
      <p className="text-xs text-muted-foreground">
        A default testing environment is created with the project.
      </p>
    </Shell>
  );
}

// The backend stores the platform as a free string; these are the SDK ids
// the DSN consumers expect.
const platformOptions = ["javascript", "node", "swift"] as const;

export function AppForm({
  projectId,
  projectName,
  onDone,
  onCancel,
}: {
  projectId: string;
  projectName: string;
  onDone: (a: { id: string; name: string; platform: string }) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState<{
    name: string;
    platform: (typeof platformOptions)[number];
  }>({ name: "", platform: "javascript" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const res = await api["api/admin/projects"][projectId]["apps"].post({
      name: f.name.trim(),
      platform: f.platform,
    });
    setSubmitting(false);
    if (res.error) {
      setError(serverError(res) ?? "Failed to create the app.");
      return;
    }
    onDone(res.data as { id: string; name: string; platform: string });
  };

  return (
    <Shell
      title={`New app in ${projectName}`}
      error={error}
      onCancel={onCancel}
      onSubmit={submit}
      canSubmit={!!f.name.trim()}
      submitting={submitting}
      submitLabel="Create app"
    >
      <Field label="Name">
        <input
          autoFocus
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
          placeholder="Android Shop"
          className={inputCls}
        />
      </Field>
      <div className="space-y-1 text-xs text-muted-foreground">
        Platform
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="Platform"
        >
          {platformOptions.map((p) => (
            <button
              type="button"
              key={p}
              onClick={() => setF({ ...f, platform: p })}
              className={cn(
                "rounded-sm border px-2 py-1 text-xs",
                f.platform === p
                  ? "border-primary text-primary"
                  : "text-muted-foreground",
              )}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        The app gets a public key; the DSN is composed from it on the app
        screen.
      </p>
    </Shell>
  );
}

// The channel types the backend notifiers implement, with the config keys
// each notifier requires (backend/alerting/notifiers.ts).
const channelTypes = [
  "webhook",
  "slack",
  "rocketchat",
  "email",
  "pagerduty",
  "opsgenie",
  "msteams",
  "victorops",
] as const;
type ChannelType = (typeof channelTypes)[number];

const channelFields: Record<
  ChannelType,
  { key: string; label: string; placeholder: string }[]
> = {
  webhook: [
    {
      key: "url",
      label: "Webhook URL",
      placeholder: "https://hooks.company.dev/alerts",
    },
  ],
  slack: [
    { key: "token", label: "Bot token", placeholder: "xoxb-…" },
    { key: "channel", label: "Channel", placeholder: "#alerts" },
  ],
  rocketchat: [
    {
      key: "webhookUrl",
      label: "Webhook URL",
      placeholder: "https://chat.company.dev/hooks/…",
    },
  ],
  email: [
    { key: "host", label: "SMTP host", placeholder: "smtp.company.dev" },
    { key: "from", label: "From", placeholder: "alerts@company.dev" },
    { key: "to", label: "To", placeholder: "oncall@company.dev" },
  ],
  pagerduty: [
    {
      key: "routing_key",
      label: "Routing key",
      placeholder: "Events API v2 routing key",
    },
  ],
  opsgenie: [{ key: "api_key", label: "API key", placeholder: "Genie key" }],
  msteams: [
    {
      key: "webhookUrl",
      label: "Webhook URL",
      placeholder: "Office connector URL",
    },
  ],
  victorops: [
    { key: "api_key", label: "API key", placeholder: "VictorOps API id" },
    {
      key: "routing_key",
      label: "Routing key",
      placeholder: "Team routing key",
    },
  ],
};

export function ChannelForm({
  projectId,
  onDone,
  onCancel,
}: {
  projectId: string;
  onDone: (c: { id: string; name: string; type: string }) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState<{
    type: ChannelType;
    name: string;
    config: Record<string, string>;
  }>({ type: "webhook", name: "", config: {} });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fields = channelFields[f.type];
  const configComplete = fields.every(
    (field) => (f.config[field.key] ?? "").trim().length > 0,
  );

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const res = await api["api/admin/alerting"]["channels"].post({
      name: f.name.trim(),
      type: f.type,
      config: Object.fromEntries(
        fields.map((field) => [field.key, f.config[field.key]!.trim()]),
      ),
      projectId,
    });
    setSubmitting(false);
    if (res.error) {
      setError(
        serverError(res) ??
          "Failed to create the channel — check the config values.",
      );
      return;
    }
    onDone(res.data as { id: string; name: string; type: string });
  };

  return (
    <Shell
      title="New alert channel"
      error={error}
      onCancel={onCancel}
      onSubmit={submit}
      canSubmit={!!f.name.trim() && configComplete}
      submitting={submitting}
      submitLabel="Add channel"
    >
      <div className="flex flex-wrap gap-2">
        {channelTypes.map((t) => (
          <button
            type="button"
            key={t}
            onClick={() => setF({ ...f, type: t })}
            className={cn(
              "rounded-sm border px-2 py-1 text-xs capitalize",
              f.type === t
                ? "border-primary text-primary"
                : "text-muted-foreground",
            )}
          >
            {t}
          </button>
        ))}
      </div>
      <Field label="Name">
        <input
          autoFocus
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
          placeholder="On-call team"
          className={inputCls}
        />
      </Field>
      {fields.map((field) => (
        <Field key={field.key} label={field.label}>
          <input
            value={f.config[field.key] ?? ""}
            onChange={(e) =>
              setF({
                ...f,
                config: { ...f.config, [field.key]: e.target.value },
              })
            }
            placeholder={field.placeholder}
            className={cn(inputCls, "font-mono text-xs")}
          />
        </Field>
      ))}
    </Shell>
  );
}
