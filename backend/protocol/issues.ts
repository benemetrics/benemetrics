// An issue is unresolved until it is resolved through the admin API;
// a new event on a resolved issue reopens it (a regression).
export type IssueStatus = "unresolved" | "resolved";

// Compact issue reference carried by alert notifications.
export interface IssueSummary {
  fingerprint: string;
  title: string;
}

export interface Issue {
  id: string;
  appId: string;
  fingerprint: string;
  title: string;
  status: IssueStatus;
  eventCount: number;
  firstSeen: string;
  lastSeen: string;
  createdAt: string;
  updatedAt: string;
}
