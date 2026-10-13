# Sentry Protocol Specification — Server Implementation Guide

This document describes the Sentry ingestion protocol that a compatible server must implement to support the 6 core features.

## Sources & References

All payload formats below are derived from the following official sources:

| Source | URL | Covers |
|--------|-----|--------|
| **Sentry Envelope Spec** | https://develop.sentry.dev/sdk/envelopes/ | Envelope format, item headers, authentication |
| **Sentry Event Payloads** | https://develop.sentry.dev/sdk/event-payloads/ | Event, transaction, session, profile, replay, check-in, user_feedback schemas |
| **Sentry Ingestion API** | https://docs.sentry.io/api/events/ | HTTP endpoints, headers, rate limiting, responses |
| **Sentry TypeScript SDK Types** | https://github.com/getsentry/sentry-javascript/tree/master/packages/types | TypeScript interfaces for all payload types |
| **Sentry Protocol (Legacy)** | https://docs.sentry.io/api/events/ | Legacy `/store/` endpoint |
| **OpenTelemetry Semantic Conventions** | https://opentelemetry.io/docs/specs/semconv/ | Span attributes, status codes |
| **Sentry Relay (Ingestion Service)** | https://github.com/getsentry/relay | Server-side processing, rate limiting headers |

## Protocol Overview

```
┌─────────────┐     HTTP/HTTPS      ┌──────────────────┐
│  SDK/Client │ ──────────────────▶ │  Ingestion API   │
│             │   JSON + Envelope   │  (Your Server)   │
└─────────────┘                     └──────────────────┘
                                           │
                    ┌──────────────────────┼──────────────────────┐
                    ▼                      ▼                      ▼
            ┌─────────────┐        ┌─────────────┐        ┌─────────────┐
            │  Error      │        │  Transaction│        │  Session    │
            │  Processing │        │  Processing │        │  Processing │
            └─────────────┘        └─────────────┘        └─────────────┘
```

## Base URL Structure

```
https://your-sentry-server.com/api/{org_slug}/
```

## Authentication

All endpoints require authentication via **DSN** (Data Source Name):

```
DSN Format: https://<public_key>@<host>/<project_id>
```

Headers:
```
X-Sentry-Auth: Sentry sentry_key=<public_key>, sentry_version=7, sentry_client=<sdk_name>/<version>
```

Or via URL:
```
POST /api/<project_id>/envelope/?sentry_key=<public_key>
```

## Envelope Format (Primary Ingestion)

All data is sent as **envelopes** — a newline-delimited format:

```
<envelope_header>\n
<item_header>\n
<item_payload>\n
<item_header>\n
<item_payload>\n
...
```

### Envelope Header

```json
{
  "event_id": "uuid-v4",           // Optional: for event items
  "sent_at": "2024-01-15T10:30:00.000Z",  // ISO 8601
  "dsn": "https://key@host/123",   // Optional
  "sdk": {
    "name": "sentry.javascript.bun",
    "version": "8.0.0",
    "integrations": ["http", "console"],
    "packages": [{"name": "npm:@sentry/bun", "version": "8.0.0"}]
  }
}
```

