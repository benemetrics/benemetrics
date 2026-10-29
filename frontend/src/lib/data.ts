export type Level = "fatal" | "error" | "warning" | "info";
export type IssueStatus = "unresolved" | "resolved" | "ignored";

export interface Frame {
  file: string;
  fn: string;
  line: number;
  col: number;
  inApp: boolean;
  context?: { line: number; code: string }[] | undefined;
}

export interface EventItem {
  id: string;
  issueId: string;
  title: string;
  level: Level;
  timestamp: string;
  release: string;
  environment: string;
  user: string;
  browser: string;
  os: string;
}

export interface Issue {
  id: string;
  shortId: string;
  type: string;
  message: string;
  culprit: string;
  level: Level;
  status: IssueStatus;
  events: number;
  users: number;
  firstSeen: string;
  lastSeen: string;
  trend: number[];
  frames: Frame[];
  tags: {
    environment: string;
    release: string;
    browser: string;
    handled: string;
  };
  assignee?: string | undefined;
}

export interface Variant {
  key: string;
  weight: number;
  exposures: number;
  conversion: number;
  errorRate: number;
}

export interface Flag {
  key: string;
  description: string;
  enabled: boolean;
  rollout: number;
  environment: string;
  variants: Variant[];
  primaryMetric: string;
  significance: number;
  updated: string;
}

export type ChannelType =
  "slack" | "email" | "pagerduty" | "webhook" | "discord";

export interface Channel {
  id: string;
  type: ChannelType;
  name: string;
  target: string;
  verified: boolean;
}

export interface AlertRule {
  id: string;
  name: string;
  metric: string;
  operator: ">" | "<";
  threshold: number;
  window: string;
  environment: string;
  severity: "critical" | "warning";
  channels: string[];
  enabled: boolean;
  status: "ok" | "triggered" | "muted";
  lastTriggered?: string;
}

export interface App {
  id: string;
  name: string;
  platform: string;
  dsn: string;
  release: string;
  crashFree: number;
  issues: Issue[];
  events: EventItem[];
  flags: Flag[];
  alerts: AlertRule[];
}

export interface Project {
  id: string;
  name: string;
  description: string;
  team: string;
  channels: Channel[];
  apps: App[];
}

// Deterministic PRNG so SSR and client render the same sample data.
function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOW = Date.UTC(2026, 9, 25, 23, 0, 0);
const ago = (mins: number) => new Date(NOW - mins * 60000).toISOString();

const templates: Record<
  string,
  {
    type: string;
    message: string;
    culprit: string;
    level: Level;
    frames: [string, string][];
  }[]
> = {
  js: [
    {
      type: "TypeError",
      message: "Cannot read properties of undefined (reading 'price')",
      culprit: "CartSummary in src/components/CartSummary.tsx",
      level: "error",
      frames: [
        ["src/components/CartSummary.tsx", "computeTotal"],
        ["src/components/CartSummary.tsx", "CartSummary"],
        ["node_modules/react-dom/cjs/react-dom.js", "renderWithHooks"],
      ],
    },
    {
      type: "ChunkLoadError",
      message: "Loading chunk 412 failed.",
      culprit: "webpack/runtime/jsonp",
      level: "warning",
      frames: [
        ["webpack/runtime/jsonp.js", "loadChunk"],
        ["src/routes/checkout.tsx", "lazyCheckout"],
      ],
    },
    {
      type: "Error",
      message: "Hydration failed because the initial UI does not match",
      culprit: "ProductGallery",
      level: "error",
      frames: [
        ["src/components/ProductGallery.tsx", "ProductGallery"],
        ["node_modules/react-dom/cjs/react-dom.js", "hydrateRoot"],
      ],
    },
    {
      type: "UnhandledRejection",
      message: "Network request failed: POST /api/cart",
      culprit: "src/lib/api.ts in request",
      level: "error",
      frames: [
        ["src/lib/api.ts", "request"],
        ["src/hooks/useCart.ts", "addItem"],
        ["src/components/AddToCart.tsx", "onClick"],
      ],
    },
    {
      type: "RangeError",
      message: "Maximum call stack size exceeded",
      culprit: "src/utils/deepMerge.ts",
      level: "fatal",
      frames: [
        ["src/utils/deepMerge.ts", "deepMerge"],
        ["src/utils/deepMerge.ts", "deepMerge"],
        ["src/store/index.ts", "hydrate"],
      ],
    },
  ],
  node: [
    {
      type: "PostgresError",
      message: "deadlock detected while updating orders",
      culprit: "OrderService.commit",
      level: "fatal",
      frames: [
        ["src/services/order.ts", "commit"],
        ["src/db/tx.ts", "withTransaction"],
        ["src/routes/checkout.ts", "handler"],
      ],
    },
    {
      type: "TimeoutError",
      message: "Stripe API request exceeded 10000ms",
      culprit: "PaymentGateway.charge",
      level: "error",
      frames: [
        ["src/payments/gateway.ts", "charge"],
        ["src/services/order.ts", "pay"],
      ],
    },
    {
      type: "ValidationError",
      message: '"currency" must be one of [EUR, USD, GBP]',
      culprit: "validateBody",
      level: "warning",
      frames: [
        ["src/middleware/validate.ts", "validateBody"],
        ["src/routes/checkout.ts", "handler"],
      ],
    },
    {
      type: "Error",
      message: "ECONNRESET: socket hang up",
      culprit: "InventoryClient.reserve",
      level: "error",
      frames: [
        ["src/clients/inventory.ts", "reserve"],
        ["src/services/order.ts", "reserveStock"],
      ],
    },
  ],
  swift: [
    {
      type: "EXC_BAD_ACCESS",
      message: "KERN_INVALID_ADDRESS at 0x0000000000000010",
      culprit: "ImageCache.load(url:)",
      level: "fatal",
      frames: [
        ["ImageCache.swift", "ImageCache.load(url:)"],
        ["ProductCell.swift", "ProductCell.configure(_:)"],
        ["UIKitCore", "-[UITableView _createCell]"],
      ],
    },
    {
      type: "NSInternalInconsistencyException",
      message: "Invalid update: invalid number of rows in section 0",
      culprit: "CartViewController.reload",
      level: "error",
      frames: [
        ["CartViewController.swift", "reload()"],
        ["CartStore.swift", "didChange"],
      ],
    },
    {
      type: "DecodingError",
      message: 'keyNotFound: CodingKeys(stringValue: "sku")',
      culprit: "Product.init(from:)",
      level: "warning",
      frames: [
        ["Product.swift", "init(from:)"],
        ["APIClient.swift", "decode(_:)"],
      ],
    },
  ],
};

