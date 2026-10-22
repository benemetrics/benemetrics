import { badRequest } from "backend/errors";

/**
 * The issue query language — a Sentry-style search grammar parsed into a
 * typed AST. Pure: no database, no clock. The terms are resolved against
 * the database by the handler (see `backend/issues/resolve.ts`).
 */

export type TimeUnit = "m" | "h" | "d" | "w";

export type TimeValue =
  | { type: "relative"; amount: number; unit: TimeUnit }
  | { type: "date"; date: string }
  | { type: "instant"; at: string };

export type TimeOperator = ">" | ">=" | "<" | "<=" | "=";

export type NumberOperator = ">" | ">=" | "<" | "<=" | "=";

export type IssueQueryTerm =
  | { kind: "status"; value: "unresolved" | "resolved"; negated: boolean }
  | { kind: "app"; value: string; negated: boolean }
  | { kind: "project"; value: string; negated: boolean }
  | { kind: "environment"; value: string; negated: boolean }
  | { kind: "level"; value: string; negated: boolean }
  | { kind: "eventType"; value: "error" | "message"; negated: boolean }
  | { kind: "release"; value: string; negated: boolean }
  | { kind: "firstSeen"; operator: TimeOperator | null; value: TimeValue; negated: boolean }
  | { kind: "lastSeen"; operator: TimeOperator | null; value: TimeValue; negated: boolean }
  | { kind: "timesSeen"; operator: NumberOperator; value: number; negated: boolean }
  | { kind: "user"; value: string; negated: boolean }
  | { kind: "tag"; key: string; value: string; negated: boolean }
  | { kind: "text"; value: string; negated: boolean };

// The keys the grammar knows. `reserved` parses strictly but is not
// implemented yet, so it answers "Unsupported term".
const KEYS = {
  is: "status",
  app: "app",
  project: "project",
  environment: "environment",
  level: "level",
  user: "user",
  tag: "tag",
  "event.type": "eventType",
  release: "release",
  firstseen: "firstSeen",
  lastseen: "lastSeen",
  timesseen: "timesSeen",
} as const;

const RESERVED = new Set([
  "assigned",
  "bookmarked",
  "has",
  "url",
]);

const STATUSES = new Set(["unresolved", "resolved"]);
const LEVELS = new Set(["fatal", "error", "warning", "info", "debug"]);
const EVENT_TYPES = new Set(["error", "message"]);

function fail(reason: string, term: string): never {
  throw badRequest(`Invalid issue query: ${reason} (${term})`);
}

// The OR separator, outside a quoted atom.
const OR_SEPARATOR = "|";

// Splits the query into tokens, keeping quoted atoms together.
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of input) {
    if (char === '"') {
      quoted = !quoted;
      current += char;
      continue;
    }
    if (!quoted && char === OR_SEPARATOR) {
      if (current) tokens.push(current);
      current = "";
      tokens.push(OR_SEPARATOR);
      continue;
    }
    if (!quoted && /\s/.test(char)) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (quoted) fail("unterminated quote", input.trim());
  if (current) tokens.push(current);
  return tokens;
}

// The atom of a value: quoted (literal) or unquoted.
function readAtom(raw: string, term: string): { value: string; quoted: boolean } {
  if (raw.startsWith('"')) {
    if (!raw.endsWith('"') || raw.length < 2) fail("unterminated quote", term);
    return { value: raw.slice(1, -1), quoted: true };
  }
  if (raw.endsWith('"')) fail("unterminated quote", term);
  return { value: raw, quoted: false };
}

function parseTimeValue(raw: string, term: string): TimeValue {
  const relative = /^-(\d+)(m|h|d|w)$/.exec(raw);
  if (relative) {
    return {
      type: "relative",
      amount: Number(relative[1]),
      unit: relative[2] as TimeUnit,
    };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { type: "date", date: raw };
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(raw)) {
    const at = new Date(raw.replace(" ", "T"));
    if (Number.isNaN(at.getTime())) fail("malformed timestamp", term);
    return { type: "instant", at: at.toISOString() };
  }
  fail("malformed time", term);
}

function parseNumberValue(raw: string, term: string): number {
  if (!/^\d+$/.test(raw)) fail("malformed number", term);
  return Number(raw);
}

function parseOperator(raw: string): { operator: string | null; rest: string } {
  for (const operator of [">=", "<=", ">", "<", "="]) {
    if (raw.startsWith(operator)) {
      return { operator, rest: raw.slice(operator.length) };
    }
  }
  return { operator: null, rest: raw };
}

type TermKind =
  | "status"
  | "app"
  | "project"
  | "environment"
  | "level"
  | "user"
  | "tag"
  | "eventType"
  | "release"
  | "firstSeen"
  | "lastSeen"
  | "timesSeen";

