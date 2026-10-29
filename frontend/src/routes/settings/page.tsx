import { useEffect, useState } from "react";
import { Archive, KeyRound, ShieldCheck } from "lucide-react";
import {
  useEventsTtl,
  usePermissions,
  type PermissionRuleRecord,
  type PermissionGrantRecord,
} from "../../hooks/use-settings";
import { useSession } from "../../hooks/use-session";
import { Btn, Crumbs, Pill, Toggle } from "../../components/ui-kit";
import { LoadingScreen } from "../../components/loading-screen";
import { cn } from "../../lib/utils";

const inputCls =
  "rounded-md border bg-code px-2 py-1.5 font-mono text-xs outline-none focus:border-primary";
const ttlUnits = ["day", "week", "month", "year"];

// Comma-separated scope editor → string[]. Empty input → [] (project-wide).
function scopeList(input: string): string[] {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function SettingsPage() {
  useEffect(() => {
    document.title = "Settings — Glitchlog";
  }, []);
  const { status, session } = useSession();
  if (status === "loading") return <LoadingScreen />;
  const isAdmin = session?.isAdmin ?? false;

  return (
    <div className="space-y-6">
      <div>
        <Crumbs items={[{ label: "settings" }]} />
        <h1 className="mt-3 text-3xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Instance-wide configuration. The admin-token surfaces are marked.
        </p>
      </div>
      <EventRetention />
      <Permissions isAdmin={isAdmin} />
    </div>
  );
}

function EventRetention() {
  const { ttl, error, saveTtl } = useEventsTtl();
  const [amount, setAmount] = useState(1);
  const [unit, setUnit] = useState("month");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await saveTtl(amount, unit);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // the read error state reflects failures; keep the form
    }
    setSaving(false);
  };

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
        <Archive className="h-3.5 w-3.5" /> Event retention
      </h2>
      {error && <p className="font-mono text-xs text-destructive">{error}</p>}
      {ttl && (
        <div className="panel space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
            <span>current:</span>
            {ttl.interval ? (
              <Pill tone="primary">
                {ttl.interval.amount} {ttl.interval.unit}
                {ttl.interval.amount === 1 ? "" : "s"}
              </Pill>
            ) : (
              <Pill tone="warning">no retention</Pill>
            )}
          </div>
          {ttl.expression && (
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {ttl.expression}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
            <span className="text-muted-foreground">TTL</span>
            <input
              type="number"
              min={0}
              max={1200}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className={cn(inputCls, "w-20")}
            />
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className={inputCls}
            >
              {ttlUnits.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
            <span className="text-muted-foreground">· 0 removes the TTL</span>
            <Btn
              variant="primary"
              onClick={save}
              disabled={saving || amount < 0 || !Number.isInteger(amount)}
            >
              {saving ? "Saving…" : saved ? "Saved ✓" : "Apply"}
            </Btn>
          </div>
          <p className="text-xs text-muted-foreground">
            Applies to the events, metric samples and issue-event tables alike,
            so the volume metrics stay consistent with the store.
          </p>
        </div>
      )}
    </section>
  );
}

function Permissions({ isAdmin }: { isAdmin: boolean }) {
  const {
    rules,
    grants,
    audit,
    identities,
    forbidden,
    loading,
    createRule,
    toggleRule,
    deleteRule,
    createGrant,
    toggleGrant,
    deleteGrant,
  } = usePermissions();
  const [creatingRule, setCreatingRule] = useState(false);
  const [creatingGrant, setCreatingGrant] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ruleDraft, setRuleDraft] = useState({
    name: "",
    projectIds: "",
    appPrefixes: "",
  });
  const [grantDraft, setGrantDraft] = useState({
    identityId: "",
    label: "",
    projectIds: "",
    appPrefixes: "",
    canWrite: false,
  });

  if (!isAdmin) {
    return (
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" /> Permissions
        </h2>
        <div className="panel p-6 text-center font-mono text-sm text-muted-foreground">
          Permission management is admin-token-only — sign in with the admin
          token to manage rules and grants.
        </div>
      </section>
    );
  }

  if (loading) return <LoadingScreen />;
  if (forbidden) {
    return (
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" /> Permissions
        </h2>
        <div className="panel p-6 text-center font-mono text-sm text-muted-foreground">
          The permission surface answered 403 — the admin token is required.
        </div>
      </section>
    );
  }

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch {
      setError("The change failed — check the values and retry.");
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" /> Permissions · admin-token-only
      </h2>
      {error && <p className="font-mono text-xs text-destructive">{error}</p>}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Group rules
            </h3>
            <Btn onClick={() => setCreatingRule((v) => !v)}>New rule</Btn>
          </div>
          {creatingRule && (
            <div
              className="panel space-y-3 p-4"
              style={{ boxShadow: "var(--glow)" }}
            >
              <input
                autoFocus
                placeholder="Group name (lowercase)"
                value={ruleDraft.name}
                onChange={(e) =>
                  setRuleDraft({ ...ruleDraft, name: e.target.value })
                }
                className={cn(inputCls, "w-full")}
              />
              <input
                placeholder="project ids (comma-separated, empty = all)"
                value={ruleDraft.projectIds}
                onChange={(e) =>
                  setRuleDraft({ ...ruleDraft, projectIds: e.target.value })
                }
                className={cn(inputCls, "w-full")}
              />
              <input
                placeholder="app name prefixes (comma-separated, empty = all)"
                value={ruleDraft.appPrefixes}
                onChange={(e) =>
                  setRuleDraft({ ...ruleDraft, appPrefixes: e.target.value })
                }
                className={cn(inputCls, "w-full")}
              />
              <div className="flex justify-end gap-2">
                <Btn onClick={() => setCreatingRule(false)}>Cancel</Btn>
                <Btn
                  variant="primary"
                  disabled={!ruleDraft.name.trim()}
                  onClick={() =>
                    run(async () => {
                      await createRule({
                        name: ruleDraft.name,
                        projectIds: scopeList(ruleDraft.projectIds),
                        appPrefixes: scopeList(ruleDraft.appPrefixes),
                      });
                      setRuleDraft({
                        name: "",
                        projectIds: "",
                        appPrefixes: "",
                      });
                      setCreatingRule(false);
                    })
                  }
                >
                  Create rule
                </Btn>
              </div>
            </div>
          )}
          <div className="panel divide-y">
            {(rules ?? []).map((rule: PermissionRuleRecord) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                onToggle={() => run(() => toggleRule(rule.id, !rule.isEnabled))}
                onDelete={() => run(() => deleteRule(rule.id))}
              />
            ))}
            {!rules?.length && (
              <div className="p-4 text-center font-mono text-sm text-muted-foreground">
                No group rules — every provider identity is denied read scope
                until one matches.
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Grants
            </h3>
            <Btn onClick={() => setCreatingGrant((v) => !v)}>New grant</Btn>
          </div>
          {creatingGrant && (
            <div
              className="panel space-y-3 p-4"
              style={{ boxShadow: "var(--glow)" }}
            >
              <input
                autoFocus
                placeholder="Identity id (e.g. google-1029384)"
                value={grantDraft.identityId}
                onChange={(e) =>
                  setGrantDraft({ ...grantDraft, identityId: e.target.value })
                }
                className={cn(inputCls, "w-full")}
              />
              <input
                placeholder="Label"
                value={grantDraft.label}
                onChange={(e) =>
                  setGrantDraft({ ...grantDraft, label: e.target.value })
                }
                className={cn(inputCls, "w-full")}
              />
              <input
                placeholder="project ids (comma-separated, empty = all)"
                value={grantDraft.projectIds}
                onChange={(e) =>
                  setGrantDraft({ ...grantDraft, projectIds: e.target.value })
                }
                className={cn(inputCls, "w-full")}
              />
              <input
                placeholder="app name prefixes (comma-separated, empty = all)"
                value={grantDraft.appPrefixes}
                onChange={(e) =>
                  setGrantDraft({ ...grantDraft, appPrefixes: e.target.value })
                }
                className={cn(inputCls, "w-full")}
              />
              <label className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                can write{" "}
                <Toggle
                  on={grantDraft.canWrite}
                  onChange={(v) =>
                    setGrantDraft({ ...grantDraft, canWrite: v })
                  }
                  label="can write"
                />
              </label>
              <div className="flex justify-end gap-2">
                <Btn onClick={() => setCreatingGrant(false)}>Cancel</Btn>
                <Btn
                  variant="primary"
                  disabled={!grantDraft.identityId.trim()}
                  onClick={() =>
                    run(async () => {
                      await createGrant({
                        identityId: grantDraft.identityId,
                        label: grantDraft.label,
                        projectIds: scopeList(grantDraft.projectIds),
                        appPrefixes: scopeList(grantDraft.appPrefixes),
                        canWrite: grantDraft.canWrite,
                      });
                      setGrantDraft({
                        identityId: "",
                        label: "",
                        projectIds: "",
                        appPrefixes: "",
                        canWrite: false,
                      });
                      setCreatingGrant(false);
                    })
                  }
                >
                  Create grant
                </Btn>
              </div>
            </div>
          )}
          <div className="panel divide-y">
            {(grants ?? []).map((grant: PermissionGrantRecord) => (
              <GrantRow
                key={grant.id}
                grant={grant}
                onToggle={() =>
                  run(() => toggleGrant(grant.id, !grant.isEnabled))
                }
                onDelete={() => run(() => deleteGrant(grant.id))}
              />
            ))}
            {!grants?.length && (
              <div className="p-4 text-center font-mono text-sm text-muted-foreground">
                No grants — identities fall back to their group rules.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <h3 className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
            <KeyRound className="h-3.5 w-3.5" /> Known identities
          </h3>
          <div className="panel divide-y">
            {(identities ?? []).map((identity) => (
              <div
                key={identity.identityId}
                className="flex items-center justify-between gap-3 p-3"
              >
                <div className="min-w-0">
                  <div className="truncate font-mono text-sm">
                    {identity.identityId}
                  </div>
                  {identity.label && (
                    <div className="text-xs text-muted-foreground">
                      {identity.label}
                    </div>
                  )}
                </div>
                <Pill>{identity.source}</Pill>
              </div>
            ))}
            {!identities?.length && (
              <div className="p-4 text-center font-mono text-sm text-muted-foreground">
                No identities have been seen yet.
              </div>
            )}
          </div>
        </div>
        <div className="space-y-3">
          <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Audit trail
          </h3>
          <div className="panel divide-y font-mono text-[11px]">
            {(audit ?? []).map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between gap-3 p-2.5"
              >
                <span className="truncate text-muted-foreground">
                  <span className="text-foreground">{entry.actorId}</span>{" "}
                  {entry.action}d {entry.target}{" "}
                  <span className="text-primary">
                    {entry.targetId.slice(0, 8)}
                  </span>
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
              </div>
            ))}
            {!audit?.length && (
              <div className="p-4 text-center font-mono text-sm text-muted-foreground">
                No changes recorded yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function RuleRow({
  rule,
  onToggle,
  onDelete,
}: {
  rule: PermissionRuleRecord;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 p-3">
      <div className="min-w-0">
        <div className="font-mono text-sm font-medium">{rule.name}</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {rule.projectIds.length === 0 && rule.appPrefixes.length === 0 ? (
            <Pill tone="primary">all projects</Pill>
          ) : (
            <>
              {rule.projectIds.map((id) => (
                <Pill key={id}>project {id.slice(0, 8)}</Pill>
              ))}
              {rule.appPrefixes.map((prefix) => (
                <Pill key={prefix}>app {prefix}*</Pill>
              ))}
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Toggle
          on={rule.isEnabled}
          label={`Toggle ${rule.name}`}
          onChange={onToggle}
        />
        <button
          onClick={onDelete}
          className="text-muted-foreground hover:text-destructive"
          title="Delete rule"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function GrantRow({
  grant,
  onToggle,
  onDelete,
}: {
  grant: PermissionGrantRecord;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-sm font-medium">
            {grant.identityId}
          </span>
          {grant.canWrite && <Pill tone="primary">can write</Pill>}
        </div>
        {grant.label && (
          <div className="text-xs text-muted-foreground">{grant.label}</div>
        )}
        <div className="mt-1 flex flex-wrap gap-1">
          {grant.projectIds.length === 0 && grant.appPrefixes.length === 0 ? (
            <Pill tone="primary">all projects</Pill>
          ) : (
            <>
              {grant.projectIds.map((id) => (
                <Pill key={id}>project {id.slice(0, 8)}</Pill>
              ))}
              {grant.appPrefixes.map((prefix) => (
                <Pill key={prefix}>app {prefix}*</Pill>
              ))}
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Toggle
          on={grant.isEnabled}
          label={`Toggle ${grant.identityId}`}
          onChange={onToggle}
        />
        <button
          onClick={onDelete}
          className="text-muted-foreground hover:text-destructive"
          title="Delete grant"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
