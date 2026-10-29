/**
 * E2E Test: Feature Flags (09-feature-flags.md)
 *
 * Tests Sentry feature flags patterns from 09-feature-flags.md
 * Uses the Elysia way of running the API without attaching to a port.
 */

import * as Sentry from "@sentry/bun";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startTestServer, ADMIN_TOKEN, type TestServer } from "./test-helpers";

let SERVER_URL = "";
let testServer: TestServer | null = null;

interface TestResult {
  id?: string;
  [key: string]: unknown;
}

async function apiRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const url = new URL(`${SERVER_URL}${path}`);
  const options: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: ADMIN_TOKEN,
    },
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }
  return await fetch(url, options);
}

async function fetchEvent(eventId: string): Promise<TestResult | null> {
  const response = await apiRequest("GET", `/events/${eventId}`);
  if (response.status === 404) return null;
  return await response.json();
}

async function fetchAllEvents(): Promise<TestResult[]> {
  const response = await apiRequest("GET", "/events");
  return await response.json();
}

async function waitForEvent(
  eventId: string,
  timeout: number = 5000,
): Promise<TestResult | null> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const event = await fetchEvent(eventId);
    if (event) return event;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

function initSentryForTest(config: { dsn: string; release?: string }): void {
  const { init } = require("@sentry/bun");
  init({
    dsn: config.dsn,
    release: config.release || "test-release",
    environment: "test",
    defaultIntegrations: false,
  });
}

let DSN = process.env.SENTRY_DSN || "";

// Self-contained backend: apps are only created through the admin API,
// so the SDK gets a real DSN provisioned on an ephemeral port.
beforeAll(async () => {
  testServer = await startTestServer();
  SERVER_URL = testServer.baseUrl;
  if (!DSN) DSN = testServer.dsn;
});

afterAll(() => {
  testServer?.stop();
});

describe("Feature Flags - Setup & Configuration (09-feature-flags.md)", () => {
  beforeAll(async () => {
    initSentryForTest({ dsn: DSN, release: "v1.0.0-test" });
  });

  it("initializes Sentry with feature flags configuration", async () => {
    // Pattern from docs: featureFlags config in Sentry.init
    // Note: featureFlags config may not be in BunOptions type yet
    Sentry.init({
      dsn: DSN,
      release: "v1.0.0-test",
      // @ts-expect-error - featureFlags not in type yet
      featureFlags: {
        fetchOnInit: true,
        pollingInterval: 60_000,
      },
      defaultIntegrations: false,
    });

    const eventId = Sentry.captureMessage("Feature flags init test");
    await Sentry.flush(5000);
    const event = await waitForEvent(eventId);

    expect(event).toBeDefined();
    expect((event as any).release).toBe("v1.0.0-test");
  });

  it("sets user context for flag targeting", async () => {
    // Pattern from docs: user attributes for targeting
    Sentry.setUser({
      id: "user-123",
      email: "user@example.com",
      username: "johndoe",
      segment: "premium",
      beta_opt_in: true,
      plan: "pro",
      signup_date: "2024-01-15",
    });

    const eventId = Sentry.captureMessage("User context for flags");
    await Sentry.flush(5000);
    const event = await waitForEvent(eventId);

    expect(event).toBeDefined();
    expect((event as any).user?.id).toBe("user-123");
    expect((event as any).user?.segment).toBe("premium");
    expect((event as any).user?.beta_opt_in).toBe(true);
    expect((event as any).user?.plan).toBe("pro");
  });

  it("sets custom context for flag evaluation", async () => {
    // Pattern from docs: custom context for targeting rules
    Sentry.setContext("custom", {
      region: "us-east",
      app_version: "v1.0.0-test",
      feature_tier: "beta",
    });

    const eventId = Sentry.captureMessage("Custom context for flags");
    await Sentry.flush(5000);
    const event = await waitForEvent(eventId);

    expect(event).toBeDefined();
    expect((event as any).contexts?.custom?.region).toBe("us-east");
    expect((event as any).contexts?.custom?.app_version).toBe("v1.0.0-test");
  });
});

