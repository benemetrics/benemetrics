/**
 * E2E Test: Full project → environment → app lifecycle
 *
 * Provisions a project, a non-default staging environment, and an app inside
 * that environment by clicking through the admin UI in a real headless
 * browser (Bun.WebView). The DSN is read from the Setup screen and wired into
 * the official Sentry SDK, then the real pipeline is verified end to end:
 * ClickHouse event storage, Postgres issue tracking, app-scoped webhook alerts
 * for new issues and regressions, and release bookkeeping. The same browser
 * also asserts that the Projects, Issues, event detail, and effective alert
 * configuration screens render the provisioned fixtures.
 */

import * as Sentry from "@sentry/bun";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import app from "../backend/index";
import { ADMIN_HEADERS, waitFor, waitForEventById } from "./test-helpers";

const MARKER = crypto.randomUUID().slice(0, 8);
const PROJECT_NAME = `Lifecycle Project ${MARKER}`;
const ENVIRONMENT_NAME = "Staging";
const APP_NAME = `Lifecycle App ${MARKER}`;
const RELEASE = `e2e-lifecycle-${MARKER}`;
const MESSAGE = `Lifecycle crash ${MARKER}`;
const REGRESSION_MESSAGE = `Lifecycle regression ${MARKER}`;
const FINGERPRINT = ["e2e-lifecycle", MARKER];
const ISSUE_FINGERPRINT = FINGERPRINT.join("::");
const TEST_TIMEOUT = 30_000;
const SIDE_EFFECT_TIMEOUT = 15_000;

interface ProjectDto {
  id: string;
  name: string;
  slug: string;
}

interface EnvironmentDto {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  isDefault: boolean;
}

interface AppDto {
  id: string;
  projectId: string;
  environmentId: string;
  name: string;
  platform: string;
  ingestKey: string;
  publicKey: string;
  number: number;
}

interface Page<T> {
  data: T[];
}

interface IssueDto {
  id: string;
  appId: string;
  fingerprint: string;
  title: string;
  status: string;
  eventCount: number;
  firstSeen: string;
  lastSeen: string;
  latestEventId: string | null;
}

interface IncidentDto {
  id: string;
  ruleId: string;
  appId: string | null;
  trigger: string;
  issueFingerprint: string | null;
  status: string;
}

interface ReleaseDto {
  id: string;
  appId: string;
  version: string;
  eventCount: number;
  latestEventId: string | null;
}

interface AlertRuleDto {
  id: string;
  name: string;
  trigger: string;
}

interface EventListItem {
  id: string;
  receivedAt: string;
  itemTypes: string[];
  event?: Record<string, any> | null;
}

type EventRecord = Record<string, any>;

let server: { port: number; stop: (force?: boolean) => void } | null = null;
let baseUrl = "";
let webhookServer: any;
let webhookUrl = "";
let view: Bun.WebView;
const webhookCalls: Array<Record<string, any>> = [];

let project: ProjectDto;
let environment: EnvironmentDto;
let appRecord: AppDto;
let channel: { id: string; name: string };
let newIssueRule: AlertRuleDto;
let regressionRule: AlertRuleDto;
let eventId = "";
let eventId2 = "";
let issue: IssueDto;
let uiDsn = "";

async function adminRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: ADMIN_HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(
      `${response.status} ${response.statusText}: ${await response.text()}`,
    );
  }
  return (await response.json()) as T;
}

async function adminJson<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  return readJson<T>(await adminRequest(method, path, body));
}

/**
 * The SDK exposes the fingerprint through the scope rather than the capture
 * hint, so every event in this file is captured inside a scoped call.
 */
function captureWithFingerprint(message: string): string {
  let captured = "";
  Sentry.withScope((scope) => {
    scope.setFingerprint(FINGERPRINT);
    captured = Sentry.captureException(new Error(message));
  });
  return captured;
}

// The issue list takes the search grammar: the terms are the query
// language (`is:unresolved app:<id>`).
async function listIssues(query?: string): Promise<Page<IssueDto>> {
  const params = new URLSearchParams({ limit: "100" });
  if (query) params.set("query", query);
  return adminJson<Page<IssueDto>>(
    "GET",
    `/api/admin/issues?${params.toString()}`,
  );
}

