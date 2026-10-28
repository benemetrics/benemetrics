/**
 * One-off wire-up diagnostic (not a committed suite): drives the real UI in
 * a real browser through the admin-token + create-project flow.
 */
import { app, ADMIN_TOKEN_RAW } from "./test-helpers";

const OIDC_KEYS = [
  "OIDC_ISSUER",
  "OAUTH_ISSUER",
  "OIDC_JWKS_URL",
  "OIDC_AUDIENCE",
  "OIDC_CLIENT_ID",
  "OAUTH_CLIENT_ID",
] as const;
for (const key of OIDC_KEYS) delete process.env[key];

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

async function clickButton(label: string): Promise<boolean> {
  return (
    (await view.evaluate(`(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const button = buttons.find((el) => (el.textContent || "").trim().includes(${JSON.stringify(label)}));
      if (!button) return false;
      button.click();
      return true;
    })()`)) ?? false
  );
}

async function typeInto(selector: string, text: string): Promise<boolean> {
  return (
    (await view.evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, ${JSON.stringify(text)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`)) ?? false
  );
}

async function url(): Promise<string> {
  return (await view.evaluate("window.location.pathname")) ?? "";
}

beforeAll(async () => {
  app.listen(0);
  const server = (app as any).server;
  baseUrl = `http://localhost:${server.port}`;
  view = new Bun.WebView({ backend: "chrome", width: 1280, height: 900 });
});

afterAll(async () => {
  await view?.close();
  (app as any).server?.stop(true);
});

describe("wire-up: token + create project", () => {
  it(
    "creates a project through the real UI",
    async () => {
      await view.navigate(`${baseUrl}/ui`);
      await view.evaluate("(() => { localStorage.clear(); sessionStorage.clear(); })()");
      await view.navigate(`${baseUrl}/ui/overview`);

      // 1. token prompt -> submit the fresh boot token
      const prompt = await waitForUI((t) => t.includes("Sign in to Glitchlog"));
      if (!prompt.includes("Sign in to Glitchlog")) throw new Error(`no token prompt, body: ${prompt.slice(0, 400)}`);
      const typed = await typeInto('input[name="token"]', ADMIN_TOKEN_RAW);
      if (!typed) throw new Error("token input missing");
      await clickButton("Continue");
      const ready = await waitForUI((t) => t.includes("Projects"), 20000);
      if (!ready.includes("Projects")) throw new Error(`session did not resolve, body: ${ready.slice(0, 400)}`);
      console.log("STEP1 token+session: OK");

      // 2. New project -> form -> submit
      if (!(await clickButton("New project"))) throw new Error("New project button not found");
      const formOpen = await waitForUI((t) => t.includes("New project") && t.includes("Name"));
      if (!(await typeInto('input[placeholder="Payments"]', "Wireup Verify"))) throw new Error("project name input missing, body: " + formOpen.slice(0, 300));
      // Log every API call the page makes from here on.
      await view.evaluate(`(() => {
        window.__calls = [];
        const orig = window.fetch.bind(window);
        window.fetch = (...args) => {
          window.__calls.push(String(args[0]));
          return orig(...args).then((r) => { window.__calls.push("-> " + r.status + " " + String(args[0])); return r; });
        };
        return true;
      })()`);
      await clickButton("Create project");

      // Watch where the SPA goes for a few seconds.
      const seen = new Set<string>();
      for (let i = 0; i < 20; i++) {
        seen.add(await url());
        await Bun.sleep(250);
      }
      console.log("PATH TIMELINE:", [...seen].join(" -> "));

      // List projects with the page's own credential.
      const listOut = (await view.evaluate(`(async () => {
        const cred = sessionStorage.getItem("benemetrics.credential") ?? "";
        const res = await fetch("/api/admin/projects?limit=100", { headers: { authorization: "API-Key " + cred } });
        return res.status + " " + (await res.text()).slice(0, 300);
      })()`)) ?? "";
      console.log("PROJECT LIST:", listOut);
        const calls = (await view.evaluate("JSON.stringify(window.__calls ?? [])")) ?? "[]";
        console.log("PAGE FETCH LOG:", calls);
        const main = (await view.evaluate("document.querySelector('main')?.innerHTML?.slice(0, 400) ?? 'no-main'")) ?? "";
        console.log("MAIN HTML:", main);

      // 3. should navigate to the project page
      const landed = await waitForUI((t) => t.includes("Wireup Verify"), 20000);
      const path = await url();
      if (!landed.includes("Wireup Verify") || !path.includes("/projects/")) {
        const mainHtml = (await view.evaluate("document.querySelector('main')?.innerHTML?.slice(0, 600) ?? 'no-main'")) ?? "";
        const bodyText = (await view.evaluate("document.body?.innerText")) ?? "";
        throw new Error(`create failed — path: ${path}, main: ${mainHtml}, bodyText: ${JSON.stringify(bodyText.slice(0, 300))}`);
      }
      console.log("STEP2 create+navigate: OK ->", path);

      // 4. the projects list shows it
      await view.navigate(`${baseUrl}/ui/overview`);
      const list = await waitForUI((t) => t.includes("Wireup Verify"), 20000);
      if (!listOut.includes("Wireup Verify")) throw new Error(`project missing from list, body: ${listOut.slice(0, 600)}`);
      console.log("STEP3 list shows project: OK");
    },
    120000,
  );
});