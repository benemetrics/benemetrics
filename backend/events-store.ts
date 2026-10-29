import { notFound } from "backend/errors";
import type { StoredEvent } from "./protocol/events";
import { findClickHouseEvent, listClickHouseEvents } from "./clickhouse";

export async function listStoredEvents(options?: {
  cursor?: string;
  limit?: number;
  projectId?: string;
  appIds?: string[];
  since?: string;
}): Promise<{ data: StoredEvent[] }> {
  return listClickHouseEvents(options);
}

export async function findStoredEventById(
  id: string,
): Promise<StoredEvent | undefined> {
  return findClickHouseEvent(id);
}

export async function findStoredEventByIdOrThrow(
  id: string,
): Promise<StoredEvent> {
  const event = await findStoredEventById(id);
  if (!event) throw notFound("Event", id);
  return event;
}
