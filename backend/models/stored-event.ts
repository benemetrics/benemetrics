import type { EnvelopeHeader } from "./envelope-header";
import type { ItemHeader } from "./item-header";

interface StoredEvent {
  id: string;
  projectId: string;
  envelope: {
    header: EnvelopeHeader;
    items: Array<{ header: ItemHeader; payload: unknown }>;
    raw: string;
    receivedAt: Date;
  };
}

export type { StoredEvent };