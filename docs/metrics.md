# Metrics — Architecture

**Status:** Design paper — metric samples ingestion, storage, API, and alerting integration.

---

## 1. Model in One Paragraph

Every ingested envelope is parsed at the API edge to extract **metric samples** — one row per `(event, metric, dimension)` — which are published to NATS and consumed by ClickHouse via a NATS engine table + materialized view. ClickHouse is the **only** store for metric samples; the control-plane database holds no measurements. The metrics API reads ClickHouse directly with exact `quantile()` computations; the alerting sweeper evaluates threshold rules against the same ClickHouse samples. Live feed is browser → NATS WebSocket (raw envelopes, client-side parsing).

---

## 2. Pipeline Overview

```
SDK ──POST /envelope──▶ Ingest Handler
         Parse envelope → extract samples
                     │
                     ▼
         NATS sentry.events   (envelope message)     ──▶ ClickHouse (engine table + MV)
                                                               Events table
         NATS sentry.metrics  (JSONEachRow samples)  ──▶ ClickHouse (engine table + MV)
                                                               Metrics table
         NATS sentry.events                                 ──▶ Side-effects Consumer
                                                              Issues / alert triggers only
```

### Key Design Decisions

1. **ClickHouse is the single source of truth for metric samples** — no event payloads and no measurements ever land in the control-plane database.
2. **Extraction happens at the API edge** — the ingest handler parses the envelope once and publishes both subjects. SQL-side extraction from envelope JSON-in-JSON was rejected as too brittle.
3. **ClickHouse ingests from NATS by configuration** — `ENGINE = NATS` with a durable JetStream pull consumer + a materialized view into the target table. Acknowledgement happens **after** the MV insert succeeds; failed inserts are redelivered.
4. **Idempotent writes** — target tables use `ReplacingMergeTree` with the event id in the sort key; reads use `FINAL` to collapse duplicates.
5. **Side-effects consumer = control-plane only** — the side-effects subscription (its own binary, `backend/consumer.ts`) applies issue tracking, release tracking, and fires `new_issue`/`regression` alerts. It reads the stream through its own durable pull consumer (`side-effects`), so an event published while it is down is not lost, and it never inserts into ClickHouse, so a ClickHouse outage never stalls side effects.
6. **Live feed = browser → NATS WebSocket** — the backend live-feed route and fanout are deleted. Auth is via NATS config (dev: open/`no_auth_user` subscribe-only; prod: token).
7. **No event state in control plane — ledger dropped** — events live only in NATS/ClickHouse. Side effects stay safe: issue creation (unique per app+fingerprint, upsert) and regression detection (conditional update on resolved status) are one-shot, so retries never duplicate issues or re-fire alerts. Only the issue event counter can drift: a crash between the control-plane write and the ack redelivers the message and increments again — accepted.

---

## 3. Metric Taxonomy

One ClickHouse row per `(event, metric, dimension)` where `dimension` = transaction name (route/screen) or `''` otherwise. **Every numeric measurement is stored** (no allowlist), including custom measurements.

### Web Vitals

| Metric | Description | Display Thresholds (warning / critical) |
|--------|-------------|-----------------------------------------|
| `lcp` | Largest Contentful Paint (ms) | 2500 / 4000 |
| `inp` | Interaction to Next Paint (ms) | 200 / 500 |
| `cls` | Cumulative Layout Shift | 0.1 / 0.25 |
| `fcp` | First Contentful Paint (ms) | 1800 / 3000 |
| `ttfb` | Time to First Byte (ms) | 800 / 1800 |
| `fp` | First Paint (ms) | 1000 / 3000 |
| `fid` | First Input Delay (ms) | 100 / 300 |
| `ttfb.requesttime` | Request time component of TTFB | — |

### Mobile Vitals

