# Plan: events + metrics in ClickHouse — services do the work (v4)

**Status:** v4 — supersedes v3. Pipeline: **API → NATS → ClickHouse**, where ClickHouse ingests from NATS **by configuration** (NATS table engine + JetStream durable pull consumer + materialized views). Live feed is **browser → NATS WebSocket** directly. The backend app keeps only the Postgres control plane: the API and a small side-effects consumer (issues/alerts). No app-side event storage, no app-side WebSocket fanout.
**Directives:** NATS/ClickHouse/S3 required; no "not configured / not available" branching or fallbacks. Durability comes from JetStream at-least-once delivery: ClickHouse acknowledges a message only after the materialized view inserted it.

## 0. Decisions

1. **Services required** — no availability branches, no in-process/local fallbacks. Init retries at boot, then fails fast.
2. **Ingested data store = ClickHouse only** — `stored_events` (Postgres) is deleted; no event payloads and no metric measurements ever land in PG. PG holds the control plane only (projects/apps/environments, issues, alert rules/incidents, permissions).
3. **ClickHouse consumes NATS by configuration** — `ENGINE = NATS` with `nats_stream` + `nats_consumer_name` (a durable pull consumer created at boot) + a materialized view into `sentry_events`. Acknowledgement happens after the MV insert succeeds; a failed/interrupted insert is redelivered. No app-side CH writer.
4. **API extracts metric samples at ingest** and publishes both subjects: `sentry.events` (envelope message, for CH + side effects) and `sentry.metrics` (JSONEachRow sample batch, for CH). SQL-side extraction rejected — envelope JSON-in-JSON is too brittle to maintain in CH.
5. **Live feed = NATS WebSocket** — the browser subscribes directly (`nats.ws`); `/events/live/feed`, `backend/live-events.ts` and `startLiveConsumer` are deleted. Feed auth is NATS config (dev: open/`no_auth_user` subscribe-only; prod: token).
6. **App consumer = Postgres side effects only** — the durable `sentry-events-consumer` keeps issue tracking; clear truncates CH tables and clears PG. It no longer touches CH, so a CH outage never stalls it.
7. **No event state in PG — ledger dropped** — events live only in NATS/CH. Side effects stay safe: `createIfNew` (unique per app+fingerprint, `onConflictDoNothing`) and `regressIfResolved` (`WHERE status='resolved'`) are one-shot, so retries never duplicate issues or re-fire alerts. Only `issues.event_count` can drift: a crash between the DB write and the ack redelivers the message and adds +1 again — accepted. If that ever matters, guard `markSeen` with a `last_event_id` scalar on the `issues` row (control plane, still not events).
8. **Idempotent CH writes** — `ReplacingMergeTree` with the event id in the sort key; reads use `FINAL`; redeliveries collapse.
9. **Metrics = raw samples in CH only** — same pipeline as events: API extracts → `sentry.metrics` → CH engine table + MV → `sentry_metrics`; exact `quantile()` at read; no PG rollup/histogram tables, no histogram approximation, no measurements in PG at all.
10. **Sweeper reads CH** — a CH outage pauses alert evaluation (self-heals on the next tick).
11. **Tests assert one hop each** — ingest→NATS, NATS→CH, NATS→PG, CH→API reads, live feed; no monolith end-to-end assertions (see §8).

## 1. Metric taxonomy — everything the clients send

One CH row per `(event, metric, dimension)`; `dimension` = transaction name (route / screen), `''` otherwise. **Every numeric measurement is stored** (no allowlist), including custom measurements.

