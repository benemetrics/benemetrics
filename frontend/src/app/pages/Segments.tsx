import { useEffect, useState } from "react";
import { Action } from "../Action.tsx";
import { ScreenIntro } from "../ScreenIntro.tsx";
import { api, type SegmentDto } from "../../lib/api.ts";
import { notify } from "../../lib/toast.ts";
import { relativeTime } from "../../lib/utils.ts";

const RULES_PLACEHOLDER = `[
  {
    "id": "rule-1",
    "attribute": "plan",
    "operator": "equals",
    "value": "pro",
    "variantKey": "on"
  }
]`;

function ago(iso: string): string {
  return relativeTime(iso).replace(/^seen /, "");
}

export function Segments() {
  const [segments, setSegments] = useState<SegmentDto[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rulesText, setRulesText] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await api.api.admin.segments.get();
        if (!cancelled) {
          setSegments((result?.data as { data?: SegmentDto[] } | null)?.data ?? []);
          setStatus("ready");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = segments.find((segment) => segment.id === selectedId) ?? null;

  const create = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      notify("Give the segment a name first.");
      return;
    }
    let rules: unknown;
    try {
      rules = JSON.parse(rulesText || "[]");
    } catch {
      notify("Rules must be valid JSON.");
      return;
    }
    if (!Array.isArray(rules)) {
      notify("Rules must be a JSON array of targeting rules.");
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      const result = await api.api.admin.segments.post({
        name: trimmedName,
        description: description.trim() || undefined,
        rules,
      });
      const created = (result?.data as SegmentDto | null) ?? null;
      if (!created?.id) {
        notify(`Could not create "${trimmedName}" — check the rules format.`);
        return;
      }
      setSegments((current) => [created, ...current]);
      setSelectedId(created.id);
      setName("");
      setDescription("");
      setRulesText("");
      setCreating(false);
      notify(`Segment "${created.name}" created`);
    } catch {
      notify("Could not reach the backend while creating the segment.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="screen-stack">
      <ScreenIntro
        eyebrow="FEATURE TARGETING"
        title="Segments"
        subtitle="Reusable rule sets that feature flags can target; rules use the same shape as flag targeting."
        action={
          <Action variant="primary" onClick={() => setCreating((value) => !value)}>
            <span className="plus">+</span>New segment
          </Action>
        }
      />
      {creating && (
        <article className="panel builder-card">
          <div className="form-grid">
            <div className="form-field">
              <span>Name</span>
              <input
                className="field-control"
                placeholder="Paying customers"
                value={name}
                autoFocus
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="form-field">
              <span>Description</span>
              <input
                className="field-control"
                placeholder="Everyone on a paid plan"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <div className="form-field full">
              <span>Rules (JSON array)</span>
              <textarea
                className="field-control code-value"
                placeholder={RULES_PLACEHOLDER}
                value={rulesText}
                rows={7}
                onChange={(event) => setRulesText(event.target.value)}
              />
              <small>
                Each rule needs an attribute, operator and value; variantKey picks the flag variant
                when the rule matches.
              </small>
            </div>
          </div>
          <div className="builder-actions">
            <Action variant="soft" onClick={() => setCreating(false)}>
              Cancel
            </Action>
            <Action variant="primary" onClick={create}>
              {saving ? "Creating…" : "Create segment"}
            </Action>
          </div>
        </article>
      )}
      <article className="panel list-screen segments">
        <div className="list-screen-head">
          <strong>Segment</strong>
          <span>Rules</span>
          <span>Created</span>
          <span>Detail</span>
        </div>
        {segments.map((segment) => (
          <div
            className={`list-screen-row clickable ${selectedId === segment.id ? "selected" : ""}`}
            key={segment.id}
            role="button"
            tabIndex={0}
            onClick={() => setSelectedId(selectedId === segment.id ? null : segment.id)}
            onKeyDown={(event) =>
              event.key === "Enter" &&
              setSelectedId(selectedId === segment.id ? null : segment.id)
            }
          >
            <span className="flag-cell">
              <strong>{segment.name}</strong>
              <span>{segment.description || "No description"}</span>
            </span>
            <span>{segment.rules.length} rule{segment.rules.length === 1 ? "" : "s"}</span>
            <span>{ago(segment.createdAt)}</span>
            <span className="row-action">
              {selectedId === segment.id ? "Hide" : "View"}
            </span>
          </div>
        ))}
        {status !== "ready" && (
          <div className="list-screen-row">
            <strong>{status === "loading" ? "Loading segments…" : "Could not load segments"}</strong>
            <span>—</span>
            <span>—</span>
            <span>—</span>
          </div>
        )}
        {status === "ready" && segments.length === 0 && (
          <div className="list-screen-row">
            <strong>No segments</strong>
            <span>—</span>
            <span>—</span>
            <span>—</span>
          </div>
        )}
      </article>
      {selected && (
        <article className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">{selected.name}</div>
              <div className="panel-subtitle">
                {selected.description || "No description"}
              </div>
            </div>
          </div>
          <div className="context-list">
            <div>
              <span>Segment ID</span>
              <strong>{selected.id}</strong>
            </div>
            <div>
              <span>Created</span>
              <strong>{ago(selected.createdAt)}</strong>
            </div>
          </div>
          <div className="segment-rules">
            <div className="preview-label">TARGETING RULES</div>
            <pre className="payload-json">{JSON.stringify(selected.rules, null, 2)}</pre>
          </div>
        </article>
      )}
    </div>
  );
}
