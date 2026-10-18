export interface EnvelopeHeader {
  event_id?: string;
  sent_at?: string;
  sdk?: {
    name: string;
    version: string;
  };
  dsn?: string;
}

export interface EnvelopeItemHeader {
  type: string;
  content_type?: string;
  length?: number;
}

export interface ParsedEnvelope {
  header: EnvelopeHeader;
  items: Array<{
    header: EnvelopeItemHeader;
    payload: unknown;
  }>;
}

export interface IssueDigest {
  eventId: string;
  fingerprint: string;
  title: string;
  culprit: string | null;
  level: string;
  type: "error" | "message";
  release: string | null;
  environment: string | null;
  user: string | null;
}