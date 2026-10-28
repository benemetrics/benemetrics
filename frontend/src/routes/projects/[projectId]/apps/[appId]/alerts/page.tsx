import { useState } from "react";
import { useParams } from "react-router-dom";
import { Plus, Send, Trash2 } from "lucide-react";
import { useAlerts, type AlertRuleRecord, type AlertChannelRecord } from "../../../../../../hooks/use-alerts";
import { Btn, Pill, Toggle } from "../../../../../../components/ui-kit";
import { ChannelForm } from "../../../../../../components/create-forms";
import { ChannelIcon } from "../../../../../../components/channel-icon";
import { cn } from "../../../../../../lib/utils";
import { AppLayout } from "../../../../../../components/app-layout";
import { LoadingScreen } from "../../../../../../components/loading-screen";

const metrics = ["error_count", "crash_free_rate", "new_issues", "flag_error_rate", "p95_latency"];
const windowOptions = ["1m", "5m", "15m", "1h", "24h"];
const windowSeconds: Record<string, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "24h": 86400 };
const inputCls = "rounded-md border bg-code px-2 py-1.5 font-mono text-xs outline-none focus:border-primary";

export default function AlertsPage() {
  const { projectId, appId } = useParams<{ projectId: string; appId: string }>();
  if (!projectId || !appId) return null;
  return (
    <AppLayout>
      <AlertsInner projectId={projectId} appId={appId} />
    </AppLayout>
  );
}

