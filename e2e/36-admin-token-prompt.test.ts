/**
 * E2E: the admin-token prompt.
 *
 * With no identity provider configured and no token stored in the browser,
 * the first 401 from the API must surface the admin-token dialog. Storing a
 * valid token dismisses it (the SPA reloads with credentials).
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { app, ADMIN_TOKEN_RAW } from "./test-helpers";

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
  // No provider: the admin token is the only credential.
  delete process.env.OIDC_ISSUER;
  delete process.env.OAUTH_ISSUER;
  delete process.env.OIDC_JWKS_URL;
  delete process.env.OIDC_AUDIENCE;
  delete process.env.OIDC_CLIENT_ID;
  delete process.env.OAUTH_CLIENT_ID;

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
  it("appears when no provider is configured and no token is stored", async () => {
    const body = await waitForUI((text) =>
      text.includes("Sign in to Glitchlog"),
    );

    expect(body).toContain("Sign in to Glitchlog");
    expect(body.toLowerCase()).toContain("admin token");

    const hasPrompt = await view.evaluate(
      `document.querySelector('input[name="token"]') !== null`,
    );
    expect(hasPrompt).toBe(true);
  });

  it("disappears once the admin token is stored", async () => {
    await view.evaluate(
      `sessionStorage.setItem("benemetrics.credential", "${ADMIN_TOKEN_RAW}")`,
    );
    await view.navigate(`${baseUrl}/ui/overview`);

    // The header shows the resolved identity id for the admin token.
    const body = await waitForUI((text) => text.includes("local-admin"));
    expect(body).toContain("local-admin");

    const hasPrompt = await view.evaluate(
      `document.querySelector('input[name="token"]') !== null`,
    );
    expect(hasPrompt).toBe(false);
  });
});
