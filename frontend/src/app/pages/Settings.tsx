import { useEffect, useState } from "react";
import { Action } from "../Action.tsx";
import { ScreenIntro } from "../ScreenIntro.tsx";
import {
  api,
  type EventsTtlDto,
  type EventsTtlUnit,
  type PermissionRuleDto,
  type PermissionUserDto,
} from "../../lib/api.ts";
import { notify } from "../../lib/toast.ts";

// Settings → Permissions: the admin-token-only management surface for the
// OIDC read permissions enforced by the backend. Group rules map an
// identity-provider group to a read scope (environment names + app-name
// prefixes); the whitelist overrides the group assignment for one email.
// Without a matching grant users are prompted for the admin token.
//
// Settings → Event retention: the ClickHouse events table declares a TTL
// inside its definition. The panel reads the live value back from the table
// and lets an admin replace it (`ALTER TABLE ... MODIFY TTL`).

interface ScopeWriteInput {
  name: string;
  environments: string[];
  appPrefixes: string[];
}

interface ScopeRow {
  id: string;
  name: string;
  environments: string[];
  appPrefixes: string[];
  enabled: boolean;
}

function parseList(text: string): string[] {
  return text
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function listText(values: string[]): string {
  return values.join(", ");
}

function scopeSummary(row: ScopeRow): string {
  const parts: string[] = [];
  if (row.environments.length > 0) {
    parts.push(`environments: ${listText(row.environments)}`);
  }
  if (row.appPrefixes.length > 0) {
    parts.push(`apps: ${listText(row.appPrefixes.map((prefix) => `${prefix}*`))}`);
  }
  if (parts.length === 0) return "No scope — reads nothing";
  return parts.join(" · ");
}

function ScopeSection({
  title,
  subtitle,
  nameLabel,
  namePlaceholder,
  entries,
  status,
  emptyText,
  readOnly,
  onCreate,
  onUpdate,
  onDelete,
}: {
  title: string;
  subtitle: string;
  nameLabel: string;
  namePlaceholder: string;
  entries: ScopeRow[];
  status: "loading" | "ready" | "error";
  emptyText: string;
  readOnly: boolean;
  onCreate: (input: ScopeWriteInput) => Promise<void>;
  onUpdate: (id: string, input: ScopeWriteInput & { enabled: boolean }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [environments, setEnvironments] = useState("");
  const [appPrefixes, setAppPrefixes] = useState("");
  const [saving, setSaving] = useState(false);

  const editing = entries.find((entry) => entry.id === editingId) ?? null;
  const formOpen = creating || editing !== null;

  const openCreate = () => {
    setEditingId(null);
    setName("");
    setEnvironments("");
    setAppPrefixes("");
    setCreating(true);
  };

  const openEdit = (entry: ScopeRow) => {
    setCreating(false);
    setEditingId(entry.id);
    setName(entry.name);
    setEnvironments(listText(entry.environments));
    setAppPrefixes(listText(entry.appPrefixes));
  };

  const close = () => {
    setCreating(false);
    setEditingId(null);
  };

  const save = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      notify(`Give the ${nameLabel.toLowerCase()} a name first.`);
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      const input: ScopeWriteInput = {
        name: trimmedName,
        environments: parseList(environments),
        appPrefixes: parseList(appPrefixes),
      };
      if (editing) {
        await onUpdate(editing.id, { ...input, enabled: editing.enabled });
      } else {
        await onCreate(input);
      }
      close();
    } catch (error) {
      notify(
        error instanceof Error && error.message
          ? error.message
          : "Could not reach the backend — check the admin token.",
      );
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (entry: ScopeRow) => {
    try {
      await onUpdate(entry.id, {
        name: entry.name,
        environments: entry.environments,
        appPrefixes: entry.appPrefixes,
        enabled: !entry.enabled,
      });
    } catch {
      notify("Could not update the entry — check the admin token.");
    }
  };

  const remove = async (entry: ScopeRow) => {
    try {
      await onDelete(entry.id);
      if (editingId === entry.id) close();
    } catch {
      notify("Could not remove the entry — check the admin token.");
    }
  };

  return (
    <article className="panel list-screen permissions">
      <div className="panel-header">
        <div>
          <div className="panel-title">{title}</div>
          <div className="panel-subtitle">{subtitle}</div>
        </div>
        {!readOnly && (
          <Action variant={formOpen ? "soft" : "primary"} onClick={formOpen ? close : openCreate}>
            {formOpen ? "Cancel" : <><span className="plus">+</span>{`Add ${nameLabel}`}</>}
          </Action>
        )}
      </div>

      {formOpen && !readOnly && (
        <div className="permission-form">
          <div className="form-grid">
            <div className="form-field">
              <span>{nameLabel}</span>
              <input
                className="field-control"
                placeholder={namePlaceholder}
                value={name}
                autoFocus
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="form-field">
              <span>Environment names</span>
              <input
                className="field-control"
                placeholder="production, staging"
                value={environments}
                onChange={(event) => setEnvironments(event.target.value)}
              />
            </div>
            <div className="form-field full">
              <span>App name prefixes</span>
              <input
                className="field-control"
                placeholder="checkout, payments"
                value={appPrefixes}
                onChange={(event) => setAppPrefixes(event.target.value)}
              />
              <small>
                Comma-separated. Users read an app when its name starts with one
                of the prefixes, or when the app lives in one of the listed
                environments. Matching is case-insensitive.
              </small>
            </div>
          </div>
          <div className="builder-actions">
            <Action variant="soft" onClick={close}>
              Cancel
            </Action>
            <Action variant="primary" onClick={save}>
              {saving ? "Saving…" : editing ? "Save changes" : `Add ${nameLabel}`}
            </Action>
          </div>
        </div>
      )}

      <div className="list-screen-head">
        <strong>{nameLabel}</strong>
        <span>Scope</span>
        <span>Status</span>
        <span>Actions</span>
      </div>
      {entries.map((entry) => (
        <div className="list-screen-row" key={entry.id}>
          <strong>{entry.name}</strong>
          <span>{scopeSummary(entry)}</span>
          <span className={`table-status ${entry.enabled ? "" : "draft"}`}>
            <i />
            {entry.enabled ? "Active" : "Disabled"}
          </span>
          <span className="row-actions">
            {!readOnly && (
              <>
                <span
                  className="row-action"
                  role="button"
                  tabIndex={0}
                  onClick={() => openEdit(entry)}
                  onKeyDown={(event) => event.key === "Enter" && openEdit(entry)}
                >
                  Edit
                </span>
                <span
                  className="row-action"
                  role="button"
                  tabIndex={0}
                  onClick={() => toggle(entry)}
                  onKeyDown={(event) => event.key === "Enter" && toggle(entry)}
                >
                  {entry.enabled ? "Disable" : "Enable"}
                </span>
                <span
                  className="row-action danger"
                  role="button"
                  tabIndex={0}
                  onClick={() => remove(entry)}
                  onKeyDown={(event) => event.key === "Enter" && remove(entry)}
                >
                  Remove
                </span>
              </>
            )}
          </span>
        </div>
      ))}
      {status !== "ready" && (
        <div className="list-screen-row">
          <strong>{status === "loading" ? "Loading…" : "Could not load permissions"}</strong>
          <span>—</span>
          <span>—</span>
          <span>—</span>
        </div>
      )}
      {status === "ready" && entries.length === 0 && (
        <div className="list-screen-row">
          <strong>{emptyText}</strong>
          <span>—</span>
          <span>—</span>
          <span>—</span>
        </div>
      )}
    </article>
  );
}

const TTL_UNIT_OPTIONS: Array<{ value: EventsTtlUnit; label: string }> = [
  { value: "SECOND", label: "Seconds" },
  { value: "MINUTE", label: "Minutes" },
  { value: "HOUR", label: "Hours" },
  { value: "DAY", label: "Days" },
  { value: "WEEK", label: "Weeks" },
  { value: "MONTH", label: "Months" },
  { value: "YEAR", label: "Years" },
];

function retentionLabel(ttl: EventsTtlDto): string {
  if (!ttl.interval) {
    return ttl.expression ? ttl.expression : "No TTL — events are kept indefinitely";
  }
  const unit = ttl.interval.unit.toLowerCase();
  return `${ttl.interval.amount} ${unit}${ttl.interval.amount === 1 ? "" : "s"}`;
}

function EventsTtlSection() {
  const [ttl, setTtl] = useState<EventsTtlDto | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [amount, setAmount] = useState("1");
  const [unit, setUnit] = useState<EventsTtlUnit>("MONTH");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await api.api.admin.settings["events-ttl"].get();
        if (cancelled) return;
        const body = (result?.data as EventsTtlDto | null | undefined) ?? null;
        if (result?.error || !body) {
          setStatus("error");
          return;
        }
        setTtl(body);
        if (body.interval) {
          setAmount(String(body.interval.amount));
          setUnit(body.interval.unit);
        }
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    const parsed = Number(amount);
    if (!Number.isInteger(parsed) || parsed < 1) {
      notify("Enter a whole number of time units (at least 1).");
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      const result = await api.api.admin.settings["events-ttl"].put({
        amount: parsed,
        unit,
      });
      const updated = (result?.data as EventsTtlDto | null | undefined) ?? null;
      if (result?.error || !updated) {
        throw new Error("Could not update the event retention.");
      }
      setTtl(updated);
      if (updated.interval) {
        setAmount(String(updated.interval.amount));
        setUnit(updated.interval.unit);
      }
      notify(`Event retention set to ${retentionLabel(updated)}`);
    } catch (error) {
      notify(
        error instanceof Error && error.message
          ? error.message
          : "Could not update the event retention — check the admin token.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className="panel">
      <div className="panel-header">
        <div>
          <div className="panel-title">Event retention</div>
          <div className="panel-subtitle">
            TTL declared on the ClickHouse events table — expired events are
            dropped as ClickHouse compacts their parts.
          </div>
        </div>
      </div>
      {status === "ready" && ttl ? (
        <div className="permission-form">
          <div className="form-grid">
            <div className="form-field">
              <span>Keep events for</span>
              <input
                className="field-control"
                type="number"
                min={1}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className="form-field">
              <span>Unit</span>
              <select
                className="field-control"
                value={unit}
                onChange={(event) => setUnit(event.target.value as EventsTtlUnit)}
              >
                {TTL_UNIT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field full">
              <small>
                Current TTL: <strong>{retentionLabel(ttl)}</strong>
                {ttl.expression ? ` — ${ttl.expression}` : ""}. Read from the
                definition of <code>{ttl.table}</code>; saving rewrites it with{" "}
                <code>ALTER TABLE … MODIFY TTL</code>.
              </small>
            </div>
          </div>
          <div className="builder-actions">
            <Action variant="primary" onClick={save}>
              {saving ? "Saving…" : "Save retention"}
            </Action>
          </div>
        </div>
      ) : (
        <div className="permission-note">
          <p>
            {status === "loading"
              ? "Loading the current event retention…"
              : "Could not read the event retention — the admin token is required."}
          </p>
        </div>
      )}
    </article>
  );
}

export function Settings() {
  const [rules, setRules] = useState<PermissionRuleDto[]>([]);
  const [users, setUsers] = useState<PermissionUserDto[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await api.api.admin.permissions.get();
        if (cancelled) return;
        const body = result?.data as
          | { rules?: PermissionRuleDto[]; users?: PermissionUserDto[] }
          | null
          | undefined;
        setRules(body?.rules ?? []);
        setUsers(body?.users ?? []);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const createRule = async (input: ScopeWriteInput) => {
    const result = await api.api.admin.permissions.rules.post({
      groupName: input.name,
      environments: input.environments,
      appPrefixes: input.appPrefixes,
    });
    const created = (result?.data as PermissionRuleDto | null) ?? null;
    if (!created?.id) {
      throw new Error("Could not create the group rule — is the group already configured?");
    }
    setRules((current) => [created, ...current]);
    notify(`Group rule "${created.groupName}" added`);
  };

  const updateRule = async (id: string, input: ScopeWriteInput & { enabled: boolean }) => {
    const result = await api.api.admin.permissions.rules({ id }).patch({
      groupName: input.name,
      environments: input.environments,
      appPrefixes: input.appPrefixes,
      isEnabled: input.enabled,
    });
    const updated = (result?.data as PermissionRuleDto | null) ?? null;
    if (!updated?.id) throw new Error("Could not save the group rule.");
    setRules((current) => current.map((rule) => (rule.id === updated.id ? updated : rule)));
  };

  const removeRule = async (id: string) => {
    const result = await api.api.admin.permissions.rules({ id }).delete();
    if (result?.error) throw new Error("Could not remove the group rule.");
    setRules((current) => current.filter((rule) => rule.id !== id));
    notify("Group rule removed");
  };

  const createUser = async (input: ScopeWriteInput) => {
    const result = await api.api.admin.permissions.users.post({
      email: input.name,
      environments: input.environments,
      appPrefixes: input.appPrefixes,
    });
    const created = (result?.data as PermissionUserDto | null) ?? null;
    if (!created?.id) {
      throw new Error("Could not add the whitelist entry — is the email already listed?");
    }
    setUsers((current) => [created, ...current]);
    notify(`Whitelist entry for ${created.email} added`);
  };

  const updateUser = async (id: string, input: ScopeWriteInput & { enabled: boolean }) => {
    const result = await api.api.admin.permissions.users({ id }).patch({
      email: input.name,
      environments: input.environments,
      appPrefixes: input.appPrefixes,
      isEnabled: input.enabled,
    });
    const updated = (result?.data as PermissionUserDto | null) ?? null;
    if (!updated?.id) throw new Error("Could not save the whitelist entry.");
    setUsers((current) =>
      current.map((entry) => (entry.id === updated.id ? updated : entry)),
    );
  };

  const removeUser = async (id: string) => {
    const result = await api.api.admin.permissions.users({ id }).delete();
    if (result?.error) throw new Error("Could not remove the whitelist entry.");
    setUsers((current) => current.filter((entry) => entry.id !== id));
    notify("Whitelist entry removed");
  };

  const toRuleRow = (rule: PermissionRuleDto): ScopeRow => ({
    id: rule.id,
    name: rule.groupName,
    environments: rule.environments,
    appPrefixes: rule.appPrefixes,
    enabled: rule.enabled,
  });

  const toUserRow = (user: PermissionUserDto): ScopeRow => ({
    id: user.id,
    name: user.email,
    environments: user.environments,
    appPrefixes: user.appPrefixes,
    enabled: user.enabled,
  });

  return (
    <div className="screen-stack">
      <ScreenIntro
        eyebrow="SETTINGS"
        title="Settings"
        subtitle="Scoped read access for identity-provider (OIDC/OAuth2) users, and the retention of the stored ClickHouse events. Managing either always requires the admin token."
      />
      <article className="panel permission-note">
        <p>
          A signed-in user reads the apps whose name starts with one of the
          rule's app prefixes, and the apps in the environments whose name
          matches one of the listed environment names. Groups are matched
          case-insensitively; a user in several groups gets the union of their
          scopes. A whitelist entry replaces the group assignment for that
          email. Users without a matching grant are asked for the admin token —
          which always has full access.
        </p>
      </article>
      <ScopeSection
        title="Group rules"
        subtitle="Grant a read scope to everyone in an identity-provider group."
        nameLabel="Group"
        namePlaceholder="engineering"
        entries={rules.map(toRuleRow)}
        status={status}
        emptyText="No group rules"
        readOnly={false}
        onCreate={createRule}
        onUpdate={updateRule}
        onDelete={removeRule}
      />
      <ScopeSection
        title="User whitelist"
        subtitle="Override the group assignment for one email address."
        nameLabel="Email"
        namePlaceholder="dev@company.com"
        entries={users.map(toUserRow)}
        status={status}
        emptyText="No whitelist entries"
        readOnly={false}
        onCreate={createUser}
        onUpdate={updateUser}
        onDelete={removeUser}
      />
      <EventsTtlSection />
    </div>
  );
}
