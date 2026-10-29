/**
 * E2E Test: Issue details — aggregated metrics, the issue's event list and
 * per-event details.
 *
 * The issue details page (/ui/issues/:eventId) aggregates every event it
 * matches for the issue into the "Issue metrics" panel (browser, OS,
 * release, users, tags), lists those events with a replay badge on the
 * rows whose event carries a replay link, and switches the stack trace,
 * user card and replay section to a clicked event.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  startTestServer,
  ADMIN_TOKEN,
  ADMIN_TOKEN_RAW,
  type TestServer,
} from "./test-helpers";

const REPLAY_ID = "cccccccccccccccccccccccccccccccc";

let testServer: TestServer;
let view: Bun.WebView;
let firstEventId = "";
let secondEventId = "";

function buildEnvelope(
  header: Record<string, unknown>,
  items: Array<{ header: Record<string, unknown>; payload: unknown }>,
): string {
  const lines = [JSON.stringify(header)];
  for (const item of items) {
    const payloadText = JSON.stringify(item.payload);
    lines.push(
      JSON.stringify({
        ...item.header,
        length: Buffer.byteLength(payloadText, "utf8"),
      }),
    );
    lines.push(payloadText);
  }
  return lines.join("\n");
}

// The DSN carries the public key as the userinfo and the numeric project
// number as the path, exactly what resolveAuthorizedApp expects.
async function sendEvent(
  eventId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const dsn = new URL(testServer.dsn);
  const response = await fetch(
    `${testServer.baseUrl}/api${dsn.pathname}/envelope/`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_key=${encodeURIComponent(dsn.username)}, sentry_version=7`,
      },
      body: buildEnvelope(
        { event_id: eventId, sent_at: new Date().toISOString() },
        [
          {
            header: { type: "event", content_type: "application/json" },
            payload,
          },
        ],
      ),
    },
  );
  expect(response.status).toBe(200);
}

// Both failures crash in the same frame, so ingestion folds them into one
// issue (fingerprint "TypeError@app.js:boom"); the third event crashes
// elsewhere and must stay out of the issue's list and metrics.
function failurePayload(
  eventId: string,
  message: string,
  extras: Record<string, unknown>,
): Record<string, unknown> {
  return {
    event_id: eventId,
    level: "error",
    message,
    platform: "javascript",
    timestamp: Date.now() / 1000,
    exception: {
      values: [
        {
          type: "TypeError",
          value: "Cannot read 'id' of null",
          stacktrace: {
            frames: [
              {
                filename: "app.js",
                function: "boom",
                lineno: 12,
                in_app: true,
              },
            ],
          },
        },
      ],
    },
    ...extras,
  };
}

// The page reads the issue's occurrences from the server, so the test
// resolves the issue the events were folded into. The issue tracks the
// latest occurrence, so any of the issue's events identifies it.
async function resolveIssueId(
  eventIds: string[],
  timeoutMs = 20000,
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const response = await fetch(
      `${testServer.baseUrl}/api/admin/issues?query=${encodeURIComponent(`app:${testServer.appId}`)}&limit=100`,
      { headers: { Authorization: ADMIN_TOKEN } },
    );
    const body = (await response.json()) as {
      data?: Array<{ id: string; latestEventId: string | null }>;
    };
    const issue = (body.data ?? []).find((entry) =>
      eventIds.includes(entry.latestEventId ?? ""),
    );
    if (issue) return issue.id;
    await Bun.sleep(300);
  }
  throw new Error(`No issue found for events ${eventIds.join(", ")}`);
}

async function waitForTextInUI(
  text: string,
  timeoutMs = 20000,
): Promise<string> {
  const start = Date.now();
  let body = "";
  while (Date.now() - start < timeoutMs) {
    body = (await view.evaluate("document.body.innerText")) ?? "";
    if (body.includes(text)) return body;
    await Bun.sleep(400);
  }
  const shot = await view.screenshot();
  await Bun.write("/tmp/e2e-issue-detail-metrics-failure.png", shot);
  throw new Error(
    `"${text}" not found in the UI within ${timeoutMs}ms. Page text: ${body.slice(0, 400)}`,
  );
}

interface EventRow {
  text: string;
  replay: boolean;
  selected: boolean;
}

async function readEventRows(): Promise<EventRow[]> {
  return (
    (await view.evaluate(`(() => {
      return Array.from(document.querySelectorAll(".issue-events-scroll .data-row")).map((row) => ({
        text: row.innerText,
        replay: !!row.querySelector(".replay-tag"),
        selected: row.classList.contains("selected"),
      }));
    })()`)) ?? []
  );
}

async function waitForEventRows(
  check: (rows: EventRow[]) => boolean,
  timeoutMs = 20000,
): Promise<EventRow[]> {
  const start = Date.now();
  let rows: EventRow[] = [];
  while (Date.now() - start < timeoutMs) {
    rows = await readEventRows();
    if (check(rows)) return rows;
    await Bun.sleep(400);
  }
  throw new Error(`event rows never matched; got ${JSON.stringify(rows)}`);
}

function panelText(title: string): Promise<string | null> {
  return view.evaluate(`(() => {
    const panel = Array.from(document.querySelectorAll(".panel")).find(
      (el) => (el.querySelector(".panel-title")?.textContent || "") === ${JSON.stringify(title)},
    );
    return panel ? panel.innerText : null;
  })()`) as Promise<string | null>;
}

async function waitForDetailUser(
  email: string,
  timeoutMs = 20000,
): Promise<void> {
  const start = Date.now();
  let shown = "";
  while (Date.now() - start < timeoutMs) {
    shown =
      (await view.evaluate(
        `document.querySelector(".detail-user strong")?.textContent ?? ""`,
      )) ?? "";
    if (shown.includes(email)) return;
    await Bun.sleep(300);
  }
  throw new Error(`.detail-user never showed "${email}"; got "${shown}"`);
}

describe("Issue details — metrics, event list and event switching", () => {
  beforeAll(async () => {
    testServer = await startTestServer();

    firstEventId = crypto.randomUUID();
    await sendEvent(
      firstEventId,
      failurePayload(firstEventId, "First failure", {
        release: "1.0.0",
        environment: "production",
        user: { email: "alice@example.com" },
        tags: { region: "eu-west-1" },
        contexts: {
          browser: { name: "Chrome", version: "120.0" },
          os: { name: "macOS", version: "14.2" },
          replay: { replay_id: REPLAY_ID, segment_id: 1 },
        },
      }),
    );

    secondEventId = crypto.randomUUID();
    await sendEvent(
      secondEventId,
      failurePayload(secondEventId, "Second failure", {
        release: "0.9.0",
        environment: "production",
        user: { email: "bob@example.com" },
        tags: { region: "eu-west-1", plan: "pro" },
        contexts: {
          browser: { name: "Firefox", version: "115.0" },
          os: { name: "Linux", version: "6.5" },
        },
      }),
    );

    const unrelatedEventId = crypto.randomUUID();
    await sendEvent(unrelatedEventId, {
      event_id: unrelatedEventId,
      level: "error",
      message: "Unrelated failure",
      platform: "javascript",
      timestamp: Date.now() / 1000,
      exception: {
        values: [
          {
            type: "RangeError",
            value: "out of range",
            stacktrace: {
              frames: [
                {
                  filename: "other.js",
                  function: "bust",
                  lineno: 3,
                  in_app: true,
                },
              ],
            },
          },
        ],
      },
    });

    view = new Bun.WebView({ backend: "chrome", width: 1280, height: 900 });
    await view.navigate(`${testServer.baseUrl}/ui/overview`);
    await view.evaluate(
      `sessionStorage.setItem("benemetrics.credential", "${ADMIN_TOKEN_RAW}")`,
    );
    await view.navigate(`${testServer.baseUrl}/ui/overview`);
    await waitForTextInUI("Overview");
  }, 40000);

  afterAll(async () => {
    await view?.close();
    testServer?.stop();
  });

  it("aggregates every event of the issue into the metrics panel", async () => {
    const issueId = await resolveIssueId([firstEventId, secondEventId]);
    await view.navigate(
      `${testServer.baseUrl}/ui/issues/${firstEventId}?issue=${issueId}`,
    );
    // Firefox and bob only exist on the second event, so their presence
    // proves the panel aggregated more than the selected event.
    await waitForTextInUI("Firefox 115.0");
    await waitForTextInUI("bob@example.com");

    const panel = await panelText("Issue metrics");
    expect(panel).toContain("Aggregated from 2 events");
    expect(panel).toContain("Chrome 120.0");
    expect(panel).toContain("Firefox 115.0");
    expect(panel).toContain("macOS 14.2");
    expect(panel).toContain("Linux 6.5");
    expect(panel).toContain("1.0.0");
    expect(panel).toContain("0.9.0");
    expect(panel).toContain("production");
    expect(panel).toContain("alice@example.com");
    expect(panel).toContain("bob@example.com");
    expect(panel).toContain("eu-west-1");
    expect(panel).toContain("pro");
  }, 40000);

  it("lists the issue's events with a replay badge only where a replay is linked", async () => {
    const rows = await waitForEventRows((list) => list.length === 2);
    const linked = rows.find((row) => row.text.includes("First failure"));
    const plain = rows.find((row) => row.text.includes("Second failure"));
    expect(linked).toBeDefined();
    expect(plain).toBeDefined();
    expect(linked!.replay).toBe(true);
    expect(plain!.replay).toBe(false);
    expect(linked!.text).toContain("alice@example.com");
    expect(plain!.text).toContain("bob@example.com");

    // The unrelated failure is a different issue: it is not in the list.
    const panel = await panelText("Events in this issue");
    expect(panel).toContain("2 events: click one to read its details");
    expect(panel).not.toContain("Unrelated failure");
  }, 40000);

  it("switches the details to the clicked event", async () => {
    // The URL event is the selected one, and its replay is linked.
    const initial = await readEventRows();
    expect(initial.find((row) => row.selected)?.text).toContain(
      "First failure",
    );
    await waitForDetailUser("alice@example.com");
    await waitForTextInUI(`replay ${REPLAY_ID.slice(0, 8)}`);

    const clicked =
      (await view.evaluate(`(() => {
        const row = Array.from(document.querySelectorAll(".issue-events-scroll .data-row"))
          .find((el) => (el.innerText || "").includes("Second failure"));
        if (!row) return false;
        row.click();
        return true;
      })()`)) ?? false;
    expect(clicked).toBe(true);

    // The user card and the replay section follow the selected event.
    await waitForDetailUser("bob@example.com");
    const body = await waitForTextInUI(
      "No session replay is linked to this issue",
    );
    expect(body).toContain("bob@example.com");
    expect((await view.evaluate("location.pathname")) ?? "").toBe(
      `/ui/issues/${secondEventId}`,
    );
    expect((await view.evaluate("location.search")) ?? "").toContain("issue=");
    const rows = await waitForEventRows(
      (list) =>
        list.find((row) => row.selected)?.text.includes("Second failure") ===
        true,
    );
    expect(
      rows.find((row) => row.text.includes("First failure"))?.selected,
    ).toBe(false);
  }, 40000);
});
