/**
 * E2E Test: Backend-parity admin surfaces in the real UI.
 *
 * Locks in the screens built for the admin API's full surface:
 *   - Projects: environment rename/default/delete controls
 *   - Segments page (create/list/detail)
 *   - Feature flags: unified creation with audience segments (pick existing or build inline)
 *   - Source maps page (upload tokens + artifacts + resolve tool)
 *   - Release detail (get / patch / finalize / delete / summary)
 *   - Alerts: rule pause/enable + delete actions
 *
 * Fixtures are provisioned through the admin API, then asserted against
 * the DOM rendered by the SPA served from the same server.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import app from "../backend/index";

const ADMIN_TOKEN = "API-Key e2e-admin-token";
const PROJECT_NAME = `Parity UI Project ${Date.now()}`;
const SEGMENT_NAME = `Paying customers ${Date.now()}`;
const TOKEN_NAME = `Upload token ${Date.now()}`;
const RELEASE_VERSION = `parity-ui@${Date.now()}`;
const RELEASE_OWNER = "owner@parity.test";
const RULE_NAME = `Parity rule ${Date.now()}`;

let baseUrl = "";
let view: Bun.WebView;
// The DSN public key of the app the SDK surfaces authenticate with.
let appPublicKey = "";
let projectId = "";

const adminHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: ADMIN_TOKEN,
});

async function adminRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: adminHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function waitForTextInUI(text: string, timeoutMs = 15000): Promise<string> {
  const start = Date.now();
  let body = "";
  while (Date.now() - start < timeoutMs) {
    body = (await view.evaluate("document.body.innerText")) ?? "";
    if (body.includes(text)) return body;
    await Bun.sleep(400);
  }
  const shot = await view.screenshot();
  await Bun.write("/tmp/e2e-parity-ui-failure.png", shot);
  throw new Error(
    `"${text}" not found in admin UI within ${timeoutMs}ms. Page text: ${body.slice(0, 300)}`,
  );
}

/** Clicks a `.row-action` with the given label inside the row containing `rowText`. */
async function clickRowAction(rowText: string, actionLabel: string): Promise<boolean> {
  return (
    (await view.evaluate(`(() => {
      const rows = Array.from(document.querySelectorAll(".list-screen-row"));
      const row = rows.find((el) => (el.textContent || "").includes(${JSON.stringify(rowText)}));
      if (!row) return false;
      const action = Array.from(row.querySelectorAll(".row-action")).find(
        (el) => (el.textContent || "").trim() === ${JSON.stringify(actionLabel)},
      );
      if (!action) return false;
      action.click();
      return true;
    })()`)) ?? false
  );
}

/** Navigates inside the SPA by clicking the sidebar item (no full page reload). */
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

/** Clicks an `.action` control (Action component) by its visible label. */
async function clickAction(label: string): Promise<boolean> {
  return (
    (await view.evaluate(`(() => {
      const normalize = (text) => (text || "").replace(/\\s+/g, " ").replace(/^\\+\\s*/, "").trim();
      const nodes = Array.from(document.querySelectorAll(".action"));
      const node = nodes.find((el) => normalize(el.textContent).startsWith(${JSON.stringify(label)}));
      if (!node) return false;
      node.click();
      return true;
    })()`)) ?? false
  );
}

