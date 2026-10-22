import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Action } from "../Action";
import { ScreenIntro } from "../ScreenIntro";
import { api, type SegmentDto } from "../../lib/api";
import { loadAllPages } from "../../lib/cursor";
import { notify } from "../../lib/toast";

type FlagType = "boolean" | "string" | "number" | "json";

const OPERATORS = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "in",
  "not_in",
  "greater_than",
  "less_than",
  "greater_than_or_equal",
  "less_than_or_equal",
] as const;

interface FlagVariant {
  key: string;
  name: string;
  value: unknown;
  weight: number;
}

interface TargetingRule {
  attribute: string;
  operator: string;
  value: unknown;
  variantKey?: string;
}

interface FlagDetailDto {
  id: string;
  key: string;
  name: string;
  description: string | null;
  type: FlagType;
  defaultValue: unknown;
  variants: FlagVariant[];
  targetingRules: TargetingRule[];
  segments: string[];
  status: string;
  rolloutPercentage: number;
  experiment: { enabled?: boolean } | null;
  projectId: string | null;
  appId: string | null;
  createdAt: string;
  updatedAt: string;
}

// The editor keeps the variant values and the rule values as editable text;
// the parse maps them back to the flag's value type.
function parseValue(raw: string, type: FlagType): { value: unknown; ok: boolean; error?: string } {
  if (type === "boolean") {
    const trimmed = raw.trim().toLowerCase();
    if (trimmed === "true") return { value: true, ok: true };
    if (trimmed === "false") return { value: false, ok: true };
    return { value: null, ok: false, error: 'Use "true" or "false"' };
  }
  if (type === "number") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? { value: parsed, ok: true } : { value: null, ok: false, error: "Not a number" };
  }
  if (type === "json") {
    try {
      JSON.parse(raw);
      return { value: raw.trim(), ok: true };
    } catch {
      return { value: null, ok: false, error: "Invalid JSON" };
    }
  }
  return { value: raw, ok: true };
}