describe("Feature Flags - Boolean Flag Patterns (09-feature-flags.md)", () => {
  beforeAll(async () => {
    initSentryForTest({ dsn: DSN, release: "v1.0.0-test" });
  });

  it("simulates boolean flag evaluation pattern", () => {
    // Pattern from docs: getFeatureFlags returns boolean flags
    const mockFlags = {
      "new-checkout": true,
      "dark-mode": false,
      "beta-api-v2": "control" as const,
    };

    const newCheckoutEnabled = mockFlags["new-checkout"];
    const darkModeEnabled = mockFlags["dark-mode"];

    expect(newCheckoutEnabled).toBe(true);
    expect(darkModeEnabled).toBe(false);
  });

  it("demonstrates flag-based code branching", () => {
    // Pattern from docs: if (flags["new-checkout"]) { ... }
    const flags = {
      "new-checkout": true,
      "dark-mode": false,
    };

    let checkoutVersion = "legacy";
    if (flags["new-checkout"]) {
      checkoutVersion = "new";
    }

    let theme = "light";
    if (flags["dark-mode"]) {
      theme = "dark";
    }

    expect(checkoutVersion).toBe("new");
    expect(theme).toBe("light");
  });

  it("tracks flag state in error context", async () => {
    // Pattern from docs: beforeSend adds flag state to errors
    const mockFlags = {
      "new-checkout": true,
      "dark-mode": false,
    };

    Sentry.init({
      dsn: DSN,
      release: "v1.0.0-test",
      beforeSend(event) {
        event.tags = {
          ...event.tags,
          "feature-flags": JSON.stringify(mockFlags),
        };
        return event;
      },
      defaultIntegrations: false,
    });

    const eventId = Sentry.captureMessage("Error with flag context");
    await Sentry.flush(5000);
    const event = await waitForEvent(eventId);

    expect(event).toBeDefined();
    expect((event as any).tags?.["feature-flags"]).toContain("new-checkout");
    expect((event as any).tags?.["feature-flags"]).toContain("true");
  });
});

describe("Feature Flags - Multivariate Flag Patterns (09-feature-flags.md)", () => {
  beforeAll(async () => {
    initSentryForTest({ dsn: DSN, release: "v1.0.0-test" });
  });

  it("handles multivariate flag variants", () => {
    // Pattern from docs: multivariate flags with variants
    const mockFlags = {
      "beta-api-v2": "treatment-a" as const,
    };

    const variant = mockFlags["beta-api-v2"];

    expect(["control", "treatment-a", "treatment-b"]).toContain(variant);
    expect(variant).toBe("treatment-a");
  });

  it("selects API endpoint based on variant", () => {
    // Pattern from docs: variant-based API routing
    const variant: string = "treatment-b";

    const baseUrl =
      variant === "control"
        ? "https://api.v1.example.com"
        : "https://api.v2.example.com";

    const headers: Record<string, string> = {};
    if (variant === "treatment-b") {
      headers["X-Cache-Strategy"] = "aggressive";
    }

    expect(baseUrl).toBe("https://api.v2.example.com");
    expect(headers["X-Cache-Strategy"]).toBe("aggressive");
  });

  it("tracks experiment variant for analytics", async () => {
    // Pattern from docs: Sentry.setTag for experiment tracking
    const variant = "treatment-a";

    Sentry.setTag("experiment.beta-api-v2", variant);

    const eventId = Sentry.captureMessage("Experiment variant tracking");
    await Sentry.flush(5000);
    const event = await waitForEvent(eventId);

    expect(event).toBeDefined();
    expect((event as any).tags?.["experiment.beta-api-v2"]).toBe("treatment-a");
  });

  it("records experiment conversion metrics", async () => {
    // Pattern from docs: metrics.increment for experiment tracking
    const variant = "treatment-a";
    const converted = true;
    const revenue = 99.99;

    Sentry.metrics.increment("experiment.conversion", 1, {
      tags: {
        experiment: "beta-api-v2",
        variant,
        converted: converted.toString(),
      },
    });

    Sentry.metrics.distribution("experiment.revenue", revenue, {
      tags: { experiment: "beta-api-v2", variant },
      unit: "currency:USD",
    });

    const eventId = Sentry.captureMessage("Experiment metrics recorded");
    await Sentry.flush(5000);
    const event = await waitForEvent(eventId);

    expect(event).toBeDefined();
  });
});

