/**
 * E2E Test: A/B experiments
 *
 * Experiments start / results / stop on /api/admin/experiments/:flagId,
 * plus SDK evaluate / track via /api/sentry/flags/{evaluate,experiment/track}.
 * Runs against a real HTTP listener via startTestServer().
 */

import * as Sentry from "@sentry/bun";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startTestServer, ADMIN_TOKEN, type TestServer } from "./test-helpers";

let SERVER_URL = "";
let testServer!: TestServer;
let publicKey = "";

async function apiRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const url = new URL(`${SERVER_URL}${path}`);
  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", Authorization: ADMIN_TOKEN },
  };
  if (body !== undefined) options.body = JSON.stringify(body);
  return await fetch(url, options);
}

async function sentryRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const url = new URL(`${SERVER_URL}${path}`);
  url.searchParams.set("sentry_key", publicKey);
  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) options.body = JSON.stringify(body);
  return await fetch(url, options);
}

beforeAll(async () => {
  testServer = await startTestServer();
  SERVER_URL = testServer.baseUrl;
  const dsnUrl = new URL(testServer.dsn);
  publicKey = dsnUrl.username;

  Sentry.init({
    dsn: testServer.dsn,
    environment: "test",
    release: "e2e-experiments",
    defaultIntegrations: false,
  });
});

afterAll(async () => {
  await Sentry.flush(2000);
  Sentry.close();
  testServer?.stop();
});

describe("A/B experiments", () => {
  it("creates an experiment-enabled flag, starts it, reads results and stops it", async () => {
    const project = await apiRequest("POST", "/api/admin/projects", {
      name: `AB Project ${Date.now()}`,
    });
    expect(project.status).toBe(200);
    const projectData = (await project.json()) as { id: string };

    const created = await apiRequest("POST", "/api/admin/feature-flags", {
      projectId: projectData.id,
      key: `e2e-exp-${Date.now()}`,
      name: `E2E Experiment ${Date.now()}`,
      type: "string",
      defaultValue: "control",
      variants: [
        { key: "control", name: "Control", value: "control", weight: 50 },
        { key: "treatment", name: "Treatment", value: "treatment", weight: 50 },
      ],
      experiment: {
        enabled: true,
        hypothesis: "Treatment converts better",
        primaryMetric: "conversion",
        minimumSampleSize: 10,
        confidenceLevel: 0.95,
      },
    });
    expect(created.status).toBe(200);
    const flag = (await created.json()) as { id: string };
    expect(flag.id).toBeDefined();

    const activated = await apiRequest(
      "POST",
      `/api/admin/feature-flags/${flag.id}/status`,
      { status: "active" },
    );
    expect(activated.status).toBe(200);

    const started = await apiRequest(
      "POST",
      `/api/admin/experiments/${flag.id}/start`,
    );
    expect(started.status).toBe(200);
    const startedBody = (await started.json()) as {
      experiment?: { status?: string };
    };
    expect(startedBody.experiment?.status).toBe("running");

    const results = await apiRequest(
      "GET",
      `/api/admin/experiments/${flag.id}/results`,
    );
    expect(results.status).toBe(200);

    const stopped = await apiRequest(
      "POST",
      `/api/admin/experiments/${flag.id}/stop`,
    );
    expect(stopped.status).toBe(200);
    const stoppedBody = (await stopped.json()) as {
      experiment?: { status?: string };
    };
    expect(stoppedBody.experiment?.status).toBe("completed");
  });

  it("evaluates a flag through the SDK surface and records an experiment metric", async () => {
    const project = await apiRequest("POST", "/api/admin/projects", {
      name: `Eval Project ${Date.now()}`,
    });
    expect(project.status).toBe(200);
    const projectData = (await project.json()) as { id: string };

    const flag = await apiRequest("POST", "/api/admin/feature-flags", {
      projectId: projectData.id,
      key: `e2e-eval-${Date.now()}`,
      name: `E2E Eval Flag ${Date.now()}`,
      type: "boolean",
      defaultValue: false,
    });
    expect(flag.status).toBe(200);
    const flagData = (await flag.json()) as { key: string };

    const evaluation = await sentryRequest("POST", "/api/sentry/flags/evaluate", {
      user: { id: "e2e-user-1" },
      flags: [flagData.key],
    });
    expect(evaluation.status).toBe(200);
    const evalBody = (await evaluation.json()) as {
      evaluations: Array<{ variantKey: string; value: unknown }>;
    };
    expect(evalBody.evaluations).toHaveLength(1);

    const tracked = await sentryRequest("POST", "/api/sentry/flags/experiment/track", {
      flagKey: flagData.key,
      variantKey: "control",
      user: { id: "e2e-user-1" },
      metric: "conversion",
      value: 1,
    });
    expect(tracked.status).toBe(200);
  });
});
