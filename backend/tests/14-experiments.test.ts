/**
 * API Test: Experiments / A/B Testing (14-experiments)
 *
 * Tests A/B testing on top of feature flags: sticky assignment,
 * eligibility targeting, metric tracking, statistical results,
 * guardrails, lifecycle, and the SSE push stream.
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
  defaultValue: any;
  status: string;
  variants: Array<{ key: string; name: string; value: any; weight: number }>;
  targetingRules: Array<any>;
  rolloutPercentage: number;
  experiment?: any;
}

interface Evaluation {
  flagKey: string;
  variantKey: string;
  value: any;
  reason: string;
  errorCode?: string | null;
  assignmentId?: string;
}

interface EvaluationResponse {
  evaluations: Evaluation[];
  evaluatedAt: string;
}

async function adminRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const url = new URL(`${baseUrl}${path}`);
  const options: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: ADMIN_TOKEN,
    },
  };
  if (body !== undefined) options.body = JSON.stringify(body);
  return await fetch(url, options);
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
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

async function evaluateRequest(body: unknown): Promise<Response> {
  const url = new URL(`${baseUrl}/api/sentry/flags/evaluate`);
  url.searchParams.set("sentry_key", await sentryDsnKey());
  return await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function trackRequest(body: unknown): Promise<Response> {
  const url = new URL(`${baseUrl}/api/sentry/flags/experiment/track`);
  url.searchParams.set("sentry_key", await sentryDsnKey());
  return await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function evaluateUser(
  flagKey: string,
  userId: string,
  context?: Record<string, unknown>,
): Promise<Evaluation> {
  const res = await evaluateRequest({
    user: { id: userId },
    context,
    flags: [flagKey],
  });
  expect(res.status).toBe(200);
  const data = (await res.json()) as EvaluationResponse;
  const [evaluation] = data.evaluations;
  expect(evaluation).toBeDefined();
  return evaluation!;
}

async function createExperimentFlag(
  suffix: string,
  experiment: Record<string, unknown> = {},
  targetingRules: Array<Record<string, unknown>> = [],
): Promise<FeatureFlag> {
  const res = await adminRequest("POST", "/api/admin/feature-flags", {
        projectId: await flagProjectId(),
    key: `exp-${suffix}`,
    name: `Experiment ${suffix}`,
    type: "string",
    defaultValue: "control",
    variants: [
      { key: "control", name: "Control", value: "control", weight: 50 },
      { key: "treatment", name: "Treatment", value: "treatment", weight: 50 },
    ],
    targetingRules,
    experiment: {
      enabled: true,
      hypothesis: "Treatment performs better",
      primaryMetric: "conversion",
      minimumSampleSize: 10,
      confidenceLevel: 0.95,
      ...experiment,
    },
  });
  expect(res.status).toBe(200);
  const flag = (await res.json()) as FeatureFlag;
  const activated = await adminRequest(
    "POST",
    `/api/admin/feature-flags/${flag.id}/status`,
    { status: "active" },
  );
  expect(activated.status).toBe(200);
  return { ...flag, status: "active" };
}

describe("Experiments / A/B Testing", () => {
  it("creates an experiment-enabled flag and activates it", async () => {
    const flag = await createExperimentFlag(`create-${Date.now()}`);

    expect(flag.experiment?.enabled).toBe(true);
    expect(flag.experiment?.primaryMetric).toBe("conversion");
    expect(flag.experiment?.confidenceLevel).toBe(0.95);
    expect(flag.variants).toHaveLength(2);
    expect(flag.variants[0]?.key).toBe("control");

    const fetched = await adminRequest(
      "GET",
      `/api/admin/feature-flags/${flag.id}`,
    );
    expect(fetched.status).toBe(200);
  });

  it("assigns users stickily across evaluations", async () => {
    const flag = await createExperimentFlag(`sticky-${Date.now()}`);

    const first = await evaluateUser(flag.key, "sticky-user-1");
    const second = await evaluateUser(flag.key, "sticky-user-1");

    expect(["control", "treatment"]).toContain(first.variantKey);
    expect(second.variantKey).toBe(first.variantKey);
    expect(first.assignmentId).toBeDefined();
    expect(first.reason).toBeTruthy();
  });

  it("stores exactly one assignment under concurrent evaluations", async () => {
    const flag = await createExperimentFlag(`race-${Date.now()}`);
    const userId = `race-user-${Date.now()}`;

    // Concurrent evaluations of the same user must all succeed (the
    // flag+user assignment is unique) and agree on a single variant.
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        evaluateRequest({ user: { id: userId }, flags: [flag.key] }),
      ),
    );
    const evaluations = await Promise.all(
      responses.map(async (response) => {
        expect(response.status).toBe(200);
        const data = (await response.json()) as EvaluationResponse;
        return data.evaluations[0]!;
      }),
    );

    const variantKeys = new Set(evaluations.map((evaluation) => evaluation.variantKey));
    expect(variantKeys.size).toBe(1);
    const assignmentIds = new Set(evaluations.map((evaluation) => evaluation.assignmentId));
    expect(assignmentIds.size).toBe(1);

    const users = await json<{
      variants: Record<string, { users: Array<{ id: string }> }>;
    }>(
      await adminRequest("GET", `/api/admin/experiments/${flag.id}/users?search=${userId}`),
    );
    const matches = Object.values(users.variants).flatMap((variant) => variant.users);
    expect(matches.filter((user) => user.id === userId)).toHaveLength(1);
  });

  it("distributes different users across variants", async () => {
    const flag = await createExperimentFlag(`dist-${Date.now()}`);

    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const evaluation = await evaluateUser(flag.key, `dist-user-${i}`);
      seen.add(evaluation.variantKey);
    }
    expect(seen.has("control")).toBe(true);
    expect(seen.has("treatment")).toBe(true);
  });

  it("filters eligibility via targeting rules without pinning a variant", async () => {
    const flag = await createExperimentFlag(
      `eligibility-${Date.now()}`,
      {},
      [{ attribute: "context.browser", operator: "equals", value: "chrome" }],
    );

    const chromeUser = await evaluateUser(flag.key, "chrome-user", {
      browser: "chrome",
    });
    expect(["control", "treatment"]).toContain(chromeUser.variantKey);

    const firefoxUser = await evaluateUser(flag.key, "firefox-user", {
      browser: "firefox",
    });
    expect(firefoxUser.variantKey).toBe("control");
    expect(firefoxUser.reason).toContain("audience");
  });

  it("pins a variant when a targeting rule declares one", async () => {
    const flag = await createExperimentFlag(`pin-${Date.now()}`, {}, [
      {
        attribute: "user.email",
        operator: "ends_with",
        value: "@company.com",
        variantKey: "treatment",
      },
    ]);

    const res = await evaluateRequest({
      user: { id: "pin-user", email: "worker@company.com" },
      flags: [flag.key],
    });
    const data = (await res.json()) as EvaluationResponse;
    expect(data.evaluations[0]?.variantKey).toBe("treatment");
    expect(data.evaluations[0]?.reason).toContain("targeting rule");

    const outsider = await evaluateRequest({
      user: { id: "pin-user-2", email: "gmail@gmail.com" },
      flags: [flag.key],
    });
    const outsiderData = (await outsider.json()) as EvaluationResponse;
    expect(["control", "treatment"]).toContain(
      outsiderData.evaluations[0]?.variantKey ?? "",
    );
  });

  it("computes significant results from tracked metrics", async () => {
    const flag = await createExperimentFlag(`results-${Date.now()}`);

    const assignments: Array<{ userId: string; variantKey: string }> = [];
    for (let i = 0; i < 200; i++) {
      const evaluation = await evaluateUser(flag.key, `results-user-${i}`);
      assignments.push({ userId: `results-user-${i}`, variantKey: evaluation.variantKey });
    }

    for (const [i, assignment] of assignments.entries()) {
      const { userId, variantKey } = assignment;
      const converts = variantKey === "treatment" ? true : i % 5 === 0;
      if (converts) {
        const res = await trackRequest({
          flagKey: flag.key,
          userId,
          metric: "conversion",
          value: 1,
        });
        expect(res.status).toBe(200);
      }
    }

    const resultsRes = await adminRequest(
      "GET",
      `/api/admin/experiments/${flag.id}/results`,
    );
    expect(resultsRes.status).toBe(200);
    const results = (await resultsRes.json()) as any;

    expect(results.featureFlagId).toBe(flag.id);
    expect(results.experiment.primaryMetric).toBe("conversion");
    expect(results.experiment.status).toBe("running");

    const byKey = new Map<string, any>(results.variants.map((v: any) => [v.key, v]));
    const control = byKey.get("control");
    const treatment = byKey.get("treatment");

    expect(control.participants).toBeGreaterThan(0);
    expect(treatment.participants).toBeGreaterThan(0);
    expect(control.participants + treatment.participants).toBe(200);
    expect(control.conversionRate).toBeGreaterThan(0.02);
    expect(control.conversionRate).toBeLessThan(0.4);
    expect(treatment.conversionRate).toBe(1);
    expect(treatment.conversionRate).toBeGreaterThan(control.conversionRate);
    expect(treatment.isSignificant).toBe(true);
    expect(treatment.pValue).toBeLessThan(0.05);
    expect(treatment.relativeImprovement).toBeGreaterThan(0);
    expect(treatment.confidenceInterval).toHaveLength(2);

    expect(results.recommendation.winner).toBe("treatment");
    expect(results.recommendation.action).toBe("implement");
  });

  it("reports no significance when conversion rates are equal", async () => {
    const flag = await createExperimentFlag(`equal-${Date.now()}`);

    for (let i = 0; i < 100; i++) {
      const evaluation = await evaluateUser(flag.key, `equal-user-${i}`);
      if (i % 2 === 0) {
        await trackRequest({
          flagKey: flag.key,
          userId: `equal-user-${i}`,
          metric: "conversion",
          value: 1,
        });
        expect(evaluation).toBeDefined();
      }
    }

    const resultsRes = await adminRequest(
      "GET",
      `/api/admin/experiments/${flag.id}/results`,
    );
    const results = (await resultsRes.json()) as any;
    const byKey = new Map<string, any>(results.variants.map((v: any) => [v.key, v]));

    expect(byKey.get("treatment").isSignificant).toBe(false);
    expect(results.recommendation.action).toBe("continue");
  });

  it("auto-pauses the flag when a guardrail metric breaches its threshold", async () => {
    const flag = await createExperimentFlag(`guardrail-${Date.now()}`, {
      guardrailMetrics: [
        { metric: "error_rate", threshold: 0.05, action: "pause" },
      ],
    });

    const evaluation = await evaluateUser(flag.key, "guardrail-user");
    const trackRes = await trackRequest({
      flagKey: flag.key,
      userId: "guardrail-user",
      metric: "error_rate",
      value: 0.08,
    });
    expect(trackRes.status).toBe(200);

    const fetched = await adminRequest(
      "GET",
      `/api/admin/feature-flags/${flag.id}`,
    );
    const updated = (await fetched.json()) as FeatureFlag;
    expect(updated.status).toBe("paused");
    expect(evaluation).toBeDefined();
  });

  it("lists users per variant", async () => {
    const flag = await createExperimentFlag(`users-${Date.now()}`);

    for (let i = 0; i < 20; i++) {
      await evaluateUser(flag.key, `users-user-${i}`);
    }

    const res = await adminRequest(
      "GET",
      `/api/admin/experiments/${flag.id}/users?variantKey=control&limit=5`,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;

    expect(data.featureFlagId).toBe(flag.id);
    expect(data.variants.control.userCount).toBeGreaterThan(0);
    expect(data.variants.control.users.length).toBeLessThanOrEqual(5);
  });

  it("filters users by search case-insensitively", async () => {
    const flag = await createExperimentFlag(`usersearch-${Date.now()}`);

    for (let i = 0; i < 20; i++) {
      await evaluateUser(flag.key, `usersearch-user-${i}`);
    }

    const res = await adminRequest(
      "GET",
      `/api/admin/experiments/${flag.id}/users?search=USER-15`,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;

    const ids = Object.values(
      data.variants as Record<string, { users: Array<{ id: string }> }>,
    )
      .flatMap((variant) => variant.users.map((user) => user.id));
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => id.includes("user-15"))).toBe(true);
  });

  it("returns the evaluation for a specific user", async () => {
    const flag = await createExperimentFlag(`peruser-${Date.now()}`);

    const evaluation = await evaluateUser(flag.key, "peruser-user-1");

    const res = await adminRequest(
      "GET",
      `/api/admin/experiments/${flag.id}/users/peruser-user-1`,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;

    expect(data.featureFlagId).toBe(flag.id);
    expect(data.userId).toBe("peruser-user-1");
    expect(data.variantKey).toBe(evaluation.variantKey);
    expect(data.variantValue).toBe(evaluation.value);
  });

  it("returns 404 for a user with no assignment", async () => {
    const flag = await createExperimentFlag(`nouser-${Date.now()}`);

    const res = await adminRequest(
      "GET",
      `/api/admin/experiments/${flag.id}/users/never-seen`,
    );
    expect(res.status).toBe(404);
  });

  it("starts and stops the experiment lifecycle", async () => {
    const flag = await createExperimentFlag(`lifecycle-${Date.now()}`);

    const startRes = await adminRequest(
      "POST",
      `/api/admin/experiments/${flag.id}/start`,
    );
    expect(startRes.status).toBe(200);
    const started = (await startRes.json()) as FeatureFlag;
    expect(started.experiment.status).toBe("running");

    const stopRes = await adminRequest(
      "POST",
      `/api/admin/experiments/${flag.id}/stop`,
    );
    expect(stopRes.status).toBe(200);
    const stopped = (await stopRes.json()) as FeatureFlag;
    expect(stopped.experiment.status).toBe("completed");
  });

  it("serves the results dashboard on the admin surface", async () => {
    const flag = await createExperimentFlag(`admin-results-${Date.now()}`);
    for (let i = 0; i < 20; i++) {
      await evaluateUser(flag.key, `admin-results-user-${i}`);
    }

    const res = await adminRequest(
      "GET",
      `/api/admin/experiments/${flag.id}/results`,
    );
    expect(res.status).toBe(200);
    const results = (await res.json()) as any;
    expect(results.featureFlagId).toBe(flag.id);
    expect(Array.isArray(results.variants)).toBe(true);
    expect(results.variants.length).toBeGreaterThan(0);
    expect(results.recommendation).toBeDefined();

    const unauthorized = await fetch(
      `${baseUrl}/api/admin/experiments/${flag.id}/results`,
    );
    expect(unauthorized.status).toBe(401);
  });

  it("promotes the winning variant", async () => {
    const flag = await createExperimentFlag(`promote-${Date.now()}`);

    for (let i = 0; i < 100; i++) {
      const evaluation = await evaluateUser(flag.key, `promote-user-${i}`);
      const converts = evaluation.variantKey === "treatment" ? i % 2 === 0 : false;
      if (converts) {
        await trackRequest({
          flagKey: flag.key,
          userId: `promote-user-${i}`,
          metric: "conversion",
          value: 1,
        });
      }
    }

    const res = await adminRequest(
      "POST",
      `/api/admin/experiments/${flag.id}/promote`,
    );
    expect(res.status).toBe(200);
    const promoted = (await res.json()) as FeatureFlag;

    const winner = promoted.variants.find((v) => v.key === "treatment");
    expect(winner?.weight).toBe(100);
    expect(promoted.defaultValue).toBe("treatment");
  });

  it("rejects promoting without a significant winner", async () => {
    const flag = await createExperimentFlag(`nopromote-${Date.now()}`);

    const res = await adminRequest(
      "POST",
      `/api/admin/experiments/${flag.id}/promote`,
    );
    expect(res.status).toBe(400);
    const data = (await res.json()) as any;
    expect(data.error).toContain("No significant winner");
  });

  it("rejects tracking for users without an assignment", async () => {
    const flag = await createExperimentFlag(`untracked-${Date.now()}`);

    const res = await trackRequest({
      flagKey: flag.key,
      userId: "never-evaluated",
      metric: "conversion",
      value: 1,
    });
    expect(res.status).toBe(400);

    const unknownFlag = await trackRequest({
      flagKey: "does-not-exist",
      userId: "someone",
      metric: "conversion",
      value: 1,
    });
    expect(unknownFlag.status).toBe(404);
  });

  it("returns OpenFeature error codes for unknown flags", async () => {
    const res = await evaluateRequest({
      user: { id: "some-user" },
      flags: ["missing-flag-key"],
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as EvaluationResponse;

    expect(data.evaluations[0]?.variantKey).toBe("default");
    expect(data.evaluations[0]?.errorCode).toBe("FLAG_NOT_FOUND");
  });

  it("keeps experiment results and participants off the public surface", async () => {
    const flag = await createExperimentFlag(`public-${Date.now()}`);
    await evaluateUser(flag.key, "public-user");

    // The SDK-facing surface evaluates and tracks; it never reads the
    // experiment back.
    for (const path of [
      `/api/sentry/flags/${flag.id}/experiment/results`,
      `/api/sentry/flags/${flag.id}/users`,
      `/api/sentry/flags/${flag.id}/user/public-user`,
    ]) {
      const res = await fetch(`${baseUrl}${path}`);
      expect(res.status).toBe(404);
    }

    // The admin surface serves them, but only with a credential.
    const unauthenticated = await fetch(
      `${baseUrl}/api/admin/experiments/${flag.id}/users`,
    );
    expect(unauthenticated.status).toBe(401);
  });

  it("streams configuration_changed events over SSE", async () => {
    const suffix = `sse-${Date.now()}`;
    const flag = await createExperimentFlag(suffix);

    const streamRes = await fetch(
      `${baseUrl}/api/sentry/flags/stream?flags=${flag.key}&sentry_key=${await sentryDsnKey()}`,
    );
    expect(streamRes.status).toBe(200);
    expect(streamRes.headers.get("content-type")).toContain("text/event-stream");

    const reader = streamRes.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const snapshot = await reader.read();
    buffer += decoder.decode(snapshot.value);
    expect(buffer).toContain("snapshot");
    expect(buffer).toContain(flag.key);

    await adminRequest("PATCH", `/api/admin/feature-flags/${flag.id}`, {
      name: "Renamed Experiment",
    });

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value);
      if (buffer.includes("configuration_changed")) break;
    }
    expect(buffer).toContain("configuration_changed");
    expect(buffer).toContain(flag.key);

    await reader.cancel();
  });

  describe("OpenFlag-compatible API (v1/flags)", () => {
    async function evaluateV1(
      key: string,
      targetingKey: string,
      context?: Record<string, unknown>,
    ): Promise<Response> {
      const url = new URL(`${baseUrl}/v1/flags/${key}`);
      url.searchParams.set("sentry_key", await sentryDsnKey());
      return await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetingKey, context }),
      });
    }

    it("evaluates a single flag for a targeting key", async () => {
      const flag = await createExperimentFlag(`v1-${Date.now()}`);

      const res = await evaluateV1(flag.key, "user-1");
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        variant: string;
        value: unknown;
        reason: string;
        errorCode?: string;
      };
      expect(data.errorCode).toBeUndefined();
      expect(["control", "treatment"]).toContain(data.variant);
      expect(["control", "treatment"]).toContain(String(data.value));
      expect(typeof data.reason).toBe("string");
    });

    it("is sticky for the same targeting key", async () => {
      const flag = await createExperimentFlag(`v1-sticky-${Date.now()}`);

      const first = (
        (await (await evaluateV1(flag.key, "sticky-user")).json()) as {
          variant: string;
        }
      ).variant;
      for (let i = 0; i < 5; i++) {
        const res = await evaluateV1(flag.key, "sticky-user");
        expect(res.status).toBe(200);
        const data = (await res.json()) as { variant: string };
        expect(data.variant).toBe(first);
      }
    });

    it("returns FLAG_NOT_FOUND for unknown flags", async () => {
      const res = await evaluateV1(`missing-${Date.now()}`, "user-1");
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.variant).toBe("default");
      expect(data.value).toBeNull();
      expect(data.errorCode).toBe("FLAG_NOT_FOUND");
    });

    it("rejects a missing targeting key", async () => {
      const flag = await createExperimentFlag(`v1-req-${Date.now()}`);
      const res = await fetch(`${baseUrl}/v1/flags/${flag.key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });
});