async function waitForIssue(
  predicate: (candidate: IssueDto) => boolean,
  query?: string,
): Promise<IssueDto> {
  const page = await waitFor(
    () => listIssues(query),
    (candidate) => candidate.data.some(predicate),
    SIDE_EFFECT_TIMEOUT,
  );
  const found = page.data.find(predicate);
  if (!found) throw new Error("Issue did not appear in time");
  return found;
}

async function listIncidents(): Promise<Page<IncidentDto>> {
  return adminJson<Page<IncidentDto>>(
    "GET",
    `/api/admin/alerting/incidents?appId=${appRecord.id}&limit=100`,
  );
}

async function waitForWebhook(
  predicate: (body: Record<string, any>) => boolean,
): Promise<Record<string, any>> {
  const calls = await waitFor(
    () => Promise.resolve(webhookCalls.slice()),
    (bodies) => bodies.some(predicate),
    SIDE_EFFECT_TIMEOUT,
  );
  const found = calls.find(predicate);
  if (!found) throw new Error("Webhook was not delivered in time");
  return found;
}

async function listEvents(
  query?: string,
): Promise<{ data: EventListItem[] }> {
  const suffix = query ? `&${query}` : "";
  return adminJson<{ data: EventListItem[] }>(
    "GET",
    `/events?limit=100${suffix}`,
  );
}

async function listReleases(): Promise<Page<ReleaseDto>> {
  return adminJson<Page<ReleaseDto>>(
    "GET",
    `/api/admin/releases?appId=${appRecord.id}&limit=100`,
  );
}

async function waitForTextInUI(
  text: string,
  timeoutMs = 15000,
): Promise<string> {
  const start = Date.now();
  let body = "";
  while (Date.now() - start < timeoutMs) {
    body = (await view.evaluate("document.body.innerText")) ?? "";
    if (body.includes(text)) return body;
    await Bun.sleep(400);
  }
  const shot = await view.screenshot();
  await Bun.write("/tmp/e2e-lifecycle-ui-failure.png", shot);
  throw new Error(
    `"${text}" not found in admin UI within ${timeoutMs}ms. Page text: ${body.slice(0, 300)}`,
  );
}

/** Navigates inside the SPA by clicking the sidebar item. */
async function clickNav(label: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const clicked =
      (await view.evaluate(`(() => {
        const items = Array.from(document.querySelectorAll(".nav-item"));
        const item = items.find((el) => (el.textContent || "").trim().startsWith(${JSON.stringify(label)}));
        if (!item) return false;
        item.click();
        return true;
      })()`)) ?? false;
    if (clicked) return;
    await Bun.sleep(400);
  }
  throw new Error(`Could not click nav item "${label}" within ${timeoutMs}ms`);
}

/** Selects an app in the topbar; app-scoped alert rules only render for an app. */
async function selectApplicationInUI(
  name: string,
  timeoutMs = 15000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const selected =
      (await view.evaluate(`(() => {
        const trigger = document.querySelector(".application-switcher");
        if (!trigger) return false;
        if ((trigger.textContent || "").includes(${JSON.stringify(name)})) return true;
        const menu = document.querySelector(".application-menu");
        if (!menu) {
          trigger.click();
          return false;
        }
        const options = Array.from(menu.querySelectorAll(".application-option"));
        const target = options.find((el) => (el.textContent || "").includes(${JSON.stringify(name)}));
        if (!target) return false;
        target.click();
        return true;
      })()`)) ?? false;
    if (selected) return;
    await Bun.sleep(400);
  }
  throw new Error(`Could not select application "${name}" in the admin UI`);
}

async function waitForSelector(
  selector: string,
  timeoutMs = 15000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found =
      (await view.evaluate(
        `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
      )) ?? false;
    if (found) return;
    await Bun.sleep(200);
  }
  throw new Error(`"${selector}" not found in the admin UI within ${timeoutMs}ms`);
}

async function waitForSelectorText(
  selector: string,
  text: string,
  timeoutMs = 15000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const matched =
      (await view.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        return Boolean(el) && (el.textContent || "").includes(${JSON.stringify(text)});
      })()`)) ?? false;
    if (matched) return;
    await Bun.sleep(200);
  }
  throw new Error(
    `"${text}" not found in "${selector}" within ${timeoutMs}ms`,
  );
}