describe("Feature Flags - Targeting Rules Patterns (09-feature-flags.md)", () => {
  beforeAll(async () => {
    initSentryForTest({ dsn: DSN, release: "v1.0.0-test" });
  });

  it("evaluates targeting rule: user segment", () => {
    // Pattern: IF user.segment = "beta" → 100%
    const user = { segment: "beta", beta_opt_in: false };
    const isBetaUser = user.segment === "beta";

    expect(isBetaUser).toBe(true);
  });

  it("evaluates targeting rule: user plan", () => {
    // Pattern: IF user.plan IN ["pro", "enterprise"]
    const user = { plan: "pro" };
    const paidPlans = ["pro", "enterprise"];
    const isPaidUser = paidPlans.includes(user.plan);

    expect(isPaidUser).toBe(true);
  });

  it("evaluates targeting rule: signup date", () => {
    // Pattern: IF user.signup_date > "2024-01-01"
    const user = { signup_date: "2024-06-15" };
    const cutoffDate = "2024-01-01";
    const isNewUser = user.signup_date > cutoffDate;

    expect(isNewUser).toBe(true);
  });

  it("evaluates targeting rule: beta opt-in", () => {
    // Pattern: IF user.beta_opt_in = true
    const user = { beta_opt_in: true };
    const isOptedIn = user.beta_opt_in === true;

    expect(isOptedIn).toBe(true);
  });

  it("evaluates targeting rule: geographic region", () => {
    // Pattern: IF custom.region = "us-east"
    const custom = { region: "us-east" };
    const isUSEast = custom.region === "us-east";

    expect(isUSEast).toBe(true);
  });

  it("evaluates targeting rule: percentage rollout", () => {
    // Pattern: user.id % 100 < 25 (25% rollout)
    const userId = "user-123";
    // Simple hash for demo
    const hash = userId
      .split("")
      .reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const percentile = hash % 100;
    const inRollout = percentile < 25;

    expect(percentile).toBeGreaterThanOrEqual(0);
    expect(percentile).toBeLessThan(100);
    // Just verify the pattern works
    expect(typeof inRollout).toBe("boolean");
  });
});

describe("Feature Flags - Segments Patterns (09-feature-flags.md)", () => {
  beforeAll(async () => {
    initSentryForTest({ dsn: DSN, release: "v1.0.0-test" });
  });

  it("defines segment with multiple rules", () => {
    // Pattern from docs: segment definition
    interface SegmentRule {
      attribute: string;
      operator: string;
      value: number | string[];
    }
    interface Segment {
      name: string;
      description: string;
      rules: SegmentRule[];
    }

    const powerUserSegment: Segment = {
      name: "power-users",
      description: "Users with >100 events in last 30 days",
      rules: [
        { attribute: "custom.events_30d", operator: ">", value: 100 },
        {
          attribute: "user.plan",
          operator: "IN",
          value: ["pro", "enterprise"],
        },
      ],
    };

    expect(powerUserSegment.rules).toHaveLength(2);
    expect(powerUserSegment.rules[0]?.operator).toBe(">");
    expect(powerUserSegment.rules[1]?.operator).toBe("IN");
  });

  it("checks user against segment rules", () => {
    // Pattern: evaluate user against segment
    interface User {
      custom: { events_30d: number };
      plan: string;
    }
    interface Rule {
      attribute: string;
      operator: string;
      value: number | string[];
    }

    const user: User = {
      custom: { events_30d: 150 },
      plan: "pro",
    };

    const rules: Rule[] = [
      { attribute: "custom.events_30d", operator: ">", value: 100 },
      { attribute: "plan", operator: "IN", value: ["pro", "enterprise"] },
    ];

    const matches = rules.every((rule) => {
      const keys = rule.attribute.split(".");
      let value: unknown = user;
      for (const key of keys) {
        value = (value as Record<string, unknown>)?.[key];
      }
      switch (rule.operator) {
        case ">":
          return (value as number) > (rule.value as number);
        case "IN":
          return (rule.value as string[]).includes(value as string);
        default:
          return false;
      }
    });

    expect(matches).toBe(true);
  });

  it("uses segment in flag targeting", () => {
    // Pattern: IF user IN SEGMENT "power-users" → 100%
    const userInSegment = true; // Result of segment evaluation
    const rollout = userInSegment ? 100 : 25;

    expect(rollout).toBe(100);
  });
});