| Metric | Description | Display Thresholds (warning / critical) |
|--------|-------------|-----------------------------------------|
| `app_start_cold` | Cold start time (ms) | <3000 / <5000 |
| `app_start_warm` | Warm start time (ms) | <1000 / <2000 |
| `time_to_initial_display` | TTID (ms) | — |
| `time_to_full_display` | TTFD (ms) | — |
| `frames_total` | Total frames rendered | — |
| `frames_slow` | Slow frames (>16ms) | — |
| `frames_frozen` | Frozen frames (>700ms) | — |
| `stall_count` | Number of stalls (RN) | — |
| `stall_total_time` | Total stall time (ms) | — |
| `stall_longest_time` | Longest stall (ms) | — |
| `frames_slow_rate` | `frames_slow / frames_total` (weighted, Sentry-style) | — |
| `frames_frozen_rate` | `frames_frozen / frames_total` | — |
| `stall_percentage` | `stall_total_time / total_time` | — |

> **Note:** `frames_slow_rate`, `frames_frozen_rate`, and `stall_percentage` are rate samples sent directly by React Native SDKs. The aggregate frame rate for display is computed as `frames_slow / frames_total` (weighted, Sentry-style).

### Sentinels

| Metric | Description |
|--------|-------------|
| `event_count` | 1 per stored event item (`event` or `transaction`) |
| `error_count` | 1 when level = `error` |
| `fatal_count` | 1 when level = `fatal` |
| `duration` | Transaction duration (ms) |

The level is normalized lowercase; a missing or unknown level counts as `error`. `error_count` and
`fatal_count` are disjoint — a `fatal` event is counted only by `fatal_count`.

---

## 4. NATS Topology & ClickHouse Schema

### Subjects on the `SENTRIES` stream

| Subject | Payload | Consumers |
|---------|---------|-----------|
| `sentry.events` | One JSON object per message (event id, project id, app id, envelope header, envelope items, received timestamp, type) | ClickHouse (events) + Side-effects consumer (`side-effects` durable) |
| `sentry.metrics` | JSONEachRow sample rows | ClickHouse (metrics) |
| `sentry.flags.changed` | The flag change | Flags consumer (`flags-consumer` durable) |

### ClickHouse DDL

The engine tables pull from NATS via durable JetStream pull consumers, provisioned by the shared `backend/nats.ts` module (so the consumer binary and the API can start in either order):

```sql
-- Events engine table
CREATE TABLE nats_events (...)
ENGINE = NATS SETTINGS
  nats_url=...,
  nats_stream='SENTRIES',
  nats_consumer_name='clickhouse-events',
  nats_subjects='sentry.events',
  nats_format='JSONEachRow',
  input_format_skip_unknown_fields=1,
  nats_skip_broken_messages=10;

-- Target events table: ReplacingMergeTree for idempotent writes
CREATE TABLE sentry_events (...)
ENGINE = ReplacingMergeTree()
ORDER BY (projectId, receivedAt, id)
SETTINGS fsync_after_insert=1, fsync_part_directory=1;

-- Materialized view: engine table → target table
CREATE MATERIALIZED VIEW sentry_events_mv TO sentry_events AS
SELECT id, projectId, appId, envelopeHeader, envelopeItems,
       parseDateTime64BestEffortOrNull(receivedAt, 3) AS receivedAt
FROM nats_events;
```

