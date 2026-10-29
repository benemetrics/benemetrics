/**
 * E2E Test: the Permissions screen in the real UI.
 *
 * The screen administers the read scope: the group rules, the identity
 * grants and the change trail. It is admin-token only.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  app,
  ADMIN_TOKEN,
  ADMIN_HEADERS,
  ADMIN_TOKEN_RAW,
} from "./test-helpers";
const GROUP_NAME = `backend-team-${Date.now()}`;

let baseUrl = "";
let view: Bun.WebView;

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
  await Bun.write("/tmp/e2e-permissions-ui-failure.png", shot);
  throw new Error(
    `"${text}" not found in the permissions UI within ${timeoutMs}ms. Page text: ${body.slice(0, 300)}`,
  );
}

async function clickText(text: string, timeoutMs = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const clicked =
      (await view.evaluate(`(() => {
      const target = Array.from(document.querySelectorAll("button, .action, [role=button]"))
        .find((el) => (el.innerText || "").trim() === ${JSON.stringify(text)});
      if (!target) return false;
      target.click();
      return true;
    })()`)) ?? false;
    if (clicked) return true;
    await Bun.sleep(300);
  }
  return false;
}

async function fillField(placeholder: string, value: string): Promise<boolean> {
  return (
    (await view.evaluate(`(() => {
    const input = Array.from(document.querySelectorAll("input"))
      .find((el) => el.placeholder === ${JSON.stringify(placeholder)});
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`)) ?? false
  );
}

describe("Permissions UI", () => {
  beforeAll(async () => {
    app.listen(0);
    const server = (app as any).server;
    baseUrl = `http://localhost:${server.port}`;

    view = new Bun.WebView({ backend: "chrome", width: 1280, height: 900 });
    await view.navigate(`${baseUrl}/ui/overview`);
    await view.evaluate(
      `sessionStorage.setItem("benemetrics.credential", "${ADMIN_TOKEN_RAW}")`,
    );
    await view.navigate(`${baseUrl}/ui/permissions`);
    await waitForTextInUI("Permissions");
  }, 40000);

  afterAll(async () => {
    await view?.close();
    (app as any).server?.stop(true);
  });

  it("creates a group rule and lists it", async () => {
    expect(await fillField("backend-team", GROUP_NAME)).toBe(true);
    expect(await fillField("api-, worker-", "production")).toBe(true);
    expect(await clickText("Create group rule")).toBe(true);

    const body = await waitForTextInUI(GROUP_NAME);
    expect(body).toContain("apps: production");
  }, 30000);

  it("records the change in the trail", async () => {
    const body = await waitForTextInUI("create");
    expect(body).toContain(GROUP_NAME);
  }, 30000);

  it("deletes the group rule", async () => {
    // The delete action lives in the rule's row.
    const removed =
      (await view.evaluate(`(() => {
      const row = Array.from(document.querySelectorAll(".permission-rule"))
        .find((el) => (el.innerText || "").includes(${JSON.stringify(GROUP_NAME)}));
      if (!row) return false;
      const button = Array.from(row.querySelectorAll("button, .action, .row-action"))
        .find((el) => (el.innerText || "").trim() === "Remove");
      if (!button) return false;
      button.click();
      return true;
    })()`)) ?? false;
    expect(removed).toBe(true);

    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const body = ((await view.evaluate("document.body.innerText")) ??
        "") as string;
      if (!body.includes(GROUP_NAME)) return;
      await Bun.sleep(400);
    }
    throw new Error("The group rule was not removed");
  }, 30000);

  it("serves the permission routes to the admin token only", async () => {
    const rules = await adminRequest("GET", "/api/admin/permissions/rules");
    expect(rules.status).toBe(200);

    const unauthorized = await fetch(`${baseUrl}/api/admin/permissions/rules`);
    expect(unauthorized.status).toBe(401);
  });
});