// A rule value may be a string, a number or a boolean: the parser tries JSON.
function parseRuleValue(raw: string): unknown {
  if (raw.trim() === "") return "";
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function valueToText(value: unknown, type: FlagType): string {
  if (value == null) return "";
  if (type === "string" || type === "json") return String(value);
  return String(value);
}

export function FlagConfig() {
  const { flagId } = useParams();
  const navigate = useNavigate();
  const [flag, setFlag] = useState<FlagDetailDto | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [saving, setSaving] = useState(false);
  const [segments, setSegments] = useState<SegmentDto[]>([]);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rollout, setRollout] = useState(100);
  const [variants, setVariants] = useState<Array<FlagVariant & { text: string }>>([]);
  const [rules, setRules] = useState<
    Array<{ attribute: string; operator: string; rawValue: string; variantKey: string }>
  >([]);
  const [selectedSegments, setSelectedSegments] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [flagResult, segmentRows] = await Promise.all([
          api.api.admin["feature-flags"][flagId!].get(),
          loadAllPages<SegmentDto>(async (cursor, limit) => {
            const result = await api.api.admin.segments.get({
              $query: { limit, ...(cursor ? { cursor } : {}) },
            });
            return (result?.data as { data?: SegmentDto[] } | null)?.data ?? [];
          }),
        ]);
        const loaded = flagResult?.data as FlagDetailDto | null;
        if (!loaded || cancelled) {
          if (!cancelled) setStatus("error");
          return;
        }
        setFlag(loaded);
        setName(loaded.name);
        setDescription(loaded.description ?? "");
        setRollout(loaded.rolloutPercentage);
        setVariants(
          (loaded.variants ?? []).map((variant) => ({
            ...variant,
            text: valueToText(variant.value, loaded.type),
          })),
        );
        setRules(
          (loaded.targetingRules ?? []).map((rule) => ({
            attribute: rule.attribute,
            operator: rule.operator,
            rawValue: valueToText(rule.value, "string"),
            variantKey: rule.variantKey ?? "",
          })),
        );
        setSelectedSegments(loaded.segments ?? []);
        setSegments(segmentRows);
        if (!cancelled) setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flagId]);

  if (status !== "ready" || !flag) {
    return (
      <div className="screen-stack">
        <div
          className="back-link"
          role="button"
          tabIndex={0}
          onClick={() => navigate("/feature-flags")}
        >
          ← Back to feature flags
        </div>
        <ScreenIntro
          eyebrow="FLAG CONFIG"
          title={status === "loading" ? "Loading flag…" : "Flag could not be loaded"}
          subtitle={status === "loading" ? "" : "The flag may have been deleted."}
        />
      </div>
    );
  }

  // The guard above leaves a non-null flag for the handlers below.
  const detail = flag;
  const weightsTotal = variants.reduce((sum, variant) => sum + (Number(variant.weight) || 0), 0);
  const variantKeys = variants.map((variant) => variant.key.trim());

  const variantProblems: string[] = [];
  if (variants.length === 0) variantProblems.push("A flag needs at least one variant");
  if (weightsTotal !== 100) variantProblems.push(`Variant weights must sum to 100 (got ${weightsTotal})`);
  if (variantKeys.some((key) => key.length === 0)) variantProblems.push("Every variant needs a key");
  if (new Set(variantKeys).size !== variantKeys.length) variantProblems.push("Variant keys must be unique");
  for (const variant of variants) {
    const parsed = parseValue(variant.text, detail.type);
    if (!parsed.ok) {
      variantProblems.push(`Variant "${variant.key}" value: ${parsed.error}`);
    }
  }
  const ruleProblems: string[] = [];
  for (const [index, rule] of rules.entries()) {
    if (rule.attribute.trim().length === 0) ruleProblems.push(`Rule ${index + 1} needs an attribute`);
    const root = rule.attribute.trim().split(".")[0];
    if (rule.attribute.trim() && root !== "user" && root !== "context") {
      ruleProblems.push(`Rule ${index + 1}: the attribute must start with "user." or "context."`);
    }
  }
  const problems = [...variantProblems, ...ruleProblems];

  const save = async () => {
    if (saving || problems.length > 0) return;
    setSaving(true);
    try {
      const parsedVariants = variants.map((variant) => ({
        key: variant.key.trim(),
        name: variant.name.trim() || variant.key.trim(),
        value: parseValue(variant.text, detail.type).value,
        weight: Number(variant.weight) || 0,
      }));
      const parsedRules = rules
        .filter((rule) => rule.attribute.trim().length > 0)
        .map((rule) => ({
          attribute: rule.attribute.trim(),
          operator: rule.operator,
          value: parseRuleValue(rule.rawValue),
          ...(rule.variantKey ? { variantKey: rule.variantKey } : {}),
        }));
      const result = await api.api.admin["feature-flags"][detail.id].patch({
        name: name.trim(),
        description: description.trim() || undefined,
        rolloutPercentage: rollout,
        variants: parsedVariants,
        targetingRules: parsedRules,
        segments: selectedSegments,
      });
      if ((result as { error?: unknown } | null)?.error) {
        notify(`Could not save "${detail.key}"`);
        return;
      }
      notify(`Flag "${detail.key}" updated`);
      navigate("/feature-flags");
    } catch {
      notify("Could not reach the backend while saving the flag.");
    } finally {
      setSaving(false);
    }
  };

  const toggleSegment = (segmentId: string) =>
    setSelectedSegments((current) =>
      current.includes(segmentId)
        ? current.filter((id) => id !== segmentId)
        : [...current, segmentId],
    );

  const isArchived = detail.status === "archived";

  return (
    <div className="screen-stack">
      <div
        className="back-link"
        role="button"
        tabIndex={0}
        onClick={() => navigate("/feature-flags")}
      >
        ← Back to feature flags
      </div>
      <ScreenIntro
        eyebrow="FLAG CONFIG"
        title={detail.name}
        subtitle={`${detail.key} · ${detail.type} · ${detail.status}${detail.experiment?.enabled ? " · experiment" : ""}`}
        action={
          <div className="intro-actions">
            <Action
              variant="soft"
              onClick={async () => {
                if (isArchived) return;
                try {
                  const next = detail.status === "active" ? "paused" : "active";
                  const result = await api.api.admin["feature-flags"][detail.id].status.post({
                    status: next,
                  });
                  if ((result as { error?: unknown } | null)?.error) {
                    notify(`Could not change the status of "${detail.key}"`);
                    return;
                  }
                  setFlag({ ...detail, status: next });
                  notify(`Flag "${detail.key}" ${next === "active" ? "activated" : "paused"}`);
                } catch {
                  notify("Could not reach the backend while changing the status.");
                }
              }}
            >
              {isArchived ? "Archived" : detail.status === "active" ? "Pause" : "Activate"}
            </Action>
          </div>
        }
      />

      <article className="panel">
        <div className="form-section">
          <div className="form-section-copy">
            <strong>Details</strong>
            <span>The key, the type and the scope are fixed; the readables can change.</span>
          </div>
          <div className="form-grid">
            <div className="form-field">
              <span>Name</span>
              <input
                className="field-control"
                aria-label="Flag name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="form-field">
              <span>Default value</span>
              <input
                className="field-control code-value"
                value={String(detail.defaultValue ?? "")}
                readOnly
              />
              <small>The default travels through the create surface only.</small>
            </div>
            <div className="form-field full">
              <span>Description</span>
              <textarea
                className="field-control"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <div className="rollout-control">
              <span>Percentage rollout</span>
              <div className="rollout-value">{rollout}%</div>
              <div className="rollout-track">
                <div className="rollout-rail">
                  <i style={{ width: `${rollout}%` }}></i>
                </div>
                <b className="rollout-thumb" style={{ left: `${rollout}%` }}></b>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={rollout}
                  aria-label="Percentage rollout"
                  onChange={(event) => setRollout(Number(event.target.value))}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="form-section">
          <div className="form-section-copy">
            <strong>Variants</strong>
            <span>
              {flagsTypeHint(detail.type)} Weights are the allocation buckets for the random
              assignment; they must sum to 100.
            </span>
          </div>
          <div className="definition-rows">
            {variants.map((variant, index) => (
              <div className="variant-row" key={index}>
                <input
                  className="field-control code-value"
                  aria-label="Variant key"
                  placeholder="control"
                  value={variant.key}
                  onChange={(event) =>
                    setVariants((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, key: event.target.value } : item,
                      ),
                    )
                  }
                />
                <input
                  className="field-control"
                  aria-label="Variant name"
                  placeholder="Control group"
                  value={variant.name}
                  onChange={(event) =>
                    setVariants((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, name: event.target.value } : item,
                      ),
                    )
                  }
                />
                <input
                  className="field-control code-value"
                  aria-label="Variant value"
                  placeholder={detail.type === "json" ? '{"x":1}' : detail.type === "string" ? "— value" : detail.type === "number" ? "0" : "true"}
                  value={variant.text}
                  onChange={(event) =>
                    setVariants((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, text: event.target.value } : item,
                      ),
                    )
                  }
                />
                <input
                  className="field-control"
                  type="number"
                  min="0"
                  max="100"
                  aria-label="Variant weight"
                  value={variant.weight}
                  onChange={(event) =>
                    setVariants((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, weight: Number(event.target.value) } : item,
                      ),
                    )
                  }
                />
                <Action
                  variant="soft"
                  onClick={() =>
                    setVariants((current) => current.filter((_, itemIndex) => itemIndex !== index))
                  }
                >
                  Remove
                </Action>
              </div>
            ))}
            <div className="audience-actions">
              <Action
                variant="soft"
                onClick={() =>
                  setVariants((current) => [
                    ...current,
                    {
                      key: "",
                      name: "",
                      value: null,
                      text: detail.type === "boolean" ? "true" : detail.type === "number" ? "0" : "",
                      weight: 0,
                    },
                  ])
                }
              >
                <span className="plus">+</span>Add variant
              </Action>
              <span
                className={`weights-sum ${weightsTotal === 100 ? "ok" : variants.length > 0 ? "bad" : ""}`}
              >
                {weightsTotal}/100
              </span>
            </div>
          </div>
        </div>

        <div className="form-section">
          <div className="form-section-copy">
            <strong>Targeting rules</strong>
            <span>
              Evaluated top to bottom; the first matching rule wins and serves its variant instead of
              the weighted assignment.
            </span>
          </div>
          <div className="definition-rows">
            {rules.map((rule, index) => (
              <div className="rule-row" key={index}>
                <input
                  className="field-control code-value"
                  aria-label="Rule attribute"
                  placeholder="user.id"
                  value={rule.attribute}
                  onChange={(event) =>
                    setRules((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, attribute: event.target.value } : item,
                      ),
                    )
                  }
                />
                <select
                  className="field-control"
                  aria-label="Rule operator"
                  value={rule.operator}
                  onChange={(event) =>
                    setRules((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, operator: event.target.value } : item,
                      ),
                    )
                  }
                >
                  {OPERATORS.map((operator) => (
                    <option key={operator} value={operator}>
                      {operator}
                    </option>
                  ))}
                </select>
                <input
                  className="field-control code-value"
                  aria-label="Rule value"
                  placeholder='"pro"'
                  value={rule.rawValue}
                  onChange={(event) =>
                    setRules((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, rawValue: event.target.value } : item,
                      ),
                    )
                  }
                />
                <select
                  className="field-control"
                  aria-label="Rule variant"
                  value={rule.variantKey}
                  onChange={(event) =>
                    setRules((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, variantKey: event.target.value } : item,
                      ),
                    )
                  }
                >
                  <option value="">No variant</option>
                  {variants.map((variant, variantIndex) => (
                    <option key={variantIndex} value={variant.key}>
                      {variant.key || `variant ${variantIndex + 1}`}
                    </option>
                  ))}
                </select>
                <Action
                  variant="soft"
                  onClick={() =>
                    setRules((current) => current.filter((_, itemIndex) => itemIndex !== index))
                  }
                >
                  Remove
                </Action>
              </div>
            ))}
            <div className="audience-actions">
              <Action
                variant="soft"
                onClick={() =>
                  setRules((current) => [
                    ...current,
                    { attribute: "", operator: "equals", rawValue: "", variantKey: "" },
                  ])
                }
              >
                <span className="plus">+</span>Add rule
              </Action>
            </div>
          </div>
        </div>

        <div className="form-section">
          <div className="form-section-copy">
            <strong>Audience</strong>
            <span>Users matching a selected segment get the flag; everyone else follows the rollout.</span>
          </div>
          <div className="audience-list">
            {segments.map((segment) => {
              const selected = selectedSegments.includes(segment.id);
              return (
                <div
                  key={segment.id}
                  className={`segment-option ${selected ? "selected" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  onClick={() => toggleSegment(segment.id)}
                  onKeyDown={(event) => event.key === "Enter" && toggleSegment(segment.id)}
                >
                  <span className="segment-option-copy">
                    <strong>{segment.name}</strong>
                    <span>
                      {segment.description ||
                        `${segment.rules.length} rule${segment.rules.length === 1 ? "" : "s"}`}
                    </span>
                  </span>
                  <span className="segment-option-mark">{selected ? "✓" : ""}</span>
                </div>
              );
            })}
            {segments.length === 0 && (
              <div className="audience-empty">No segments yet — create one on the Segments page.</div>
            )}
          </div>
        </div>

        <div className="builder-actions">
          <Action variant="soft" onClick={() => navigate("/feature-flags")}>
            Cancel
          </Action>
          <Action variant="primary" onClick={save}>
            {saving ? "Saving…" : "Save changes"}
          </Action>
        </div>
        {problems.length > 0 && (
          <div className="audience-empty" role="alert">
            {problems.map((problem) => (
              <span key={problem}>
                {problem}
                <br />
              </span>
            ))}
          </div>
        )}
      </article>
    </div>
  );
}

function flagsTypeHint(type: FlagType): string {
  if (type === "boolean") return 'Variant values are "true" or "false".';
  if (type === "number") return "Variant values are numbers.";
  if (type === "json") return "Variant values are JSON documents.";
  return "Variant values are strings.";
}
