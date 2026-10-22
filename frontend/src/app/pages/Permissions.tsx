import { useCallback, useEffect, useState } from "react";
import { Action } from "../Action";
import { ScreenIntro } from "../ScreenIntro";
import {
  api,
  listPermissionAudit,
  listPermissionGrants,
  listPermissionRules,
  type PermissionAuditDto,
  type PermissionGrantDto,
  type PermissionRuleDto,
} from "../../lib/api";
import { notify } from "../../lib/toast";
import { relativeTime } from "../../lib/utils";

function ago(iso: string): string {
  return relativeTime(iso).replace(/^seen /, "");
}

/** The scope inputs are comma separated lists. */
function splitList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function scopeText(environments: string[], appPrefixes: string[]): string {
  const parts: string[] = [];
  if (environments.length > 0) parts.push(`env: ${environments.join(", ")}`);
  if (appPrefixes.length > 0) parts.push(`apps: ${appPrefixes.join(", ")}`);
  return parts.length > 0 ? parts.join(" · ") : "read nothing";
}

export function Permissions() {
  const [rules, setRules] = useState<PermissionRuleDto[]>([]);
  const [grants, setGrants] = useState<PermissionGrantDto[]>([]);
  const [audit, setAudit] = useState<PermissionAuditDto[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);

  // The group rule form.
  const [ruleName, setRuleName] = useState("");
  const [ruleEnvironments, setRuleEnvironments] = useState("");
  const [rulePrefixes, setRulePrefixes] = useState("");

  // The identity grant form.
  const [grantId, setGrantId] = useState("");
  const [grantLabel, setGrantLabel] = useState("");
  const [grantEnvironments, setGrantEnvironments] = useState("");
  const [grantPrefixes, setGrantPrefixes] = useState("");
  const [grantCanWrite, setGrantCanWrite] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ruleRows, grantRows, auditRows] = await Promise.all([
        listPermissionRules(),
        listPermissionGrants(),
        listPermissionAudit(),
      ]);
      setRules(ruleRows);
      setGrants(grantRows);
      setAudit(auditRows);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createRule = async () => {
    const name = ruleName.trim();
    if (!name) {
      notify("Give the group rule a name first.");
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      await api.api.admin.permissions.rules.post({
        name,
        environments: splitList(ruleEnvironments),
        appPrefixes: splitList(rulePrefixes),
      });
      setRuleName("");
      setRuleEnvironments("");
      setRulePrefixes("");
      notify("Group rule created.");
      await load();
    } catch {
      notify("Could not create the group rule.");
    } finally {
      setBusy(false);
    }
  };

  const createGrant = async () => {
    const identityId = grantId.trim();
    if (!identityId) {
      notify("Give the identity id first.");
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      await api.api.admin.permissions.grants.post({
        identityId,
        label: grantLabel.trim() || undefined,
        environments: splitList(grantEnvironments),
        appPrefixes: splitList(grantPrefixes),
        canWrite: grantCanWrite,
      });
      setGrantId("");
      setGrantLabel("");
      setGrantEnvironments("");
      setGrantPrefixes("");
      setGrantCanWrite(false);
      notify("Grant created.");
      await load();
    } catch {
      notify("Could not create the grant.");
    } finally {
      setBusy(false);
    }
  };

  const toggleRule = async (rule: PermissionRuleDto) => {
    setBusy(true);
    try {
      await api.api.admin.permissions.rules[rule.id].patch({
        isEnabled: !rule.isEnabled,
      });
      await load();
    } catch {
      notify("Could not update the group rule.");
    } finally {
      setBusy(false);
    }
  };

  const toggleGrant = async (grant: PermissionGrantDto) => {
    setBusy(true);
    try {
      await api.api.admin.permissions.grants[grant.id].patch({
        isEnabled: !grant.isEnabled,
      });
      await load();
    } catch {
      notify("Could not update the grant.");
    } finally {
      setBusy(false);
    }
  };

  const removeRule = async (rule: PermissionRuleDto) => {
    setBusy(true);
    try {
      await api.api.admin.permissions.rules[rule.id].delete();
      notify("Group rule removed.");
      await load();
    } catch {
      notify("Could not remove the group rule.");
    } finally {
      setBusy(false);
    }
  };

  const removeGrant = async (grant: PermissionGrantDto) => {
    setBusy(true);
    try {
      await api.api.admin.permissions.grants[grant.id].delete();
      notify("Grant removed.");
      await load();
    } catch {
      notify("Could not remove the grant.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen-stack">
      <ScreenIntro
        eyebrow="ACCESS CONTROL"
        title="Permissions"
        subtitle="Read access for verified identities: a group rule grants a scope to everyone in a group, an identity grant overrides the groups for one identity."
      />

      <article className="panel builder-card">
        <div className="panel-header">
          <div>
            <div className="panel-title">New group rule</div>
            <div className="panel-subtitle">
              Everyone whose token carries the group gets the scope.
            </div>
          </div>
        </div>
        <div className="form-grid">
          <div className="form-field">
            <span>Group</span>
            <input
              className="field-control"
              placeholder="backend-team"
              value={ruleName}
              onChange={(event) => setRuleName(event.target.value)}
            />
          </div>
          <div className="form-field">
            <span>Environments</span>
            <input
              className="field-control"
              placeholder="production, staging"
              value={ruleEnvironments}
              onChange={(event) => setRuleEnvironments(event.target.value)}
            />
          </div>
          <div className="form-field full">
            <span>App name prefixes</span>
            <input
              className="field-control"
              placeholder="api-, worker-"
              value={rulePrefixes}
              onChange={(event) => setRulePrefixes(event.target.value)}
            />
            <small>
              An environment grant exposes every app in it; a prefix grant exposes the matching
              apps wherever they live.
            </small>
          </div>
        </div>
        <div className="builder-actions">
          <Action variant="primary" onClick={createRule}>
            {busy ? "Saving…" : "Create group rule"}
          </Action>
        </div>
      </article>

      <article className="panel list-screen">
        <div className="list-screen-head">
          <strong>Group rule</strong>
          <span>Scope</span>
          <span>State</span>
          <span>Detail</span>
        </div>
        {rules.map((rule) => (
          <div className="list-screen-row" key={rule.id}>
            <span className="flag-cell">
              <strong>{rule.name}</strong>
              <span>{ago(rule.createdAt)}</span>
            </span>
            <span>{scopeText(rule.environments, rule.appPrefixes)}</span>
            <span>{rule.isEnabled ? "enabled" : "disabled"}</span>
            <span className="row-action">
              <Action variant="ghost" onClick={() => toggleRule(rule)}>
                {rule.isEnabled ? "Disable" : "Enable"}
              </Action>
              <Action variant="ghost" onClick={() => removeRule(rule)}>
                Delete
              </Action>
            </span>
          </div>
        ))}
        {status === "ready" && rules.length === 0 && (
          <div className="list-screen-row">
            <strong>No group rules</strong>
            <span>—</span>
            <span>—</span>
            <span>—</span>
          </div>
        )}
        {status === "loading" && (
          <div className="list-screen-row">
            <strong>Loading permissions…</strong>
            <span>—</span>
            <span>—</span>
            <span>—</span>
          </div>
        )}
        {status === "error" && (
          <div className="list-screen-row">
            <strong>Could not load the permissions</strong>
            <span>—</span>
            <span>—</span>
            <span>—</span>
          </div>
        )}
      </article>

      <article className="panel builder-card">
        <div className="panel-header">
          <div>
            <div className="panel-title">New identity grant</div>
            <div className="panel-subtitle">
              One identity id gets the scope, whatever its groups are.
            </div>
          </div>
        </div>
        <div className="form-grid">
          <div className="form-field">
            <span>Identity id</span>
            <input
              className="field-control"
              placeholder="https://issuer|user-1"
              value={grantId}
              onChange={(event) => setGrantId(event.target.value)}
            />
          </div>
          <div className="form-field">
            <span>Label</span>
            <input
              className="field-control"
              placeholder="Alice"
              value={grantLabel}
              onChange={(event) => setGrantLabel(event.target.value)}
            />
          </div>
          <div className="form-field">
            <span>Environments</span>
            <input
              className="field-control"
              placeholder="production"
              value={grantEnvironments}
              onChange={(event) => setGrantEnvironments(event.target.value)}
            />
          </div>
          <div className="form-field">
            <span>App name prefixes</span>
            <input
              className="field-control"
              placeholder="api-"
              value={grantPrefixes}
              onChange={(event) => setGrantPrefixes(event.target.value)}
            />
          </div>
          <div className="form-field full">
            <label className="channel-pick">
              <input
                type="checkbox"
                checked={grantCanWrite}
                onChange={(event) => setGrantCanWrite(event.target.checked)}
              />
              <span>Allow writes</span>
            </label>
            <small>
              A writer may change the admin data; without this the identity only reads its
              scope.
            </small>
          </div>
        </div>
        <div className="builder-actions">
          <Action variant="primary" onClick={createGrant}>
            {busy ? "Saving…" : "Create grant"}
          </Action>
        </div>
      </article>

      <article className="panel list-screen">
        <div className="list-screen-head">
          <strong>Identity grant</strong>
          <span>Scope</span>
          <span>State</span>
          <span>Detail</span>
        </div>
        {grants.map((grant) => (
          <div className="list-screen-row" key={grant.id}>
            <span className="flag-cell">
              <strong>{grant.label || grant.identityId}</strong>
              <span>{grant.label ? grant.identityId : ago(grant.createdAt)}</span>
            </span>
            <span>{scopeText(grant.environments, grant.appPrefixes)}</span>
            <span>
              {grant.isEnabled ? "enabled" : "disabled"}
              {grant.canWrite ? " · writer" : ""}
            </span>
            <span className="row-action">
              <Action variant="ghost" onClick={() => toggleGrant(grant)}>
                {grant.isEnabled ? "Disable" : "Enable"}
              </Action>
              <Action variant="ghost" onClick={() => removeGrant(grant)}>
                Delete
              </Action>
            </span>
          </div>
        ))}
        {status === "ready" && grants.length === 0 && (
          <div className="list-screen-row">
            <strong>No identity grants</strong>
            <span>—</span>
            <span>—</span>
            <span>—</span>
          </div>
        )}
      </article>

      <article className="panel list-screen">
        <div className="list-screen-head">
          <strong>Change</strong>
          <span>Target</span>
          <span>Actor</span>
          <span>When</span>
        </div>
        {audit.map((entry) => (
          <div className="list-screen-row" key={entry.id}>
            <span className="flag-cell">
              <strong>{entry.action}</strong>
              <span>{entry.target}</span>
            </span>
            <span>{entry.targetId.slice(0, 8)}</span>
            <span>{entry.actorId}</span>
            <span>{ago(entry.createdAt)}</span>
          </div>
        ))}
        {status === "ready" && audit.length === 0 && (
          <div className="list-screen-row">
            <strong>No changes recorded</strong>
            <span>—</span>
            <span>—</span>
            <span>—</span>
          </div>
        )}
      </article>
    </div>
  );
}