/** Sets a React-controlled input/textarea identified by its aria-label. */
async function setField(label: string, value: string): Promise<boolean> {
  const selector = `[aria-label="${label}"]`;
  return (
    (await view.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`)) ?? false
  );
}

/** Waits for the flags list row to show the flag together with its audience chip. */
async function waitForFlagRowWithAudience(name: string, timeoutMs = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ready =
      (await view.evaluate(`(() => {
        const rows = Array.from(document.querySelectorAll(".list-screen-row"));
        const row = rows.find((el) => (el.textContent || "").includes(${JSON.stringify(name)}));
        return !!(row && (row.textContent || "").includes("Audience · 1 segment"));
      })()`)) ?? false;
    if (ready) return true;
    await Bun.sleep(400);
  }
  return false;
}

describe("Backend parity — admin UI surfaces", () => {
  beforeAll(async () => {
    app.listen(0);
    const server = (app as any).server;
    baseUrl = `http://localhost:${server.port}`;

    // Project + app + default environment.
    const project = (await (
      await adminRequest("POST", "/api/admin/projects", { name: PROJECT_NAME })
    ).json()) as { id: string };
    projectId = project.id;
    const appRecord = (await (
      await adminRequest("POST", `/api/admin/projects/${project.id}/apps`, {
        name: "Parity App",
        platform: "web",
      })
    ).json()) as { id: string; publicKey: string; environment: { id: string } };
    appPublicKey = appRecord.publicKey;

    // Segment fixture (rules use the targeting-rule shape).
    await adminRequest("POST", "/api/admin/segments", {
      name: SEGMENT_NAME,
      description: "Everyone on a paid plan",
      rules: [
        {
          id: "rule-1",
          attribute: "plan",
          operator: "equals",
          value: "pro",
          variantKey: "on",
        },
      ],
    });

    // Source-map upload token fixture.
    await adminRequest("POST", "/api/admin/source-map-tokens", {
      name: TOKEN_NAME,
      projectId: project.id,
      appId: appRecord.id,
      environmentId: appRecord.environment.id,
    });

    // Release fixture (draft, so the detail page offers Finalize).
    await adminRequest("POST", "/api/admin/releases", {
      appId: appRecord.id,
      version: RELEASE_VERSION,
      owner: RELEASE_OWNER,
    });

    // Enabled alert rule so the pause action has something to toggle.
    await adminRequest("POST", "/api/admin/alerting/rules", {
      name: RULE_NAME,
      metric: "error_count",
      operator: "gt",
      threshold: 5,
      windowSeconds: 300,
    });

    view = new Bun.WebView({ backend: "chrome", width: 1280, height: 900 });
    await view.navigate(`${baseUrl}/ui/overview`);
    await view.evaluate(
      `localStorage.setItem("benedebug.adminToken", "e2e-admin-token")`,
    );
    await view.navigate(`${baseUrl}/ui/overview`);
    // Wait until the workspace resolved the project before visiting
    // project-scoped pages (Source maps reads the selected project).
    await waitForTextInUI(PROJECT_NAME, 20000);
  });

  afterAll(async () => {
    await view?.close();
    (app as any).server?.stop(true);
  });

  it("renders the Segments page with the created segment and its rules", async () => {
    await clickNav("Segments");
    const body = await waitForTextInUI(SEGMENT_NAME);
    expect(body).toContain("1 rule");

    const opened = await view.evaluate(`(() => {
      const rows = Array.from(document.querySelectorAll(".list-screen-row"));
      const row = rows.find((el) => (el.textContent || "").includes(${JSON.stringify(SEGMENT_NAME)}));
      if (!row) return false;
      row.click();
      return true;
    })()`);
    expect(opened).toBe(true);
    const detail = await waitForTextInUI("TARGETING RULES");
    expect(detail).toContain("plan");
  }, 30000);

  it("renders the Source maps page with the upload token", async () => {
    await clickNav("Source maps");
    const body = await waitForTextInUI(TOKEN_NAME);
    expect(body).toContain("Upload tokens");
    expect(body).toContain("Resolve a position");
  }, 30000);

  it("renders environment management on the Projects page", async () => {
    await clickNav("Projects");
    // Wait for the workspace environments to resolve: the lowercase slug
    // "testing" only appears in the environment row (the Source maps page
    // shows "Testing" as the environment name, so it can't be the anchor).
    const body = await waitForTextInUI("testing");
    expect(body).toContain("Environments");
    expect(body).toContain("Default");
    expect(body).toContain("Rename");
  }, 30000);

  it("opens the release detail page from the releases list", async () => {
    await clickNav("Releases");
    await waitForTextInUI(RELEASE_VERSION);
    const opened = await view.evaluate(`(() => {
      const rows = Array.from(document.querySelectorAll(".list-screen-row"));
      const row = rows.find((el) => (el.textContent || "").includes(${JSON.stringify(RELEASE_VERSION)}));
      if (!row) return false;
      row.click();
      return true;
    })()`);
    expect(opened).toBe(true);
    await waitForTextInUI("Release details");
    // The owner is loaded into the edit form, so assert on the input value.
    const ownerLoaded =
      (await view.evaluate(
        `Array.from(document.querySelectorAll("input")).some((el) => el.value === ${JSON.stringify(RELEASE_OWNER)})`,
      )) ?? false;
    expect(ownerLoaded).toBe(true);
    await waitForTextInUI("Finalize");
  }, 30000);

  it("pauses an alert rule from the list", async () => {
    await clickNav("Alerts");
    await waitForTextInUI(RULE_NAME);
    const clicked = await clickRowAction(RULE_NAME, "Pause");
    expect(clicked).toBe(true);
    await waitForTextInUI("Disabled");
  }, 30000);

  it("creates a flag targeting an existing audience segment in one submission", async () => {
    await clickNav("Feature flags");
    await waitForTextInUI("New flag");
    expect(await clickAction("New flag")).toBe(true);
    await waitForTextInUI("Audience");
    await waitForTextInUI(SEGMENT_NAME);

    const selected = (await view.evaluate(`(() => {
      const options = Array.from(document.querySelectorAll(".segment-option"));
      const option = options.find((el) => (el.textContent || "").includes(${JSON.stringify(SEGMENT_NAME)}));
      if (!option) return false;
      option.click();
      return true;
    })()`)) ?? false;
    expect(selected).toBe(true);
    await waitForTextInUI("1 selected");

    const flagName = `Unified audience flag ${Date.now()}`;
    expect(await setField("Flag name", flagName)).toBe(true);
    expect(await clickAction("Create flag")).toBe(true);

    expect(await waitForFlagRowWithAudience(flagName)).toBe(true);
  }, 30000);

  it("creates a brand-new audience segment alongside the flag", async () => {
    await clickNav("Feature flags");
    await waitForTextInUI("New flag");
    expect(await clickAction("New flag")).toBe(true);
    await waitForTextInUI("Audience");
    expect(await clickAction("New segment")).toBe(true);

    const segmentName = `Inline audience ${Date.now()}`;
    expect(await setField("New segment name", segmentName)).toBe(true);
    const flagName = `Inline audience flag ${Date.now()}`;
    expect(await setField("Flag name", flagName)).toBe(true);
    expect(await clickAction("Create flag")).toBe(true);

    expect(await waitForFlagRowWithAudience(flagName)).toBe(true);

    // The inline segment also exists as a standalone segment.
    await clickNav("Segments");
    const segmentsBody = await waitForTextInUI(segmentName);
    expect(segmentsBody).toContain(segmentName);
  }, 30000);

  it("renders the experiment Results dashboard", async () => {
    const stamp = Date.now();
    const created = await adminRequest("POST", "/api/admin/feature-flags", {
      projectId,
      key: `results-${stamp}`,
      name: `Results flag ${stamp}`,
      type: "boolean",
      defaultValue: false,
      variants: [
        { key: "control", name: "Control", value: false, weight: 50 },
        { key: "treatment", name: "Treatment", value: true, weight: 50 },
      ],
      experiment: { enabled: true, primaryMetric: "conversion" },
    });
    const flag = (await created.json()) as { id: string; key: string };
    await adminRequest("POST", `/api/admin/feature-flags/${flag.id}/status`, {
      status: "active",
    });

    // Persist a few assignments so the dashboard has participants. The
    // SDK surface authenticates with the DSN public key.
    for (let i = 0; i < 12; i++) {
      const evaluateUrl = new URL(`${baseUrl}/api/sentry/flags/evaluate`);
      evaluateUrl.searchParams.set("sentry_key", appPublicKey);
      await fetch(evaluateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user: { id: `results-user-${stamp}-${i}` },
          flags: [flag.key],
        }),
      });
    }

    await clickNav("Feature flags");
    await waitForTextInUI(flag.key);
    expect(await clickRowAction(flag.key, "Results")).toBe(true);

    const panel = await waitForTextInUI("Primary metric");
    // innerText reflects the CSS-uppercased table header.
    expect(panel).toContain("PARTICIPANTS");
    expect(panel).toContain("95% CI");
    expect(panel).toContain("Recommendation");
  }, 30000);
});
