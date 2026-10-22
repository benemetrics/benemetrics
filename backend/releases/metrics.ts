import { extractEventItems } from "../events/utils";
import { issueFingerprint } from "../issues/grouping";

interface StoredEventLike {
  receivedAt: string;
  envelopeItems: string;
}

interface ReleaseIssueMetric {
  fingerprint: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  isNew: boolean;
  isRegressed: boolean;
}

interface ReleaseIssueMetrics {
  issueCount: number;
  newIssueCount: number;
  regressedIssueCount: number;
  issues: ReleaseIssueMetric[];
}

export function computeIssueMetrics(
  events: StoredEventLike[],
  version: string,
): ReleaseIssueMetrics {
  const sorted = [...events].sort((a, b) =>
    a.receivedAt < b.receivedAt ? -1 : a.receivedAt > b.receivedAt ? 1 : 0,
  );

  const firstAppearance = new Map<
    string,
    { firstSeen: string; firstRelease: string }
  >();
  const inRelease = new Map<string, { count: number; lastSeen: string }>();

  for (const event of sorted) {
    for (const payload of extractEventItems(event.envelopeItems)) {
      const release = payload.release;
      if (typeof release !== "string" || !release) continue;

      const fingerprint = issueFingerprint(payload);
      if (!firstAppearance.has(fingerprint)) {
        firstAppearance.set(fingerprint, {
          firstSeen: event.receivedAt,
          firstRelease: release,
        });
      }

      if (release === version) {
        const stat = inRelease.get(fingerprint) ?? { count: 0, lastSeen: event.receivedAt };
        stat.count += 1;
        stat.lastSeen = event.receivedAt;
        inRelease.set(fingerprint, stat);
      }
    }
  }

  const issues: ReleaseIssueMetric[] = [];
  for (const [fingerprint, stat] of inRelease) {
    const first = firstAppearance.get(fingerprint)!;
    const isNew = first.firstRelease === version;
    issues.push({
      fingerprint,
      count: stat.count,
      firstSeen: first.firstSeen,
      lastSeen: stat.lastSeen,
      isNew,
      isRegressed: !isNew,
    });
  }
  issues.sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));

  return {
    issueCount: issues.length,
    newIssueCount: issues.filter((issue) => issue.isNew).length,
    regressedIssueCount: issues.filter((issue) => issue.isRegressed).length,
    issues: issues.slice(0, 10),
  };
}
