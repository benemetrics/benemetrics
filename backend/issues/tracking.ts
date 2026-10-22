
import { issueDAO } from "db/dao/issues";
import { extractEventItems } from "../events/utils";
import {
  issueDigestsFromPayloads,
  type IssueDigest,
} from "./grouping";

export interface TrackedIssue {
  id: string;
  fingerprint: string;
  title: string;
}

export interface IssueTrackingResult {
  newIssues: TrackedIssue[];
  regressions: TrackedIssue[];
}

// The digests of a message: the ones the ingest handler attached, or — for
// a message published before the digest existed — the ones extracted from
// the envelope items.
export function parseIssueDigests(
  issueEvents: string | undefined,
  envelopeItems: string,
): IssueDigest[] {
  if (issueEvents) {
    try {
      const digests = JSON.parse(issueEvents);
      if (Array.isArray(digests)) return digests as IssueDigest[];
    } catch {
      // Fall through to the envelope items.
    }
  }
  return issueDigestsFromPayloads(extractEventItems(envelopeItems));
}

export async function trackIssuesForEvent(
  appId: string,
  digests: IssueDigest[],
  receivedAt: string,
  latestEventId: string,
): Promise<IssueTrackingResult> {
  // One entry per fingerprint: the first digest plus the occurrence count.
  const occurrences = new Map<string, { digest: IssueDigest; count: number }>();
  for (const digest of digests) {
    const existing = occurrences.get(digest.fingerprint);
    if (existing) existing.count += 1;
    else occurrences.set(digest.fingerprint, { digest, count: 1 });
  }

  const tracked = await Promise.all(
    [...occurrences].map(
      async ([
        fingerprint,
        { digest, count },
      ]): Promise<{
        newIssue?: TrackedIssue;
        regression?: TrackedIssue;
      }> => {
        const occurrence = {
          receivedAt,
          latestEventId,
          occurrences: count,
          title: digest.title,
          culprit: digest.culprit,
          level: digest.level,
          type: digest.type,
          release: digest.release,
        };
        const created = await issueDAO.createIfNew({
          appId,
          fingerprint,
          title: digest.title,
          culprit: digest.culprit,
          level: digest.level,
          type: digest.type,
          firstRelease: digest.release,
          lastRelease: digest.release,
          eventCount: count,
          firstSeen: receivedAt,
          lastSeen: receivedAt,
          latestEventId,
        });
        if (created) {
          return { newIssue: { id: created.id, fingerprint: created.fingerprint, title: created.title } };
        }

        const regressed = await issueDAO.regressIfResolved(
          appId,
          fingerprint,
          occurrence,
        );
        if (regressed) {
          return { regression: { id: regressed.id, fingerprint: regressed.fingerprint, title: regressed.title } };
        }

        await issueDAO.markSeen(appId, fingerprint, occurrence);
        return {};
      },
    ),
  );

  return {
    newIssues: tracked.flatMap((entry) => (entry.newIssue ? [entry.newIssue] : [])),
    regressions: tracked.flatMap((entry) => (entry.regression ? [entry.regression] : [])),
  };
}
