import type { IssueRow } from "db/schema/issues";
import type { Issue } from "../../protocol/issues";

export function toIssue(row: IssueRow): Issue {
  return {
    id: row.id,
    appId: row.appId,
    fingerprint: row.fingerprint,
    title: row.title,
    status: row.status as Issue["status"],
    eventCount: row.eventCount,
    firstSeen: row.firstSeen,
    lastSeen: row.lastSeen,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
