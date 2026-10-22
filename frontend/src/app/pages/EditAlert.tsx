import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ScreenIntro } from "../ScreenIntro";
import { AlertBuilder, type AlertBuilderPayload, unwrapRuleResponse } from "../AlertBuilder";
import { api, type AlertRuleDto } from "../../lib/api";
import { notify } from "../../lib/toast";

export function EditAlert() {
  const { ruleId } = useParams();
  const navigate = useNavigate();
  const [rule, setRule] = useState<AlertRuleDto | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await api.api.admin.alerting.rules[ruleId!].get();
        const loaded = unwrapRuleResponse(result);
        if (!loaded || cancelled) {
          if (!cancelled) setStatus("error");
          return;
        }
        if (!cancelled) {
          setRule(loaded);
          setStatus("ready");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ruleId]);

  const save = async (payload: AlertBuilderPayload) => {
    if (saving || !ruleId) return;
    setSaving(true);
    try {
      const result = await api.api.admin.alerting.rules[ruleId].patch({
        name: payload.name,
        trigger: payload.trigger,
        ...(payload.metric != null ? { metric: payload.metric } : {}),
        ...(payload.operator != null ? { operator: payload.operator } : {}),
        ...(payload.threshold != null ? { threshold: payload.threshold } : {}),
        ...(payload.thresholdFactor != null
          ? { thresholdFactor: payload.thresholdFactor }
          : {}),
        ...(payload.windowSeconds != null ? { windowSeconds: payload.windowSeconds } : {}),
        cooldownSeconds: payload.cooldownSeconds,
        channelIds: payload.channelIds,
        filters: payload.filters,
        // Null drops a previously set message template.
        message: payload.message,
        folder: payload.folder,
      });
      if ((result as { error?: unknown } | null)?.error) {
        notify(`Could not save "${payload.name}".`);
        return;
      }
      notify(`Alert rule "${payload.name}" updated`);
      navigate("/alerts");
    } catch {
      notify("Could not reach the backend while saving the rule.");
    } finally {
      setSaving(false);
    }
  };

  if (status !== "ready") {
    return (
      <div className="screen-stack">
        <div className="back-link" role="button" tabIndex={0} onClick={() => navigate("/alerts")}>
          ← Back to alerts
        </div>
        <ScreenIntro
          eyebrow="EDIT ALERT"
          title="Edit alert rule"
          subtitle={status === "loading" ? "Loading the rule…" : "The rule could not be loaded."}
        />
      </div>
    );
  }

  return (
    <div className="screen-stack">
      <div className="back-link" role="button" tabIndex={0} onClick={() => navigate("/alerts")}>
        ← Back to alerts
      </div>
      <ScreenIntro
        eyebrow="EDIT ALERT"
        title="Edit alert rule"
        subtitle="Change the condition, the routing and the message template — the scope stays fixed."
      />
      <AlertBuilder
        initial={rule}
        lockScope
        submitLabel="Save changes"
        busyLabel="Saving…"
        busy={saving}
        onSubmit={save}
        onCancel={() => navigate("/alerts")}
      />
    </div>
  );
}
