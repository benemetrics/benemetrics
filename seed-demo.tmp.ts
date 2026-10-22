/**
 * Temporary demo-data seeder (deleted after the screenshots are captured).
 * Publishes the events straight to NATS with a backdated `receivedAt`, so the
 * dashboards show a realistic time series instead of one ingestion spike.
 */
import { publishEvent, publishMetricSamples } from "./backend/nats";
import { extractIssueDigests } from "./backend/issues/grouping";
import { extractMetricSamples } from "./backend/metrics/samples";
import type { SentryEventMessage } from "./backend/protocol/events";

const BASE = process.env.DEMO_BASE ?? "http://localhost:31337";
const TOKEN = process.env.DEMO_TOKEN ?? "dev-admin-token";

const adminHeaders = {
  "Content-Type": "application/json",
  Authorization: `API-Key ${TOKEN}`,
};

async function admin(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: adminHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) {
    console.error(`x ${method} ${path} -> ${res.status}`, JSON.stringify(json).slice(0, 200));
    return null;
  }
  return json;
}

let seed = Number(process.env.DEMO_SEED ?? 42);
function rand() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}

const users = ["ada@acme.io", "grace@acme.io", "linus@acme.io", "margaret@acme.io", "alan@acme.io"];
const frame = (file: string, fn: string, line: number) => ({
  filename: file, function: fn, lineno: line, colno: 12, in_app: true,
});

const errorKinds = [
  { type: "TypeError", msg: "Cannot read properties of undefined (reading 'id')", file: "src/checkout/review.ts", fn: "renderReviewSummary", line: 88 },
  { type: "RangeError", msg: "Maximum call stack size exceeded", file: "src/lib/tree.ts", fn: "flattenTree", line: 24 },
  { type: "Error", msg: "Failed to fetch cart from the pricing service", file: "src/api/cart.ts", fn: "loadCart", line: 141 },
  { type: "Error", msg: "Payment provider returned a 502 Bad Gateway", file: "src/api/payments.ts", fn: "capturePayment", line: 57 },
  { type: "TypeError", msg: "Cannot destructure property 'total' of 'undefined'", file: "src/api/cart.ts", fn: "getTotals", line: 19 },
  { type: "Error", msg: "Session cookie expired while refreshing the cart", file: "src/session/refresh.ts", fn: "refreshSession", line: 66 },
];

const transactions = [
  { name: "GET /api/products", op: "http.server", ms: 120 },
  { name: "GET /api/cart", op: "http.server", ms: 340 },
  { name: "POST /api/checkout", op: "http.server", ms: 860 },
  { name: "GET /api/products/:id", op: "http.server", ms: 95 },
  { name: "POST /api/auth/login", op: "http.server", ms: 210 },
  { name: "GET /api/search", op: "http.server", ms: 480 },
];

async function publish(app: any, projectId: string, items: any[], receivedAt: string) {
  const eventId = items[0].payload.event_id as string;
  const parsed = items.map((item) => ({
    header: { type: item.type, content_type: "application/json" },
    payload: item.payload,
  }));
  const message: SentryEventMessage = {
    id: eventId,
    projectId,
    appId: app.id,
    envelopeHeader: JSON.stringify({ event_id: eventId, sent_at: receivedAt }),
    envelopeItems: JSON.stringify(parsed),
    issueEvents: JSON.stringify(extractIssueDigests(parsed as any)),
    receivedAt,
    type: "envelope",
  };
  await publishEvent(message);
  await publishMetricSamples(
    extractMetricSamples({ projectId, appId: app.id, eventId, items: parsed as any, receivedAt }),
  );
}