**Source:** [Sentry Envelope Spec](https://develop.sentry.dev/sdk/envelopes/) — Envelope header structure defined in "Envelope Header" section.

### Item Header

```json
{
  "type": "event",           // event | transaction | session | profile | replay_event | check_in | user_feedback
  "content_type": "application/json",
  "length": 1234,            // Bytes
  "filename": "event.json"   // Optional
}
```

**Source:** [Sentry Envelope Spec](https://develop.sentry.dev/sdk/envelopes/) — Item header structure defined in "Item Header" section.

### Item Payload

Varies by type (see below).

## Item Types

### 1. Event (Error Tracking)

```json
{
  "type": "event",
  "event_id": "fc6d8c0c-4b3a-4b3a-8b3a-4b3a4b3a4b3a",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "error",
  "logger": "my.logger",
  "platform": "node",
  "server_name": "server-1",
  "release": "2.3.1-abc123",
  "environment": "production",
  "tags": {
    "service": "api",
    "tier": "premium"
  },
  "user": {
    "id": "user_123",
    "email": "user@example.com",
    "ip_address": "{{auto}}"
  },
  "contexts": {
    "trace": {
      "trace_id": "0af7651916cd43dd8448eb211c80319c",
      "span_id": "b7ad6b7169203331",
      "parent_span_id": "parent_span_id",
      "op": "http.server",
      "status": "ok"
    },
    "request": {
      "url": "https://api.example.com/orders",
      "method": "POST",
      "headers": { "content-type": "application/json" },
      "query_string": "filter=active",
      "data": { "items": [...] },
      "cookies": {}
    }
  },
  "exception": {
    "values": [{
      "type": "TypeError",
      "value": "Cannot read property 'id' of null",
      "module": "orders.service",
      "thread_id": 1,
      "stacktrace": {
        "frames": [{
          "filename": "/app/services/orders.ts",
          "lineno": 42,
          "colno": 15,
          "function": "getOrder",
          "in_app": true,
          "vars": { "orderId": "123", "user": "object" },
          "pre_context": ["const order = await db.find(orderId)", ""],
          "context_line": "return order.user.id;",
          "post_context": ["", "}"]
        }]
      },
      "mechanism": {
        "type": "generic",
        "handled": false,
        "data": {}
      }
    }]
  },
  "breadcrumbs": {
    "values": [
      {
        "type": "http",
        "category": "http.request",
        "message": "POST /api/orders",
        "level": "info",
        "timestamp": 1705312200.123,
        "data": { "method": "POST", "url": "/api/orders", "status_code": 500 }
      }
    ]
  },
  "fingerprint": ["{{ default }}"],
  "modules": { "express": "4.18.2", "@sentry/bun": "8.0.0" },
  "sdk": { "name": "sentry.javascript.bun", "version": "8.0.0" }
}
```

**Source:** [Sentry Event Payloads](https://develop.sentry.dev/sdk/event-payloads/) — "Event Payload" section defines the complete event schema including exception, contexts, breadcrumbs, user, tags, fingerprint, modules, and sdk fields.

### 2. Transaction (Performance Monitoring)

```json
{
  "type": "transaction",
  "event_id": "fc6d8c0c-4b3a-4b3a-8b3a-4b3a4b3a4b3a",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "start_timestamp": "2024-01-15T10:30:00.000Z",
  "transaction": "GET /api/orders/:id",
  "transaction_info": { "source": "route" },
  "trace_id": "0af7651916cd43dd8448eb211c80319c",
  "span_id": "b7ad6b7169203331",
  "parent_span_id": "parent_span_id",
  "op": "http.server",
  "status": "ok",
  "duration": 0.123,
  "measurements": {
    "fp": { "value": 1200.5 },
    "fcp": { "value": 1350.2 },
    "lcp": { "value": 2100.8 },
    "cls": { "value": 0.05 },
    "fid": { "value": 12.3 }
  },
  "spans": [
    {
      "span_id": "span_1",
      "parent_span_id": "b7ad6b7169203331",
      "op": "db.query",
      "description": "SELECT * FROM orders WHERE id = ?",
      "start_timestamp": "2024-01-15T10:30:00.010Z",
      "timestamp": "2024-01-15T10:30:00.055Z",
      "status": "ok",
      "tags": { "db.system": "postgresql", "db.table": "orders" },
      "data": { "db.rows_returned": 1 }
    }
  ],
  "contexts": {
    "trace": { "trace_id": "...", "span_id": "...", "op": "http.server" },
    "request": { "url": "...", "method": "GET" }
  }
}
```

**Source:** [Sentry Event Payloads](https://develop.sentry.dev/sdk/event-payloads/) — "Transaction Payload" section defines transaction-specific fields (trace_id, span_id, op, duration, spans, measurements). Span attributes follow [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/) for db.system, http.method, etc.

### 3. Session (Release Health)

```json
{
  "type": "session",
  "sid": "session-uuid",
  "init": true,
  "started": "2024-01-15T10:00:00.000Z",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "duration": 1800,
  "status": "ok",
  "release": "2.3.1-abc123",
  "environment": "production",
  "user": { "id": "user_123" },
  "errors": 0,
  "attrs": {
    "release": "2.3.1-abc123",
    "environment": "production"
  }
}
```

**Source:** [Sentry Event Payloads](https://develop.sentry.dev/sdk/event-payloads/) — "Session Payload" section defines session schema (sid, init, started, timestamp, duration, status, errors, attrs).

### 4. Profile (Continuous Profiling)

```json
{
  "type": "profile",
  "profile_id": "profile-uuid",
  "trace_id": "0af7651916cd43dd8448eb211c80319c",
  "start_timestamp": "2024-01-15T10:30:00.000Z",
  "end_timestamp": "2024-01-15T10:30:10.000Z",
  "platform": "node",
  "samples": [
    { "timestamp": 100, "stack_id": 0, "thread_id": 1 },
    { "timestamp": 101, "stack_id": 1, "thread_id": 1 }
  ],
  "stacks": [
    { "frames": [0, 1, 2] },
    { "frames": [0, 3, 4] }
  ],
  "frames": [
    { "function": "processOrder", "filename": "orders.ts", "lineno": 10 },
    { "function": "validateOrder", "filename": "orders.ts", "lineno": 50 }
  ]
}
```

**Source:** [Sentry Event Payloads](https://develop.sentry.dev/sdk/event-payloads/) — "Profile Payload" section defines profile schema with samples, stacks, and frames arrays.

### 5. Replay Event (Session Replay)

```json
{
  "type": "replay_event",
  "replay_id": "replay-uuid",
  "segment_id": 1,
  "timestamp": "2024-01-15T10:30:00.000Z",
  "events": [
    { "type": "full_snapshot", "data": { ... } },
    { "type": "incremental_snapshot", "data": { ... } }
  ]
}
```

**Source:** [Sentry Event Payloads](https://develop.sentry.dev/sdk/event-payloads/) — "Replay Event Payload" section defines replay_event schema. The replay event format is also documented in [@sentry/replay package](https://github.com/getsentry/sentry-javascript/tree/master/packages/replay).

### 6. Check-in (Cron Monitoring)

```json
{
  "type": "check_in",
  "monitor_slug": "nightly-backup",
  "status": "in_progress",  // in_progress | ok | error
  "check_in_id": "checkin-uuid",
  "duration": 300,
  "monitor_config": {
    "schedule": "0 2 * * *",
    "checkin_margin": 600,
    "max_runtime": 1800
  }
}
```

**Source:** [Sentry Event Payloads](https://develop.sentry.dev/sdk/event-payloads/) — "Check-in Payload" section defines check_in schema. Also referenced in [Cron Monitoring docs](https://docs.sentry.io/product/crons/).

### 7. User Feedback

```json
{
  "type": "user_feedback",
  "event_id": "fc6d8c0c-4b3a-4b3a-8b3a-4b3a4b3a4b3a",
  "name": "John Doe",
  "email": "john@example.com",
  "comments": "The checkout page crashed when I clicked pay",
  "source": "widget"
}
```

**Source:** [Sentry Event Payloads](https://develop.sentry.dev/sdk/event-payloads/) — "User Feedback Payload" section defines user_feedback schema.

## API Endpoints

### Envelope Ingestion (Primary)

```
POST /api/{project_id}/envelope/
POST /envelope/ (with sentry_key query param)
```

**Headers:**
```
Content-Type: application/x-sentry-envelope
X-Sentry-Auth: Sentry sentry_key=...
```

**Response:**
```
200 OK
{
  "id": "event_id"
}
```

**Source:** [Sentry Ingestion API](https://docs.sentry.io/api/events/) — "Envelope Ingestion" endpoint documentation.

### Legacy Event Ingestion (Deprecated)

```
POST /api/{project_id}/store/
POST /store/ (with sentry_key)
```

**Headers:**
```
Content-Type: application/json
X-Sentry-Auth: Sentry sentry_key=...
```

**Body:** Event JSON (not envelope)

**Response:**
```
200 OK
{"id": "event_id"}
```

**Source:** [Sentry Ingestion API](https://docs.sentry.io/api/events/) — "Event Ingestion (Legacy)" endpoint documentation.

### Security Policy (CSP Reporting)

```
POST /api/{project_id}/security/
```

**Source:** [Sentry Ingestion API](https://docs.sentry.io/api/events/) — "Security Policy Reporting" endpoint.

### Attachments

```
POST /api/{project_id}/attachments/?event_id=...
```

**Source:** [Sentry Ingestion API](https://docs.sentry.io/api/events/) — "Attachment Upload" endpoint.

## Required Headers for All Requests

| Header | Required | Description |
|--------|----------|-------------|
| `Content-Type` | Yes | `application/x-sentry-envelope` or `application/json` |
| `X-Sentry-Auth` | Yes* | Authentication (or query param) |
| `User-Agent` | No | SDK identification |
| `Accept` | No | `application/json` |

*Can use `?sentry_key=<public_key>` query parameter instead.

**Source:** [Sentry Envelope Spec](https://develop.sentry.dev/sdk/envelopes/) — "Authentication" section.

## Rate Limiting

Return `429 Too Many Requests` with headers:
```
Retry-After: 60
X-Sentry-Rate-Limit: 1000;w=3600
X-Sentry-Rate-Limit-Remaining: 0
```

**Source:** [Sentry Relay](https://github.com/getsentry/relay) — Rate limiting implementation in Relay (Sentry's ingestion service). Headers documented in [Sentry API docs](https://docs.sentry.io/api/rate-limits/).

## Error Responses

| Code | Meaning |
|------|---------|
| 200 | Accepted |
| 400 | Invalid payload |
| 401 | Invalid DSN/key |
| 403 | Project disabled/quota exceeded |
| 429 | Rate limited |
| 500 | Server error |

**Source:** [Sentry Ingestion API](https://docs.sentry.io/api/events/) — Response codes documentation.

## Feature Mapping to Protocol

| Feature | Protocol Items | Key Fields |
|---------|---------------|------------|
| **Error Tracking** | `event` | `exception`, `contexts.request`, `breadcrumbs` |
| **Release Tracking** | `event`, `transaction`, `session` | `release`, `environment` |
| **Performance** | `transaction` | `spans`, `measurements`, `trace_id` |
| **Session Replay** | `replay_event` | `replay_id`, `segment_id`, `events` |
| **Breadcrumbs** | `event` (embedded) | `breadcrumbs.values` |
| **Alerting** | `check_in`, `metric` (custom) | `monitor_slug`, `status` |

## Data Retention Requirements

| Data Type | Minimum Retention |
|-----------|-------------------|
| Events (errors) | 90 days |
| Transactions | 30 days |
| Sessions | 90 days |
| Profiles | 14 days |
| Replays | 7 days |
| Check-ins | 90 days |

**Source:** [Sentry Data Retention](https://docs.sentry.io/product/accounts/data-retention/) — Default retention periods by data type.

## Compression

Clients may send gzipped envelopes:
```
Content-Encoding: gzip
```

Server must support decompression.

**Source:** [Sentry Envelope Spec](https://develop.sentry.dev/sdk/envelopes/) — "Compression" section.

## SDK Compatibility

Your server must accept envelopes from:
- `@sentry/bun` (Node/Bun)
- `@sentry/node` (Node.js)
- `@sentry/javascript` (Browser)
- `@sentry/python`, `@sentry/java`, `@sentry/go`, etc.
- `sentry-cli` (for releases, source maps)

**Source:** [Sentry SDK Index](https://docs.sentry.io/platforms/) — All official SDKs use the envelope protocol.

## Testing Checklist

- [ ] Accept envelope format
- [ ] Parse all 7 item types
- [ ] Validate DSN authentication
- [ ] Return proper event IDs
- [ ] Handle gzip compression
- [ ] Rate limit with proper headers
- [ ] Store release/environment on all items
- [ ] Link transactions to errors via trace_id
- [ ] Support check-in monitor config
- [ ] Handle large payloads (10MB+)

---

*This specification covers the ingestion protocol. See individual feature docs for processing requirements.*