const codeLines = [
  "const items = cart.items ?? [];",
  "for (const item of items) {",
  "  total += item.variant.price * item.qty;",
  "}",
  "return applyDiscount(total, cart.coupon);",
];

function makeIssues(
  appId: string,
  kind: keyof typeof templates,
  prefix: string,
): Issue[] {
  const r = rng(appId);
  return templates[kind]!.map((t, i) => {
    const events = Math.floor(r() * 9000) + 40;
    const statusRoll = r();
    const status: IssueStatus =
      statusRoll > 0.85
        ? "resolved"
        : statusRoll > 0.75
          ? "ignored"
          : "unresolved";
    return {
      id: `${appId}-${i + 1}`,
      shortId: `${prefix}-${100 + i * 7 + Math.floor(r() * 6)}`,
      ...t,
      status,
      events,
      users: Math.floor(events * (0.1 + r() * 0.5)),
      firstSeen: ago(60 * 24 * (2 + Math.floor(r() * 30))),
      lastSeen: ago(Math.floor(r() * 180)),
      trend: Array.from({ length: 24 }, (_, k) =>
        Math.floor(r() * 40 + (k > 18 && i === 0 ? 60 : 0)),
      ),
      frames: t.frames.map(([file, fn], fi) => {
        const line = 20 + Math.floor(r() * 180);
        const inApp =
          !file.includes("node_modules") &&
          !file.startsWith("UIKit") &&
          !file.startsWith("webpack");
        return {
          file,
          fn,
          line,
          col: Math.floor(r() * 40) + 1,
          inApp,
          context:
            fi === 0
              ? codeLines.map((code, ci) => ({ line: line - 2 + ci, code }))
              : undefined,
        };
      }),
      tags: {
        environment: r() > 0.3 ? "production" : "staging",
        release: `2026.10.${Math.floor(r() * 25) + 1}`,
        browser:
          kind === "js"
            ? r() > 0.5
              ? "Chrome 131"
              : "Safari 18.1"
            : kind === "swift"
              ? "iOS 19.1"
              : "node 22.11",
        handled: r() > 0.5 ? "yes" : "no",
      },
      assignee:
        r() > 0.5
          ? ["tiago", "marta", "joão", "ana"][Math.floor(r() * 4)]!
          : undefined,
    };
  });
}

function makeEvents(appId: string, issues: Issue[]): EventItem[] {
  const r = rng(appId + "ev");
  return Array.from({ length: 40 }, (_, i) => {
    const iss = issues[Math.floor(r() * issues.length)]!;
    return {
      id:
        Math.floor(r() * 0xffffffff)
          .toString(16)
          .padStart(8, "0") + i.toString(16).padStart(4, "0"),
      issueId: iss.id,
      title: `${iss.type}: ${iss.message}`,
      level: iss.level,
      timestamp: ago(i * 7 + Math.floor(r() * 6)),
      release: iss.tags.release,
      environment: iss.tags.environment,
      user: `user_${Math.floor(r() * 90000) + 10000}`,
      browser: iss.tags.browser,
      os: ["macOS 15", "Windows 11", "iOS 19", "Android 15", "Linux"][
        Math.floor(r() * 5)
      ]!,
    };
  });
}