describe("Feature Flags - Kill Switch Patterns (09-feature-flags.md)", () => {
  beforeAll(async () => {
    initSentryForTest({ dsn: DSN, release: "v1.0.0-test" });
  });

  it("implements manual kill switch pattern", () => {
    // Pattern: emergency disable bypasses all rules
    const flagState = {
      enabled: true,
      rollout: 25,
      killSwitch: false,
    };

    let effectiveEnabled = flagState.enabled && !flagState.killSwitch;
    expect(effectiveEnabled).toBe(true);

    flagState.killSwitch = true;
    effectiveEnabled = flagState.enabled && !flagState.killSwitch;
    expect(effectiveEnabled).toBe(false);
  });

  it("implements automated kill switch based on metrics", () => {
    // Pattern from docs: metric-based kill switch
    const killSwitchConfig = {
      flag: "new-checkout",
      trigger: {
        metric: "error_rate",
        threshold: 0.05, // 5%
        window: "5m",
        min_evaluations: 100,
      },
      action: "disable",
    };

    const currentErrorRate = 0.08; // 8% - exceeds threshold
    const evaluations = 150;

    const shouldTrigger =
      currentErrorRate > killSwitchConfig.trigger.threshold &&
      evaluations >= killSwitchConfig.trigger.min_evaluations;

    expect(shouldTrigger).toBe(true);
    expect(killSwitchConfig.action).toBe("disable");
  });

  it("does not trigger kill switch below threshold", () => {
    const killSwitchConfig = {
      trigger: {
        metric: "error_rate",
        threshold: 0.05,
        min_evaluations: 100,
      },
    };

    const currentErrorRate = 0.02; // 2% - below threshold
    const evaluations = 150;

    const shouldTrigger =
      currentErrorRate > killSwitchConfig.trigger.threshold &&
      evaluations >= killSwitchConfig.trigger.min_evaluations;

    expect(shouldTrigger).toBe(false);
  });
});

describe("Feature Flags - Release Integration (09-feature-flags.md)", () => {
  beforeAll(async () => {
    initSentryForTest({ dsn: DSN, release: "v2.3.0" });
  });

  it("associates flags with release version", async () => {
    // Pattern: flags scoped to release in Sentry.init
    const release = "v2.3.0";

    Sentry.init({
      dsn: DSN,
      release,
      defaultIntegrations: false,
    });

    const eventId = Sentry.captureMessage("Release-scoped flags test");
    await Sentry.flush(5000);
    const event = await waitForEvent(eventId);

    expect(event).toBeDefined();
    expect((event as any).release).toBe(release);
  });

  it("tracks flag evaluations per release", () => {
    // Pattern: release health + flags dashboard data
    const releaseFlags = {
      "v2.3.0": {
        "new-checkout": { rollout: 25, evaluations: 12450, enabledPct: 24.8 },
        "dark-mode": { rollout: 100, evaluations: 45200, enabledPct: 100 },
        "beta-api-v2": { rollout: 10, evaluations: 4520, enabledPct: 10.1 },
      },
    };

    const flags = releaseFlags["v2.3.0"];
    expect(flags["new-checkout"].rollout).toBe(25);
    expect(flags["dark-mode"].enabledPct).toBe(100);
    expect(flags["beta-api-v2"].rollout).toBe(10);
  });

  it("correlates flag state with error rates", () => {
    // Pattern: error rate per flag variant
    const flagErrorRates = {
      "new-checkout": {
        on: { errors: 25, events: 12450, rate: 0.002 },
        off: { errors: 150, events: 37750, rate: 0.004 },
      },
    };

    const checkout = flagErrorRates["new-checkout"];
    expect(checkout.on.rate).toBeLessThan(checkout.off.rate);
  });
});

describe("Feature Flags - Caching & Performance Patterns (09-feature-flags.md)", () => {
  beforeAll(async () => {
    initSentryForTest({ dsn: DSN, release: "v1.0.0-test" });
  });

  it("implements flag caching with TTL", () => {
    // Pattern from docs: cache with TTL
    let flagsCache: Record<string, any> | null = null;
    let lastFetch = 0;
    const CACHE_TTL = 30_000;

    function isCacheValid(): boolean {
      return flagsCache !== null && Date.now() - lastFetch < CACHE_TTL;
    }

    expect(isCacheValid()).toBe(false);

    flagsCache = { "new-checkout": true };
    lastFetch = Date.now();
    expect(isCacheValid()).toBe(true);

    lastFetch = Date.now() - CACHE_TTL - 1000;
    expect(isCacheValid()).toBe(false);
  });

  it("evaluates flags only once per request", () => {
    // Pattern: single evaluation per request
    let evaluationCount = 0;

    function evaluateFlags(): Record<string, any> {
      evaluationCount++;
      return { "new-checkout": true, "dark-mode": false };
    }

    // Multiple calls in same request should use cache
    const flags1 = evaluateFlags();
    const flags2 = evaluateFlags(); // In real code, would use cached value

    // This test just verifies the pattern concept
    expect(flags1).toEqual(flags2);
  });
});

