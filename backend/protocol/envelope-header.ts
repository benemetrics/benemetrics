interface EnvelopeHeader {
  event_id?: string;
  sent_at?: string;
  dsn?: string;
  sdk?: {
    name: string;
    version: string;
    integrations?: string[];
    packages?: Array<{ name: string; version: string }>;
  };
}

export type { EnvelopeHeader };
