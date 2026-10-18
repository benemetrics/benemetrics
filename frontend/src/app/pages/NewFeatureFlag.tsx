import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Action } from "../Action.tsx";
import { Icon } from "../Icon.tsx";
import { ScreenIntro } from "../ScreenIntro.tsx";
import { api, type SegmentDto } from "../../lib/api.ts";
import { notify } from "../../lib/toast.ts";

type FlagType = "boolean" | "string" | "number" | "json";

const FLAG_TYPES: Array<[FlagType, string]> = [
  ["boolean", "Boolean"],
  ["string", "String"],
  ["number", "Number"],
  ["json", "JSON"],
];

const AUDIENCE_RULES_PLACEHOLDER = `[
  {
    "id": "rule-1",
    "attribute": "plan",
    "operator": "equals",
    "value": "pro"
  }
]`;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function unwrapOne<T>(response: unknown): T | null {
  if (!response || typeof response !== "object") return null;
  const candidate = response as { data?: T | null; error?: unknown };
  if (candidate.error) return null;
  return candidate.data ?? null;
}

export function NewFeatureFlag() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [type, setType] = useState<FlagType>("boolean");
  const [booleanDefault, setBooleanDefault] = useState(false);
  const [stringDefault, setStringDefault] = useState("");
  const [numberDefault, setNumberDefault] = useState("0");
  const [jsonDefault, setJsonDefault] = useState("{}");
  const [rollout, setRollout] = useState(100);
  const [activate, setActivate] = useState(true);
  const [creating, setCreating] = useState(false);
  const [audience, setAudience] = useState<SegmentDto[]>([]);
  const [audienceStatus, setAudienceStatus] = useState<"loading" | "ready" | "error">("loading");
  const [selectedSegments, setSelectedSegments] = useState<string[]>([]);
  const [newSegmentOpen, setNewSegmentOpen] = useState(false);
  const [newSegmentName, setNewSegmentName] = useState("");
  const [newSegmentDescription, setNewSegmentDescription] = useState("");
  const [newSegmentRules, setNewSegmentRules] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await api.api.admin.segments.get();
        if (!cancelled) {
          setAudience((result?.data as { data?: SegmentDto[] } | null)?.data ?? []);
          setAudienceStatus("ready");
        }
      } catch {
        if (!cancelled) setAudienceStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const effectiveKey = keyTouched ? key : slugify(name);
  const valid = name.trim().length > 0 && effectiveKey.length > 0;

  const toggleSegment = (segmentId: string) =>
    setSelectedSegments((current) =>
      current.includes(segmentId)
        ? current.filter((id) => id !== segmentId)
        : [...current, segmentId],
    );

  const defaultValue = (): { value: unknown; ok: boolean } => {
    if (type === "boolean") return { value: booleanDefault, ok: true };
    if (type === "number") {
      const parsed = Number(numberDefault);
      return { value: parsed, ok: Number.isFinite(parsed) };
    }
    if (type === "json") {
      try {
        JSON.parse(jsonDefault);
        // JSON flags keep the raw string: the API contract allows
        // string | number | boolean defaults.
        return { value: jsonDefault.trim(), ok: true };
      } catch {
        return { value: null, ok: false };
      }
    }
    return { value: stringDefault, ok: true };
  };

  const create = async () => {
    if (!valid || creating) return;
    const parsed = defaultValue();
    if (!parsed.ok) {
      notify(type === "json" ? "Default value is not valid JSON" : "Default value must be a number");
      return;
    }

    // The audience can include one brand-new segment defined on this screen.
    const trimmedSegmentName = newSegmentName.trim();
    const wantsNewSegment = newSegmentOpen && trimmedSegmentName.length > 0;
    if (newSegmentOpen && !trimmedSegmentName && newSegmentRules.trim().length > 0) {
      notify("Give the new audience segment a name first.");
      return;
    }
    let newSegmentRulesParsed: unknown[] = [];
    if (wantsNewSegment) {
      try {
        newSegmentRulesParsed = newSegmentRules.trim() ? JSON.parse(newSegmentRules) : [];
      } catch {
        notify("Audience rules must be valid JSON.");
        return;
      }
      if (!Array.isArray(newSegmentRulesParsed)) {
        notify("Audience rules must be a JSON array of targeting rules.");
        return;
      }
    }

    setCreating(true);
    try {
      let audienceIds = [...selectedSegments];
      let createdSegmentName: string | null = null;
      if (wantsNewSegment) {
        const segmentResult = await api.api.admin.segments.post({
          name: trimmedSegmentName,
          description: newSegmentDescription.trim() || undefined,
          rules: newSegmentRulesParsed,
        });
        const segment = (segmentResult?.data as SegmentDto | null) ?? null;
        if (!segment?.id) {
          notify(`Could not create the audience segment "${trimmedSegmentName}".`);
          return;
        }
        createdSegmentName = segment.name;
        audienceIds = [...audienceIds, segment.id];
        // Fold the new audience into the selection so a retry (e.g. after a
        // duplicate key) reuses it instead of creating a second segment.
        setAudience((current) => [segment, ...current]);
        setSelectedSegments(audienceIds);
        setNewSegmentOpen(false);
        setNewSegmentName("");
        setNewSegmentDescription("");
        setNewSegmentRules("");
      }
      const created = unwrapOne<{ id: string; name: string }>(
        await api.api.admin["feature-flags"].post({
          key: effectiveKey,
          name: name.trim(),
          description: description.trim(),
          type,
          defaultValue: parsed.value as string | number | boolean,
          segments: audienceIds,
        }),
      );
      if (!created?.id) {
        notify(
          createdSegmentName
            ? `Segment "${createdSegmentName}" was created, but the flag could not be — the key may already exist.`
            : `Could not create "${name.trim()}" — the key may already exist.`,
        );
        return;
      }
      let extrasSaved = true;
      if (rollout < 100) {
        try {
          await api.api.admin["feature-flags"][created.id].patch({ rolloutPercentage: rollout });
        } catch {
          extrasSaved = false;
        }
      }
      if (activate) {
        try {
          await api.api.admin["feature-flags"][created.id].status.post({ status: "active" });
        } catch {
          extrasSaved = false;
        }
      }
      const audienceNote =
        audienceIds.length > 0
          ? ` targeting ${audienceIds.length} segment${audienceIds.length === 1 ? "" : "s"}`
          : "";
      if (!extrasSaved) {
        notify(`Feature flag "${created.name}" created${audienceNote}, but the rollout/status update failed.`);
      } else {
        notify(
          activate
            ? `Feature flag "${created.name}" created and activated${audienceNote}`
            : `Feature flag "${created.name}" created as draft${audienceNote}`,
        );
      }
      navigate("/feature-flags");
    } catch {
      notify("Could not reach the backend while creating the feature flag.");
    } finally {
      setCreating(false);
    }
  };

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
        eyebrow="NEW FEATURE FLAG"
        title="Create a feature flag"
        subtitle="Safely release a capability to a targeted audience."
      />
      <article className="panel flag-builder">
        <div className="form-section">
          <div className="form-section-copy">
            <strong>Flag details</strong>
            <span>Use a stable key that can be referenced in code; it becomes part of the evaluated payload.</span>
          </div>
          <div className="form-grid">
            <div className="form-field">
              <span>Name</span>
              <input
                className="field-control"
                aria-label="Flag name"
                placeholder="Express checkout"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="form-field">
              <span>Key</span>
              <input
                className="field-control code-value"
                placeholder="express-checkout"
                value={effectiveKey}
                onChange={(event) => {
                  setKeyTouched(true);
                  setKey(slugify(event.target.value));
                }}
              />
            </div>
            <div className="form-field full">
              <span>Description</span>
              <textarea
                className="field-control"
                placeholder="A faster one-step checkout experience for returning customers."
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="form-section">
          <div className="form-section-copy">
            <strong>Targeting</strong>
            <span>Choose the value type, the default returned outside the rollout, and how much traffic evaluates the flag.</span>
          </div>
          <div className="targeting-controls">
            <div className="form-field">
              <span>Type</span>
              <select
                className="field-control"
                value={type}
                onChange={(event) => setType(event.target.value as FlagType)}
              >
                {FLAG_TYPES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <span>Default value</span>
              {type === "boolean" && (
                <div className="toggle-row">
                  <div>
                    <strong>{booleanDefault ? "On" : "Off"}</strong>
                    <span>Returned while the flag is disabled.</span>
                  </div>
                  <div
                    className={`toggle ${booleanDefault ? "on" : ""}`}
                    role="switch"
                    tabIndex={0}
                    aria-checked={booleanDefault}
                    onClick={() => setBooleanDefault(!booleanDefault)}
                    onKeyDown={(event) =>
                      event.key === "Enter" && setBooleanDefault(!booleanDefault)
                    }
                  >
                    <i></i>
                  </div>
                </div>
              )}
              {type === "string" && (
                <input
                  className="field-control"
                  placeholder="control"
                  value={stringDefault}
                  onChange={(event) => setStringDefault(event.target.value)}
                />
              )}
              {type === "number" && (
                <input
                  className="field-control"
                  type="number"
                  value={numberDefault}
                  onChange={(event) => setNumberDefault(event.target.value)}
                />
              )}
              {type === "json" && (
                <textarea
                  className="field-control code-value"
                  value={jsonDefault}
                  onChange={(event) => setJsonDefault(event.target.value)}
                />
              )}
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
              <small>Drag to set how much traffic evaluates this flag.</small>
            </div>
            <div className="toggle-row">
              <div>
                <strong>Activate after creating</strong>
                <span>Leave off to keep the flag as a draft.</span>
              </div>
              <div
                className={`toggle ${activate ? "on" : ""}`}
                role="switch"
                tabIndex={0}
                aria-checked={activate}
                onClick={() => setActivate(!activate)}
                onKeyDown={(event) => event.key === "Enter" && setActivate(!activate)}
              >
                <i></i>
              </div>
            </div>
          </div>
        </div>
        <div className="form-section">
          <div className="form-section-copy">
            <strong>Audience</strong>
            <span>
              Users matching a selected segment's rules get this flag right away; everyone else follows
              the rollout percentage.
            </span>
          </div>
          <div className="audience-controls">
            <div className="audience-list">
              {audience.map((segment) => {
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
              {audienceStatus === "loading" && (
                <div className="audience-empty">Loading segments…</div>
              )}
              {audienceStatus === "error" && (
                <div className="audience-empty">
                  Could not load segments — you can still create one below.
                </div>
              )}
              {audienceStatus === "ready" && audience.length === 0 && (
                <div className="audience-empty">No segments yet — create the first audience right here.</div>
              )}
            </div>
            <div className="audience-actions">
              <Action
                variant="soft"
                active={newSegmentOpen}
                onClick={() => setNewSegmentOpen((value) => !value)}
              >
                <span className="plus">+</span>New segment
              </Action>
              {selectedSegments.length > 0 && (
                <span className="audience-count">{selectedSegments.length} selected</span>
              )}
            </div>
            {newSegmentOpen && (
              <div className="audience-builder">
                <div className="form-grid">
                  <div className="form-field">
                    <span>Segment name</span>
                    <input
                      className="field-control"
                      aria-label="New segment name"
                      placeholder="Paying customers"
                      value={newSegmentName}
                      onChange={(event) => setNewSegmentName(event.target.value)}
                    />
                  </div>
                  <div className="form-field">
                    <span>Description</span>
                    <input
                      className="field-control"
                      aria-label="New segment description"
                      placeholder="Everyone on a paid plan"
                      value={newSegmentDescription}
                      onChange={(event) => setNewSegmentDescription(event.target.value)}
                    />
                  </div>
                  <div className="form-field full">
                    <span>Rules (JSON array)</span>
                    <textarea
                      className="field-control code-value"
                      aria-label="New segment rules"
                      placeholder={AUDIENCE_RULES_PLACEHOLDER}
                      rows={6}
                      value={newSegmentRules}
                      onChange={(event) => setNewSegmentRules(event.target.value)}
                    />
                    <small>
                      Created together with the flag when you submit; leave empty to match every user.
                    </small>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="flag-code">
          <div>
            <Icon name="code" />
            <span>Use this key in your application</span>
          </div>
          <code>benedebug.flags.isEnabled("{effectiveKey || "flag-key"}")</code>
        </div>
        <div className="builder-actions">
          <Action variant="soft" onClick={() => navigate("/feature-flags")}>
            Cancel
          </Action>
          <Action variant="primary" onClick={create}>
            {creating ? "Creating…" : "Create flag"}
          </Action>
        </div>
      </article>
    </div>
  );
}
