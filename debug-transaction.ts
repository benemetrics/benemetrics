import * as Sentry from "@sentry/bun";

Sentry.init({
  dsn: "http://a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4@localhost:31337/123",
  tracesSampleRate: 1.0,
  debug: true,
  defaultIntegrations: false,
});

const span = Sentry.startInactiveSpan({
  name: "GET /api/test",
  op: "http.server",
});

console.log("Span traceId:", span.spanContext().traceId);
console.log("Span spanId:", span.spanContext().spanId);

span.end();
await Sentry.flush(5000);