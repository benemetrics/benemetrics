import { notFound } from "backend/errors";
import { storedEventDAO } from "db/dao/stored-event";
import type { StoredEvent } from "db/schema/stored-event";
import {
  findClickHouseEvent,
  isClickHouseAvailable,
  listClickHouseEvents,
} from "./clickhouse";

// Stored-events reads (list + get) prefer ClickHouse when it is
// available: it holds a best-effort copy of every stored envelope and is
// the analytics store. Postgres stays the source of truth — writes,
// metrics and alerting read from it, and any ClickHouse failure falls
// back to it for that request.

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function listStoredEvents(options?: {
  page?: number;
  limit?: number;
  projectId?: string;
  appIds?: string[];
}): Promise<{
  data: StoredEvent[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  if (isClickHouseAvailable()) {
    try {
      return await listClickHouseEvents(options);
    } catch (err) {
      console.error(
        "[ClickHouse] Failed to list events, falling back to Postgres:",
        describe(err),
      );
    }
  }
  return storedEventDAO.list(options);
}

export async function findStoredEventById(
  id: string,
): Promise<StoredEvent | undefined> {
  if (isClickHouseAvailable()) {
    try {
      return await findClickHouseEvent(id);
    } catch (err) {
      console.error(
        "[ClickHouse] Failed to fetch event, falling back to Postgres:",
        describe(err),
      );
    }
  }
  return storedEventDAO.findById(id);
}

export async function findStoredEventByIdOrThrow(id: string): Promise<StoredEvent> {
  const event = await findStoredEventById(id);
  if (!event) throw notFound("Event", id);
  return event;
}