function AlertsInner({ projectId, appId }: { projectId: string; appId: string }) {
  const { rules, channels, loading, reload, createRule, toggleRule, deleteRule, testChannel } = useAlerts(projectId, appId);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: "", metric: metrics[0]!, operator: ">" as ">" | "<", threshold: 100, window: "5m", channels: [] as string[] });
  const [addingChannel, setAddingChannel] = useState(false);
  const [tested, setTested] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const chName = (id: string) => channels?.find((c: AlertChannelRecord) => c.id === id);

  const save = async () => {
    if (!draft.name.trim()) return;
    try {
      await createRule({
        name: draft.name.trim(),
        metric: draft.metric,
        operator: draft.operator,
        threshold: draft.threshold,
        windowSeconds: windowSeconds[draft.window] ?? 300,
        channelIds: draft.channels,
      });
      setDraft({ name: "", metric: metrics[0]!, operator: ">", threshold: 100, window: "5m", channels: [] });
      setCreating(false);
    } catch {
      // error handled by hook
    }
  };

  const handleToggle = async (rule: AlertRuleRecord) => {
    try {
      await toggleRule(rule.id, !rule.isEnabled);
    } catch {
      // error handled by hook
    }
  };

  const handleDelete = async (ruleId: string) => {
    setDeleting(ruleId);
    try {
      await deleteRule(ruleId);
    } catch {
      // error handled by hook
    }
    setDeleting(null);
  };

  const handleTestChannel = async (channelId: string) => {
    try {
      await testChannel(channelId);
      setTested(channelId);
      setTimeout(() => setTested(null), 2000);
    } catch {
      // error handled by hook
    }
  };

  if (loading) return <LoadingScreen />;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <section className="space-y-3 lg:col-span-2">
        <div className="flex items-center justify-between">
          <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Alert rules</h3>
          <Btn variant="primary" onClick={() => setCreating((v) => !v)}><Plus className="h-4 w-4" />New rule</Btn>
        </div>

        {creating && (
          <div className="panel space-y-3 p-4" style={{ boxShadow: "var(--glow)" }}>
            <input autoFocus placeholder="Rule name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={cn(inputCls, "w-full text-sm")} />
            <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
              <span className="text-muted-foreground">when</span>
              <select value={draft.metric} onChange={(e) => setDraft({ ...draft, metric: e.target.value })} className={inputCls}>{metrics.map((m) => <option key={m}>{m}</option>)}</select>
              <select value={draft.operator} onChange={(e) => setDraft({ ...draft, operator: e.target.value as ">" | "<" })} className={inputCls}><option>{">"}</option><option>{"<"}</option></select>
              <input type="number" value={draft.threshold} onChange={(e) => setDraft({ ...draft, threshold: Number(e.target.value) })} className={cn(inputCls, "w-20")} />
              <span className="text-muted-foreground">over</span>
              <select value={draft.window} onChange={(e) => setDraft({ ...draft, window: e.target.value })} className={inputCls}>{windowOptions.map((w) => <option key={w}>{w}</option>)}</select>
            </div>
            <div className="flex flex-wrap gap-2">
              {channels?.map((c: AlertChannelRecord) => {
                const on = draft.channels.includes(c.id);
                return (
                  <button key={c.id} onClick={() => setDraft({ ...draft, channels: on ? draft.channels.filter((x: string) => x !== c.id) : [...draft.channels, c.id] })} className={cn("rounded-sm border px-2 py-1 text-xs", on ? "border-primary text-primary" : "text-muted-foreground")}>
                    {c.type}: {c.name}
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end gap-2">
              <Btn onClick={() => setCreating(false)}>Cancel</Btn>
              <Btn variant="primary" onClick={save} disabled={!draft.name.trim()}>Save rule</Btn>
            </div>
          </div>
        )}

        <div className="panel divide-y">
          {(rules ?? []).map((r) => (
            <div key={r.id} className="flex items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("h-2 w-2 rounded-full", r.status === "triggered" ? "animate-pulse bg-destructive" : r.status === "muted" ? "bg-muted-foreground" : "bg-primary")} />
                  <span className="font-semibold">{r.name}</span>
                  <Pill tone={r.status === "triggered" ? "destructive" : "warning"}>{r.status === "triggered" ? "firing" : r.status}</Pill>
                </div>
                <div className="mt-1 font-mono text-xs text-muted-foreground">
                  {r.metric} {r.operator} {r.threshold} over {r.windowSeconds}s · {r.isEnabled ? "enabled" : "disabled"}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {r.channelIds.map((id: string) => <Pill key={id}>→ {chName(id)?.name ?? id}</Pill>)}
                  {r.lastTriggeredAt && <span className="text-[11px] text-muted-foreground">last fired {new Date(r.lastTriggeredAt).toLocaleDateString()}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Toggle on={r.isEnabled} label={`Toggle ${r.name}`} onChange={() => handleToggle(r)} />
                <button onClick={() => handleDelete(r.id)} className="text-muted-foreground hover:text-destructive" title="Delete rule">
                  {deleting === r.id ? "..." : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          ))}
          {!rules?.length && !loading && <div className="p-8 text-center font-mono text-sm text-muted-foreground">No alert rules.</div>}
        </div>
      </section>

      <aside className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Channels · project</h3>
          <Btn onClick={() => setAddingChannel((v) => !v)}><Plus className="h-4 w-4" />Add</Btn>
        </div>
        {addingChannel && (
          <ChannelForm
            projectId={projectId}
            onCancel={() => setAddingChannel(false)}
            onDone={(c) => {
              setAddingChannel(false);
              reload();
              // While a rule draft is open, select the fresh channel right away.
              if (creating) setDraft((d) => ({ ...d, channels: [...d.channels, c.id] }));
            }}
          />
        )}
        <div className="panel divide-y">
          {(channels ?? []).map((c: AlertChannelRecord) => (
            <div key={c.id} className="space-y-2 p-3">
              <div className="flex items-center gap-3">
                <ChannelIcon type={c.type as never} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{c.name}</div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">{c.type}</div>
                </div>
              </div>
              <div className="flex items-center justify-between">
                {c.verified ? <Pill tone="primary">verified</Pill> : <Pill tone="warning">unverified</Pill>}
                <button onClick={() => handleTestChannel(c.id)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
                  <Send className="h-3 w-3" />{tested === c.id ? "Test sent ✓" : "Send test"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