- The metrics tables (`nats_metrics` / `sentry_metrics`) mirror the events tables with a separate consumer (`clickhouse-metrics`). Their sort key carries the metric and dimension instead of the event id: `ORDER BY (projectId, metric, receivedAt, eventId, dimension)`.
- `fsync_after_insert` + `fsync_part_directory` on target tables: without them, an acknowledged (inserted) batch can still be lost on a page-cache loss (power/VM reset); with them the ack is honest.
- `input_format_skip_unknown_fields=1` + `nats_skip_broken_messages=10`: a message the schema cannot parse must not poison-loop the consumer; it is skipped/logged.
- Migration: data-preserving RENAME to `_old`, create new `ReplacingMergeTree` with `ORDER BY (projectId, receivedAt, id)`, `INSERT … SELECT` (dedupe by id), drop old.
- Durable pull consumers are created by the shared `backend/nats.ts` module (`consumers.add`, explicit ack, no deliver subject) and therefore exist for both the consumer binary and the API; the engine tables attach to them by name, so ClickHouse can boot before they exist.
- **Risk gate cleared:** the CH NATS engine + JetStream round trip was smoke-tested (stream + durable pull consumer → engine table → publish → row landed, ack advanced after the MV insert) against the `latest` images; the breakage reports (ClickHouse#87518) do not reproduce.

### Events Table Retention (TTL)

The events table declares a retention TTL:

```sql
TTL toDateTime(receivedAt) + toIntervalMonth(1)
```

- Default: **one month**.
- Admin can read the live TTL from the table definition and change it via Settings → Event retention (admin-token-only): `GET`/`PUT /api/admin/settings/events-ttl` with `{ amount, unit }` (`day` | `week` | `month` | `year`); `amount: 0` removes the TTL.
- Bootstrap only seeds the default when the table has no TTL — **never overwrites** an admin change.
- The metric samples share the retention: a store that dropped the events but kept their counters would make the volume metrics disagree with the store.

---

## 5. Write Path

### Ingest Handler
1. Resolve app (control plane)
2. Extract samples from envelope (every numeric measurement + sentinels)
3. Publish `sentry.events` + `sentry.metrics`
4. Publish failure → 503; no in-process fallback

### ClickHouse
- Engine tables pull from JetStream via their own durable consumers
- Materialized views insert, ack-after-insert
- Redelivery retried by the engine
- Duplicates collapsed by `ReplacingMergeTree`

### Side-Effects Consumer
- Process ingested event — issue create/regress (one-shot, race-safe) + mark seen
- No ledger, no ClickHouse writes, no broadcast
- A ClickHouse outage never touches this consumer

---

## 6. Read Path

### Events API
- ClickHouse only (`SELECT … FINAL`)
- No control-plane fallback
- ClickHouse errors → 5xx

### Metrics API

#### `GET /api/admin/metrics/series`
```
Query: metric, projectId|environmentId|appId, from, to, stepSeconds?
Response: { metric, unit, points: [{ bucketStart, count, mean, p50, p95, p99 }] }
```
- `toStartOfInterval` + `quantile()` in ClickHouse
- Auto step: ≤6h → 1m, ≤48h → 5m, else 1h

#### `GET /api/admin/metrics/breakdown`
```
Query: metric=duration, projectId|environmentId|appId, from, to, limit?
Response: { data: [{ dimension, count, mean, p50, p95 }] }
```
- Top-N dimensions by count for the given metric/window

---

## 7. Alerting Integration

- Sweeper queries ClickHouse per rule
- Counts from sentinel metrics (`event_count`, `error_count`, `fatal_count`)
- `latency_p95|p99` = `quantile()` over `rule.measurement ?? "duration"`
- `new_issue_count` stays in the control plane (issue transitions are event-driven at ingestion)
- Raw-event scan removed
- ClickHouse failure: log, skip tick (self-heals on next tick)

---

## 8. Frontend

### Live Feed
- Subscribe with `nats.ws` to `sentry.events` (URL from config, default local dev WS port)
- Parse envelopes client-side (reuse the events-API parser)
- Old backend live-feed route removed

### Metrics Panels
- API client, units, bands
- **Performance page web vitals cards** (adds `fp`/`fid`)
- **Mobile Vitals panel** — cold/warm start, TTID/TTFD, derived slow/frozen frame rate, stalls
- **Latency table** from `breakdown` instead of a fixed event window
- Issue detail unchanged

---

## 9. Infra Preconditions

- NATS with JetStream + WebSocket — config file versioned and shared with CI; ClickHouse + S3-compatible object store provisioned. Dev WS listener open (no TLS, local); prod auth via NATS credentials/token.
- ClickHouse: passwordless default user restricted to localhost; dev/test environments use a skip-user-setup flag (production uses real credentials).
- CI: ClickHouse + NATS (with mounted config) required for test suite.
- Local dev/test: container stack must be running.
- Boot order: the consumer binary and the API both provision the stream + durable pull consumers (idempotently) → the API attaches the ClickHouse engine tables/MVs → fail fast.

---

## 10. Testing — Small Blocks, One Hop Per Test

Test suites split by transport:
- **In-process**: run via application handle — no network listener. Host header set so request-derived values (DSN hosts) stay consistent.
- **E2E**: only suites needing a real socket — SDK-driven, WebView UI, WebSocket.

Each hop is asserted by its own small test (no chain assertions):

| # | Test | Description |
|---|------|-------------|
| 1 | **ingest → NATS** | POST an envelope; assert the `sentry.events` message and `sentry.metrics` rows in the stream. Nothing downstream awaited. |
| 2 | **NATS → ClickHouse** | Publish directly to NATS; wait for row in events/metrics tables (`FINAL`); duplicate event id stays one row. Owns engine config/ack path. |
| 3 | **NATS → Control Plane** | Publish; assert issue/alert side effects; republished id never creates a second issue or re-fires an alert (one-shot; counter drift accepted). |
| 4 | **ClickHouse → API reads** | Seed ClickHouse directly; assert events/metrics endpoints. No ingestion involved. |
| 5 | **Live feed** | NATS client subscribes like the browser; publish; assert receipt. |
| 6 | **SDK E2E** | Full path through a real SDK; ClickHouse visibility assertions wait for engine ingestion (asynchronous). |

---

## 11. Accepted Consequences

- **ClickHouse outage**: ingestion unaffected (NATS buffers unacked messages); events/metrics reads 5xx; sweeper paused; control-plane side effects unaffected (separate consumer).
- **NATS outage**: ingestion 503; live feed down (same dependency); side effects stop.
- **Live feed is browser→NATS**: NATS becomes a browser-facing surface (dev open, prod token); payload is raw envelopes, not a trimmed live message.
- **`fsync_after_insert` cost** on the hot write path (accepted; correctness over throughput at this scale).
- **Long ClickHouse outage** grows NATS disk unboundedly (no stream limits) — consider `max_age` as a valve.
- **Redelivery after a crash** can double-increment the issue event counter (no ledger); alerts never double-fire.
- **Test suite requires docker services** (CI + local).

---

## 12. Dropped Across Versions

The following were explicitly dropped in earlier plan versions and are **not** part of the current architecture:

- Control-plane rollups / histogram tables
- Metrics read facade (abstraction layer over ClickHouse/control-plane)
- Measurement allowlist (all numeric measurements are stored)
- Control-plane event storage table
- Control-plane processed-event ledger (no event-derived state in control plane at all)
- In-process ingestion fallback
- Local storage directory
- Application-side ClickHouse writer
- Backend WebSocket fanout and live-feed route

---

## 13. Invariants (Must Not Break)

- **Metric reads are ClickHouse-only** — control plane has no measurements. ClickHouse failure = failed read (5xx), never a fallback to zero.
- **Extraction at the API edge** — envelope parsing happens once in the handler; ClickHouse never sees raw envelope JSON-in-JSON.
- **Idempotent ClickHouse writes** — `ReplacingMergeTree` + `FINAL` reads; duplicates collapse.
- **Side-effects consumer never touches ClickHouse** — side effects are control-plane only; the threshold rules are the sweeper's job, so a ClickHouse outage cannot stall issue tracking or alert triggers.
- **Live feed is NATS-native** — no backend WebSocket fanout, no live-feed route.
- **Sweeper evaluates threshold rules only** — `new_issue`/`regression` are event-driven at ingestion; re-running transitions would re-fire one-shot alerts. The ingestion path does not evaluate threshold rules: their metric is read from ClickHouse, which ingests the same subject on its own consumer, so a window read at ingestion time does not contain the event yet.
- **Admin-token-only metrics API** — scoped identities rejected (not in scoped-read allowlist; tracked for permissions work).
- **Timestamps as ISO strings** — UTC ISO strings everywhere; the control-plane columns are `timestamptz` and the application reads and writes them as ISO-8601 UTC strings.
- **IDs generated in handler/consumer** — UUID v4, never database default.
- **JSON columns stringified on write, parsed on read** — envelope header, envelope items, metric sample batches.

---

## 14. Related Architecture Docs

- [`alerting.md`](alerting.md) — Alerting system (threshold metrics sourced from ClickHouse, sweeper reads ClickHouse)
- [`issues.md`](issues.md) — Issue tracking (drives `new_issue`/`regression` triggers; `new_issue_count` metric reads control plane)
- [`events.md`](events.md) — Ingestion pipeline (NATS → ClickHouse → alert evaluation)
- [`permission.md`](permission.md) — Admin auth model (metrics API is admin-token-only)
- [`storage.md`](storage.md) — Object store (unrelated but same repo structure)