import * as Sentry from "@sentry/bun";
import { fetchEvent, fetchAllEvents, setupTestSuite, clearEvents } from "./e2e/test-utils";

await setupTestSuite();

Sentry.init({
  dsn: "http://a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4@localhost:31337/123",
  tracesSampleRate: 1.0,
  debug: true,
  defaultIntegrations: false,
});

const span = Sentry.startInactiveSpan({
  name: "GET /api/users/:id",
  op: "http.server",
});

console.log("Span traceId:", span.spanContext().traceId);
const traceId = span.spanContext().traceId;

await new Promise((resolve) => setTimeout(resolve, 10));
span.end();

await Sentry.flush(5000);

const events = await fetchAllEvents();
console.log("Events:", JSON.stringify(events, null, 2));

const transactionEvent = events.find((e) => e.itemTypes.includes("transaction"));
console.log("Transaction event:", transactionEvent);

if (transactionEvent) {
  const transaction = await fetchEvent(transactionEvent.id);
  console.log("Transaction payload:", JSON.stringify(transaction, null, 2));
}

await Sentry.close();