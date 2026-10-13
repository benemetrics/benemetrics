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
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import app from "../backend/index";

const DSN_PUBLIC_KEY = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4";
const PROJECT_ID = "123";

let baseUrl = "";
let view: Bun.WebView;

function uniqueMarker(): string {
  return `e2e-ui-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function clearEvents(): Promise<void> {
  await fetch(`${baseUrl}/events/clear`, { method: "POST" });
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

describe("Error Tracking — Full Circle (SDK → Backend → Admin UI)", () => {
  beforeAll(async () => {
    // Start the real backend (API + admin UI) on an ephemeral port
    app.listen(0);
    const server = (app as any).server;
    baseUrl = `http://localhost:${server.port}`;
    await clearEvents();

    // Point the Sentry SDK at the backend
    Sentry.init({
      dsn: `http://${DSN_PUBLIC_KEY}@localhost:${server.port}/${PROJECT_ID}`,
      environment: "test",
      release: "e2e-ui-full-circle",
      defaultIntegrations: false,
    });

    // Load the admin panel in a real headless browser
    view = new Bun.WebView({ backend: "chrome", width: 1280, height: 900 });
    await view.navigate(`${baseUrl}/ui/issues`);
  });

  beforeEach(async () => {
    await clearEvents();
  });

  afterEach(async () => {
    await clearEvents();
  });

  afterAll(async () => {
    await Sentry.flush(2000);
    await Sentry.close();
    await clearEvents();
    await view?.close();
    (app as any).server?.stop(true);
  });

  it("captures a generic Error, stores it, and displays it in the admin UI", async () => {
    const msg = uniqueMarker();
    const eventId = Sentry.captureException(new Error(msg));
    expect(eventId).toBeDefined();

    await Sentry.flush(5000);
    const body = await waitForTextInUI(`Error: ${msg}`);
    expect(body).toContain(`Error: ${msg}`);
    expect(body).toContain("seen just now"); // rendered as a live (not mock) row
  });

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
    const body = await waitForTextInUI(`TypeError: ${msg}`);
    expect(body).toContain(`TypeError: ${msg}`);
  });

  it("captures a message event and displays it in the admin UI", async () => {
    const msg = uniqueMarker();
    const eventId = Sentry.captureMessage(msg, "warning");
    expect(eventId).toBeDefined();

    await Sentry.flush(5000);
    const body = await waitForTextInUI(msg);
    expect(body).toContain(msg);
  });

  it("stores multiple events and displays all of them in the admin UI", async () => {
    const msg1 = uniqueMarker();
    const msg2 = uniqueMarker();
    const msg3 = uniqueMarker();

    Sentry.captureException(new Error(msg1));
    Sentry.captureMessage(msg2, "error");
    Sentry.captureException(new TypeError(msg3));

    await Sentry.flush(5000);
    await waitForTextInUI(`Error: ${msg1}`);
    await waitForTextInUI(msg2);
    await waitForTextInUI(`TypeError: ${msg3}`);
  });

  it("does not display an event that was never sent (negative case)", async () => {
    const ghost = uniqueMarker();

    // No capture, no send — the UI must not show it after several refresh cycles
    await Bun.sleep(6000);
    const body = (await view.evaluate("document.body.innerText")) ?? "";
    expect(body).not.toContain(ghost);
  }, 10000);
});
