export type IssueStatus = "unresolved" | "resolved";

export interface IssueSummary {
  fingerprint: string;
  title: string;
}

export interface Issue {
  id: string;
  appId: string;
  fingerprint: string;
  title: string;
  culprit: string | null;
  level: string;
  type: "error" | "message";
  firstRelease: string | null;
  lastRelease: string | null;
  status: IssueStatus;
  eventCount: number;
  firstSeen: string;
  lastSeen: string;
  latestEventId: string | null;
  createdAt: string;
  updatedAt: string;
}
