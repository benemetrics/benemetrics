import { appDAO } from "db/dao/project";
import { releaseDAO } from "db/dao/releases";
import { extractRelease } from "../events/utils";
import type { SentryEventMessage } from "../protocol/events";
import type { ItemHeader } from "../protocol/item-header";

// Best-effort: messages without a release, without a resolvable app, or
// for deleted apps are skipped. `recordEvent` is an upsert, so concurrent
// deliveries cannot create two rows for one (app, version).
export async function recordReleaseFromEvent(
  event: SentryEventMessage,
): Promise<void> {
  if (!event.appId) return;

  let items: Array<{ header: ItemHeader; payload: unknown }>;
  try {
    items = JSON.parse(event.envelopeItems) as Array<{
      header: ItemHeader;
      payload: unknown;
    }>;
  } catch {
    return;
  }

  const release = extractRelease({ items });
  if (!release) return;

  // The app is gone (deleted between ingest and processing): skip.
  const app = await appDAO.findById(event.appId);
  if (!app) return;

  await releaseDAO.recordEvent(event.appId, release, {
    eventId: event.id,
    at: event.receivedAt,
  });
}
