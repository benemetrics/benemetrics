import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2, Users, X } from "lucide-react";
import { targetingAttributes, type TargetingRule } from "../lib/data";
import { parseTargetValues, targetedVariant, targetingOperators } from "../lib/flag-targeting";
import { Btn, Pill } from "../components/ui-kit";

const inputClass = "w-full min-w-0 rounded-md border bg-card px-2.5 py-2 text-sm outline-none focus:border-primary";
const emptyDraft = { attribute: "user.id", operator: "is one of" as TargetingRule["operator"], values: "", variant: "treatment" };

export function FlagTargeting({
  flagKey,
  variants,
  rules,
  onPersist,
}: {
  flagKey: string;
  // Only the variant key is read; both the mock Variant and the real
  // FeatureFlagVariant shapes satisfy it.
  variants: Array<{ key: string }>;
  rules: TargetingRule[];
  onPersist: (rules: TargetingRule[]) => Promise<boolean>;
}) {
  // Local mirror for snappy edits; the flag record stays the source of truth.
  const [local, setLocal] = useState<TargetingRule[]>(rules);
  useEffect(() => setLocal(rules), [rules]);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Record<string, string>>({});
  const [previewed, setPreviewed] = useState(false);
  const attributes = [...new Set(local.map((rule) => rule.attribute))];
  const matched = targetedVariant(local, preview);
  const reset = () => { setOpen(false); setEditing(null); setError(""); setDraft(emptyDraft); };

  const commit = async (next: TargetingRule[]) => {
    setLocal(next);
    setPreviewed(false);
    await onPersist(next);
  };

  return (
    <section className="mt-4 border-t pt-3" aria-label={`Targeting for ${flagKey}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium"><Users className="h-4 w-4 text-primary" />User targeting {local.length > 0 && <Pill>{local.length}</Pill>}</h3>
        {!open && <Btn type="button" onClick={() => { setDraft({ ...emptyDraft, variant: variants.find((v) => v.key !== "control")?.key ?? variants[0]?.key ?? "control" }); setOpen(true); }}><Plus className="h-3.5 w-3.5" />Add rule</Btn>}
      </div>
      {local.length === 0 && !open && <p className="mt-2 text-xs text-muted-foreground">No targeted users</p>}
      <div className="divide-y">
        {local.map((rule, index) => (
          <div key={rule.id} className="flex items-center justify-between gap-2 py-3">
            <p className="min-w-0 break-words text-xs"><span className="mr-2 font-mono text-muted-foreground">{index + 1}.</span><span className="font-mono">{rule.attribute}</span> {rule.operator} <span className="font-mono">{rule.values.join(", ")}</span> → <span className="font-semibold text-primary">{rule.variant}</span></p>
            <div className="flex shrink-0 gap-1">
              <Btn type="button" aria-label={`Edit targeting rule ${index + 1}`} title="Edit rule" className="px-2" onClick={() => { setEditing(rule.id); setDraft({ ...rule, values: rule.values.join(", ") }); setError(""); setOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Btn>
              <Btn type="button" aria-label={`Delete targeting rule ${index + 1}`} title="Delete rule" className="px-2" onClick={() => { commit(local.filter((r) => r.id !== rule.id)); if (editing === rule.id) reset(); }}><Trash2 className="h-3.5 w-3.5" /></Btn>
            </div>
          </div>
        ))}
      </div>
      {open && <form className="mt-3 space-y-3" onSubmit={(event) => {
        event.preventDefault();
        const values = parseTargetValues(draft.values);
        if (!values.length) { setError("Enter at least one value."); return; }
        // The backend matches contains/ends_with against a single scalar.
        if ((draft.operator === "contains" || draft.operator === "ends with") && values.length > 1) { setError("This operator accepts a single value."); return; }
        if (draft.operator === "greater than" && values.some((value) => !Number.isFinite(Number(value)))) { setError("Greater than requires numeric values."); return; }
        const rule = { id: editing ?? crypto.randomUUID(), attribute: draft.attribute, operator: draft.operator, values, variant: draft.variant };
        commit(editing ? local.map((r) => (r.id === editing ? rule : r)) : [...local, rule]);
        reset();
      }}>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1 text-xs text-muted-foreground">Attribute<select className={inputClass} value={draft.attribute} onChange={(e) => setDraft({ ...draft, attribute: e.target.value })}>{targetingAttributes.map((attribute) => <option key={attribute}>{attribute}</option>)}</select></label>
          <label className="space-y-1 text-xs text-muted-foreground">Operator<select className={inputClass} value={draft.operator} onChange={(e) => { const operator = targetingOperators.find((o) => o === e.target.value); if (operator) setDraft({ ...draft, operator }); }}>{targetingOperators.map((operator) => <option key={operator}>{operator}</option>)}</select></label>
          <label className="space-y-1 text-xs text-muted-foreground">Serve variant<select className={inputClass} value={draft.variant} onChange={(e) => setDraft({ ...draft, variant: e.target.value })}>{variants.map((variant) => <option key={variant.key}>{variant.key}</option>)}</select></label>
        </div>
        <label className="block space-y-1 text-xs text-muted-foreground">Values<textarea className={`${inputClass} min-h-20 font-mono`} value={draft.values} onChange={(e) => setDraft({ ...draft, values: e.target.value })} placeholder={draft.attribute === "user.email" ? "tiago@example.com, ana@example.com" : "user_123, user_456"} /></label>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <div className="flex gap-2"><Btn type="submit" variant="primary">{editing ? "Save changes" : "Save rule"}</Btn><Btn type="button" onClick={reset}><X className="h-3.5 w-3.5" />Cancel</Btn></div>
      </form>}
      {local.length > 0 && <form className="mt-3 space-y-3 border-t pt-3" onSubmit={(event) => { event.preventDefault(); setPreviewed(true); }}>
        <h4 className="text-xs font-medium">User preview</h4>
        <div className="grid gap-2 sm:grid-cols-2">{attributes.map((attribute) => <label key={attribute} className="space-y-1 text-xs text-muted-foreground">{attribute}<input className={inputClass} value={preview[attribute] ?? ""} onChange={(e) => { setPreview({ ...preview, [attribute]: e.target.value }); setPreviewed(false); }} /></label>)}</div>
        <div className="flex flex-wrap items-center gap-3"><Btn type="submit">Check user</Btn>{previewed && <p role="status" className="text-xs font-medium text-primary">{matched ? `Targeted variant: ${matched}` : "No matching rule · default rollout"}</p>}</div>
      </form>}
    </section>
  );
}