async function main() {
  console.log("-> creating projects");
  const storefront = await admin("POST", "/api/admin/projects", {
    name: "Acme Storefront", description: "Customer-facing web checkout",
  });
  const platform = await admin("POST", "/api/admin/projects", {
    name: "Acme Platform", description: "Internal services and workers",
  });
  if (!storefront || !platform) throw new Error("project creation failed");

  await admin("POST", "/api/admin/environments", { projectId: storefront.id, name: "production" });
  await admin("POST", "/api/admin/environments", { projectId: storefront.id, name: "staging" });
  await admin("POST", "/api/admin/environments", { projectId: platform.id, name: "production" });

  const web = await admin("POST", `/api/admin/projects/${storefront.id}/apps`, { name: "web", platform: "react", environment: "production" });
  const api = await admin("POST", `/api/admin/projects/${storefront.id}/apps`, { name: "checkout-api", platform: "node", environment: "production" });
  const worker = await admin("POST", `/api/admin/projects/${storefront.id}/apps`, { name: "web-staging", platform: "react", environment: "staging" });
  const svc = await admin("POST", `/api/admin/projects/${platform.id}/apps`, { name: "billing-service", platform: "python", environment: "production" });
  console.log("-> apps:", web?.name, api?.name, worker?.name, svc?.name);

  console.log("-> feature flags");
  const flag1 = await admin("POST", "/api/admin/feature-flags", {
    key: "new-checkout-flow", name: "New checkout flow",
    description: "The redesigned single-page checkout",
    type: "boolean", defaultValue: false, projectId: storefront.id,
    variants: [
      { key: "control", name: "Control", value: false, weight: 50 },
      { key: "treatment", name: "Treatment", value: true, weight: 50 },
    ],
    rolloutPercentage: 100,
    experiment: {
      enabled: true, status: "running",
      hypothesis: "The redesigned checkout increases completed orders",
      primaryMetric: "checkout_completed", confidenceLevel: 0.95,
    },
  });
  const flag2 = await admin("POST", "/api/admin/feature-flags", {
    key: "search-ranking-v2", name: "Search ranking v2",
    description: "Learned ranking for the product search",
    type: "boolean", defaultValue: false, projectId: storefront.id,
    variants: [
      { key: "control", name: "Control", value: false, weight: 50 },
      { key: "treatment", name: "Treatment", value: true, weight: 50 },
    ],
  });
  const flag3 = await admin("POST", "/api/admin/feature-flags", {
    key: "express-checkout", name: "Express checkout",
    description: "One-tap payment with stored cards",
    type: "boolean", defaultValue: false, projectId: storefront.id, appId: web.id,
  });
  const flag4 = await admin("POST", "/api/admin/feature-flags", {
    key: "fast-shipping-quotes", name: "Fast shipping quotes",
    description: "Quote shipping from the carrier network live",
    type: "number", defaultValue: 0, projectId: platform.id,
  });
  for (const f of [flag1, flag2, flag3, flag4]) {
    if (f?.id) await admin("POST", `/api/admin/feature-flags/${f.id}/status`, { status: "active" });
  }

  await admin("POST", "/api/admin/segments", {
    name: "Beta testers", description: "Users opted into the beta programme",
    rules: [{ attribute: "user.plan", operator: "equals", value: "beta" }],
  });
  await admin("POST", "/api/admin/segments", {
    name: "Enterprise", description: "Enterprise plan customers",
    rules: [{ attribute: "user.plan", operator: "equals", value: "enterprise" }],
  });

  console.log("-> alerting");
  const webhook = await admin("POST", "/api/admin/alerting/channels", {
    name: "Slack #oncall", type: "slack", config: { webhookUrl: "https://hooks.slack.com/services/demo/oncall" },
  });
  const email = await admin("POST", "/api/admin/alerting/channels", {
    name: "Engineering email", type: "email",
    config: { to: "oncall@acme.io", from: "benemetrics@acme.io", host: "smtp.acme.io" },
  });
  await admin("POST", "/api/admin/alerting/rules", {
    name: "Error rate spike", trigger: "threshold", metric: "error_count",
    operator: "gt", threshold: 3, windowSeconds: 3600,
    channelIds: webhook?.id ? [webhook.id] : [],
  });
  await admin("POST", "/api/admin/alerting/rules", {
    name: "p95 latency regression", trigger: "threshold", metric: "latency_p95",
    operator: "gt", threshold: 500, windowSeconds: 3600, measurement: "duration",
    channelIds: webhook?.id && email?.id ? [webhook.id, email.id] : [],
  });
  await admin("POST", "/api/admin/alerting/rules", {
    name: "New issue detected", trigger: "new_issue",
    channelIds: webhook?.id ? [webhook.id] : [],
  });
  await admin("POST", "/api/admin/alerting/rules", {
    name: "Regression after a fix", trigger: "regression",
    channelIds: webhook?.id ? [webhook.id] : [],
  });
  await admin("POST", "/api/admin/alerting/rules", {
    name: "Checkout error spike", trigger: "threshold", metric: "error_count",
    operator: "gt", threshold: 3, windowSeconds: 1800,
    channelIds: webhook?.id ? [webhook.id] : [], appId: web.id,
  });

  console.log("-> publishing backdated events");
  const now = Date.now();
  const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

  function errorItems(kind: number, minutesAgo: number, release: string, environment: string) {
    const k = errorKinds[kind % errorKinds.length]!;
    const eventId = crypto.randomUUID();
    const ts = ago(minutesAgo);
    return {
      type: "event",
      payload: {
        event_id: eventId,
        timestamp: ts,
        platform: "javascript",
        level: kind % 7 === 0 ? "fatal" : kind % 3 === 0 ? "warning" : "error",
        logger: "app",
        transaction: k.file,
        release,
        environment,
        server_name: "checkout-7d9f",
        user: { id: `u-${Math.floor(rand() * 900) + 100}`, email: users[Math.floor(rand() * users.length)]! },
        tags: { "service.name": "storefront", region: "eu-west-1", runtime: "bun" },
        contexts: {
          runtime: { name: "node", version: "22.11.0" },
          browser: { name: "Chrome", version: "131.0" },
        },
        exception: {
          values: [{
            type: k.type, value: k.msg,
            stacktrace: {
              frames: [
                { filename: "node_modules/react-dom/cjs/react-dom.production.min.js", function: "performWorkUntilDeadline", in_app: false },
                frame(k.file, k.fn, k.line),
                { filename: "src/checkout/CartProvider.tsx", function: "CartProvider", in_app: true },
              ],
            },
          }],
        },
        breadcrumbs: {
          values: [
            { timestamp: ts, type: "http", category: "fetch", level: "info", message: "GET /api/cart" },
            { timestamp: ts, type: "default", category: "ui.click", level: "info", message: "Click on button#place-order" },
          ],
        },
        message: k.msg,
      },
    };
  }

  function transactionItems(t: any, minutesAgo: number, release: string) {
    const eventId = crypto.randomUUID();
    const ts = ago(minutesAgo);
    const durationMs = Math.round(t.ms * (0.6 + rand() * 1.6));
    const start = new Date(ts).getTime() / 1000 - durationMs / 1000;
    return {
      type: "transaction",
      payload: {
        event_id: eventId,
        transaction: t.name,
        op: t.op,
        trace_id: crypto.randomUUID().replace(/-/g, ""),
        span_id: crypto.randomUUID().replace(/-/g, "").slice(0, 16),
        start_timestamp: start,
        timestamp: start + durationMs / 1000,
        release,
        environment: "production",
        platform: "javascript",
        user: { id: `u-${Math.floor(rand() * 900) + 100}`, email: users[Math.floor(rand() * users.length)]! },
        tags: { "service.name": "storefront", region: "eu-west-1" },
        contexts: { trace: { op: t.op, status: "ok" }, runtime: { name: "node", version: "22.11.0" } },
        measurements: {
          duration: { value: durationMs },
          "http.response_content_length": { value: 2048 + Math.round(rand() * 4096) },
        },
        spans: [{
          span_id: crypto.randomUUID().replace(/-/g, "").slice(0, 16),
          op: "db.sql.query",
          description: "SELECT * FROM products WHERE id = $1",
          start_timestamp: start + durationMs / 4000,
          timestamp: start + durationMs / 2000,
        }],
      },
    };
  }

  for (let i = 0; i < 100; i++) {
    const minutesAgo = Math.round(720 - i * 6 + rand() * 5);
    await publish(web, storefront.id, [transactionItems(transactions[i % transactions.length], minutesAgo, "web@2.14.0")], ago(minutesAgo));
    if (i % 2 === 0) await publish(api, storefront.id, [transactionItems(transactions[(i + 3) % transactions.length], minutesAgo, "checkout-api@1.9.2")], ago(minutesAgo));
    if (i % 3 === 0) await publish(svc, platform.id, [transactionItems(transactions[(i + 2) % transactions.length], minutesAgo, "billing@4.2.0")], ago(minutesAgo));
  }
  for (let i = 0; i < 34; i++) {
    const m = Math.round(700 - i * 19 + rand() * 10);
    await publish(web, storefront.id, [errorItems(i, m, "web@2.14.0", "production")], ago(m));
  }
  for (let i = 0; i < 12; i++) {
    const m = Math.round(560 - i * 42 + rand() * 10);
    await publish(web, storefront.id, [errorItems(i + 1, m, "web@2.14.0", "production")], ago(m));
  }
  for (let i = 0; i < 10; i++) {
    const m = Math.round(520 - i * 46 + rand() * 10);
    await publish(api, storefront.id, [errorItems(i + 2, m, "checkout-api@1.9.2", "production")], ago(m));
  }
  for (let i = 0; i < 6; i++) {
    const m = Math.round(440 - i * 64 + rand() * 10);
    await publish(svc, platform.id, [errorItems(i + 4, m, "billing@4.2.0", "production")], ago(m));
  }
  for (let i = 0; i < 4; i++) {
    const m = Math.round(180 - i * 40 + rand() * 10);
    await publish(worker, storefront.id, [errorItems(i + 1, m, "web@2.15.0-rc.1", "staging")], ago(m));
  }
  for (let i = 0; i < 16; i++) {
    const m = Math.round(24 - i * 1.4 + rand() * 1.2);
    await publish(web, storefront.id, [errorItems(i, m, "web@2.14.0", "production")], ago(m));
  }
  for (let i = 0; i < 30; i++) {
    const m = Math.round(88 - i * 1.9 + rand());
    await publish(web, storefront.id, [transactionItems(transactions[i % transactions.length], m, "web@2.14.0")], ago(m));
    await publish(api, storefront.id, [transactionItems(transactions[(i + 2) % transactions.length], m, "checkout-api@1.9.2")], ago(m));
  }
  {
    const eventId = crypto.randomUUID();
    const ts = ago(35);
    await publish(web, storefront.id, [{
      type: "event",
      payload: {
        event_id: eventId, timestamp: ts, level: "info", logger: "checkout",
        message: "Order #A-10231 captured successfully",
        release: "web@2.14.0", environment: "production",
        tags: { "service.name": "storefront" },
        user: { id: "u-204", email: "ada@acme.io" },
      },
    }], ts);
  }

  console.log("-> waiting for the pipeline to settle");
  await Bun.sleep(10_000);

  console.log("-> releases");
  for (const [appId, version] of [
    [web.id, "web@2.14.0"],
    [api.id, "checkout-api@1.9.2"],
    [svc.id, "billing@4.2.0"],
    [worker.id, "web@2.15.0-rc.1"],
  ]) {
    await admin("POST", "/api/admin/releases", { appId, version, ref: "main", owner: "acme", status: "finalized" });
  }
  const releases = await admin("GET", "/api/admin/releases?limit=50");
  for (const release of releases?.data ?? []) {
    if (release.status === "draft" && release.version !== "web@2.15.0-rc.1") {
      await admin("PATCH", `/api/admin/releases/${release.id}`, { status: "finalized" });
    }
  }

  console.log("-> permissions");
  await admin("POST", "/api/admin/permissions/rules", {
    name: "backend-team", environments: ["production", "staging"], appPrefixes: ["api-", "worker-"], isEnabled: true,
  });
  await admin("POST", "/api/admin/permissions/rules", {
    name: "support", environments: ["production"], appPrefixes: [], isEnabled: true,
  });
  await admin("POST", "/api/admin/permissions/grants", {
    identityId: "https://id.acme.io|alice", label: "Alice",
    environments: ["production"], appPrefixes: ["checkout-"], isEnabled: true, canWrite: false,
  });

  console.log("-> experiment traffic");
  const dsnHeaders = { "Content-Type": "application/json" };
  for (let i = 0; i < 160; i++) {
    const userId = `exp-user-${i}`;
    const res = await fetch(`${BASE}/api/sentry/flags/evaluate?sentry_key=${web.publicKey}`, {
      method: "POST",
      headers: dsnHeaders,
      body: JSON.stringify({
        user: { id: userId, email: `${userId}@acme.io` },
        context: { plan: i % 5 === 0 ? "beta" : "default", country: "DE" },
        flags: ["new-checkout-flow"],
      }),
    });
    if (!res.ok) { console.error("evaluate failed", res.status, (await res.text()).slice(0, 200)); break; }
    const body = await res.json() as any;
    const variant = body.evaluations?.[0]?.variantKey;
    const converts = variant === "treatment" ? rand() < 0.44 : rand() < 0.3;
    if (!converts) continue;
    await fetch(`${BASE}/api/sentry/flags/experiment/track?sentry_key=${web.publicKey}`, {
      method: "POST",
      headers: dsnHeaders,
      body: JSON.stringify({ flagKey: "new-checkout-flow", userId, metric: "checkout_completed", value: 1 }),
    });
  }

  console.log("done");
}

await main();
process.exit(0);
