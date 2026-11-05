export interface StoredEvent {
  id: string;
  projectId: string;
  appId: string;
  envelopeHeader: string;
  envelopeItems: string;
  receivedAt: string;
}

// One ingested item on the `benemetrics.events` JetStream subject. ClickHouse
// ingests it from NATS; the side-effects consumer (`backend/consumer.ts`)
// applies the Postgres transitions.
export interface BenemetricsEventMessage {
  id: string;
  projectId: string;
  appId: string;
  envelopeHeader: string;
  envelopeItems: string;
  issueEvents?: string;
  receivedAt: string;
  type: "envelope" | "store";
}
