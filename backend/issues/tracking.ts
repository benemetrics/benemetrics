// Issue-state transitions for an ingested event:
//   - a fingerprint never seen for the app  → new issue
//   - a resolved issue that gets an event   → regression (reopened)
// Every transition is race-safe at the database level, so concurrent
// deliveries of the same event never double-fire an alert.

import { issueDAO } from "db/dao/issues";
import {
  extractEventItems,
  issueFingerprint,
  issueTitle,
} from "../events/utils";

export interface TrackedIssue {
  id: string;
  fingerprint: string;
  title: string;
}

export interface IssueTrackingResult {
  newIssues: TrackedIssue[];
  regressions: TrackedIssue[];
}

export async function trackIssuesForEvent(
  appId: string,
  envelopeItems: string,
  receivedAt: string,
): Promise<IssueTrackingResult> {
  // One transition per fingerprint even when the envelope carries
  // several event items of the same issue.
  const payloads = new Map<string, Record<string, unknown>>();
  for (const payload of extractEventItems(envelopeItems)) {
    const fingerprint = issueFingerprint(payload);
    if (!payloads.has(fingerprint)) payloads.set(fingerprint, payload);
  }

  const newIssues: TrackedIssue[] = [];
  const regressions: TrackedIssue[] = [];

  for (const [fingerprint, payload] of payloads) {
    const created = await issueDAO.createIfNew({
      appId,
      fingerprint,
      title: issueTitle(payload),
      firstSeen: receivedAt,
      lastSeen: receivedAt,
    });
    if (created) {
      newIssues.push({
        id: created.id,
        fingerprint: created.fingerprint,
        title: created.title,
      });
      continue;
    }

    const regressed = await issueDAO.regressIfResolved(
      appId,
      fingerprint,
      receivedAt,
    );
    if (regressed) {
      regressions.push({
        id: regressed.id,
        fingerprint: regressed.fingerprint,
        title: regressed.title,
      });
      continue;
    }

    await issueDAO.markSeen(appId, fingerprint, receivedAt);
  }

  return { newIssues, regressions };
}
