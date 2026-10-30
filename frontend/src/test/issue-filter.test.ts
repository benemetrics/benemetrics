import { describe, expect, it } from "vitest";
import { issueFilterValues, matchesIssueFilter } from "../lib/issue-filter";
import type { IssueSummary } from "../hooks/use-app-issues";

const issue: IssueSummary = {
  id: "issue-1",
  fingerprint: "msg:payment 4821 failed",
  title: "payment 4821 failed: card_declined",
  culprit: "PaymentGateway.charge",
  level: "error",
  type: "error",
  status: "unresolved",
  eventCount: 12,
  userCount: 4,
  tags: {
    environment: "production",
    release: "2026.10.25",
    browser: "Chrome 131",
    handled: "no",
  },
  firstSeen: "2026-10-25T20:00:00Z",
  lastSeen: "2026-10-25T23:00:00Z",
};

describe("Guided issue filters", () => {
  it("filters concrete levels", () => {
    expect(matchesIssueFilter(issue, "level:error", "unresolved")).toBe(true);
    expect(matchesIssueFilter(issue, "level:fatal", "unresolved")).toBe(false);
  });
  it("combines quoted tag values with text", () => {
    expect(
      matchesIssueFilter(issue, `browser:"${issue.tags?.["browser"]}" payment`, "unresolved"),
    ).toBe(true);
    expect(
      matchesIssueFilter(issue, 'browser:"Unknown Browser" payment', "unresolved"),
    ).toBe(false);
  });
  it("matches the current triage status", () => {
    expect(matchesIssueFilter(issue, "is:resolved", "resolved")).toBe(true);
    expect(matchesIssueFilter(issue, "is:resolved", "unresolved")).toBe(false);
  });
  it("offers tag values actually present in issues", () => {
    expect(issueFilterValues("environment", [issue])).toEqual(["production"]);
  });
  it("falls back to free-text on unknown keys", () => {
    expect(matchesIssueFilter(issue, "card_declined", "unresolved")).toBe(true);
    expect(matchesIssueFilter(issue, "no-match", "unresolved")).toBe(false);
  });
});
