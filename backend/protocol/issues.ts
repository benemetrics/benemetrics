export interface IssueQueryTerm {
  kind: "status" | "app" | "project" | "environment" | "level" | "event_type" | "first_seen" | "last_seen" | "times_seen" | "release" | "text";
  value: unknown;
  negated: boolean;
}

export interface IssueFilter {
  status?: "unresolved" | "resolved";
  appIds?: string[];
  excludedAppIds?: string[];
  level?: string;
  type?: "error" | "message";
  timeRanges?: {
    firstSeen?: { from?: string; to?: string };
    lastSeen?: { from?: string; to?: string };
  };
  timesSeen?: { operator: ">" | ">=" | "<" | "<=" | "="; value: number };
  fingerprints?: string[];
  textTerms?: string[];
  negatedTextTerms?: string[];
}

export interface IssueResponse {
  id: string;
  appId: string;
  fingerprint: string;
  title: string;
  culprit: string | null;
  level: string;
  type: "error" | "message";
  status: "unresolved" | "resolved";
  eventCount: number;
  firstSeen: string;
  lastSeen: string;
  latestEventId: string | null;
  firstRelease: string | null;
  lastRelease: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IssueListResponse {
  data: IssueResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  meta: {
    terms: IssueQueryTerm[];
    sort: string;
  };
}

export interface IssueOccurrence {
  messageId: string;
  eventId: string;
  receivedAt: string;
  title: string;
  level: string;
  release: string | null;
  environment: string | null;
  user: string | null;
}

export interface IssueOccurrencesResponse {
  data: IssueOccurrence[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface IssueStatsPoint {
  bucketStart: string;
  eventCount: number;
  userCount: number;
}

export interface IssueStatsResponse {
  from: string;
  to: string;
  stepSeconds: number;
  points: IssueStatsPoint[];
  totals: {
    eventCount: number;
    userCount: number;
    firstSeen: string;
    lastSeen: string;
  };
}