import { notFound } from "backend/errors";
import type { StoredEvent } from "./protocol/events";
import { findClickHouseEvent, listClickHouseEvents } from "./clickhouse";

// Stored-event reads are served by ClickHouse only — it is the events
// store, fed by the NATS engine tables. A ClickHouse failure is a failed
// request (5xx), never a fallback: Postgres holds the control plane and
// has no event payloads.

export async function listStoredEvents(options?: {
  page?: number;
  limit?: number;
  projectId?: string;
  appIds?: string[];
}): Promise<{
  data: StoredEvent[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  return listClickHouseEvents(options);
}

export async function findStoredEventById(
  id: string,
): Promise<StoredEvent | undefined> {
  return findClickHouseEvent(id);
}

export async function findStoredEventByIdOrThrow(id: string): Promise<StoredEvent> {
  const event = await findStoredEventById(id);
  if (!event) throw notFound("Event", id);
  return event;
}