**Web vitals:** `lcp`, `inp`, `cls`, `fcp`, `ttfb`, `fp`, `fid`, `ttfb.requesttime` — display thresholds: lcp 2500/4000, inp 200/500, cls 0.1/0.25, fcp 1800/3000, ttfb 800/1800, fp 1000/3000, fid 100/300.
**Mobile vitals:** `app_start_cold` (<3s/<5s), `app_start_warm` (<1s/<2s), `time_to_initial_display`, `time_to_full_display`, `frames_total`, `frames_slow`, `frames_frozen`, `stall_count`, `stall_total_time`, `stall_longest_time` (RN), plus the rate samples RN sends (`frames_slow_rate`, `frames_frozen_rate`, `stall_percentage`). Aggregate frame rate for display = `frames_slow / frames_total` (weighted, Sentry-style).
**Sentinels:** `event_count` (1 per stored event), `error_count`, `fatal_count`, `duration` (ms).

## 2. Topology & ClickHouse schema

Subjects on the `SENTRIES` stream:
- `sentry.events` — one JSON object per message (`id, projectId, appId?, envelopeHeader, envelopeItems, receivedAt, type`); consumed by CH (→ `sentry_events`) **and** by the app side-effects consumer.
- `sentry.metrics` — JSONEachRow sample rows; consumed by CH (→ `sentry_metrics`).
- `sentry.flags.changed` — unchanged.

DDL (in `initClickHouse`, which now runs **after** `initNats`):

```sql
CREATE TABLE nats_events (id String, projectId String, appId String, envelopeHeader String,
  envelopeItems String, receivedAt String, type String)
ENGINE = NATS SETTINGS
  nats_url='…', nats_stream='SENTRIES', nats_consumer_name='clickhouse-events',
  nats_subjects='sentry.events', nats_format='JSONEachRow',
  input_format_skip_unknown_fields=1, nats_skip_broken_messages=10;

CREATE TABLE sentry_events (…)
ENGINE = ReplacingMergeTree()
ORDER BY (projectId, receivedAt, id)
SETTINGS fsync_after_insert=1, fsync_part_directory=1;

CREATE MATERIALIZED VIEW sentry_events_mv TO sentry_events AS
SELECT id, projectId, appId, envelopeHeader, envelopeItems,
       parseDateTimeBestEffort(receivedAt) AS receivedAt
FROM nats_events WHERE type != 'clear';
```

