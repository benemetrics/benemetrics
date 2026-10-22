import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ScreenIntro } from "../ScreenIntro";
import { AlertBuilder, type AlertBuilderPayload, type Metric } from "../AlertBuilder";
import { api } from "../../lib/api";
import { notify } from "../../lib/toast";

export function NewAlert() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  const create = async (payload: AlertBuilderPayload) => {
    if (creating) return;
    setCreating(true);
    const ruleName = payload.name;
    try {
      const tags = payload.filters?.tags ?? {};
      const shared = {
        name: payload.name,
        cooldownSeconds: payload.cooldownSeconds,
        channelIds: payload.channelIds,
        ...(payload.message ? { message: payload.message } : {}),
        ...(payload.folder ? { folder: payload.folder } : {}),
        ...(payload.appId ? { appId: payload.appId } : {}),
        ...(Object.keys(tags).length > 0 ? { filters: { tags } } : {}),
      };
      const result =
        payload.trigger === "threshold"
          ? await api.api.admin.alerting.rules.post({
              ...shared,
              trigger: payload.trigger,
              metric: payload.metric as Metric,
              operator: payload.operator as "gt" | "lt",
              // A dynamic rule ("3x baseline") carries the factor alone.
              ...(payload.threshold != null ? { threshold: payload.threshold } : {}),
              ...(payload.thresholdFactor != null
                ? { thresholdFactor: payload.thresholdFactor }
                : {}),
              windowSeconds: payload.windowSeconds as number,
            })
          : await api.api.admin.alerting.rules.post({
              ...shared,
              trigger: payload.trigger,
            });
      const created =
        (result?.data as { data?: { id: string } | null; error?: unknown } | null)?.data ?? null;
      if (!created?.id) {
        notify(`Could not create "${ruleName}" — the name may already be taken in this scope.`);
        return;
      }
      notify(`Alert rule "${ruleName}" created`);
      if (payload.channelIds.length > 0) {
        try {
          const testResult = await api.api.admin.alerting.rules[created.id].test.post();
          const results =
            (testResult?.data as { results?: Array<{ ok: boolean }> } | null)?.results ?? [];
          if (results.length === 0) {
            notify("No channels to notify for the test alert");
          } else {
            const delivered = results.filter((item) => item.ok).length;
            notify(`Test notification: ${delivered}/${results.length} channels delivered`);
          }
        } catch {
          notify("The test notification could not be delivered");
        }
      }
      navigate("/alerts");
    } catch {
      notify("Could not reach the backend while creating the alert rule.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="screen-stack">
      <div className="back-link" role="button" tabIndex={0} onClick={() => navigate("/alerts")}>
        ← Back to alerts
      </div>
      <ScreenIntro
        eyebrow="NEW ALERT"
        title="Create an alert"
        subtitle="Turn metric thresholds, new issues and regressions into actionable notifications."
      />
      <AlertBuilder
        submitLabel="Create alert"
        busyLabel="Creating…"
        busy={creating}
        onSubmit={create}
        onCancel={() => navigate("/alerts")}
      />
    </div>
  );
}
