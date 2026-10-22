/**
 * API Test: Issue-triggered alerting (new issue / regression)
 *
 * Covers the issue lifecycle and its alert triggers:
 *   - issues table tracking at ingestion (unique per app + fingerprint)
 *   - "new_issue" rules fire once when a fingerprint is first seen
 *   - "regression" rules fire when a resolved issue receives a new event
 *   - repeats while unresolved never re-fire; the cooldown applies per issue
 *   - app-scoped issue rules only affect their app
 *   - /api/admin/issues list/get/patch endpoints
 *   - rule CRUD validation for triggers (issue triggers reject threshold fields)
 * Runs in-process through app.handle (no listener, no port).
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { handleFetch as fetch, TEST_ORIGIN } from "./test-helpers";

const baseUrl = TEST_ORIGIN;

let webhookServer: any;
let webhookUrl = "";
const webhookCalls: Array<{ url: string; body: Record<string, unknown> }> = [];

const ADMIN_TOKEN = "API-Key e2e-admin-token";
const uniq = () => Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

async function apiRequest(
  method: string,
  path: string,
  body?: unknown,
  token: string = ADMIN_TOKEN,
): Promise<Response> {
  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", Authorization: token },
  };
  if (body !== undefined) options.body = JSON.stringify(body);
  return fetch(`${baseUrl}${path}`, options);
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

interface TestApp {
  projectId: string;
  id: string;
  ingestKey: string;
  publicKey: string;
}

async function makeApp(): Promise<TestApp> {
  const project = await json<{ id: string }>(
    await apiRequest("POST", "/api/admin/projects", { name: `IssueProj-${uniq()}` }),
  );
  const appRecord = await json<{ id: string; ingestKey: string; publicKey: string }>(
    await apiRequest("POST", `/api/admin/projects/${project.id}/apps`, {
      name: `IssueApp-${uniq()}`,
    }),
  );
  return { projectId: project.id, ...appRecord };
}

async function makeAppInProject(projectId: string): Promise<TestApp> {
  const appRecord = await json<{ id: string; ingestKey: string; publicKey: string }>(
    await apiRequest("POST", `/api/admin/projects/${projectId}/apps`, {
      name: `IssueApp-${uniq()}`,
    }),
  );
  return { projectId, ...appRecord };
}

async function ingestEvent(t: TestApp, event: Record<string, unknown>): Promise<Response> {
  return fetch(
    `${baseUrl}/api/${t.ingestKey}/store/?sentry_key=${encodeURIComponent(t.publicKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    },
  );
}

function errorEvent(message: string, level = "error"): Record<string, unknown> {
  return { event_id: crypto.randomUUID(), level, message, environment: "test" };
}

async function waitFor<T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 5000,
): Promise<T> {
  const start = Date.now();
  let last: T;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  last = await fn();
  return last;
}

interface IssueDto {
  id: string;
  appId: string;
  fingerprint: string;
  title: string;
  culprit: string | null;
  level: string;
  type: string;
  firstRelease: string | null;
  lastRelease: string | null;
  status: string;
  eventCount: number;
  latestEventId: string | null;
}

interface IncidentDto {
  id: string;
  ruleId: string;
  appId: string | null;
  trigger: string;
  metric: string | null;
  value: number | null;
  threshold: number | null;
  issueFingerprint: string | null;
  status: string;
  triggeredAt: string;
  resolvedAt: string | null;
}

async function listIssues(appId: string, status?: string): Promise<IssueDto[]> {
  const terms = [`app:${appId}`];
  if (status) terms.push(`is:${status}`);
  const query = `/api/admin/issues?query=${encodeURIComponent(terms.join(" "))}`;
  return (await json<{ data: IssueDto[] }>(await apiRequest("GET", query))).data;
}

async function listIncidents(appId: string): Promise<IncidentDto[]> {
  return (
    await json<{ data: IncidentDto[] }>(
      await apiRequest("GET", `/api/admin/alerting/incidents?appId=${appId}`),
    )
  ).data;
}

async function makeChannel(appId: string): Promise<{ id: string }> {
  return json<{ id: string }>(
    await apiRequest("POST", "/api/admin/alerting/channels", {
      name: `issue-web-${uniq()}`,
      type: "webhook",
      config: { url: webhookUrl },
      appId,
    }),
  );
}

function waitForWebhook(predicate: (body: Record<string, unknown>) => boolean) {
  return waitFor(
    () => Promise.resolve(webhookCalls.map((call) => call.body)),
    (bodies) => bodies.some(predicate),
  );
}

describe("Issue alerting (new issue / regression)", () => {
  beforeAll(async () => {
    webhookServer = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const body = await request.json().catch(() => ({}));
        webhookCalls.push({ url: request.url, body });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    webhookUrl = `http://localhost:${webhookServer.port}/hook`;
  });

  afterAll(() => {
    webhookServer.stop();
  });

  describe("Rule CRUD validation for triggers", () => {
    it("creates issue-trigger rules and reports null threshold fields", async () => {
      const created = await json<{
        id: string;
        trigger: string;
        metric: string | null;
        operator: string | null;
        threshold: number | null;
        windowSeconds: number | null;
      }>(
        await apiRequest("POST", "/api/admin/alerting/rules", {
          name: `new issue rule ${uniq()}`,
          trigger: "new_issue",
          cooldownSeconds: 300,
        }),
      );

      expect(created.trigger).toBe("new_issue");
      expect(created.metric).toBeNull();
      expect(created.operator).toBeNull();
      expect(created.threshold).toBeNull();
      expect(created.windowSeconds).toBeNull();

      await apiRequest("DELETE", `/api/admin/alerting/rules/${created.id}`);
    });

    it("defaults to the threshold trigger when omitted (backward compatible)", async () => {
      const created = await json<{ id: string; trigger: string }>(
        await apiRequest("POST", "/api/admin/alerting/rules", {
          name: `legacy rule ${uniq()}`,
          metric: "error_count",
          operator: "gt",
          threshold: 1,
          windowSeconds: 300,
        }),
      );
      expect(created.trigger).toBe("threshold");
      await apiRequest("DELETE", `/api/admin/alerting/rules/${created.id}`);
    });

    it("rejects issue triggers carrying threshold fields (400)", async () => {
      const response = await apiRequest("POST", "/api/admin/alerting/rules", {
        name: `bad issue rule ${uniq()}`,
        trigger: "new_issue",
        metric: "error_count",
        operator: "gt",
        threshold: 1,
        windowSeconds: 300,
      });
      expect(response.status).toBe(400);
    });

    it("rejects threshold rules missing metric fields (400)", async () => {
      const response = await apiRequest("POST", "/api/admin/alerting/rules", {
        name: `incomplete rule ${uniq()}`,
        trigger: "threshold",
        operator: "gt",
        threshold: 1,
        windowSeconds: 300,
      });
      expect(response.status).toBe(400);
    });

    it("switches a rule to an issue trigger and back (PATCH)", async () => {
      const created = await json<{ id: string }>(
        await apiRequest("POST", "/api/admin/alerting/rules", {
          name: `switch rule ${uniq()}`,
          metric: "error_count",
          operator: "gt",
          threshold: 1,
          windowSeconds: 300,
        }),
      );

      const switched = await json<{
        trigger: string;
        metric: string | null;
        windowSeconds: number | null;
      }>(
        await apiRequest("PATCH", `/api/admin/alerting/rules/${created.id}`, {
          trigger: "regression",
        }),
      );
      expect(switched.trigger).toBe("regression");
      expect(switched.metric).toBeNull();
      expect(switched.windowSeconds).toBeNull();

      // Switching back without the metric fields fails...
      const backInvalid = await apiRequest(
        "PATCH",
        `/api/admin/alerting/rules/${created.id}`,
        { trigger: "threshold" },
      );
      expect(backInvalid.status).toBe(400);

      // ...but with them it succeeds.
      const back = await json<{ trigger: string; metric: string | null }>(
        await apiRequest("PATCH", `/api/admin/alerting/rules/${created.id}`, {
          trigger: "threshold",
          metric: "error_count",
          operator: "gt",
          threshold: 2,
          windowSeconds: 600,
        }),
      );
      expect(back.trigger).toBe("threshold");
      expect(back.metric).toBe("error_count");

      await apiRequest("DELETE", `/api/admin/alerting/rules/${created.id}`);
    });
  });

  describe("New-issue trigger", () => {
    it("fires once on first occurrence and tracks the issue", async () => {
      const t = await makeApp();
      const ruleName = `new issue ${uniq()}`;
      const channel = await makeChannel(t.id);

      await apiRequest("POST", "/api/admin/alerting/rules", {
        name: ruleName,
        trigger: "new_issue",
        cooldownSeconds: 0,
        channelIds: [channel.id],
        appId: t.id,
      });

      const message = `brand new problem ${uniq()}`;
      await ingestEvent(t, errorEvent(message));

      const incidents = await waitFor(
        () => listIncidents(t.id),
        (data) => data.length > 0,
      );
      expect(incidents.length).toBe(1);
      expect(incidents[0]!.trigger).toBe("new_issue");
      expect(incidents[0]!.metric).toBeNull();
      expect(incidents[0]!.value).toBeNull();
      expect(incidents[0]!.threshold).toBeNull();
      expect(incidents[0]!.issueFingerprint).toBe(`msg:${message}`);
      expect(incidents[0]!.status).toBe("resolved");
      expect(incidents[0]!.resolvedAt).not.toBeNull();

      const bodies = await waitForWebhook(
        (b) => b.ruleName === ruleName && b.trigger === "new_issue",
      );
      const notification = bodies.find((b) => b.ruleName === ruleName)!;
      expect((notification.issue as { title: string }).title).toBe(message);

      const issues = await listIssues(t.id);
      expect(issues.length).toBe(1);
      expect(issues[0]!.fingerprint).toBe(`msg:${message}`);
      expect(issues[0]!.title).toBe(message);
      expect(issues[0]!.status).toBe("unresolved");
      expect(issues[0]!.eventCount).toBe(1);

      const fetched = await json<IssueDto>(
        await apiRequest("GET", `/api/admin/issues/${issues[0]!.id}`),
      );
      expect(fetched.id).toBe(issues[0]!.id);
    });

    it("records repeats without re-firing while the issue is unresolved", async () => {
      const t = await makeApp();
      const ruleName = `repeat rule ${uniq()}`;
      const channel = await makeChannel(t.id);

      await apiRequest("POST", "/api/admin/alerting/rules", {
        name: ruleName,
        trigger: "new_issue",
        cooldownSeconds: 0,
        channelIds: [channel.id],
        appId: t.id,
      });

      const message = `repeating problem ${uniq()}`;
      await ingestEvent(t, errorEvent(message));

      await waitFor(
        () => listIssues(t.id),
        (issues) => issues.length === 1 && issues[0]!.eventCount === 1,
      );
      await ingestEvent(t, errorEvent(message));
      await ingestEvent(t, errorEvent(message));

      const issues = await waitFor(
        () => listIssues(t.id),
        (data) => data[0]?.eventCount === 3,
      );
      expect(issues[0]!.status).toBe("unresolved");

      // Give any stray (wrong) firing a chance to land, then assert only one incident.
      await new Promise((resolve) => setTimeout(resolve, 500));
      const incidents = await listIncidents(t.id);
      expect(incidents.length).toBe(1);
      expect(incidents[0]!.trigger).toBe("new_issue");
    });

    it("does not fire for a regression rule when the issue is first created", async () => {
      const t = await makeApp();
      const channel = await makeChannel(t.id);

      await apiRequest("POST", "/api/admin/alerting/rules", {
        name: `strict regression ${uniq()}`,
        trigger: "regression",
        cooldownSeconds: 0,
        channelIds: [channel.id],
        appId: t.id,
      });

      await ingestEvent(t, errorEvent(`never regressed ${uniq()}`));

      await waitFor(
        () => listIssues(t.id),
        (issues) => issues.length === 1,
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect((await listIncidents(t.id)).length).toBe(0);
    });
  });

  describe("Regression trigger", () => {
    it("fires when a resolved issue receives a new event, then not again while unresolved", async () => {
      const t = await makeApp();
      const ruleName = `regression rule ${uniq()}`;
      const channel = await makeChannel(t.id);

      await apiRequest("POST", "/api/admin/alerting/rules", {
        name: ruleName,
        trigger: "regression",
        cooldownSeconds: 0,
        channelIds: [channel.id],
        appId: t.id,
      });

      const message = `regressed problem ${uniq()}`;
      await ingestEvent(t, errorEvent(message));

      const [issue] = await waitFor(
        () => listIssues(t.id),
        (issues) => issues.length === 1,
      );
      expect(issue!.status).toBe("unresolved");

      const resolved = await json<IssueDto>(
        await apiRequest("PATCH", `/api/admin/issues/${issue!.id}`, {
          status: "resolved",
        }),
      );
      expect(resolved.status).toBe("resolved");

      await ingestEvent(t, errorEvent(message));

      const incidents = await waitFor(
        () => listIncidents(t.id),
        (data) => data.length > 0,
      );
      expect(incidents.length).toBe(1);
      expect(incidents[0]!.trigger).toBe("regression");
      expect(incidents[0]!.issueFingerprint).toBe(`msg:${message}`);
      expect(incidents[0]!.status).toBe("resolved");

      const bodies = await waitForWebhook(
        (b) => b.ruleName === ruleName && b.trigger === "regression",
      );
      const notification = bodies.find((b) => b.ruleName === ruleName)!;
      expect((notification.issue as { title: string }).title).toBe(message);

      const reopened = await waitFor(
        () => listIssues(t.id),
        (issues) => issues[0]?.status === "unresolved",
      );
      expect(reopened[0]!.eventCount).toBe(2);

      // A further event on the still-unresolved issue must not re-fire.
      await ingestEvent(t, errorEvent(message));
      await waitFor(
        () => listIssues(t.id),
        (issues) => issues[0]?.eventCount === 3,
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect((await listIncidents(t.id)).length).toBe(1);
    });

    it("applies the cooldown per issue, not per rule", async () => {
      const t = await makeApp();
      const channel = await makeChannel(t.id);

      await apiRequest("POST", "/api/admin/alerting/rules", {
        name: `cooled regression ${uniq()}`,
        trigger: "regression",
        cooldownSeconds: 3600,
        channelIds: [channel.id],
        appId: t.id,
      });

      const messageA = `cooldown problem A ${uniq()}`;
      const messageB = `cooldown problem B ${uniq()}`;

      // First regression on issue A fires...
      await ingestEvent(t, errorEvent(messageA));
      const [issueA] = await waitFor(() => listIssues(t.id), (issues) => issues.length === 1);
      await apiRequest("PATCH", `/api/admin/issues/${issueA!.id}`, { status: "resolved" });
      await ingestEvent(t, errorEvent(messageA));
      await waitFor(() => listIncidents(t.id), (data) => data.length === 1);

      // ...a second regression on issue A within the cooldown does not...
      await apiRequest("PATCH", `/api/admin/issues/${issueA!.id}`, { status: "resolved" });
      await ingestEvent(t, errorEvent(messageA));

      // ...but issue B regressing in the same window still fires.
      await ingestEvent(t, errorEvent(messageB));
      // Ingest side effects are chained per app and applied after the
      // response; wait for the new issue before resolving it.
      const issuesB = await waitFor(
        () => listIssues(t.id),
        (issues) => issues.some((issue) => issue.fingerprint === `msg:${messageB}`),
      );
      const issueB = issuesB.find((issue) => issue.fingerprint === `msg:${messageB}`)!;
      await apiRequest("PATCH", `/api/admin/issues/${issueB.id}`, { status: "resolved" });
      await ingestEvent(t, errorEvent(messageB));

      const incidents = await waitFor(
        () => listIncidents(t.id),
        (data) => data.length === 2,
      );
      expect(incidents.map((incident) => incident.issueFingerprint).sort()).toEqual(
        [`msg:${messageA}`, `msg:${messageB}`].sort(),
      );

      // Nothing further lands for the suppressed issue A repeat.
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect((await listIncidents(t.id)).length).toBe(2);
    });

    it("scopes issue rules to their app", async () => {
      const appA = await makeApp();
      const appB = await makeApp();
      const channel = await makeChannel(appA.id);

      await apiRequest("POST", "/api/admin/alerting/rules", {
        name: `app scoped issue rule ${uniq()}`,
        trigger: "new_issue",
        cooldownSeconds: 0,
        channelIds: [channel.id],
        appId: appA.id,
      });

      const message = `scoped problem ${uniq()}`;
      await ingestEvent(appB, errorEvent(message));
      await waitFor(() => listIssues(appB.id), (issues) => issues.length === 1);

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect((await listIncidents(appB.id)).length).toBe(0);

      await ingestEvent(appA, errorEvent(message));
      const incidentsA = await waitFor(() => listIncidents(appA.id), (data) => data.length === 1);
      expect(incidentsA[0]!.appId).toBe(appA.id);
    });
  });

  describe("Issues endpoints", () => {
    it("projects the occurrence's title, culprit, level, type and release", async () => {
      const t = await makeApp();
      const message = `projected ${uniq()}`;

      const ingestRes = await ingestEvent(t, {
        event_id: crypto.randomUUID(),
        level: "warning",
        message,
        release: "1.2.3",
        exception: {
          values: [
            {
              type: "TypeError",
              value: "cannot read id",
              stacktrace: {
                frames: [
                  { filename: "app.js", lineno: 12, function: "boom", in_app: true },
                ],
              },
            },
          ],
        },
      });
      expect(ingestRes.status).toBe(200);

      const issues = await waitFor(
        async () =>
          json<{ data: IssueDto[] }>(
            await apiRequest("GET", `/api/admin/issues?query=${encodeURIComponent(`app:${t.id}`)}`),
          ),
        (body) => body.data.length === 1,
      );

      const issue = issues.data[0]!;
      expect(issue.title).toBe("TypeError: cannot read id");
      expect(issue.culprit).toBe("app.js:12");
      expect(issue.level).toBe("warning");
      expect(issue.type).toBe("error");
      expect(issue.firstRelease).toBe("1.2.3");
      expect(issue.lastRelease).toBe("1.2.3");

      // A later occurrence updates the presentation and the last release,
      // but keeps the first one.
      await ingestEvent(t, {
        event_id: crypto.randomUUID(),
        level: "error",
        message: `${message} again`,
        release: "1.3.0",
        exception: {
          values: [
            {
              type: "TypeError",
              value: "still broken",
              stacktrace: {
                frames: [
                  { filename: "app.js", lineno: 20, function: "boom", in_app: true },
                ],
              },
            },
          ],
        },
      });

      const updated = await waitFor(
        async () =>
          json<{ data: IssueDto[] }>(
            await apiRequest("GET", `/api/admin/issues?query=${encodeURIComponent(`app:${t.id}`)}`),
          ),
        (body) => body.data[0]?.lastRelease === "1.3.0",
      );
      expect(updated.data[0]!.firstRelease).toBe("1.2.3");
      expect(updated.data[0]!.level).toBe("error");
      expect(updated.data[0]!.culprit).toBe("app.js:20");
    });

    it("requires admin auth", async () => {
      const response = await apiRequest("GET", "/api/admin/issues", undefined, "");
      expect(response.status).toBe(401);
    });

    it("404s unknown issues and treats unknown list filters as empty", async () => {
      const missing = await apiRequest("GET", `/api/admin/issues/${crypto.randomUUID()}`);
      expect(missing.status).toBe(404);

      const badFilter = await apiRequest("GET", "/api/admin/issues?query=is%3Anope");
      expect(badFilter.status).toBe(400);

      // A name that does not resolve is a 404, not a parse error.
      const badApp = await apiRequest("GET", "/api/admin/issues?query=app%3Anot-a-uuid");
      expect(badApp.status).toBe(404);

      // An unknown app is a 404: the name does not resolve to anything.
      const unknownApp = await apiRequest(
        "GET",
        `/api/admin/issues?query=${encodeURIComponent(`app:${crypto.randomUUID()}`)}`,
      );
      expect(unknownApp.status).toBe(404);

      const badPatch = await apiRequest("PATCH", `/api/admin/issues/${crypto.randomUUID()}`, {
        status: "closed",
      });
      expect(badPatch.status).toBe(400);

      const missingPatch = await apiRequest(
        "PATCH",
        `/api/admin/issues/${crypto.randomUUID()}`,
        { status: "resolved" },
      );
      expect(missingPatch.status).toBe(404);
    });

    it("filters by status and app", async () => {
      const t = await makeApp();
      const other = await makeApp();

      const message = `filterable problem ${uniq()}`;
      await ingestEvent(t, errorEvent(message));
      await ingestEvent(other, errorEvent(`other app problem ${uniq()}`));

      const [issue] = await waitFor(() => listIssues(t.id), (issues) => issues.length === 1);

      const unresolved = await listIssues(t.id, "unresolved");
      expect(unresolved.map((i) => i.id)).toEqual([issue!.id]);

      await apiRequest("PATCH", `/api/admin/issues/${issue!.id}`, { status: "resolved" });
      expect((await listIssues(t.id, "resolved")).map((i) => i.id)).toEqual([issue!.id]);
      expect((await listIssues(t.id, "unresolved")).length).toBe(0);

      // The other app's issue is not listed for this app.
      const otherIssues = await listIssues(other.id);
      expect(otherIssues.length).toBe(1);
      expect(otherIssues[0]!.fingerprint).not.toBe(issue!.fingerprint);
    });

    it("exposes the latest stored event id for drill-down", async () => {
      const t = await makeApp();
      const message = `latest event problem ${uniq()}`;
      const firstId = crypto.randomUUID();
      const secondId = crypto.randomUUID();

      await ingestEvent(t, { ...errorEvent(message), event_id: firstId });
      const [issue] = await waitFor(() => listIssues(t.id), (issues) => issues.length === 1);
      expect(issue!.latestEventId).toBe(firstId);

      await ingestEvent(t, { ...errorEvent(message), event_id: secondId });
      const updated = await waitFor(
        () => listIssues(t.id),
        (issues) => issues[0]?.latestEventId === secondId,
      );
      expect(updated[0]!.latestEventId).toBe(secondId);

      const fetched = await json<IssueDto>(
        await apiRequest("GET", `/api/admin/issues/${issue!.id}`),
      );
      expect(fetched.latestEventId).toBe(secondId);
    });

    it("filters by project across its apps and validates the filter", async () => {
      const t = await makeApp();
      const second = await makeAppInProject(t.projectId);
      const outsider = await makeApp();

      await ingestEvent(t, errorEvent(`project scoped A ${uniq()}`));
      await ingestEvent(second, errorEvent(`project scoped B ${uniq()}`));
      await ingestEvent(outsider, errorEvent(`project scoped C ${uniq()}`));

      const byProject = await waitFor(
        async () =>
          json<{ data: IssueDto[] }>(
            await apiRequest(
              "GET",
              `/api/admin/issues?query=${encodeURIComponent(`project:${t.projectId}`)}`,
            ),
          ),
        (result) => result.data.length === 2,
      );
      expect(byProject.data.length).toBe(2);
      expect(new Set(byProject.data.map((issue) => issue.appId))).toEqual(
        new Set([t.id, second.id]),
      );

      // The app filter still narrows to a single app.
      expect((await listIssues(t.id)).length).toBe(1);
      expect((await listIssues(second.id)).length).toBe(1);

      const unknownProject = await apiRequest(
        "GET",
        `/api/admin/issues?query=${encodeURIComponent(`project:${crypto.randomUUID()}`)}`,
      );
      expect(unknownProject.status).toBe(404);
    });

    it("searches issues by title and fingerprint", async () => {
      const t = await makeApp();
      const message = `wombat overflow ${uniq()}`;
      const exception = {
        event_id: crypto.randomUUID(),
        level: "error",
        exception: {
          values: [
            {
              type: "ZodError",
              value: "bad input",
              stacktrace: {
                frames: [{ filename: "src/checkout/cart.ts", function: "validateCart" }],
              },
            },
          ],
        },
      };

      await ingestEvent(t, errorEvent(message));
      await ingestEvent(t, exception);
      await waitFor(() => listIssues(t.id), (issues) => issues.length === 2);

      const byTitle = await json<{ data: IssueDto[] }>(
        await apiRequest(
          "GET",
          `/api/admin/issues?query=${encodeURIComponent(`app:${t.id} wombat overflow`)}`,
        ),
      );
      expect(byTitle.data.map((issue) => issue.title)).toEqual([message]);

      // The frame-derived fingerprint matches even though the title does not.
      const byFingerprint = await json<{ data: IssueDto[] }>(
        await apiRequest("GET", `/api/admin/issues?query=${encodeURIComponent(`app:${t.id} validateCart`)}`),
      );
      expect(byFingerprint.data.length).toBe(1);
      expect(byFingerprint.data[0]!.fingerprint).toBe(
        "ZodError@src/checkout/cart.ts:validateCart",
      );

      const noHits = await json<{ data: IssueDto[] }>(
        await apiRequest(
          "GET",
          `/api/admin/issues?query=${encodeURIComponent(`app:${t.id} nothing-matches-this`)}`,
        ),
      );
      expect(noHits.data.length).toBe(0);
    });

    it("fingerprints the crash frame (SDKs send frames oldest-first)", async () => {
      const t = await makeApp();
      const exceptionFor = (entry: string) => ({
        type: "TypeError",
        value: "cannot checkout",
        stacktrace: {
          frames: [
            { filename: entry, function: "bootstrap", in_app: true },
            { filename: "src/cart.ts", function: "checkout", in_app: true },
            { filename: "node_modules/payments-sdk.js", function: "charge", in_app: false },
          ],
        },
      });

      await ingestEvent(t, {
        event_id: crypto.randomUUID(),
        level: "error",
        exception: { values: [exceptionFor("src/entry.ts")] },
      });

      const issues = await waitFor(
        () => listIssues(t.id),
        (list) => list.length === 1,
      );
      expect(issues[0]!.fingerprint).toBe("TypeError@src/cart.ts:checkout");
      expect(issues[0]!.title).toBe("TypeError: cannot checkout");

      // The same crash frame reached through a different outer caller
      // stays in the same issue (the outermost frame must not drive the
      // fingerprint).
      await ingestEvent(t, {
        event_id: crypto.randomUUID(),
        level: "error",
        exception: { values: [exceptionFor("src/retry-entry.ts")] },
      });
      const grouped = await waitFor(
        () => listIssues(t.id),
        (list) => list[0]?.eventCount === 2,
      );
      expect(grouped.length).toBe(1);
    });
  });
});
