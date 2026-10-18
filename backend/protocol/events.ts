// Stored envelope as served by the events API. Events live in ClickHouse
// (Postgres holds the control plane only); this is the read shape.
export interface StoredEvent {
  id: string;
  projectId: string;
  appId: string | null;
  envelopeHeader: string;
  envelopeItems: string;
  receivedAt: string;
}
