export interface ReleaseIssueMetric {
  fingerprint: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  isNew: boolean;
  isRegressed: boolean;
}

export interface ReleaseIssueMetrics {
  issueCount: number;
  newIssueCount: number;
  regressedIssueCount: number;
  issues: ReleaseIssueMetric[];
}

// The summary of a release, from the issue index: the issues that the
// release touched, the ones it introduced (the release they were first
// seen in) and the ones it regressed.
export function buildReleaseIssueMetrics(
  rows: Array<{
    fingerprint: string;
    count: number;
    firstSeen: string;
    lastSeen: string;
    isNew: boolean;
  }>,
): ReleaseIssueMetrics {
  const issues: ReleaseIssueMetric[] = rows.map((row) => ({
    ...row,
    isRegressed: !row.isNew,
  }));

  return {
    issueCount: issues.length,
    newIssueCount: issues.filter((issue) => issue.isNew).length,
    regressedIssueCount: issues.filter((issue) => issue.isRegressed).length,
    issues: issues.slice(0, 10),
  };
}
