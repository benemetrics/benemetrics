import { env } from "bun";

const BASE_URL = "http://localhost:31337";
const RPS = env.RPS || "5000";
const DURATION = env.DURATION || "60s";
const headers = {
  "Content-Type": "application/json",
  Authorization: `API-Key ${env.ADMIN_TOKEN}`,
};

const projectResp = await fetch(`${BASE_URL}/api/admin/projects`, {
  method: "POST",
  headers,
  body: JSON.stringify({ name: `Stress ${Date.now()}` }),
});
if (!projectResp.ok) throw new Error(`Project failed: ${projectResp.status}`);
const project = (await projectResp.json()) as any;

const appResp = await fetch(
  `${BASE_URL}/api/admin/projects/${project.id}/apps`,
  {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "Stress App" }),
  },
);
if (!appResp.ok) throw new Error(`App failed: ${appResp.status}`);
const app = (await appResp.json()) as any;

const url = `${BASE_URL}/api/${app.ingestKey}/envelope/?sentry_key=${app.publicKey}`;
console.log(
  `🚀 Stressing ${url} at ${RPS} RPS for ${DURATION} (unique event_id + unique issue per request)...`,
);
// oha sends one static body; unique event ids need a per-request envelope,
// so the loop is ours. RPS-targeted like oha's -q, with an in-flight cap so
// a slow backend throttles the sender instead of exploding the queue.
const targetRps = Number(RPS);
const durationMs = Number(DURATION.replace(/s$/, "")) * 1000;
const maxInFlight = Math.max(64, targetRps);
const start = performance.now();
let sent = 0,
  ok = 0,
  failed = 0,
  inFlight = 0;
const latencies: number[] = [];

await new Promise<void>((resolve) => {
  const timer = setInterval(() => {
    const elapsed = performance.now() - start;
    if (elapsed >= durationMs) {
      clearInterval(timer);
      // Wait for the tail of in-flight requests.
      const drain = setInterval(() => {
        if (inFlight === 0) {
          clearInterval(drain);
          resolve();
        }
      }, 50);
      return;
    }
    const due = Math.floor((elapsed / 1000) * targetRps);
    while (sent < due && inFlight < maxInFlight) {
      sent++;
      inFlight++;
      const id = crypto.randomUUID().replace(/-/g, "");
      const payload = `{"event_id":"${id}","timestamp":${Date.now() / 1000},"message":"stress error #${sent}","level":"error","platform":"stress"}`;
      const envelope = `{"event_id":"${id}","timestamp":${Date.now() / 1000}}\n{"type":"event"}\n${payload}\n`;
      const t0 = performance.now();
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-sentry-envelope" },
        body: envelope,
      })
        .then((r) => {
          if (r.status === 200) ok++;
          else failed++;
          latencies.push(performance.now() - t0);
        })
        .catch(() => failed++)
        .finally(() => {
          inFlight--;
        });
    }
  }, 1);
});

const pct = (p: number) => {
  const s = latencies.sort((a, b) => a - b);
  if (s.length === 0) return "-";
  return s[Math.min(Math.floor(s.length * p), s.length - 1)].toFixed(1);
};
const wall = (performance.now() - start) / 1000;
console.log(`Summary:
  Sent:        ${sent}
  Success:     ${ok} (${((ok / sent) * 100).toFixed(2)}%)
  Failed:      ${failed}
  Effective:   ${(ok / wall).toFixed(2)}/sec
  Latency avg: ${(latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2)} ms
  p50:         ${pct(0.5)} ms
  p90:         ${pct(0.9)} ms
  p99:         ${pct(0.99)} ms
  p999:        ${pct(0.999)} ms
  Max:         ${pct(1)} ms`);

// The side-effects consumer applies issues asynchronously; give it a moment
// and report how many issues the run created for the stress app. The API
// has no totals, so "more" is a full page.
await new Promise((r) => setTimeout(r, 5000));
const issuesResp = await fetch(
  `${BASE_URL}/api/admin/issues?query=app:${app.id}&limit=100`,
  { headers },
);
if (issuesResp.ok) {
  const issues = (await issuesResp.json()) as { data: any[] };
  console.log(
    `  Issues:      ${issues.data.length >= 100 ? "100+" : issues.data.length} (drain sample)`,
  );
}
