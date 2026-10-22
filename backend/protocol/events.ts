export interface StoredEvent {
  id: string;
  projectId: string;
  appId: string | null;
  envelopeHeader: string;
  envelopeItems: string;
  receivedAt: string;
}

// One ingested item on the `sentry.events` JetStream subject. ClickHouse
// ingests it from NATS; the side-effects consumer (`backend/consumer.ts`)
// applies the Postgres transitions.
export interface SentryEventMessage {
  id: string;
  projectId: string;
  // Resolved app the event was ingested through.
  appId?: string;
  envelopeHeader: string;
  envelopeItems: string;
  // The issue digests of the event items, as JSON text (like the envelope
  // fields), so the consumer applies the grouping without re-parsing.
  issueEvents?: string;
  receivedAt: string;
  type: "envelope" | "store";
}
