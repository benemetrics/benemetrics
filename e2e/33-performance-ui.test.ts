/**
 * E2E Test: Performance metrics panels in the real UI.
 *
 * The Performance page reads the metrics API (raw samples in ClickHouse):
 * the web vitals cards, the mobile vitals panel and the latency tables
 * must render them. Rows are seeded straight into `sentry_metrics` — no
 * ingestion, no SDK: a unique transaction-name marker proves the
 * breakdown is served from the samples, and its P95 proves the quantile
 * path end to end (CH → API → UI).
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import app from "../backend/index";
import { insertClickHouseMetricSamples } from "../backend/clickhouse";

const ADMIN_TOKEN = "API-Key e2e-admin-token";
const PROJECT_NAME = `Perf UI Project ${Date.now()}`;
const MARKER = `GET /perf-ui-${Math.random().toString(36).slice(2, 8)}`;

let baseUrl = "";
let view: Bun.WebView;

async function adminRequest(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: ADMIN_TOKEN },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function waitForTextInUI(text: string, timeoutMs = 20000): Promise<string> {
  const start = Date.now();
  let body = "";
  while (Date.now() - start < timeoutMs) {
    body = (await view.evaluate("document.body.innerText")) ?? "";
    if (body.includes(text)) return body;
    await Bun.sleep(400);
  }
  const shot = await view.screenshot();
  await Bun.write("/tmp/e2e-perf-ui-failure.png", shot);
  throw new Error(
    `"${text}" not found in admin UI within ${timeoutMs}ms. Page text: ${body.slice(0, 300)}`,
  );
}

/** Selects the fixture project in the sidebar switcher. */
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
    if (!reloaded && Date.now() - start > 3000) {
      reloaded = true;
      await view.navigate(`${baseUrl}/ui/overview`);
    }
    await Bun.sleep(400);
  }
  throw new Error(`Could not select project "${name}" in the admin UI`);
}

/** Navigates inside the SPA by clicking the sidebar item (no reload). */
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

function sample(
  projectId: string,
  appId: string,
  metric: string,
  value: number,
  dimension: string,
  offsetMs: number,
) {
  return {
    projectId,
    appId,
    eventId: crypto.randomUUID(),
    metric,
    value,
    dimension,
    tags: {},
    receivedAt: new Date(Date.now() - offsetMs).toISOString(),
  };
}

describe("Performance metrics UI", () => {
  beforeAll(async () => {
    app.listen(0);
    baseUrl = `http://localhost:${(app as any).server.port}`;

    const project = (await (
      await adminRequest("POST", "/api/admin/projects", { name: PROJECT_NAME })
    ).json()) as { id: string };
    const appRecord = (await (
      await adminRequest("POST", `/api/admin/projects/${project.id}/apps`, {
        name: "Perf UI App",
      })
    ).json()) as { id: string };

    // All rows land well inside the page's 6h window.
    const rows = [
      // Latency: five samples on the marked transaction (P50 300ms, P95 480ms).
      ...[100, 200, 300, 400, 500].map((value, index) =>
        sample(project.id, appRecord.id, "duration", value, MARKER, 5 * 60_000 + index * 5_000),
      ),
      // Web vitals: LCP P50 2200ms (good band).
      ...[2000, 2200, 2400].map((value, index) =>
        sample(project.id, appRecord.id, "lcp", value, "pageload", 4 * 60_000 + index * 1_000),
      ),
      // Mobile vitals: cold start P50 3000ms (needs improvement) and a
      // 20-of-200 slow-frame window (10.0% derived rate).
      ...[2500, 3500].map((value, index) =>
        sample(project.id, appRecord.id, "app_start_cold", value, "AppStart", 3 * 60_000 + index * 1_000),
      ),
      ...[100, 100].map((value, index) =>
        sample(project.id, appRecord.id, "frames_total", value, "HomeScreen", 2 * 60_000 + index * 1_000),
      ),
      ...[10, 10].map((value, index) =>
        sample(project.id, appRecord.id, "frames_slow", value, "HomeScreen", 2 * 60_000 + index * 1_000 + 500),
      ),
      sample(project.id, appRecord.id, "stall_count", 2, "HomeScreen", 60_000),
    ];
    await insertClickHouseMetricSamples(rows);

    view = new Bun.WebView({ backend: "chrome", width: 1280, height: 900 });
    await view.navigate(`${baseUrl}/ui/overview`);
    // The UI has no built-in token fallback: log in by storing the admin
    // token in localStorage, then reload so the SPA picks it up.
    await view.evaluate(`localStorage.setItem("benedebug.adminToken", "e2e-admin-token")`);
    await view.navigate(`${baseUrl}/ui/overview`);
    // The workspace auto-selects the first project; scope the fixture.
    await selectProjectInUI(PROJECT_NAME);
    await clickNav("Performance");
  }, 60000);

  afterAll(async () => {
    await view?.close();
    (app as any).server?.stop(true);
  });

  it("renders web vitals, mobile vitals and the latency tables from the metrics API", async () => {
    // The breakdown table shows the seeded transaction name...
    await waitForTextInUI(MARKER);

    // ...with the quantiles served by the samples API.
    const body = await waitForTextInUI("P95 latency");
    expect(body).toContain("480ms"); // P95 of the marked transaction
    expect(body).toContain("P95 per 1 min bucket");

    expect(body).toContain("Web vitals");
    expect(body).toContain("LCP");
    expect(body).toContain("2.20s"); // LCP P50

    expect(body).toContain("Mobile vitals");
    expect(body).toContain("Cold start");
    expect(body).toContain("3.00s"); // cold start P50
    expect(body).toContain("Slow frames");
    expect(body).toContain("10.0%"); // derived slow-frame rate
    expect(body).toContain("Stalls");
  }, 45000);
});
