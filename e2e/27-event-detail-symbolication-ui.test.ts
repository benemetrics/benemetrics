/**
 * E2E Test: Event detail stack trace (real UI) — source maps + frame order.
 *
 * Locks in the read-time symbolication contract in a real browser:
 *   - a source map is uploaded for a release through the sentry-cli
 *     compatible API (upload token scoped to project/app/environment)
 *   - a minified event for that release is ingested
 *   - the event detail page shows the RESOLVED position (original_*)
 *     instead of the minified one, plus the source snippet from
 *     sourcesContent, and lists the crash frame first (SDK frames
 *     arrive oldest-first).
 *
 * Provisioning goes through the admin API; the SPA is served from the
 * same server under /ui.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  app,
  ADMIN_TOKEN,
  ADMIN_HEADERS,
  ADMIN_TOKEN_RAW,
} from "./test-helpers";
const ORG = "default";
const RELEASE = "ui-1.0.0";

// Same fixture as e2e/17: generated (1,1) -> app.ts (1,1),
// generated (2,1) -> app.ts (2,1), with sourcesContent so the resolver
// can attach the context snippet.
const SOURCE_MAP = {
  version: 3,
  file: "app.js",
  sources: ["app.ts"],
  sourcesContent: ["function boom() {\n  throw new Error('boom');\n}\n"],
  names: [],
  mappings: "AAAA;AACA",
};

let baseUrl = "";
let view: Bun.WebView;
let appRecord: { id: string; ingestKey: string; publicKey: string };

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

async function uploadMultipart(
  path: string,
  token: string,
  map: unknown,
  name: string,
): Promise<Response> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([JSON.stringify(map)], { type: "application/json" }),
    "app.js.map",
  );
  form.append("name", name);
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
}

async function waitForIssue(timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const response = await adminRequest(
      "GET",
      `/api/admin/issues?query=${encodeURIComponent(`app:${appRecord.id}`)}`,
    );
    const body = (await response.json()) as {
      data?: Array<{ status: string }>;
    };
    if (body.data?.some((issue) => issue.status === "unresolved")) return;
    await Bun.sleep(100);
  }
  throw new Error("issue never showed up as unresolved");
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
  await Bun.write("/tmp/e2e-event-detail-failure.png", shot);
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

interface FrameRow {
  strong: string;
  small: string;
  code: string;
}

async function readFrameRows(): Promise<FrameRow[]> {
  return (
    ((await view.evaluate(`(() => {
      return Array.from(document.querySelectorAll(".frame-row")).map((row) => ({
        strong: row.querySelector("strong")?.textContent ?? "",
        small: row.querySelector("small")?.textContent ?? "",
        code: row.querySelector("code")?.textContent ?? "",
      }));
    })()`)) as FrameRow[]) ?? []
  );
}

async function waitForFrames(
  check: (rows: FrameRow[]) => boolean,
  timeoutMs = 15000,
): Promise<FrameRow[]> {
  const start = Date.now();
  let rows: FrameRow[] = [];
  while (Date.now() - start < timeoutMs) {
    rows = await readFrameRows();
    if (check(rows)) return rows;
    await Bun.sleep(400);
  }
  const shot = await view.screenshot();
  await Bun.write("/tmp/e2e-event-detail-frames-failure.png", shot);
  throw new Error(`stack frames never matched; got ${JSON.stringify(rows)}`);
}

describe("Event detail stack trace — symbolication in the real UI", () => {
  beforeAll(async () => {
    app.listen(0);
    const server = (app as any).server;
    baseUrl = `http://localhost:${server.port}`;

    const project = (await (
      await adminRequest("POST", "/api/admin/projects", {
        name: `Symbolicated UI ${Date.now()}`,
        slug: "smt-ui",
      })
    ).json()) as { id: string; slug: string };

    appRecord = (await (
      await adminRequest("POST", `/api/admin/projects/${project.id}/apps`, {
        name: "web",
      })
    ).json()) as { id: string; ingestKey: string; publicKey: string };

    const token = (await (
      await adminRequest("POST", "/api/admin/source-map-tokens", {
        name: "ui-ci",
        projectId: project.id,
        appId: appRecord.id,
      })
    ).json()) as { token: string };

    // sentry-cli style release + map upload.
    const createRelease = await fetch(
      `${baseUrl}/api/0/projects/${ORG}/${project.slug}/releases/`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ version: RELEASE }),
      },
    );
    expect(createRelease.status).toBe(200);
    const upload = await uploadMultipart(
      `/api/0/projects/${ORG}/${project.slug}/releases/${RELEASE}/files/`,
      token.token,
      SOURCE_MAP,
      "~/dist/app.js.map",
    );
    expect(upload.status).toBe(201);

    // Minified event: frames arrive oldest-first, crash site last.
    const ingested = await fetch(
      `${baseUrl}/api/${appRecord.ingestKey}/store/?sentry_key=${encodeURIComponent(appRecord.publicKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: crypto.randomUUID(),
          level: "error",
          release: RELEASE,
          exception: {
            values: [
              {
                type: "TypeError",
                value: "boom",
                stacktrace: {
                  frames: [
                    {
                      filename: "app.js",
                      lineno: 1,
                      colno: 1,
                      function: "outer",
                    },
                    {
                      filename: "app.js",
                      lineno: 2,
                      colno: 1,
                      function: "boom",
                    },
                  ],
                },
              },
            ],
          },
        }),
      },
    );
    expect(ingested.ok).toBe(true);
    await waitForIssue();

    view = new Bun.WebView({ backend: "chrome", width: 1280, height: 900 });
    await view.navigate(`${baseUrl}/ui/overview`);
    await view.evaluate(
      `sessionStorage.setItem("benemetrics.credential", "${ADMIN_TOKEN_RAW}")`,
    );
    await view.navigate(`${baseUrl}/ui/overview`);
    await waitForTextInUI(`Symbolicated UI`, 20000);
  });

  afterAll(async () => {
    await view?.close();
    (app as any).server?.stop(true);
  });

  it("shows resolved, crash-first frames with source context", async () => {
    await clickNav("Issues");
    await waitForTextInUI("TypeError: boom");

    // The same title is rendered on the Overview page, so a bare text
    // match does not prove the Issues table has rendered: wait for the
    // row itself before clicking it.
    const deadline = Date.now() + 15000;
    let clicked = false;
    while (!clicked && Date.now() < deadline) {
      clicked =
        (await view.evaluate(`(() => {
          const rows = Array.from(document.querySelectorAll(".data-row"));
          const row = rows.find((el) => (el.textContent || "").includes("TypeError: boom"));
          if (!row) return false;
          row.click();
          return true;
        })()`)) ?? false;
      if (!clicked) await Bun.sleep(200);
    }
    expect(clicked).toBe(true);

    await waitForTextInUI("Stack trace");
    const rows = await waitForFrames(
      (list) => list.length >= 2 && (list[0]?.small ?? "").includes("app.ts:2"),
    );

    // The crash frame sits on top and shows the position resolved through
    // the uploaded source map (not the minified app.js:2), with the
    // source snippet from sourcesContent.
    expect(rows[0]!.strong).toContain("boom");
    expect(rows[0]!.strong).toContain("source map");
    expect(rows[0]!.small).toBe("app.ts:2");
    expect(rows[0]!.code).toContain("throw new Error('boom');");

    const outer = rows.find((row) => row.strong.includes("outer"));
    expect(outer).toBeDefined();
    expect(outer!.small).toBe("app.ts:1");
    expect(outer!.code).toContain("function boom() {");
  }, 30000);
});
