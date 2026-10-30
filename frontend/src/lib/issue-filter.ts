import type { IssueStatus } from "./data";
import type { IssueSummary } from "../hooks/use-app-issues";

export const issueFilterKeys = ["level", "environment", "release", "browser", "handled", "is"] as const;
export type IssueFilterKey = (typeof issueFilterKeys)[number];

// Values are suggested from the issues actually loaded (tag values + fixed
// keys) — nothing is invented for tags the backend never carries (no
// assignee surface exists).
export function issueFilterValues(key: IssueFilterKey, issues: IssueSummary[]): string[] {
  if (key === "is") return ["unresolved", "resolved", "ignored"];
  if (key === "level") return ["fatal", "error", "warning", "info"];
  if (key === "handled") return ["yes", "no"];
  return [
    ...new Set(
      issues
        .map((i) => i.tags?.[key as "environment" | "release" | "browser" | "handled"])
        .filter((v): v is string => !!v),
    ),
  ].sort();
}

export function matchesIssueFilter(issue: IssueSummary, query: string, status: IssueStatus): boolean {
  const tokens = query.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  return tokens.every((token) => {
    const split = token.indexOf(":");
    const key = token.slice(0, split);
    const value = token.slice(split + 1).replaceAll('"', "").toLowerCase();
    if (split > 0 && (issueFilterKeys as readonly string[]).includes(key)) {
      const actual =
        key === "is"
          ? status
          : key === "level"
            ? issue.level
            : issue.tags?.[key as "environment" | "release" | "browser" | "handled"];
      return actual?.toLowerCase() === value;
    }
    return `${issue.type} ${issue.title} ${issue.culprit ?? ""} ${issue.fingerprint}`
      .toLowerCase()
      .includes(token.replaceAll('"', "").toLowerCase());
  });
}
