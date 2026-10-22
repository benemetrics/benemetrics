/**
 * E2E Test: Issues page (real UI) — resolve/reopen flow.
 *
 * The Issues page is backed by the admin issues API (not client-side
 * grouping); this locks in the full loop in a real browser:
 *   - an ingested error shows up as an unresolved issue row
 *   - "Resolve" removes it from the unresolved filter and flips the backend
 *     status (which arms the "regression" alert trigger)
 *   - the resolved filter lists it again with a "Reopen" action
 *   - "Reopen" flips the backend status back
 *   - the toolbar search feeds the server-side `q` filter
 *
 * Provisioning goes through the admin API; the SPA is served from the same
 * server under /ui.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import app from "../backend/index";

const ADMIN_TOKEN = "API-Key e2e-admin-token";
const PROJECT_NAME = `Issues UI ${Date.now()}`;
const uniq = () => Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

let baseUrl = "";
let view: Bun.WebView;
let appRecord: { id: string; ingestKey: string; publicKey: string };
const message = `ui problem ${uniq()}`;

async function adminRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: ADMIN_TOKEN },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function issueStatus(): Promise<string | null> {
  const response = await adminRequest("GET", `/api/admin/issues?query=${encodeURIComponent(`app:${appRecord.id}`)}`);
  const body = (await response.json()) as { data?: Array<{ status: string }> };
  return body.data?.[0]?.status ?? null;
}

async function waitForIssueStatus(expected: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  let last: string | null = null;
  while (Date.now() - start < timeoutMs) {
    last = await issueStatus();
    if (last === expected) return;
    await Bun.sleep(100);
  }
  throw new Error(`issue status stayed "${last}", expected "${expected}"`);
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
  await Bun.write("/tmp/e2e-issues-ui-failure.png", shot);
  throw new Error(
    `"${text}" not found in admin UI within ${timeoutMs}ms. Page text: ${body.slice(0, 300)}`,
  );
}

/** Waits for a `.data-row` containing `rowText` to appear/disappear. */
async function waitForRow(rowText: string, present: boolean, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found =
      (await view.evaluate(`(() => {
        const rows = Array.from(document.querySelectorAll(".data-row"));
        return rows.some((el) => (el.textContent || "").includes(${JSON.stringify(rowText)}));
      })()`)) ?? false;
    if (found === present) return;
    await Bun.sleep(400);
  }
  throw new Error(`row "${rowText}" ${present ? "never appeared" : "never disappeared"}`);
}

/** Clicks a `.row-action` with the given label inside the row containing `rowText`. */
async function clickRowAction(rowText: string, actionLabel: string): Promise<boolean> {
  return (
    (await view.evaluate(`(() => {
      const rows = Array.from(document.querySelectorAll(".data-row"));
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

/** Clicks the interactive status filter chip with the exact label. */
async function clickChip(label: string): Promise<boolean> {
  return (
    (await view.evaluate(`(() => {
      const chips = Array.from(document.querySelectorAll(".filter-chip.clickable"));
      const chip = chips.find((el) => (el.textContent || "").trim() === ${JSON.stringify(label)});
      if (!chip) return false;
      chip.click();
      return true;
    })()`)) ?? false
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

describe("Issues page — resolve/reopen in the real UI", () => {
  beforeAll(async () => {
    app.listen(0);
    const server = (app as any).server;
    baseUrl = `http://localhost:${server.port}`;

    const project = (await (
      await adminRequest("POST", "/api/admin/projects", { name: PROJECT_NAME })
    ).json()) as { id: string };
    appRecord = (await (
      await adminRequest("POST", `/api/admin/projects/${project.id}/apps`, {
        name: "Issues UI App",
        platform: "web",
      })
    ).json()) as { id: string; ingestKey: string; publicKey: string };

    const ingested = await fetch(
      `${baseUrl}/api/${appRecord.ingestKey}/store/?sentry_key=${encodeURIComponent(appRecord.publicKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: crypto.randomUUID(),
          level: "error",
          message,
          environment: "test",
        }),
      },
    );
    expect(ingested.ok).toBe(true);
    await waitForIssueStatus("unresolved");

    view = new Bun.WebView({ backend: "chrome", width: 1280, height: 900 });
    await view.navigate(`${baseUrl}/ui/overview`);
    await view.evaluate(
      `localStorage.setItem("benedebug.adminToken", "e2e-admin-token")`,
    );
    await view.navigate(`${baseUrl}/ui/overview`);
    // Wait until the workspace resolved the project before visiting
    // project-scoped pages.
    await waitForTextInUI(PROJECT_NAME, 20000);
  });

  afterAll(async () => {
    await view?.close();
    (app as any).server?.stop(true);
  });

  it("lists the ingested error as an unresolved issue", async () => {
    await clickNav("Issues");
    // The Overview page renders the same issue title, so a bare text
    // match does not prove the Issues table has rendered: wait for the
    // row itself before reading the status column.
    await waitForRow(message, true);
    const body = (await view.evaluate("document.body.innerText")) ?? "";
    expect(body).toContain("unresolved");
    expect(body).toContain("Status: Unresolved");
  }, 30000);

  it("resolves the issue and reopens it from the resolved filter", async () => {
    await clickNav("Issues");
    await waitForRow(message, true);

    expect(await clickRowAction(message, "Resolve")).toBe(true);
    await waitForRow(message, false);
    await waitForIssueStatus("resolved");

    // The resolved filter lists it with a Reopen action.
    expect(await clickChip("Status: Resolved")).toBe(true);
    await waitForRow(message, true);
    const resolvedBody = (await view.evaluate("document.body.innerText")) ?? "";
    expect(resolvedBody).toContain("resolved");

    expect(await clickRowAction(message, "Reopen")).toBe(true);
    await waitForRow(message, false);
    await waitForIssueStatus("unresolved");

    // …and it is back in the default unresolved filter.
    expect(await clickChip("Status: Unresolved")).toBe(true);
    await waitForRow(message, true);
  }, 30000);

  it("searches the list through the server-side q filter", async () => {
    await clickNav("Issues");
    await waitForRow(message, true);

    const typed = await view.evaluate(`(() => {
      const el = document.querySelector(".toolbar-input");
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      ).set;
      setter.call(el, "no-such-issue-xyz");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    expect(typed).toBe(true);

    await waitForTextInUI("No matching issues");
    await waitForRow(message, false);
  }, 30000);
});