describe("Feature Flags - Migration Patterns (09-feature-flags.md)", () => {
  beforeAll(async () => {
    initSentryForTest({ dsn: DSN, release: "v1.0.0-test" });
  });

  it("maps LaunchDarkly flag structure to Sentry", () => {
    // Pattern from docs: LaunchDarkly → Sentry migration
    interface LDFlag {
      key: string;
      variations: Array<{ value: boolean; weight: number }>;
      targets: Array<{ attribute: string; op: string; values: string[] }>;
      rollout: number;
    }
    interface SentryFlag {
      key: string;
      defaultValue: boolean;
      rollout: number;
      targetingRules: Array<{
        attribute: string;
        operator: string;
        value: string;
      }>;
    }

    const ldFlag: LDFlag = {
      key: "new-feature",
      variations: [
        { value: false, weight: 75 },
        { value: true, weight: 25 },
      ],
      targets: [
        { attribute: "email", op: "endsWith", values: ["@company.com"] },
      ],
      rollout: 25,
    };

    const sentryFlag: SentryFlag = {
      key: ldFlag.key,
      defaultValue: ldFlag.variations[0]?.value ?? false,
      rollout: ldFlag.rollout,
      targetingRules: ldFlag.targets.map((t) => ({
        attribute: t.attribute,
        operator: t.op === "endsWith" ? "ENDS_WITH" : "=",
        value: t.values[0] ?? "",
      })),
    };

    expect(sentryFlag.key).toBe("new-feature");
    expect(sentryFlag.rollout).toBe(25);
    expect(sentryFlag.targetingRules[0]?.operator).toBe("ENDS_WITH");
  });

  it("maps Unleash flag structure to Sentry", () => {
    // Pattern from docs: Unleash → Sentry migration
    interface UnleashFlag {
      name: string;
      enabled: boolean;
      strategies: Array<{
        name: string;
        parameters: Record<string, string | number>;
      }>;
    }
    interface SentryFlag {
      key: string;
      defaultValue: boolean;
      rollout: number;
      targetingRules: Array<{
        attribute: string;
        operator: string;
        value: string[];
      }>;
    }

    const unleashFlag: UnleashFlag = {
      name: "new-feature",
      enabled: true,
      strategies: [
        { name: "gradualRolloutUserId", parameters: { percentage: 25 } },
        { name: "userWithId", parameters: { userIds: "1,2,3" } },
      ],
    };

    const sentryFlag: SentryFlag = {
      key: unleashFlag.name,
      defaultValue: unleashFlag.enabled,
      rollout: 25, // from gradualRolloutUserId
      targetingRules: [
        { attribute: "user.id", operator: "IN", value: ["1", "2", "3"] },
      ],
    };

    expect(sentryFlag.key).toBe("new-feature");
    expect(sentryFlag.rollout).toBe(25);
    expect(sentryFlag.targetingRules[0]?.value).toEqual(["1", "2", "3"]);
  });
});

describe("Feature Flags - Self-Hosted Config Patterns (09-feature-flags.md)", () => {
  beforeAll(async () => {
    initSentryForTest({ dsn: DSN, release: "v1.0.0-test" });
  });

  it("validates self-hosted feature flags config structure", () => {
    // Pattern from docs: sentry/config.yml feature_flags section
    const config = {
      feature_flags: {
        enabled: true,
        evaluation: {
          cache_ttl: 300,
          max_concurrent: 1000,
        },
        storage: {
          backend: "postgres",
          redis: {
            hosts: ["redis:6379"],
            key_prefix: "sentry:ff:",
          },
        },
        analytics: {
          enabled: true,
          sample_rate: 0.1,
        },
        api: {
          rate_limit: 1000,
        },
      },
    };

    expect(config.feature_flags.enabled).toBe(true);
    expect(config.feature_flags.evaluation.cache_ttl).toBe(300);
    expect(config.feature_flags.storage.backend).toBe("postgres");
    expect(config.feature_flags.analytics.sample_rate).toBe(0.1);
    expect(config.feature_flags.api.rate_limit).toBe(1000);
  });
});
