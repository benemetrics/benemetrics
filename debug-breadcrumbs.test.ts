import * as Sentry from "@sentry/bun";
import app from "./backend/index";

const DSN = "http://a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4@localhost:31337/123";

Sentry.init({
  dsn: DSN,
  environment: "test",
  release: "1.0.0-test",
  tracesSampleRate: 1.0,
  debug: false,
  defaultIntegrations: false,
});

await app.handle(new Request("http://localhost/events/clear", { method: "POST" }));

Sentry.addBreadcrumb({
  type: "info",
  category: "test",
  message: "This should be cleared",
  level: "info",
});

const scope = Sentry.getCurrentScope();
scope.clearBreadcrumbs();

const eventId = Sentry.captureMessage("Event after breadcrumb clear", "info");
console.log("Event ID:", eventId);
await Sentry.flush(5000);

const response = await app.handle(new Request(`http://localhost/events/${eventId}`));
const event = await response.json();
console.log("=== EVENT ===");
console.log(JSON.stringify(event, null, 2));
console.log("=== END ===");