- `sentry_metrics` / `nats_metrics` mirror this (same consumer pattern, `clickhouse-metrics`).
- `fsync_after_insert` + `fsync_part_directory` on the target tables per the engine docs: without them, an acknowledged (inserted) batch can still be lost on a page-cache loss (power/VM reset); with them the ack is honest.
- `input_format_skip_unknown_fields=1` + `nats_skip_broken_messages=N`: a message the schema cannot parse must not poison-loop the consumer; it is skipped/logged.
- `sentry_events` migration: data-preserving RENAME to `sentry_events_old`, create new `ReplacingMergeTree` with `ORDER BY (projectId, receivedAt, id)`, `INSERT … SELECT` (dedupe by id), drop old.
- Durable pull consumers (`clickhouse-events`, `clickhouse-metrics`) are created in `initNats` (`consumers.add`, explicit ack, no deliver subject) before `initClickHouse` attaches the engine tables.
- **Risk gate cleared:** the CH NATS engine + JetStream round trip was smoke-tested in batch 0 (stream + durable pull consumer → engine table → publish → row landed, ack advanced after the MV insert) against the `latest` images; the breakage reports (ClickHouse#87518) do not reproduce.

## 3. Write path

**API:** resolve app (PG) → extract samples (`backend/metrics/samples.ts`: `parseEnvelope` + `normalizeTransactionPayload`, every numeric measurement + sentinels) → publish `sentry.events` + `sentry.metrics`. Publish failure → `internalError` (503); the in-process `applyEventMessage` fallback is deleted.

**ClickHouse:** engine tables pull from JetStream via their own durable consumers, MVs insert, ack-after-insert; redelivery retried by the engine; duplicates collapsed by `ReplacingMergeTree`.

**App consumer (`sentry-events-consumer`, side effects):** `processIngestedEvent` — issue create/regress (one-shot, race-safe) + `markSeen`; `clear` → TRUNCATE CH targets + clear `issues`. No ledger, no CH writes, no broadcast (broadcast dies in batch 2). A CH outage never touches this consumer.

## 4. Read path

- `backend/events-store.ts`: ClickHouse only (`SELECT … FINAL`); PG fallback + `isClickHouseAvailable` deleted; CH errors → 5xx. `stored_events` DAO/schema/table removed; `StoredEvent` type moves to `backend/protocol/`.
- `GET /api/admin/metrics/series?metric&projectId|environmentId|appId&from&to&stepSeconds` → `{ metric, unit, points: [{ bucketStart, count, mean, p50, p95, p99 }] }` (`toStartOfInterval` + `quantile()`); auto step ≤6h→1m, ≤48h→5m, else 1h.
- `GET /api/admin/metrics/breakdown?metric=duration&…&limit` → `{ data: [{ dimension, count, mean, p50, p95 }] }`.

## 5. Alerting

Sweeper queries CH per rule: counts from sentinel metrics, `latency_p95|p99` = quantile over `rule.measurement ?? "duration"`; `new_issue_count` stays on PG `issues`. Raw-event scan removed. CH failure: log, skip tick.

## 6. Frontend

- **Live feed:** subscribe with `nats.ws` to `sentry.events` (URL from config, default local dev WS port); parse envelopes client-side (reuse the events-API parser); `clear` message resets the feed. The old `/events/live/feed` client code goes away with the backend route.
- **Metrics:** `frontend/src/lib/metrics.ts` (API client, units, bands); Performance page web vitals cards (adds `fp`/`fid`), new **Mobile Vitals** panel (cold/warm start, TTID/TTFD, derived slow/frozen frame rate, stalls), latency table from `breakdown` instead of the 200-event window. Issue detail unchanged.

## 7. Infra preconditions (first)

- `docker-compose.yml`: **add NATS (JetStream + WebSocket)** — missing today; config file checked in (`infra/nats-server.conf`) and shared with CI; clickhouse + rustfs already present. Dev WS listener open (`no_tls`, local); prod auth via NATS credentials/token.
- ClickHouse image restricts the passwordless `default` user to localhost; compose/CI set `CLICKHOUSE_SKIP_USER_SETUP=1` for dev/test (production uses real credentials).
- CI test job: add `clickhouse` + `nats` (config-mounted run step or service container, whichever supports the config file) (rustfs when the S3 batch lands) — required for `bun run test` once fallbacks are removed.
- Local dev/test: `docker compose up -d` becomes a prerequisite.
- Boot order: postgres → nats (stream + pull consumers) → clickhouse (engine tables + MVs) → fail fast.

## 8. Testing — small blocks, one hop per test

Suite split (batch 0b, done): `backend/tests/` runs in-process via `app.handle(new Request(...))` (no listen/port/stop) — 11 API suites moved there; `handleFetch` sets the `Host` header so request-derived values (app DSN hosts) stay consistent. `e2e/` keeps only suites needing a real socket: the 9 SDK-driven files (`01-error-tracking`, `01-error-tracking-ui`, `02-release-tracking`, `03-performance-monitoring`, `04-session-replay`, `05-breadcrumbs`, `06-alerting`, `09-feature-flags`, `24-sdk-dsn`), the WebView UI files (`23-backend-parity-ui`, `26-issues-ui`, `27-event-detail-symbolication-ui`, `29-replay-issue-view`, `30-issue-detail-metrics`; `01-error-tracking-ui` drives a WebView too), the 2 WebSocket files until batch 2, and 4 files still carrying the parallel session's uncommitted work (`08-authentication`, `19-admin-guard`, `31-permissions`, `32-health` — 08/32 already use `app.handle`; they move once that work lands). `bun run test` = `bun test --parallel=1 backend/tests/ e2e/`; tests import the exported app singleton directly — no separate `bootstrap()` was needed; `startTestApp()`/`waitFor(fn)` live in `backend/tests/test-helpers.ts`.

Each hop is asserted by its own small test (no chain assertions):

1. **ingest → NATS:** POST an envelope via handle; assert the `sentry.events` message and `sentry.metrics` rows in the stream. Nothing downstream is awaited.
2. **NATS → CH:** publish directly to NATS; `waitFor` the row in `sentry_events`/`sentry_metrics` (`FINAL`); a duplicate event id stays one row. This test owns the engine configuration/ack path.
3. **NATS → PG:** publish; assert issue/alert side effects; a republished id never creates a second issue or re-fires an alert (one-shot transitions; `event_count` drift is accepted).
4. **CH → API reads:** seed CH directly (client); assert events/metrics endpoints. No ingestion involved.
5. **Live feed:** nats client subscribes the way the browser does; publish; assert receipt (replaces `20-live-events`).
6. **SDK e2e (9 files):** the full path through a real SDK; any assertion that needs CH visibility uses `waitFor` (engine ingestion is asynchronous).

`21-nats-first`'s fallback cases disappear with the fallback removal; the file is rewritten into 1/3-style tests (`20-live-events` into 5).

## 9. Accepted consequences

- CH outage: ingestion unaffected (NATS buffers unacked messages); events/metrics reads 5xx; sweeper paused; PG side effects unaffected (separate consumer).
- NATS outage: ingestion 503; live feed down (same dependency); side effects stop.
- Live feed is browser→NATS: NATS becomes a browser-facing surface (dev open, prod token); payload is raw envelopes, not the trimmed live message.
- `fsync_after_insert` cost on the hot write path (accepted; correctness over throughput at this scale).
- Long CH outage grows NATS disk unboundedly (no stream limits) — consider `max_age` as a valve.
- Redelivery after a crash can double-increment `issues.event_count` (no ledger); alerts never double-fire.
- Test suite requires docker services (CI + local).

## 10. Batches (each: typecheck + full suite green, commit + push; stage only own files)

- [x] 0. Infra: NATS (JetStream + WebSocket, config file) in compose + CI + local docs; smoke passed (ClickHouse `latest` acked only after the MV insert — the engine gate is clear).
- [x] 0b. Test split: 11 in-process suites moved to `backend/tests/` (`app.handle`, no listen/port/stop); `e2e/` keeps the SDK + WebView + WebSocket files and the 4 files blocked by the parallel session's uncommitted work (see §8); `bootstrap()` superseded (tests import the app singleton); `waitFor` in `backend/tests/test-helpers.ts`; `bun run test` = `bun test --parallel=1 backend/tests/ e2e/`; AGENTS.md Testing section updated.
- [x] 1. CH ingests from NATS: engine tables + MVs + `fsync_*` + pull-consumer provisioning; `sentry_events` ReplacingMergeTree migration; API publish path (in-process fallback deleted); app consumer = PG side effects only (no ledger); `stored_events` + DAO deleted; events API CH-only; clear; hop tests 1–4.
- [x] 2. Live feed via NATS: delete `/events/live/feed` + `backend/live-events.ts` + `startLiveConsumer` + broadcast calls; frontend `nats.ws`; rewrite `20-live-events`/`21-nats-first` as hop test 5; `e2e/` shrinks to the 9 SDK files.
- [x] 3. Metrics ingest: `samples.ts` extraction at the API; `sentry.metrics` + CH tables/MVs; hop tests 1–2 for metrics.
- [x] 4. Metrics API (`series` + `breakdown`) + hop test 4.
- [x] 5. Sweeper → CH + alert tests.
- [x] 6. Frontend metrics panels (web + mobile vitals).
- [ ] 7. Remove remaining NATS fallbacks (releases/flags) + `isNatsConnected`/boolean `publishEvent`; sweep leftover CH availability branches.
  - Working tree (uncommitted): `publishFlagChangeEvent` throws when NATS is down (no silent skip, no swallow); `publishFlagChange` is async and maps a failed publish to `serviceUnavailable`; its call sites (`featureFlags` ×4, `experiments` ×2) await it; `startEventsConsumer`/`startReleasesConsumer` are awaited inside `initNats` so a consumer that cannot attach fails/retries the boot (never a silent stop); stale "in-process fallback" comment in `backend/tests/15` fixed.
  - Already gone (batches 1–2): `isNatsConnected`, boolean `publishEvent`, the in-process ingestion fallback.
  - CH availability sweep: none left — `events-store`/`metrics-store`/`/health` are strict; `withChRetry` retries transient sockets only; the sweeper's "log + skip tick" is decision §5/§9.
  - Remaining: full suite green (the parallel session's suite truncates CH mid-run → UI e2e flakes; verify when it is idle), commit + push (include the tracked `todo.metrics.md` ticks).
- [ ] 8. S3 required (rustfs in CI; delete local-dir path).
  - `backend/storage/index.ts`: delete `StorageBackend`, `activeStorageBackend`, `localStorageDir`, `resolveLocalObjectPath`, `putObjectLocal`, the local branches of `getObjectText`/`listObjectKeys`, and `storageRoutes` + the `/storage/*` mount; require the S3 config (boot-time check, fail fast like NATS/CH). The parallel session has uncommitted scope hunks in this file — their `/storage/*` scoping goes away with the route; stage only my hunks.
  - `backend/events/offload.ts`: S3-only comments; keep the 5s bounded best-effort inline behavior (the object store must never fail ingestion).
  - Tests: `backend/tests/28-replay-offload.test.ts` drops the `LOCAL_STORAGE_DIR` cases (keep the S3-stub ones); e2e `04-session-replay` and `29-replay-issue-view` must run against rustfs (`:9100`, bucket `sentry-replays`) — configure the S3 env for the e2e suite so no test depends on `./.storage`.
  - Config/docs: `.gitignore` `.storage` entry, BACKEND_API.md env table + §5.12/§9.5/§8, AGENTS.md storage landmine.
  - CI: rustfs joins the test job — which first has to exist (§11).

**Dropped across versions:** PG rollups/histograms, metrics read facade, measurement allowlist, PG `stored_events`, PG `processed_events` ledger (no event-derived state in PG at all), in-process ingestion fallback, local storage dir, app-side CH writer, backend WebSocket fanout and `/events/live/feed`.

## 11. What is missing (audit — 2026-10-18)

Beyond batches 7–8:

- **No CI test job exists.** `.github/workflows/` contains only `distroless-image.yml` and `source-maps.yml`; nothing runs `bun run test` with ClickHouse + NATS (rustfs after batch 8) or mounts `infra/nats-server.conf`. §7's CI item was ticked with batch 0, but the repo has no such workflow — add it (or document the external job), otherwise the "suite green" gate stays local-only (`docker compose up -d` prerequisite).
- **`BACKEND_API.md` sweep** (deferred: the file carries the parallel session's uncommitted hunks): it still documents removed surfaces (`/events/live/feed`, `stored_events`, `isNatsConnected`, `NATS_TEST_URL` + `e2e/21-nats-first.test.ts`, the local storage backend and `/storage/*`) and lacks the metrics endpoints (`series`/`breakdown`). Do it once the parallel work is committed.
- **`AGENTS.md` landmines**: the storage bullet still says "S3 when `S3_BUCKET` is set, otherwise the local `LOCAL_STORAGE_DIR`" and describes `GET /storage/<key>` — reword to S3-required after batch 8. The ClickHouse/events bullets are current.
- **Metrics read scope**: `/api/admin/metrics/series|breakdown` are live but admin-token-only and not in `SCOPED_READ_PATHS` (`backend/admin/index.ts`), so a scoped OIDC identity gets 401/403. Adding them (with `scopedViewFor(...)` filtering, 404 for out-of-scope details) belongs to the permissions work (`todos/issues.md` batch 6) — recorded here so it is not lost.
- **Plan text drift (minor):** §8's e2e inventory predates `e2e/33-performance-ui.test.ts` (new WebView file for the metrics panels; `20-live-events`/`21-nats-first` no longer exist).
- **Concurrent-session verification:** the final full-suite run must happen while the parallel session is idle — its `clear` tests truncate ClickHouse mid-run, which is what the two batch 4/5 full-suite failures were (`e2e/01-error-tracking-ui`, `e2e/23-backend-parity-ui`; both pass solo).

## 12. Status dump — done vs. missing (2026-10-18, session stopped)

### Done and pushed — `origin/master` = `865c218`

- **Batch 0** (`4680f4e`) — NATS (JetStream + WebSocket, `infra/nats-server.conf`) in `docker-compose.yml`; CH NATS-engine smoke gate cleared (ack only after the MV insert).
- **Batch 0b** (`1c52ddb`) — suite split: 11 API suites in `backend/tests/` via `app.handle`; `bun run test` = `bun test --parallel=1 backend/tests/ e2e/`.
- **Batch 1** (`aa6d5ec`) — ClickHouse ingests from NATS by configuration (engine tables, MVs, `fsync_*`, durable pull consumers); `sentry_events` ReplacingMergeTree migration; API publishes to NATS only (no in-process fallback); consumer = PG side effects only; `stored_events` deleted; events API CH-only; hop tests `40`–`43`.
- **Batch 2** (`8e2e2e6`) — live feed browser→NATS (`nats.ws`); `/events/live/feed`, `backend/live-events.ts`, `startLiveConsumer` and the backend fanout deleted; hop test `44`.
- **Batch 3** (`c05956b`) — metrics ingest: `backend/metrics/samples.ts`, `sentry.metrics` → `sentry_metrics`; hop test `45`.
- **Batch 4** (`ee337da`) — metrics read API `series` + `breakdown`; hop test `47`.
- **Batch 5** (`a3980df`) — sweeper over CH metric samples (`new_issue_count` stays on PG).
- **Batch 6** (`865c218`) — Performance page metrics-only (web + mobile vitals, `frontend/src/lib/metrics.ts`); `e2e/33-performance-ui.test.ts`.

### Done, NOT committed — batch 7 in the working tree

Tracked, unstaged:

- `backend/nats.ts` — `publishFlagChangeEvent` throws when NATS is down (no silent skip); `initNats` awaits `startEventsConsumer`/`startReleasesConsumer` (attach failure fails/retries boot).
- `backend/flags-events.ts` — `publishFlagChange` async; failed publish → `serviceUnavailable` (503).
- `backend/featureFlags/index.ts` (×4) + `backend/experiments/index.ts` (×2) — the call sites await it.
- `backend/events-consumer.ts`, `backend/releases-consumer.ts` — awaited startup; detached loops log on runtime stop.
- `backend/tests/15-releases.test.ts` — stale fallback comment removed.

Verified: `bun run typecheck` ✓; focused `backend/tests/11` + `14` + `15` + `42` = 59 pass / 1 fail (`backend/tests/42` 5s timeout under the parallel suite; passes solo). No commit/push was made — the session stopped here.

### Missing

- **Batch 7 finish:** one full-suite green run while the parallel session is idle, then commit + push (the 7 files above + this file).
- **Batch 8 (S3 required):** the sub-list above — storage local-dir removal + `/storage/*` route, boot-time S3 config check, `backend/tests/28` local cases, e2e S3 env (rustfs `:9100`, bucket `sentry-replays`), `.gitignore`/doc updates, rustfs in CI.
- **§11 audit items:** CI test job (does not exist), `BACKEND_API.md` sweep, `AGENTS.md` storage landmine, metrics read scope (`SCOPED_READ_PATHS`), plan-drift note.
- **Verification caveat:** no clean single-run full-suite verification exists for the current tree — the failed attempts were parallel-session contention (CH truncation), and the affected tests pass solo (§11).

_Session stopped on request — the working tree is the exact state left behind; only batches 0–6 are on the remote._