async function clickSelector(
  selector: string,
  timeoutMs = 15000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const clicked =
      (await view.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.click();
        return true;
      })()`)) ?? false;
    if (clicked) return;
    await Bun.sleep(200);
  }
  throw new Error(`Could not click "${selector}" within ${timeoutMs}ms`);
}

async function clickElementWithText(
  selector: string,
  text: string,
  timeoutMs = 15000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const clicked =
      (await view.evaluate(`(() => {
        const elements = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
        const el = elements.find((candidate) => (candidate.textContent || "").includes(${JSON.stringify(text)}));
        if (!el) return false;
        el.click();
        return true;
      })()`)) ?? false;
    if (clicked) return;
    await Bun.sleep(200);
  }
  throw new Error(
    `Could not click "${selector}" containing "${text}" within ${timeoutMs}ms`,
  );
}

async function setInputValue(
  selector: string,
  value: string,
  timeoutMs = 15000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const set =
      (await view.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        const prototype = el.tagName === "TEXTAREA"
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
        if (!setter) return false;
        setter.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`)) ?? false;
    if (set) return;
    await Bun.sleep(200);
  }
  throw new Error(`Could not set "${selector}" within ${timeoutMs}ms`);
}

beforeAll(async () => {
  app.listen(0);
  server = (app as any).server;
  baseUrl = `http://localhost:${server!.port}`;

  webhookServer = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (request) => {
      const body = await request.json().catch(() => ({}));
      webhookCalls.push(body as Record<string, any>);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  webhookUrl = `http://127.0.0.1:${webhookServer.port}/hook`;

  view = new Bun.WebView({ backend: "chrome", width: 1280, height: 900 });
  await view.navigate(`${baseUrl}/ui/overview`);
  await view.evaluate(
    `localStorage.setItem("benemetrics.adminToken", "e2e-admin-token")`,
  );
  await view.navigate(`${baseUrl}/ui/overview`);
  await waitForSelector(".project-switcher", 20000);

  // Create the project through the sidebar switcher.
  await clickSelector(".project-switcher");
  await clickSelector(".project-menu .create-project-trigger");
  await setInputValue(".project-menu .inline-project-input", PROJECT_NAME);
  await clickSelector(".project-menu .inline-create-action");
  await waitForSelectorText(".project-switcher", PROJECT_NAME, 20000);

  // Create Staging through the environment switcher. Waiting for the
  // auto-created Testing environment first also proves the initial
  // environment fetch finished, so it cannot overwrite the new selection.
  await clickSelector(".environment-switcher");
  await waitForSelectorText(".environment-menu", "Testing", 20000);
  await clickSelector(".environment-menu .create-project-trigger");
  await setInputValue(
    ".environment-menu .inline-project-input",
    ENVIRONMENT_NAME,
  );
  await clickSelector(".environment-menu .inline-create-action");
  await waitForSelectorText(".environment-switcher", ENVIRONMENT_NAME, 20000);

  // Create the app on the Projects page; it must land in the selected
  // environment rather than the project default.
  await clickNav("Projects");
  await waitForTextInUI("Add application", 20000);
  await clickSelector(".new-app-card");
  await waitForSelector(".new-app-card .inline-project-input", 20000);
  await setInputValue(".new-app-card .inline-project-input", APP_NAME);
  await clickSelector(".new-app-card .inline-create-action");
  await waitForSelectorText(".app-card", APP_NAME, 20000);
  const appCardText = String(
    (await view.evaluate(`(() => {
      const cards = Array.from(document.querySelectorAll(".app-card"));
      const card = cards.find((el) => (el.textContent || "").includes(${JSON.stringify(APP_NAME)}));
      return card?.innerText ?? "";
    })()`)) ?? "",
  );
  if (!appCardText.includes(ENVIRONMENT_NAME)) {
    throw new Error(
      `App card did not render in ${ENVIRONMENT_NAME}: ${appCardText}`,
    );
  }

  // Open the setup guide from the app card and read the DSN the UI hands out.
  await clickElementWithText(".app-card", APP_NAME);
  await waitForTextInUI("STEP 1 OF 3", 20000);
  await clickElementWithText(".action", "Continue");
  await waitForTextInUI("STEP 2 OF 3", 20000);
  const setupCode = String(
    (await view.evaluate(
      `document.querySelector(".code-block-body")?.innerText ?? ""`,
    )) ?? "",
  );
  const dsnMatch = setupCode.match(/http:\/\/[^\s"]+/);
  if (!dsnMatch) {
    throw new Error(`Could not read the DSN from the setup page: ${setupCode}`);
  }
  uiDsn = dsnMatch[0];
  const setupUrl = new URL(
    String((await view.evaluate("location.href")) ?? ""),
  );
  const appIdFromUrl = setupUrl.searchParams.get("app");
  if (!appIdFromUrl) {
    throw new Error(`Setup URL did not include an app id: ${setupUrl}`);
  }

  // Read the UI-created records back so the API assertions can use their IDs,
  // and cross-check the IDs and DSN the browser actually rendered.
  const projectPage = await adminJson<Page<ProjectDto>>(
    "GET",
    "/api/admin/projects?limit=100",
  );
  const foundProject = projectPage.data.find(
    (entry) => entry.name === PROJECT_NAME,
  );
  if (!foundProject) {
    throw new Error(`Project "${PROJECT_NAME}" was not created in the UI`);
  }
  project = foundProject;

  const envPage = await adminJson<Page<EnvironmentDto>>(
    "GET",
    `/api/admin/environments?projectId=${project.id}&limit=100`,
  );
  const foundEnvironment = envPage.data.find(
    (entry) => entry.name === ENVIRONMENT_NAME,
  );
  if (!foundEnvironment) {
    throw new Error(
      `Environment "${ENVIRONMENT_NAME}" was not created in the UI`,
    );
  }
  environment = foundEnvironment;

  const appPage = await adminJson<Page<AppDto>>(
    "GET",
    `/api/admin/projects/${project.id}/apps?limit=100`,
  );
  const foundApp = appPage.data.find((entry) => entry.name === APP_NAME);
  if (!foundApp) {
    throw new Error(`App "${APP_NAME}" was not created in the UI`);
  }
  appRecord = foundApp;

  if (appRecord.id !== appIdFromUrl) {
    throw new Error(
      `Setup page opened app ${appIdFromUrl}, but the API returned ${appRecord.id}`,
    );
  }
  if (appRecord.environmentId !== environment.id) {
    throw new Error(
      `App was created in environment ${appRecord.environmentId}, expected ${environment.id}`,
    );
  }
  // The API returns the credentials; the Setup page composes the DSN.
  const expectedDsn = `http://${appRecord.publicKey}@${new URL(baseUrl).host}/${appRecord.number}`;
  if (uiDsn !== expectedDsn) {
    throw new Error(
      `Setup page DSN ${uiDsn} did not match the composed DSN ${expectedDsn}`,
    );
  }

  // The webhook channel has to be app-scoped, which the Alert channels UI
  // cannot create yet, so seed the delivery fixture through the API. The
  // WebView assertions later prove the effective configuration renders it.
  channel = await adminJson<{ id: string; name: string }>(
    "POST",
    "/api/admin/alerting/channels",
    {
      name: `lifecycle hook ${MARKER}`,
      type: "webhook",
      config: { url: webhookUrl },
      appId: appRecord.id,
    },
  );
  newIssueRule = await adminJson<AlertRuleDto>(
    "POST",
    "/api/admin/alerting/rules",
    {
      name: `new issue ${MARKER}`,
      trigger: "new_issue",
      cooldownSeconds: 0,
      channelIds: [channel.id],
      appId: appRecord.id,
    },
  );
  regressionRule = await adminJson<AlertRuleDto>(
    "POST",
    "/api/admin/alerting/rules",
    {
      name: `regression ${MARKER}`,
      trigger: "regression",
      cooldownSeconds: 0,
      channelIds: [channel.id],
      appId: appRecord.id,
    },
  );

  Sentry.init({
    dsn: uiDsn,
    environment: "staging",
    release: RELEASE,
    defaultIntegrations: false,
  });
}, 60_000);

afterAll(async () => {
  await Sentry.flush(2000);
  await Sentry.close();
  await view?.close();
  webhookServer?.stop(true);
  server?.stop(true);
});

describe("Project → environment → app → SDK lifecycle", () => {
  it(
    "creates the project, environment, and app through the admin UI and hands out a working DSN",
    async () => {
      expect(project.id).toBeTruthy();
      expect(environment.projectId).toBe(project.id);
      expect(environment.name).toBe(ENVIRONMENT_NAME);
      expect(environment.slug).toBe("staging");
      expect(environment.isDefault).toBe(false);

      expect(appRecord.projectId).toBe(project.id);
      expect(appRecord.environmentId).toBe(environment.id);
      expect(appRecord.number).toBeGreaterThan(0);
      expect(appRecord.publicKey).toBeDefined();

      const envPage = await adminJson<Page<EnvironmentDto>>(
        "GET",
        `/api/admin/environments?projectId=${project.id}&limit=100`,
      );
      const staging = envPage.data.find((entry) => entry.id === environment.id);
      expect(staging).toBeDefined();
      expect(staging?.slug).toBe("staging");
      expect(staging?.isDefault).toBe(false);

      const defaults = envPage.data.filter((entry) => entry.isDefault);
      expect(defaults).toHaveLength(1);
      expect(defaults[0]?.id).not.toBe(environment.id);

      const appPage = await adminJson<Page<AppDto>>(
        "GET",
        `/api/admin/projects/${project.id}/apps?limit=100`,
      );
      const listed = appPage.data.find((entry) => entry.id === appRecord.id);
      expect(listed).toBeDefined();
      expect(listed?.publicKey).toBe(appRecord.publicKey);
      expect(listed?.environmentId).toBe(environment.id);

      const dsnUrl = new URL(uiDsn);
      expect(dsnUrl.protocol).toBe("http:");
      expect(dsnUrl.host).toBe(new URL(baseUrl).host);
      expect(dsnUrl.username).toBe(appRecord.publicKey);
      expect(dsnUrl.pathname).toBe(`/${appRecord.number}`);

      const clientDsn = Sentry.getClient()?.getDsn();
      expect(clientDsn).toBeDefined();
      expect(clientDsn?.projectId).toBe(String(appRecord.number));
      expect(clientDsn?.publicKey).toBe(appRecord.publicKey);
      expect(clientDsn?.host).toBe(dsnUrl.hostname);
      expect(clientDsn?.port).toBe(dsnUrl.port);
    },
    TEST_TIMEOUT,
  );

  it(
    "ingests the SDK error and serves it from the event list and detail",
    async () => {
      eventId = captureWithFingerprint(MESSAGE);
      expect(eventId).toBeTruthy();
      await Sentry.flush(5000);

      const event = await waitForEventById(
        baseUrl,
        eventId,
        SIDE_EFFECT_TIMEOUT,
      );
      expect(event).not.toBeNull();
      expect(event?.event_id).toBe(eventId);
      expect(event?.environment).toBe("staging");
      expect(event?.release).toBe(RELEASE);
      expect(event?.exception?.values?.[0]?.value).toBe(MESSAGE);
      expect(event?.fingerprint).toEqual(FINGERPRINT);

      const appEvents = await listEvents(`appId=${appRecord.id}`);
      const item = appEvents.data.find((entry) => entry.id === eventId);
      expect(item).toBeDefined();
      expect(item?.itemTypes).toContain("event");
      expect(item?.event?.environment).toBe("staging");
      expect(item?.event?.exception?.values?.[0]?.value).toBe(MESSAGE);

      const projectEvents = await listEvents(`projectId=${project.id}`);
      expect(projectEvents.data.some((entry) => entry.id === eventId)).toBe(true);

      const stagingEvents = await listEvents(
        `environmentId=${environment.id}`,
      );
      expect(stagingEvents.data.some((entry) => entry.id === eventId)).toBe(true);

      const envPage = await adminJson<Page<EnvironmentDto>>(
        "GET",
        `/api/admin/environments?projectId=${project.id}&limit=100`,
      );
      const defaultEnvironment = envPage.data.find((entry) => entry.isDefault);
      expect(defaultEnvironment).toBeDefined();
      const defaultEvents = await listEvents(
        `environmentId=${defaultEnvironment!.id}`,
      );
      expect(defaultEvents.data.some((entry) => entry.id === eventId)).toBe(
        false,
      );

      const allEvents = await listEvents();
      expect(allEvents.data.some((entry) => entry.id === eventId)).toBe(true);

      const releases = await waitFor(
        () => listReleases(),
        (page) => page.data.some((release) => release.version === RELEASE),
        SIDE_EFFECT_TIMEOUT,
      );
      const release = releases.data.find(
        (entry) => entry.version === RELEASE,
      );
      expect(release).toBeDefined();
      expect(release?.eventCount).toBe(1);
      expect(release?.latestEventId).toBe(eventId);
    },
    TEST_TIMEOUT,
  );

  it(
    "creates the issue and delivers the new-issue webhook",
    async () => {
      issue = await waitForIssue(
        (candidate) => candidate.fingerprint === ISSUE_FINGERPRINT,
      );
      expect(issue.title).toBe(`Error: ${MESSAGE}`);
      expect(issue.status).toBe("unresolved");
      expect(issue.eventCount).toBe(1);
      expect(issue.latestEventId).toBe(eventId);
      expect(issue.appId).toBe(appRecord.id);

      const detail = await adminJson<IssueDto>(
        "GET",
        `/api/admin/issues/${issue.id}`,
      );
      expect(detail.id).toBe(issue.id);
      expect(detail.fingerprint).toBe(ISSUE_FINGERPRINT);

      const byProject = await listIssues(`project:${project.id}`);
      expect(byProject.data.some((entry) => entry.id === issue.id)).toBe(true);

      const search = await listIssues(`app:${appRecord.id} ${MARKER}`);
      expect(search.data.some((entry) => entry.id === issue.id)).toBe(true);

      const all = await listIssues();
      expect(all.data.some((entry) => entry.id === issue.id)).toBe(true);

      const delivery = await waitForWebhook(
        (body) =>
          body.trigger === "new_issue" &&
          body.ruleName === newIssueRule.name &&
          body.issue?.fingerprint === ISSUE_FINGERPRINT,
      );
      expect(delivery.appId).toBe(appRecord.id);
      expect(delivery.issue?.title).toBe(`Error: ${MESSAGE}`);
      expect(String(delivery.message)).toContain("New issue");

      const incidents = await waitFor(
        () => listIncidents(),
        (page) =>
          page.data.some(
            (incident) =>
              incident.trigger === "new_issue" &&
              incident.issueFingerprint === ISSUE_FINGERPRINT,
          ),
        SIDE_EFFECT_TIMEOUT,
      );
      const incident = incidents.data.find(
        (entry) =>
          entry.trigger === "new_issue" &&
          entry.issueFingerprint === ISSUE_FINGERPRINT,
      );
      expect(incident?.ruleId).toBe(newIssueRule.id);
      expect(incident?.appId).toBe(appRecord.id);
    },
    TEST_TIMEOUT,
  );

  it(
    "resolves the issue and delivers the regression webhook when the fingerprint recurs",
    async () => {
      const resolved = await adminJson<IssueDto>(
        "PATCH",
        `/api/admin/issues/${issue.id}`,
        { status: "resolved" },
      );
      expect(resolved.status).toBe("resolved");

      const resolvedList = await listIssues(
        `app:${appRecord.id} is:resolved`,
      );
      expect(resolvedList.data.some((entry) => entry.id === issue.id)).toBe(
        true,
      );
      const unresolvedList = await listIssues(
        `app:${appRecord.id} is:unresolved`,
      );
      expect(unresolvedList.data.some((entry) => entry.id === issue.id)).toBe(
        false,
      );

      eventId2 = captureWithFingerprint(REGRESSION_MESSAGE);
      expect(eventId2).toBeTruthy();
      expect(eventId2).not.toBe(eventId);
      await Sentry.flush(5000);

      const secondEvent = await waitForEventById(
        baseUrl,
        eventId2,
        SIDE_EFFECT_TIMEOUT,
      );
      expect(secondEvent?.event_id).toBe(eventId2);
      expect(secondEvent?.exception?.values?.[0]?.value).toBe(
        REGRESSION_MESSAGE,
      );
      expect(secondEvent?.release).toBe(RELEASE);

      const reopened = await waitFor(
        () => listIssues(`app:${appRecord.id}`),
        (page) =>
          page.data.some(
            (entry) =>
              entry.id === issue.id &&
              entry.status === "unresolved" &&
              entry.eventCount === 2,
          ),
        SIDE_EFFECT_TIMEOUT,
      );
      const reopenedIssue = reopened.data.find(
        (entry) => entry.id === issue.id,
      );
      expect(reopenedIssue?.status).toBe("unresolved");
      expect(reopenedIssue?.eventCount).toBe(2);
      expect(reopenedIssue?.latestEventId).toBe(eventId2);
      expect(reopenedIssue?.title).toBe(`Error: ${REGRESSION_MESSAGE}`);

      const delivery = await waitForWebhook(
        (body) =>
          body.trigger === "regression" &&
          body.ruleName === regressionRule.name &&
          body.issue?.fingerprint === ISSUE_FINGERPRINT,
      );
      expect(delivery.appId).toBe(appRecord.id);
      expect(delivery.issue?.title).toBe(`Error: ${REGRESSION_MESSAGE}`);
      expect(String(delivery.message)).toContain("Regression");

      const incidents = await waitFor(
        () => listIncidents(),
        (page) =>
          page.data.filter(
            (incident) =>
              incident.issueFingerprint === ISSUE_FINGERPRINT,
          ).length === 2,
        SIDE_EFFECT_TIMEOUT,
      );
      const triggers = incidents.data
        .filter(
          (incident) => incident.issueFingerprint === ISSUE_FINGERPRINT,
        )
        .map((incident) => incident.trigger);
      expect(triggers).toContain("new_issue");
      expect(triggers).toContain("regression");

      const events = await listEvents(`appId=${appRecord.id}`);
      const eventIds = events.data
        .filter((entry) => entry.itemTypes.includes("event"))
        .map((entry) => entry.id);
      expect(eventIds).toContain(eventId);
      expect(eventIds).toContain(eventId2);

      const releases = await waitFor(
        () => listReleases(),
        (page) =>
          page.data.some(
            (release) =>
              release.version === RELEASE && release.eventCount === 2,
          ),
        SIDE_EFFECT_TIMEOUT,
      );
      const release = releases.data.find(
        (entry) => entry.version === RELEASE,
      );
      expect(release?.eventCount).toBe(2);
      expect(release?.latestEventId).toBe(eventId2);

      expect(
        webhookCalls.filter((body) => body.ruleName === newIssueRule.name),
      ).toHaveLength(1);
      expect(
        webhookCalls.filter((body) => body.ruleName === regressionRule.name),
      ).toHaveLength(1);
    },
    TEST_TIMEOUT,
  );

  it(
    "renders the project, environment, app, issue, event, and alert rules in the admin UI",
    async () => {
      await clickNav("Projects");
      await waitForTextInUI(appRecord.name, 20000);
      await waitForTextInUI("Staging", 20000);

      const projectsBody =
        (await view.evaluate("document.body.innerText")) ?? "";
      expect(projectsBody).toContain(project.name);
      expect(projectsBody).toContain("Staging");
      expect(projectsBody).toContain("staging");

      const appCard =
        (await view.evaluate(`(() => {
          const cards = Array.from(document.querySelectorAll(".app-card"));
          const card = cards.find((el) => (el.textContent || "").includes(${JSON.stringify(appRecord.name)}));
          return card?.innerText ?? "";
        })()`)) ?? "";
      expect(appCard).toContain(appRecord.name);
      expect(appCard).toContain("Staging");

      await selectApplicationInUI(appRecord.name);
      await clickNav("Alerts");
      const alertsBody = await waitForTextInUI(newIssueRule.name, 20000);
      expect(alertsBody).toContain("Effective configuration");
      expect(alertsBody).toContain(regressionRule.name);
      expect(alertsBody).toContain("New issue · App override");
      expect(alertsBody).toContain("Regression · App override");
      expect(alertsBody).toContain(channel.name);
      expect(alertsBody).toContain("webhook");

      await clickNav("Issues");
      await waitForTextInUI(`Error: ${REGRESSION_MESSAGE}`, 20000);

      const issueRow =
        (await view.evaluate(`(() => {
          const rows = Array.from(document.querySelectorAll(".data-row"));
          const row = rows.find((el) => (el.textContent || "").includes(${JSON.stringify(`Error: ${REGRESSION_MESSAGE}`)}));
          return row?.innerText ?? "";
        })()`)) ?? "";
      expect(issueRow).toContain("2");
      expect(issueRow).toContain("unresolved");

      const clicked =
        (await view.evaluate(`(() => {
          const rows = Array.from(document.querySelectorAll(".data-row"));
          const row = rows.find((el) => (el.textContent || "").includes(${JSON.stringify(`Error: ${REGRESSION_MESSAGE}`)}));
          if (!row) return false;
          row.click();
          return true;
        })()`)) ?? false;
      expect(clicked).toBe(true);

      // The list row already carries the latest occurrence's title, so
      // wait for the detail page itself.
      const detailBody = await waitForTextInUI("2 events", 20000);
      expect(detailBody).toContain(REGRESSION_MESSAGE);
      expect(detailBody).toContain(MESSAGE);
      expect(detailBody).toContain("environment: staging");
      expect(detailBody).toContain(`release: ${RELEASE}`);
    },
    60_000,
  );
});