function makeFlags(appId: string, defs: [string, string, string][]): Flag[] {
  const r = rng(appId + "ff");
  return defs.map(([key, description, metric]) => {
    const ctrlConv = 0.02 + r() * 0.06;
    const lift = (r() - 0.35) * 0.4;
    const exp = Math.floor(r() * 40000) + 5000;
    return {
      key,
      description,
      enabled: r() > 0.25,
      rollout: [10, 25, 50, 100][Math.floor(r() * 4)]!,
      environment: "production",
      primaryMetric: metric,
      significance: Math.round((0.6 + r() * 0.39) * 100) / 100,
      updated: ago(Math.floor(r() * 60 * 24 * 10)),
      variants: [
        {
          key: "control",
          weight: 50,
          exposures: exp,
          conversion: ctrlConv,
          errorRate: 0.004 + r() * 0.006,
        },
        {
          key: "treatment",
          weight: 50,
          exposures: Math.floor(exp * (0.95 + r() * 0.1)),
          conversion: ctrlConv * (1 + lift),
          errorRate: 0.003 + r() * 0.012,
        },
      ],
    };
  });
}

function makeAlerts(appId: string): AlertRule[] {
  return [
    {
      id: `${appId}-a1`,
      name: "Error spike",
      metric: "error_count",
      operator: ">",
      threshold: 500,
      window: "5m",
      environment: "production",
      severity: "critical",
      channels: ["c-pd", "c-slack"],
      enabled: true,
      status: appId.length % 2 ? "triggered" : "ok",
      lastTriggered: ago(42),
    },
    {
      id: `${appId}-a2`,
      name: "Crash-free sessions drop",
      metric: "crash_free_rate",
      operator: "<",
      threshold: 99.5,
      window: "1h",
      environment: "production",
      severity: "critical",
      channels: ["c-pd"],
      enabled: true,
      status: "ok",
      lastTriggered: ago(60 * 26),
    },
    {
      id: `${appId}-a3`,
      name: "New issue in release",
      metric: "new_issues",
      operator: ">",
      threshold: 0,
      window: "15m",
      environment: "production",
      severity: "warning",
      channels: ["c-slack", "c-email"],
      enabled: true,
      status: "ok",
    },
    {
      id: `${appId}-a4`,
      name: "Flag treatment error rate",
      metric: "flag_error_rate",
      operator: ">",
      threshold: 1.5,
      window: "30m",
      environment: "production",
      severity: "warning",
      channels: ["c-hook"],
      enabled: false,
      status: "muted",
    },
  ];
}

const defaultChannels: Channel[] = [
  {
    id: "c-slack",
    type: "slack",
    name: "#incidents",
    target: "acme.slack.com/#incidents",
    verified: true,
  },
  {
    id: "c-pd",
    type: "pagerduty",
    name: "On-call rotation",
    target: "service P8XK21",
    verified: true,
  },
  {
    id: "c-email",
    type: "email",
    name: "Eng leads",
    target: "eng-leads@acme.dev",
    verified: true,
  },
  {
    id: "c-hook",
    type: "webhook",
    name: "Incident bot",
    target: "https://hooks.acme.dev/glitch",
    verified: false,
  },
];

function app(
  id: string,
  name: string,
  platform: string,
  kind: keyof typeof templates,
  prefix: string,
  flags: [string, string, string][],
): App {
  const issues = makeIssues(id, kind, prefix);
  const r = rng(id + "app");
  return {
    id,
    name,
    platform,
    dsn: `https://${Math.floor(r() * 1e12).toString(16)}@ingest.glitchlog.dev/${Math.floor(r() * 9000) + 1000}`,
    release: issues[0]!.tags.release,
    crashFree: Math.round((98.6 + r() * 1.35) * 100) / 100,
    issues,
    events: makeEvents(id, issues),
    flags: makeFlags(id, flags),
    alerts: makeAlerts(id),
  };
}

