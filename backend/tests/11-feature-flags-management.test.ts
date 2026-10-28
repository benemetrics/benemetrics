/**
 * API Test: Feature Flags Management API (11-admin.md)
 * 
 * Tests the feature flags management API endpoints.
 * Runs in-process through app.handle (no listener, no port).
 */

import { describe, it, expect } from "bun:test";
import {
  handleFetch as fetch,
  startTestApp,
  TEST_ORIGIN,
  ADMIN_TOKEN,
  type TestApp,
} from "./test-helpers";

const baseUrl = TEST_ORIGIN;

interface FeatureFlag {
  id: string;
  key: string;
  name: string;
  description: string;
  type: "boolean" | "string" | "number" | "json";
  defaultValue: any;
  variants: Array<{ key: string; name: string; value: any; weight: number }>;
  targetingRules: Array<any>;
  segments: Array<string>;
  status: "draft" | "active" | "paused" | "archived";
  rolloutPercentage: number;
  experiment?: any;
  createdAt: string;
  updatedAt: string;
}

async function apiRequest(
  method: string,
  path: string,
  body?: unknown,
  token: string = ADMIN_TOKEN
): Promise<Response> {
  const url = new URL(`${baseUrl}${path}`);
  const options: RequestInit = {
    method,
    headers: { 
      "Content-Type": "application/json",
      "Authorization": token
    },
  };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  return await fetch(url, options);
}

// The SDK surfaces authenticate with the DSN public key of a real app.
let dsnKey: Promise<string> | null = null;
// The flags belong to a project; the SDK surface resolves them in the
// app's project, so the tests share one app.
let testApp: Promise<TestApp> | null = null;
async function sentryApp(): Promise<TestApp> {
  testApp ??= startTestApp();
  return testApp;
}
async function flagProjectId(): Promise<string> {
  return (await sentryApp()).projectId;
}

async function sentryDsnKey(): Promise<string> {
  dsnKey ??= sentryApp().then((app) => app.publicKey);
  return dsnKey;
}

async function sentryRequest(
  method: string,
  path: string,
  body?: unknown
): Promise<Response> {
  const url = new URL(`${baseUrl}${path}`);
  url.searchParams.set("sentry_key", await sentryDsnKey());
  
  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  return await fetch(url, options);
}