function parsePair(
  key: TermKind,
  rawValue: string,
  term: string,
): IssueQueryTerm {
  const { operator, rest } = parseOperator(rawValue);
  const { value } = readAtom(rest, term);

  switch (key) {
    case "status": {
      const status = value.toLowerCase();
      if (!STATUSES.has(status)) fail("unknown status", term);
      return { kind: "status", value: status as "unresolved" | "resolved", negated: false };
    }
    case "level": {
      const level = value.toLowerCase();
      if (!LEVELS.has(level)) fail("unknown level", term);
      return { kind: "level", value: level, negated: false };
    }
    case "eventType": {
      const type = value.toLowerCase();
      if (!EVENT_TYPES.has(type)) fail("unknown event type", term);
      return { kind: "eventType", value: type as "error" | "message", negated: false };
    }
    case "app":
      if (!value) fail("empty value", term);
      return { kind: "app", value, negated: false };
    case "project":
      if (!value) fail("empty value", term);
      return { kind: "project", value, negated: false };
    case "environment":
      if (!value) fail("empty value", term);
      return { kind: "environment", value, negated: false };
    case "release":
      if (!value) fail("empty value", term);
      return { kind: "release", value, negated: false };
    case "user":
      if (!value) fail("empty value", term);
      return { kind: "user", value, negated: false };
    case "tag": {
      const separator = value.indexOf(":");
      if (separator <= 0 || separator === value.length - 1) {
        fail("a tag is <key>:<value>", term);
      }
      return {
        kind: "tag",
        key: value.slice(0, separator),
        value: value.slice(separator + 1),
        negated: false,
      };
    }
    case "firstSeen":
    case "lastSeen": {
      if (operator && !["<", "<=", ">", ">=", "="].includes(operator)) {
        fail("malformed operator", term);
      }
      const time = {
        operator: (operator as TimeOperator | null) ?? null,
        value: parseTimeValue(value, term),
        negated: false,
      };
      return key === "firstSeen"
        ? { kind: "firstSeen", ...time }
        : { kind: "lastSeen", ...time };
    }
    case "timesSeen": {
      return {
        kind: "timesSeen",
        operator: (operator as NumberOperator | null) ?? "=",
        value: parseNumberValue(value, term),
        negated: false,
      };
    }
  }
}

export type IssueSort = "new" | "frequent" | "first-seen";

const SORTS: IssueSort[] = ["new", "frequent", "first-seen"];

export function parseIssueSort(value: string | undefined): IssueSort {
  if (value === undefined) return "new";
  if (!SORTS.includes(value as IssueSort)) {
    throw badRequest(`Invalid issue query: unknown sort (${value})`);
  }
  return value as IssueSort;
}

// The echo of a term in the response meta.
export function summarizeTerm(term: IssueQueryTerm): {
  kind: string;
  value: string;
  negated?: boolean;
} {
  const summary = { kind: term.kind, value: "" } as {
    kind: string;
    value: string;
    negated?: boolean;
  };
  switch (term.kind) {
    case "status":
    case "level":
    case "eventType":
    case "app":
    case "project":
    case "environment":
    case "release":
      summary.value = term.value;
      break;
    case "firstSeen":
    case "lastSeen":
      summary.value = term.value.type === "relative"
        ? `-${term.value.amount}${term.value.unit}`
        : term.value.type === "date"
          ? term.value.date
          : term.value.at;
      break;
    case "timesSeen":
      summary.value = String(term.value);
      break;
    case "text":
      summary.value = term.value;
      break;
  }
  if (term.negated) summary.negated = true;
  return summary;
}

/**
 * Parses a query into its alternatives. The terms of one alternative are
 * ANDed, the alternatives are ORed — `a | b c` is `a OR (b AND c)`.
 * Throws a bad request for anything the grammar does not accept.
 */
export function parseIssueQuery(input: string): IssueQueryTerm[][] {
  const groups: IssueQueryTerm[][] = [[]];
  for (const token of tokenize(input.trim())) {
    if (token === OR_SEPARATOR) {
      if (groups[groups.length - 1]!.length === 0) fail("empty OR group", token);
      groups.push([]);
      continue;
    }
    let negated = false;
    let rest = token;
    if (rest.startsWith("!") || rest.startsWith("-")) {
      negated = true;
      rest = rest.slice(1);
      if (!rest) fail("empty term", token);
    }

    // A quoted token is free text, even when it contains a colon.
    if (rest.startsWith('"')) {
      const { value } = readAtom(rest, token);
      groups[groups.length - 1]!.push({ kind: "text", value, negated });
      continue;
    }

    const colon = rest.indexOf(":");
    if (colon === -1) {
      groups[groups.length - 1]!.push({ kind: "text", value: rest, negated });
      continue;
    }

    const rawKey = rest.slice(0, colon).toLowerCase();
    if (RESERVED.has(rawKey)) fail("unsupported term", token);
    const key = KEYS[rawKey as keyof typeof KEYS] as TermKind | undefined;
    if (!key) fail("unknown key", token);

    const term = parsePair(key, rest.slice(colon + 1), token);
    groups[groups.length - 1]!.push({ ...term, negated });
  }
  if (groups.length > 1 && groups[groups.length - 1]!.length === 0) {
    fail("empty OR group", OR_SEPARATOR);
  }
  return groups;
}