export const projects: Project[] = [
  {
    id: "acme-commerce",
    name: "Acme Commerce",
    description: "Customer-facing storefront, checkout and mobile apps",
    team: "Commerce",
    channels: defaultChannels,
    apps: [
      app("web-storefront", "Web Storefront", "React", "js", "WEB", [
        [
          "new-checkout-flow",
          "One-page checkout replacing 3-step wizard",
          "checkout_conversion",
        ],
        ["reco-carousel-v2", "ML recommendations on PDP", "add_to_cart_rate"],
        [
          "sticky-cart-button",
          "Persistent cart CTA on mobile",
          "checkout_conversion",
        ],
      ]),
      app("checkout-api", "Checkout API", "Node.js", "node", "API", [
        [
          "async-inventory-reserve",
          "Reserve stock via queue instead of sync RPC",
          "order_success_rate",
        ],
        [
          "stripe-retry-policy",
          "Exponential retries for payment timeouts",
          "payment_success_rate",
        ],
      ]),
      app("ios-shop", "iOS Shop", "Swift", "swift", "IOS", [
        [
          "swiftui-cart",
          "Rewrite cart screen in SwiftUI",
          "checkout_conversion",
        ],
        [
          "image-prefetch",
          "Prefetch product images on scroll",
          "session_length",
        ],
      ]),
    ],
  },
  {
    id: "internal-platform",
    name: "Internal Platform",
    description: "Back-office tooling and async workers",
    team: "Platform",
    channels: defaultChannels.slice(0, 3),
    apps: [
      app("admin-console", "Admin Console", "React", "js", "ADM", [
        [
          "bulk-edit-grid",
          "Virtualized grid for bulk product edits",
          "task_completion",
        ],
      ]),
      app("billing-worker", "Billing Worker", "Node.js", "node", "BIL", [
        [
          "batch-invoices",
          "Batch invoice generation nightly",
          "job_success_rate",
        ],
      ]),
    ],
  },
];

export function getProject(id: string) {
  return projects.find((p) => p.id === id);
}
export function getApp(projectId: string, appId: string) {
  return getProject(projectId)?.apps.find((a) => a.id === appId);
}

export function timeAgo(iso: string) {
  const m = Math.max(1, Math.round((NOW - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function compact(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${n}`;
}

// ---------- Performance ----------
export interface Transaction {
  name: string;
  op: string;
  throughput: number; // req/min
  p50: number;
  p95: number;
  p99: number;
  failureRate: number;
  apdex: number;
  series: number[]; // p95 over last 24h
}

export interface LoadTest {
  id: string;
  scenario: string;
  target: string;
  vus: number;
  duration: string;
  rps: number;
  p95: number;
  errorRate: number;
  status: "passed" | "failed" | "running";
  ranAt: string;
}

const txNames: Record<string, [string, string][]> = {
  React: [
    ["/", "pageload"],
    ["/product/:slug", "pageload"],
    ["/checkout", "navigation"],
    ["/search", "navigation"],
  ],
  "Node.js": [
    ["POST /api/checkout", "http.server"],
    ["GET /api/cart", "http.server"],
    ["POST /api/payments", "http.server"],
    ["queue.reserve_stock", "queue.task"],
  ],
  Swift: [
    ["ProductListView", "ui.load"],
    ["CartView", "ui.load"],
    ["app.start.cold", "app.start"],
  ],
};

export function getPerformance(app: App) {
  const r = rng(app.id + "perf");
  const transactions: Transaction[] = (
    txNames[app.platform] ?? txNames["React"]!
  ).map(([name, op]) => {
    const p50 = Math.round(80 + r() * 400);
    return {
      name,
      op,
      throughput: Math.round(50 + r() * 2000),
      p50,
      p95: Math.round(p50 * (2 + r() * 1.5)),
      p99: Math.round(p50 * (3.5 + r() * 3)),
      failureRate: Math.round(r() * 300) / 100,
      apdex: Math.round((0.7 + r() * 0.29) * 100) / 100,
      series: Array.from({ length: 24 }, () =>
        Math.round(p50 * (1.8 + r() * 1.6)),
      ),
    };
  });
  const vitals = {
    lcp: Math.round((1.4 + r() * 2) * 100) / 100,
    inp: Math.round(90 + r() * 260),
    cls: Math.round(r() * 25) / 100,
  };
  const loadTests: LoadTest[] = transactions.slice(0, 3).map((t, i) => {
    const p95 = Math.round(t.p95 * (1 + r()));
    const err = Math.round(r() * 400) / 100;
    return {
      id: `lt-${app.id}-${i}`,
      scenario: ["Black Friday spike", "Soak 30m", "Baseline smoke"][i]!,
      target: t.name,
      vus: [500, 150, 20][i]!,
      duration: ["5m", "30m", "1m"][i]!,
      rps: Math.round(100 + r() * 1500),
      p95,
      errorRate: err,
      status: err > 2 || p95 > 1500 ? "failed" : "passed",
      ranAt: ago((i + 1) * 60 * 9),
    };
  });
  return { transactions, vitals, loadTests };
}

// ---------- Flag targeting ----------
export interface TargetingRule {
  id: string;
  attribute: string;
  operator:
    "is one of" | "is not one of" | "contains" | "ends with" | "greater than";
  values: string[];
  variant: string;
}

export const targetingAttributes = [
  "user.id",
  "user.email",
  "user.country",
  "user.plan",
  "device.os",
  "app.release",
];