describe("Feature Flags Management API", () => {
  describe("POST /api/admin/feature-flags", () => {
    it("should create a new boolean feature flag", async () => {
      const response = await apiRequest("POST", "/api/admin/feature-flags", {
        projectId: await flagProjectId(),
        key: "new-checkout-flow",
        name: "New Checkout Flow",
        description: "Enables the redesigned checkout experience",
        type: "boolean",
        defaultValue: false,
        variants: [
          { key: "control", name: "Control", value: false, weight: 50 },
          { key: "treatment", name: "New Flow", value: true, weight: 50 }
        ]
      });

      expect(response.status).toBe(200);
      const data = await response.json() as FeatureFlag;
      expect(data.id).toBeDefined();
      expect(data.key).toBe("new-checkout-flow");
      expect(data.name).toBe("New Checkout Flow");
      expect(data.type).toBe("boolean");
      expect(data.status).toBe("draft");
      expect(data.variants).toHaveLength(2);
    });

    it("should attach an audience segment when creating a flag", async () => {
      const segmentResponse = await apiRequest("POST", "/api/admin/feature-flags/segments", {
        name: `Audience Segment ${Date.now()}`,
        rules: [
          { id: "rule-1", attribute: "plan", operator: "equals", value: "enterprise" }
        ]
      });
      const segment = (await segmentResponse.json()) as { id: string };
      expect(segment.id).toBeDefined();

      const response = await apiRequest("POST", "/api/admin/feature-flags", {
        projectId: await flagProjectId(),
        key: `audience-flag-${Date.now()}`,
        name: "Audience Flag",
        type: "boolean",
        defaultValue: false,
        segments: [segment.id]
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as FeatureFlag;
      expect(data.segments).toEqual([segment.id]);
    });

    it("should create a string feature flag with multiple variants", async () => {
      const response = await apiRequest("POST", "/api/admin/feature-flags", {
        projectId: await flagProjectId(),
        key: "button-color",
        name: "Button Color",
        type: "string",
        defaultValue: "blue",
        variants: [
          { key: "control", name: "Blue", value: "blue", weight: 33 },
          { key: "variant_a", name: "Green", value: "green", weight: 33 },
          { key: "variant_b", name: "Orange", value: "orange", weight: 34 }
        ]
      });

      expect(response.status).toBe(200);
      const data = await response.json() as FeatureFlag;
      expect(data.variants).toHaveLength(3);
      expect(data.variants[0]!.value).toBe("blue");
    });

    it("should return 400 for missing required fields", async () => {
      const response = await apiRequest("POST", "/api/admin/feature-flags", {
        projectId: await flagProjectId(),
        name: "Missing Key"
      });

      expect(response.status).toBe(400);
    });

    it("should reject request without admin auth", async () => {
      const response = await apiRequest("POST", "/api/admin/feature-flags", {
        projectId: await flagProjectId(),
        key: "no-auth-test",
        name: "No Auth Test",
        type: "boolean",
        defaultValue: false
      }, "");

      expect(response.status).toBe(401);
    });
  });

  describe("GET /api/admin/feature-flags", () => {
    it("should list feature flags with a limit", async () => {
      const response = await apiRequest("GET", "/api/admin/feature-flags?limit=10");
      expect(response.status).toBe(200);
      const data = await response.json() as { data: FeatureFlag[] };
      expect(data.data).toBeInstanceOf(Array);
    });

    it("should filter by status", async () => {
      const response = await apiRequest("GET", "/api/admin/feature-flags?status=active");
      expect(response.status).toBe(200);
      const data = await response.json() as { data: FeatureFlag[] };
      expect(data.data).toBeInstanceOf(Array);
    });

    it("should filter by search case-insensitively", async () => {
      const suffix = "search-" + Date.now();
      const createResponse = await apiRequest("POST", "/api/admin/feature-flags", {
        projectId: await flagProjectId(),
        key: suffix,
        name: "Searchable Name",
        type: "boolean",
        defaultValue: false
      });
      const created = await createResponse.json() as FeatureFlag;

      const response = await apiRequest("GET", `/api/admin/feature-flags?search=SEARCHABLE`);
      expect(response.status).toBe(200);
      const data = await response.json() as { data: FeatureFlag[] };
      expect(data.data.some((flag) => flag.id === created.id)).toBe(true);
    });

    it("should reject an invalid status filter", async () => {
      const response = await apiRequest("GET", "/api/admin/feature-flags?status=bogus");
      expect(response.status).toBe(400);
    });
  });

  describe("GET /api/admin/feature-flags/:id", () => {
    it("should retrieve a specific feature flag", async () => {
      const createResponse = await apiRequest("POST", "/api/admin/feature-flags", {
        projectId: await flagProjectId(),
        key: "retrieve-test-" + Date.now(),
        name: "Retrieve Test",
        type: "boolean",
        defaultValue: false
      });
      const created = await createResponse.json() as FeatureFlag;

      const response = await apiRequest("GET", `/api/admin/feature-flags/${created.id}`);
      expect(response.status).toBe(200);
      const data = await response.json() as FeatureFlag;
      expect(data.id).toBe(created.id);
      expect(data.key).toBe(created.key);
    });

    it("should return 404 for non-existent flag", async () => {
      const response = await apiRequest("GET", `/api/admin/feature-flags/${crypto.randomUUID()}`);
      expect(response.status).toBe(404);
    });
  });

  describe("PATCH /api/admin/feature-flags/:id", () => {
    it("should update a feature flag", async () => {
      const createResponse = await apiRequest("POST", "/api/admin/feature-flags", {
        projectId: await flagProjectId(),
        key: "update-test-" + Date.now(),
        name: "Original Name",
        type: "boolean",
        defaultValue: false
      });
      const created = await createResponse.json() as FeatureFlag;

      const response = await apiRequest("PATCH", `/api/admin/feature-flags/${created.id}`, {
        name: "Updated Name",
        rolloutPercentage: 75
      });

      expect(response.status).toBe(200);
      const data = await response.json() as FeatureFlag;
      expect(data.name).toBe("Updated Name");
      expect(data.rolloutPercentage).toBe(75);
    });

    it("cannot overwrite internal columns through a patch", async () => {
      const createResponse = await apiRequest("POST", "/api/admin/feature-flags", {
        projectId: await flagProjectId(),
        key: "guard-test-" + Date.now(),
        name: "Guard Test",
        type: "boolean",
        defaultValue: false
      });
      const created = await createResponse.json() as FeatureFlag;

      const response = await apiRequest("PATCH", `/api/admin/feature-flags/${created.id}`, {
        id: crypto.randomUUID(),
        createdAt: "1970-01-01T00:00:00.000Z",
        name: "Renamed"
      });

      expect(response.status).toBe(200);
      const data = await response.json() as FeatureFlag;
      expect(data.id).toBe(created.id);
      expect(data.createdAt).toBe(created.createdAt);
      expect(data.name).toBe("Renamed");
    });
  });

  describe("POST /api/admin/feature-flags/:id/status", () => {
    it("should activate a feature flag", async () => {
      const createResponse = await apiRequest("POST", "/api/admin/feature-flags", {
        projectId: await flagProjectId(),
        key: "status-test-" + Date.now(),
        name: "Status Test",
        type: "boolean",
        defaultValue: false
      });
      const created = await createResponse.json() as FeatureFlag;

      const response = await apiRequest("POST", `/api/admin/feature-flags/${created.id}/status`, {
        status: "active"
      });

      expect(response.status).toBe(200);
      const data = await response.json() as FeatureFlag;
      expect(data.status).toBe("active");
    });

    it("should pause a feature flag", async () => {
      const createResponse = await apiRequest("POST", "/api/admin/feature-flags", {
        projectId: await flagProjectId(),
        key: "pause-test-" + Date.now(),
        name: "Pause Test",
        type: "boolean",
        defaultValue: false
      });
      const created = await createResponse.json() as FeatureFlag;

      await apiRequest("POST", `/api/admin/feature-flags/${created.id}/status`, {
        status: "active"
      });

      const response = await apiRequest("POST", `/api/admin/feature-flags/${created.id}/status`, {
        status: "paused"
      });

      expect(response.status).toBe(200);
      const data = await response.json() as FeatureFlag;
      expect(data.status).toBe("paused");
    });
  });

  describe("Targeting Rules", () => {
    it("should create a flag with targeting rules", async () => {
      const response = await apiRequest("POST", "/api/admin/feature-flags", {
        projectId: await flagProjectId(),
        key: "targeting-test-" + Date.now(),
        name: "Targeting Test",
        type: "boolean",
        defaultValue: false,
        targetingRules: [
          {
            attribute: "user.email",
            operator: "ends_with",
            value: "@company.com",
            variantKey: "treatment"
          }
        ],
        variants: [
          { key: "control", name: "Control", value: false, weight: 50 },
          { key: "treatment", name: "Treatment", value: true, weight: 50 }
        ]
      });

      expect(response.status).toBe(200);
      const data = await response.json() as FeatureFlag;
      expect(data.targetingRules).toHaveLength(1);
      expect(data.targetingRules[0].attribute).toBe("user.email");
    });
  });

  describe("Segments", () => {
    it("should create a segment", async () => {
      const response = await apiRequest("POST", "/api/admin/feature-flags/segments", {
        name: "Premium Users",
        description: "Users with premium subscription",
        rules: [
          { attribute: "user.custom.subscription_tier", operator: "equals", value: "premium" }
        ]
      });

      expect(response.status).toBe(200);
      const data = await response.json() as { id: string; name: string };
      expect(data.id).toBeDefined();
      expect(data.name).toBe("Premium Users");
    });

    it("should list segments", async () => {
      const response = await apiRequest("GET", "/api/admin/feature-flags/segments");
      expect(response.status).toBe(200);
      const data = await response.json() as { data: any[] };
      expect(data.data).toBeInstanceOf(Array);
    });

    it("should retrieve a segment by id", async () => {
      const createdResponse = await apiRequest("POST", "/api/admin/feature-flags/segments", {
        name: `Segment Detail ${Date.now()}`,
        description: "detail lookup",
        rules: [{ attribute: "user.id", operator: "equals", value: "user-1" }],
      });
      const created = await createdResponse.json() as { id: string };

      const response = await apiRequest("GET", `/api/admin/feature-flags/segments/${created.id}`);
      expect(response.status).toBe(200);
      const data = await response.json() as {
        id: string;
        name: string;
        rules: unknown[];
      };
      expect(data.id).toBe(created.id);
      expect(data.rules).toHaveLength(1);

      const missing = await apiRequest(
        "GET",
        `/api/admin/feature-flags/segments/${crypto.randomUUID()}`,
      );
      expect(missing.status).toBe(404);
    });
  });

  describe("Experiment / A/B Testing", () => {
    it("should create an experiment-enabled flag", async () => {
      const response = await apiRequest("POST", "/api/admin/feature-flags", {
        projectId: await flagProjectId(),
        key: "ab-test-example-" + Date.now(),
        name: "A/B Test Example",
        type: "string",
        defaultValue: "control",
        variants: [
          { key: "control", name: "Control", value: "control", weight: 50 },
          { key: "treatment", name: "Treatment", value: "treatment", weight: 50 }
        ],
        experiment: {
          enabled: true,
          hypothesis: "Treatment will increase conversions",
          primaryMetric: "conversion_rate",
          minimumSampleSize: 1000,
          confidenceLevel: 0.95
        }
      });

      expect(response.status).toBe(200);
      const data = await response.json() as FeatureFlag;
      expect(data.experiment?.enabled).toBe(true);
      expect(data.experiment?.hypothesis).toBe("Treatment will increase conversions");
    });
  });

  describe("Flag scope", () => {
    it("resolves the app flag over the project flag", async () => {
      const app = await sentryApp();
      const key = `scoped-${Date.now()}`;

      const projectFlag = await apiRequest("POST", "/api/admin/feature-flags", {
        projectId: app.projectId,
        key,
        name: "Project flag",
        type: "string",
        defaultValue: "project",
      });
      expect(projectFlag.status).toBe(200);

      const appFlag = await apiRequest("POST", "/api/admin/feature-flags", {
        projectId: app.projectId,
        appId: app.appId,
        key,
        name: "App flag",
        type: "string",
        defaultValue: "app",
      });
      expect(appFlag.status).toBe(200);

      const response = await sentryRequest("POST", "/api/sentry/flags/evaluate", {
        user: { id: "scoped-user" },
        flags: [key],
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        evaluations: Array<{ variantKey: string; value: string }>;
      };
      expect(body.evaluations[0]?.value).toBe("app");
    });

    it("keeps the same key in two projects", async () => {
      const key = `shared-${Date.now()}`;
      const first = await apiRequest("POST", "/api/admin/feature-flags", {
        projectId: (await sentryApp()).projectId,
        key,
        name: "First",
        type: "boolean",
        defaultValue: false,
      });
      expect(first.status).toBe(200);

      const otherProject = (await (
        await apiRequest("POST", "/api/admin/projects", { name: `Scope ${Date.now()}` })
      ).json()) as { id: string };
      const second = await apiRequest("POST", "/api/admin/feature-flags", {
        projectId: otherProject.id,
        key,
        name: "Second",
        type: "boolean",
        defaultValue: true,
      });
      expect(second.status).toBe(200);
    });

    it("rejects a flag without a project", async () => {
      const response = await apiRequest("POST", "/api/admin/feature-flags", {
        key: `no-project-${Date.now()}`,
        name: "No project",
        type: "boolean",
        defaultValue: false,
      });
      expect(response.status).toBe(400);
    });
  });

  describe("Evaluation API (Sentry - DSN auth)", () => {
    it("should evaluate flags for a user context", async () => {
      await apiRequest("POST", "/api/admin/feature-flags", {
        projectId: await flagProjectId(),
        key: "eval-test-orphan-" + Date.now(),
        name: "Eval Test",
        type: "boolean",
        defaultValue: false,
        variants: [
          { key: "control", name: "Control", value: false, weight: 50 },
          { key: "treatment", name: "Treatment", value: true, weight: 50 }
        ]
      });

      const key = "eval-test-" + Date.now();
      await apiRequest("POST", "/api/admin/feature-flags", {
        projectId: await flagProjectId(),
        key,
        name: "Eval Test",
        type: "boolean",
        defaultValue: false,
        variants: [
          { key: "control", name: "Control", value: false, weight: 50 },
          { key: "treatment", name: "Treatment", value: true, weight: 50 }
        ]
      });

      const response = await sentryRequest("POST", "/api/sentry/flags/evaluate", {
        user: {
          id: "user_123",
          email: "test@company.com",
          custom: { tier: "premium" }
        },
        context: {
          ip: "192.168.1.1",
          country: "US"
        },
        flags: [key]
      });

      expect(response.status).toBe(200);
    });

    it("rejects the SDK surface without a DSN key", async () => {
      const response = await apiRequest("POST", "/api/sentry/flags/evaluate", {
        user: { id: "user_123" },
        flags: ["eval-test"],
      });
      expect(response.status).toBe(401);
    });

    it("rejects the SDK surface with an unknown DSN key", async () => {
      const url = new URL(`${baseUrl}/api/sentry/flags/evaluate`);
      url.searchParams.set("sentry_key", "not-a-real-key");
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: { id: "user_123" }, flags: ["eval-test"] }),
      });
      expect(response.status).toBe(401);
    });
  });

  describe("DELETE /api/admin/feature-flags/:id", () => {
    it("should delete a draft feature flag", async () => {
      const createResponse = await apiRequest("POST", "/api/admin/feature-flags", {
        projectId: await flagProjectId(),
        key: "delete-test-" + Date.now(),
        name: "Delete Test",
        type: "boolean",
        defaultValue: false
      });
      const created = await createResponse.json() as FeatureFlag;

      const response = await apiRequest("DELETE", `/api/admin/feature-flags/${created.id}`);
      expect(response.status).toBe(200);

      const getResponse = await apiRequest("GET", `/api/admin/feature-flags/${created.id}`);
      expect(getResponse.status).toBe(404);
    });

    it("is idempotent: deleting a draft flag twice still succeeds", async () => {
      const created = (await (
        await apiRequest("POST", "/api/admin/feature-flags", {
        projectId: await flagProjectId(),
          key: "idem-" + Date.now(),
          name: "Idempotent",
          type: "boolean",
          defaultValue: false,
        })
      ).json()) as FeatureFlag;

      expect((await apiRequest("DELETE", `/api/admin/feature-flags/${created.id}`)).status).toBe(200);
      expect((await apiRequest("DELETE", `/api/admin/feature-flags/${created.id}`)).status).toBe(200);
      expect((await apiRequest("DELETE", `/api/admin/feature-flags/${crypto.randomUUID()}`)).status).toBe(200);
    });

    it("should reject deleting non-draft flag", async () => {
      const createResponse = await apiRequest("POST", "/api/admin/feature-flags", {
        projectId: await flagProjectId(),
        key: "delete-active-" + Date.now(),
        name: "Delete Active",
        type: "boolean",
        defaultValue: false
      });
      const created = await createResponse.json() as FeatureFlag;

      await apiRequest("POST", `/api/admin/feature-flags/${created.id}/status`, {
        status: "active"
      });

      const response = await apiRequest("DELETE", `/api/admin/feature-flags/${created.id}`);
      expect(response.status).toBe(400);
    });

    it("rejects variants whose weights do not sum to 100", async () => {
      const response = await apiRequest("POST", "/api/admin/feature-flags", {
        projectId: await flagProjectId(),
        key: "bad-weights-" + Date.now(),
        name: "Bad Weights",
        type: "boolean",
        defaultValue: false,
        variants: [
          { key: "control", name: "Control", value: false, weight: 30 },
          { key: "treatment", name: "Treatment", value: true, weight: 30 },
        ],
      });
      expect(response.status).toBe(400);
    });

    it("rejects a targeting rule with an unsupported attribute path", async () => {
      const response = await apiRequest("POST", "/api/admin/feature-flags", {
        projectId: await flagProjectId(),
        key: "bad-attribute-" + Date.now(),
        name: "Bad Attribute",
        type: "boolean",
        defaultValue: false,
        targetingRules: [
          { attribute: "request.headers.x", operator: "equals", value: "1" },
        ],
      });
      expect(response.status).toBe(400);
    });

    it("rejects an unsupported targeting operator", async () => {
      const response = await apiRequest("POST", "/api/admin/feature-flags", {
        projectId: await flagProjectId(),
        key: "bad-operator-" + Date.now(),
        name: "Bad Operator",
        type: "boolean",
        defaultValue: false,
        targetingRules: [
          { attribute: "user.email", operator: "between", value: "1" },
        ],
      });
      expect(response.status).toBe(400);
    });

    it("rejects an unsupported experiment confidence level", async () => {
      const response = await apiRequest("POST", "/api/admin/feature-flags", {
        projectId: await flagProjectId(),
        key: "bad-confidence-" + Date.now(),
        name: "Bad Confidence",
        type: "boolean",
        defaultValue: false,
        experiment: { enabled: true, confidenceLevel: 0.5 },
      });
      expect(response.status).toBe(400);
    });

    it("honours the rollout percentage from the create body", async () => {
      const key = "rollout-" + Date.now();
      const response = await apiRequest("POST", "/api/admin/feature-flags", {
        projectId: await flagProjectId(),
        key,
        name: "Rollout",
        type: "boolean",
        defaultValue: false,
        rolloutPercentage: 25,
      });
      expect(response.status).toBe(200);
      expect(((await response.json()) as FeatureFlag).rolloutPercentage).toBe(25);
    });

    it("rejects a patch that empties the variants", async () => {
      const createResponse = await apiRequest("POST", "/api/admin/feature-flags", {
        projectId: await flagProjectId(),
        key: "empty-variants-" + Date.now(),
        name: "Empty Variants",
        type: "boolean",
        defaultValue: false,
      });
      const created = (await createResponse.json()) as FeatureFlag;

      const response = await apiRequest("PATCH", `/api/admin/feature-flags/${created.id}`, {
        variants: [],
      });
      expect(response.status).toBe(400);
    });

    it("maps a duplicate key rename to 409", async () => {
      const first = (await (
        await apiRequest("POST", "/api/admin/feature-flags", {
        projectId: await flagProjectId(),
          key: "dup-a-" + Date.now(),
          name: "Dup A",
          type: "boolean",
          defaultValue: false,
        })
      ).json()) as FeatureFlag;
      const second = (await (
        await apiRequest("POST", "/api/admin/feature-flags", {
        projectId: await flagProjectId(),
          key: "dup-b-" + Date.now(),
          name: "Dup B",
          type: "boolean",
          defaultValue: false,
        })
      ).json()) as FeatureFlag;

      const response = await apiRequest("PATCH", `/api/admin/feature-flags/${second.id}`, {
        key: first.key,
      });
      expect(response.status).toBe(409);
    });

    it("treats archived as terminal", async () => {
      const created = (await (
        await apiRequest("POST", "/api/admin/feature-flags", {
        projectId: await flagProjectId(),
          key: "terminal-" + Date.now(),
          name: "Terminal",
          type: "boolean",
          defaultValue: false,
        })
      ).json()) as FeatureFlag;

      await apiRequest("POST", `/api/admin/feature-flags/${created.id}/status`, {
        status: "archived",
      });

      const response = await apiRequest("POST", `/api/admin/feature-flags/${created.id}/status`, {
        status: "active",
      });
      expect(response.status).toBe(400);
    });
  });
});