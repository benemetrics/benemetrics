/**
 * E2E Test: Error Tracking — Full Circle (SDK → Backend → Admin UI)
 *
 * Verifies the complete loop instead of fetching events from the API:
 *   1. The @sentry/bun SDK captures an event and sends it to the backend
 *   2. The backend ingests and stores the envelope
 *   3. The admin panel UI (served by the backend) renders the event
 *
 * The UI is loaded in a real headless browser via Bun.WebView and the
 * assertion is made against the rendered DOM, so a passing test proves
 * the client can send, the backend can store, and the UI can display.
 */

import * as Sentry from "@sentry/bun";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { app, ADMIN_TOKEN, ADMIN_HEADERS, ADMIN_TOKEN_RAW } from "./test-helpers";

const PROJECT_NAME = `E2E UI Project ${Date.now()}`;

let baseUrl = "";
let dsn = "";
let view: Bun.WebView;

function uniqueMarker(): string {
  return `e2e-ui-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/**
 * Polls the rendered admin UI until the given text shows up.
 * The Issues page polls the ingestion API every 2s, so no manual
 * reload is needed — we just wait for the next refresh cycle.
 */
async function waitForTextInUI(text: string, timeoutMs = 15000): Promise<string> {
  const start = Date.now();
  let body = "";
  while (Date.now() - start < timeoutMs) {
    body = (await view.evaluate("document.body.innerText")) ?? "";
    if (body.includes(text)) return body;
    await Bun.sleep(400);
  }
  const shot = await view.screenshot();
  await Bun.write("/tmp/e2e-ui-failure.png", shot);
  throw new Error(`"${text}" not found in admin UI within ${timeoutMs}ms. Page text: ${body.slice(0, 300)}`);
}

/**
 * The Issues page scopes events to the project selected in the sidebar.
 * The test provisions the project + app through the admin API before
 * ingesting, so the project is selected by its real name.
 */
async function selectProjectInUI(name: string, timeoutMs = 20000): Promise<void> {
  const start = Date.now();
  let reloaded = false;
  while (Date.now() - start < timeoutMs) {
    const selected = await view.evaluate(`(() => {
      const trigger = document.querySelector(".project-switcher");
      if (!trigger) return false;
      if ((trigger.textContent || "").includes(${JSON.stringify(name)})) return true;
      const menu = document.querySelector(".project-menu");
      if (!menu) {
        trigger.click();
        return false;
      }
      const options = Array.from(menu.querySelectorAll(".project-option"));
      const target = options.find((el) => (el.textContent || "").includes(${JSON.stringify(name)}));
      if (!target) return false;
      target.click();
      return true;
    })()`);
    if (selected) return;
    // The project may not exist yet when the SPA first loaded its project
    // list (first ingest creates it), so reload once to pick it up.
    if (!reloaded && Date.now() - start > 3000) {
      reloaded = true;
      await view.navigate(`${baseUrl}/ui/issues`);
    }
    await Bun.sleep(400);
  }
  throw new Error(`Could not select project "${name}" in the admin UI`);
}

describe("Error Tracking — Full Circle (SDK → Backend → Admin UI)", () => {
  beforeAll(async () => {
    app.listen(0);
    const server = (app as any).server;
    baseUrl = `http://localhost:${server.port}`;

    // Apps are only created through the admin API; provision one and
    // point the Sentry SDK at its real DSN.
    const adminHeaders = {
      "Content-Type": "application/json",
      Authorization: ADMIN_TOKEN,
    };
    const projectResponse = await fetch(`${baseUrl}/api/admin/projects`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ name: PROJECT_NAME }),
    });
    const project = (await projectResponse.json()) as { id: string };
    const appResponse = await fetch(`${baseUrl}/api/admin/projects/${project.id}/apps`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ name: "UI App" }),
    });
    const created = (await appResponse.json()) as { number: number; publicKey: string };
    dsn = `http://${created.publicKey}@${new URL(baseUrl).host}/${created.number}`;

    Sentry.init({
      dsn,
      environment: "test",
      release: "e2e-ui-full-circle",
      defaultIntegrations: false,
    });

    view = new Bun.WebView({ backend: "chrome", width: 1280, height: 900 });
    await view.navigate(`${baseUrl}/ui/issues`);
    // The UI has no built-in token fallback: log in by storing the admin
    // token in localStorage, then reload so the SPA picks it up.
    await view.evaluate(
      `sessionStorage.setItem("benemetrics.credential", "${ADMIN_TOKEN_RAW}")`,
    );
    await view.navigate(`${baseUrl}/ui/issues`);
  });

  afterAll(async () => {
    await Sentry.flush(2000);
    await Sentry.close();
    await view?.close();
    (app as any).server?.stop(true);
  });

  it("captures a generic Error, stores it, and displays it in the admin UI", async () => {
    const msg = uniqueMarker();
    const eventId = Sentry.captureException(new Error(msg));
    expect(eventId).toBeDefined();

    await Sentry.flush(5000);
    await selectProjectInUI(PROJECT_NAME);

    const body = await waitForTextInUI(`Error: ${msg}`);
    expect(body).toContain(`Error: ${msg}`);
    expect(body).toContain("seen just now"); // rendered as a live (not mock) row
  }, 30000);

  it("captures a TypeError with stack trace and displays it in the admin UI", async () => {
    const msg = uniqueMarker();
    let eventId = "";
    try {
      throw new TypeError(msg);
    } catch (e) {
      eventId = Sentry.captureException(e as Error);
    }
    expect(eventId).toBeDefined();

    await Sentry.flush(5000);
    await selectProjectInUI(PROJECT_NAME);
    const body = await waitForTextInUI(`TypeError: ${msg}`);
    expect(body).toContain(`TypeError: ${msg}`);
  }, 30000);

  it("captures a message event and displays it in the admin UI", async () => {
    const msg = uniqueMarker();
    const eventId = Sentry.captureMessage(msg, "warning");
    expect(eventId).toBeDefined();

    await Sentry.flush(5000);
    await selectProjectInUI(PROJECT_NAME);
    const body = await waitForTextInUI(msg);
    expect(body).toContain(msg);
  }, 30000);

  it("stores multiple events and displays all of them in the admin UI", async () => {
    const msg1 = uniqueMarker();
    const msg2 = uniqueMarker();
    const msg3 = uniqueMarker();

    // Distinct error types and a message event: same-type exceptions share
    // a fingerprint and would collapse into earlier issues, hiding their
    // messages from the grouped list.
    Sentry.captureException(new SyntaxError(msg1));
    Sentry.captureMessage(msg2, "error");
    Sentry.captureException(new RangeError(msg3));

    await Sentry.flush(5000);
    await selectProjectInUI(PROJECT_NAME);
    await waitForTextInUI(`SyntaxError: ${msg1}`);
    await waitForTextInUI(msg2);
    await waitForTextInUI(`RangeError: ${msg3}`);
  }, 30000);

  it("does not display an event that was never sent (negative case)", async () => {
    const ghost = uniqueMarker();

    // No capture, no send — the UI must not show it after several refresh cycles
    await Bun.sleep(6000);
    const body = (await view.evaluate("document.body.innerText")) ?? "";
    expect(body).not.toContain(ghost);
  }, 10000);
});
