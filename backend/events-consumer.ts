import { db } from "../db/index.ts";
import { storedEventDAO } from "../db/dao/stored-events.ts";
import { issueDAO } from "../db/dao/issues.ts";
import { alertRuleDAO, alertIncidentDAO } from "../db/dao/alert-rules.ts";
import { metricsStore } from "./metrics-store.ts";
import { parseEnvelope, extractEventId, convertSpanToTransaction, normalizeTransactionPayload, replayIdFromEnvelope } from "./events/utils.ts";
import { dispatchIngestedEvent } from "./nats.ts";

export async function processIngestedEvent(message: {
  id: string;
  projectId: string;
  appId: string;
  envelopeHeader: string;
  envelopeItems: string;
  receivedAt: string;
  type: string;
  issueEvents?: string;
}): Promise<void> {
  // Parse envelope
  const envelope = parseEnvelope(message.envelopeHeader, message.envelopeItems);
  if (!envelope) return;

  // Extract issue digests
  const issueEvents = envelope.items
    .filter((item: any) => item.header.type === "event" || item.header.type === "transaction")
    .map((item: any) => extractIssueDigest(item.payload, message.receivedAt));

  // Store in Postgres for side effects only
  await storedEventDAO.create({
    id: message.id,
    projectId: message.projectId,
    appId: message.appId,
    envelopeHeader: message.envelopeHeader,
    envelopeItems: message.envelopeItems,
    receivedAt: message.receivedAt,
  });

  // Process issues
  for (const issueEvent of issueEvents) {
    if (!issueEvent) continue;

    // Create if new
    const created = await issueDAO.createIfNew({
      appId: message.appId,
      fingerprint: issueEvent.fingerprint,
      title: issueEvent.title,
      level: issueEvent.level,
      type: issueEvent.type,
      receivedAt: message.receivedAt,
      eventCount: 1,
    });

    if (created) {
      // Fire new_issue alert
      await fireIssueAlerts(message, issueEvent, "new_issue");
    } else {
      // Check for regression
      const regressed = await issueDAO.regressIfResolved({
        appId: message.appId,
        fingerprint: issueEvent.fingerprint,
        title: issueEvent.title,
        level: issueEvent.level,
        type: issueEvent.type,
        receivedAt: message.receivedAt,
        eventCount: 1,
      });

      if (regressed) {
        await fireIssueAlerts(message, issueEvent, "regression");
      } else {
        await issueDAO.markSeen({
          appId: message.appId,
          fingerprint: issueEvent.fingerprint,
          title: issueEvent.title,
          level: issueEvent.level,
          type: issueEvent.type,
          receivedAt: message.receivedAt,
          eventCount: 1,
        });
      }
    }
  }

  // Evaluate threshold alerts
  await evaluateThresholdAlerts(message);
}

async function extractIssueDigest(payload: unknown, receivedAt: string) {
  // Implementation would extract fingerprint, title, etc. from event payload
  return {
    fingerprint: "extracted-fingerprint",
    title: "Extracted title",
    level: "error",
    type: "error",
  };
}

async function fireIssueAlerts(message: any, issueEvent: any, trigger: "new_issue" | "regression") {
  // Fire alert rules for this trigger
}

async function evaluateThresholdAlerts(message: any) {
  // Evaluate threshold-based alert rules
}