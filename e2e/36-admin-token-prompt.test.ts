/**
 * E2E: stored OIDC admin credential dismisses the login gate.
 *
 * With an identity provider configured (the suite always bootstraps one via
 * `e2e/preload.ts`) and no credential stored, the frontend redirects into the
 * provider's login flow. Storing a valid OIDC admin JWT dismisses the gate
 * and the SPA renders authenticated as an administrator.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { app, ADMIN_JWT } from "./test-helpers";

let baseUrl = "";
let view: Bun.WebView;

async function waitForUI(
  predicate: (body: string) => boolean,
  timeoutMs = 15000,
): Promise<string> {
  const start = Date.now();
  let body = "";
  while (Date.now() - start < timeoutMs) {
    body = (await view.evaluate("document.body?.innerText ?? ''")) ?? "";
    if (predicate(body)) return body;
    await Bun.sleep(200);
  }
  return body;
}

beforeAll(async () => {
  app.listen(0);
  const server = (app as any).server;
  baseUrl = `http://localhost:${server.port}`;

  view = new Bun.WebView({ backend: "chrome", width: 1280, height: 900 });
  await view.navigate(`${baseUrl}/ui/overview`);
  await view.evaluate(`localStorage.clear()`);
  await view.navigate(`${baseUrl}/ui/overview`);
});

afterAll(async () => {
  await view?.close();
  (app as any).server?.stop(true);
});

describe("Admin token prompt", () => {
  it("redirects into the provider login flow when no credential is stored", async () => {
    const body = await waitForUI((text) =>
      text.includes("Sign in to Glitchlog"),
    );

    expect(body).toContain("Sign in to Glitchlog");
  });

  it("dismisses the gate once the OIDC admin credential is stored", async () => {
    await view.evaluate(
      `sessionStorage.setItem("benemetrics.credential", "${ADMIN_JWT}")`,
    );
    await view.navigate(`${baseUrl}/ui/overview`);

    // The header shows the resolved admin identity (provider claims).
    const body = await waitForUI((text) => text.includes("OIDC User"));
    expect(body).toContain("OIDC User");

    const hasPrompt = await view.evaluate(
      `document.querySelector('input[name="token"]') !== null`,
    );
    expect(hasPrompt).toBe(false);
  });
});
