/**
 * Unit Test: the issue query grammar (pure).
 *
 * Covers the keys, the negation, the quoting, the time values and the
 * error cases. No database.
 */

import { describe, it, expect } from "bun:test";
import { parseIssueQuery } from "../issues/query";

function parse(query: string) {
  return parseIssueQuery(query).flat();
}

function parseGroups(query: string) {
  return parseIssueQuery(query);
}

function expectBad(query: string) {
  let message = "";
  try {
    parseIssueQuery(query);
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  expect(message).toContain("Invalid issue query");
  return message;
}

describe("Issue query grammar", () => {
  it("parses a status term", () => {
    expect(parse("is:unresolved")).toEqual([
      { kind: "status", value: "unresolved", negated: false },
    ]);
  });

  it("splits the query into OR alternatives", () => {
    const groups = parseGroups("is:unresolved | is:resolved app:checkout");
    expect(groups.length).toBe(2);
    expect(groups[0]).toEqual([{ kind: "status", value: "unresolved", negated: false }]);
    expect(groups[1]).toHaveLength(2);
    expect(groups[1]![1]).toMatchObject({ kind: "app", value: "checkout" });
  });

  it("keeps a single alternative for a query without an OR", () => {
    expect(parseGroups("is:unresolved app:checkout").length).toBe(1);
  });

  it("searches a quoted pipe as free text", () => {
    expect(parse('"a | b"')).toEqual([
      { kind: "text", value: "a | b", negated: false },
    ]);
  });

  it("rejects an empty OR group", () => {
    expectBad("is:unresolved |");
    expectBad("| is:unresolved");
  });

  it("lowercases the status and the level", () => {
    expect(parse("is:RESOLVED")[0]).toMatchObject({ value: "resolved" });
    expect(parse("level:WARNING")[0]).toMatchObject({ value: "warning" });
  });

  it("parses every key", () => {
    expect(parse("app:checkout")[0]).toMatchObject({ kind: "app", value: "checkout" });
    expect(parse("project:web")[0]).toMatchObject({ kind: "project", value: "web" });
    expect(parse("environment:production")[0]).toMatchObject({
      kind: "environment",
      value: "production",
    });
    expect(parse("release:2.3.1")[0]).toMatchObject({ kind: "release" });
    expect(parse("event.type:error")[0]).toMatchObject({ kind: "eventType" });
    expect(parse("timesSeen:>100")[0]).toMatchObject({
      kind: "timesSeen",
      operator: ">",
      value: 100,
    });
  });

  it("accepts both negation forms", () => {
    expect(parse("!is:resolved")[0]).toMatchObject({ negated: true });
    expect(parse("-level:warning")[0]).toMatchObject({ negated: true });
  });

  it("treats a token without a key as free text", () => {
    expect(parse("TypeError")[0]).toEqual({
      kind: "text",
      value: "TypeError",
      negated: false,
    });
    expect(parse("!TypeError")[0]).toEqual({
      kind: "text",
      value: "TypeError",
      negated: true,
    });
  });

  it("keeps a quoted colon literal", () => {
    expect(parse('"https://api.example.com"')[0]).toEqual({
      kind: "text",
      value: "https://api.example.com",
      negated: false,
    });
  });

  it("parses the time values", () => {
    expect(parse("lastSeen:-24h")[0]).toMatchObject({
      kind: "lastSeen",
      operator: null,
      value: { type: "relative", amount: 24, unit: "h" },
    });
    expect(parse("firstSeen:2026-10-01")[0]).toMatchObject({
      value: { type: "date", date: "2026-10-01" },
    });
    expect(parse("firstSeen:>2026-10-01T10:00:00Z")[0]).toMatchObject({
      operator: ">",
      value: { type: "instant" },
    });
  });

  it("parses the time operators", () => {
    for (const operator of [">", ">=", "<", "<=", "="]) {
      expect(parse(`firstSeen:${operator}2026-10-01`)[0]).toMatchObject({
        operator,
      });
    }
  });

  it("treats a bare timesSeen as an exact count", () => {
    expect(parse("timesSeen:42")[0]).toMatchObject({ operator: "=", value: 42 });
  });

  it("parses several terms", () => {
    const terms = parse("is:unresolved app:checkout lastSeen:-24h TypeError");
    expect(terms).toHaveLength(4);
    expect(terms[3]).toMatchObject({ kind: "text", value: "TypeError" });
  });

  it("rejects an unknown key", () => {
    expectBad("nope:1");
  });

  it("rejects a reserved key", () => {
    const message = expectBad("user:someone");
    expect(message).toContain("unsupported term");
  });

  it("rejects an unknown status, level and event type", () => {
    expectBad("is:nope");
    expectBad("level:nope");
    expectBad("event.type:nope");
  });

  it("rejects a malformed time and number", () => {
    expectBad("firstSeen:yesterday");
    expectBad("timesSeen:many");
  });

  it("rejects an unterminated quote", () => {
    expectBad('"unterminated');
  });

  it("rejects an empty negated term", () => {
    expectBad("!");
  });
});
