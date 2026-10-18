import { parseEnvelope, normalizeTransactionPayload } from "../events/utils.ts";

export interface MetricSample {
  eventId: string;
  projectId: string;
  appId: string;
  metric: string;
  value: number;
  dimension: string;
  timestamp: string;
}

export function extractMetrics(envelope: { header: Record<string, unknown>; items: Array<{ header: Record<string, unknown>; payload: unknown }> }): MetricSample[] {
  const samples: MetricSample[] = [];
  const timestamp = new Date().toISOString();

  for (const item of envelope.items) {
    if (!item.payload || typeof item.payload !== "object") continue;
    const payload = item.payload as Record<string, unknown>;

    // Skip non-event/transaction items
    if (item.header.type !== "event" && item.header.type !== "transaction") continue;

    const normalized = normalizeTransactionPayload(payload);
    const eventId = (normalized as Record<string, unknown>).event_id as string || "unknown";
    const projectId = (envelope.header as Record<string, unknown>).project_id as string || "unknown";
    const appId = "unknown";

    // Sentinels
    samples.push({
      eventId,
      projectId,
      appId,
      metric: "event_count",
      value: 1,
      dimension: "",
      timestamp,
    });

    const level = payload.level as string;
    if (level === "error") {
      samples.push({ eventId, projectId, appId, metric: "error_count", value: 1, dimension: "", timestamp });
    }
    if (level === "fatal") {
      samples.push({ eventId, projectId, appId, metric: "fatal_count", value: 1, dimension: "", timestamp });
    }

    // Extract measurements from payload for all item types
    const payloadMeasurements = (payload.measurements && typeof payload.measurements === "object")
      ? payload.measurements as Record<string, unknown>
      : null;

    const normalizedMeasurements = (normalized as Record<string, unknown>).measurements as Record<string, unknown> | undefined;

    // Transaction measurements
    if (item.header.type === "transaction" && normalizedMeasurements) {
      for (const [key, value] of Object.entries(normalizedMeasurements)) {
        if (typeof value === "object" && value !== null && "value" in value) {
          const numValue = (value as Record<string, unknown>).value as number;
          if (typeof numValue === "number") {
            const dimension = (normalized as Record<string, unknown>).transaction as string || "";
            samples.push({
              eventId,
              projectId,
              appId,
              metric: key,
              value: numValue,
              dimension,
              timestamp,
            });
          }
        }
      }

      // Duration
      const duration = payload.duration as number;
      if (typeof duration === "number") {
        const dimension = (normalized as Record<string, unknown>).transaction as string || "";
        samples.push({
          eventId,
          projectId,
          appId,
          metric: "duration",
          value: duration,
          dimension,
          timestamp,
        });
      }

      // Web vitals from payload measurements
      const webVitals = ["lcp", "inp", "cls", "fcp", "ttfb", "fp", "fid", "ttfb.requesttime"];
      const allMeasurements = payloadMeasurements || normalizedMeasurements;
      if (allMeasurements) {
        for (const vital of ["lcp", "inp", "cls", "fcp", "ttfb", "fp", "fid", "ttfb.requesttime"]) {
          if (vital in allMeasurements) {
            const m = allMeasurements[vital] as Record<string, unknown>;
            if (m && typeof m.value === "number") {
              samples.push({
                eventId,
                projectId,
                appId,
                metric: vital,
                value: m.value,
                dimension: "",
                timestamp,
              });
            }
          }
        }

        // Mobile vitals from measurements
        const mobileVitals = [
          "app_start_cold", "app_start_warm", "time_to_initial_display", "time_to_full_display",
          "frames_total", "frames_slow", "frames_frozen", "stall_count",
          "stall_total_time", "stall_longest_time",
          "frames_slow_rate", "frames_frozen_rate", "stall_percentage",
        ];
        for (const vital of mobileVitals) {
          if (vital in allMeasurements) {
            const m = allMeasurements[vital] as Record<string, unknown>;
            if (m && typeof m.value === "number") {
              samples.push({
                eventId,
                projectId,
                appId,
                metric: vital,
                value: m.value,
                dimension: "",
                timestamp,
              });
            }
          }
        }
      }
    }
  }

  return samples;
}

export function metricsToJSONEachRow(samples: MetricSample[]): string {
  return samples.map(s => JSON.stringify(s)).join("\n");
}