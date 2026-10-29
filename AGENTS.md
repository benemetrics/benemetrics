# AGENTS.md

Agent operating rules for this repository. `docs/BACKEND_API.md` is the long-form reference; this file is the contract you MUST follow when writing or changing backend code.

**Architecture Reference Documents** (in `docs/`) — **GROUND TRUTH**

- [`models.md`](docs/models.md) — Project → Environment → App hierarchy, invariants, scoped reads
- [`metrics.md`](docs/metrics.md) — Metric taxonomy, NATS→ClickHouse pipeline, series/breakdown APIs, alerting integration
- [`source-maps.md`](docs/source-maps.md) — Artifact storage, upload tokens, VLQ symbolication, CLI surface
- [`feature-flags.md`](docs/feature-flags.md) — Global flags, evaluation priority, experiments (Wilson CI + z-test), 3 surfaces
- [`session-replays.md`](docs/session-replays.md) — rrweb offload, object-store backends, playback assembly
- [`alerting.md`](docs/alerting.md) — Alerting system (channels, rules, sweeper, incident model)
- [`issues.md`](docs/issues.md) — Issue tracking, fingerprinting, query protocol, scoped reads
- [`nats.md`](docs/nats.md) — NATS subjects, account/credential model, auth callout
- [`permission.md`](docs/permission.md) — Admin auth model, scoped reads, group rules + whitelist

**Enforcement:** The `docs/` documents are the **single source of architectural truth**.

- `AGENTS.md` and `docs/BACKEND_API.md` MUST be consistent with `docs/`.
- Any architectural decision not reflected in `docs/` is not binding.
- When changing architecture: update `docs/` FIRST, then `AGENTS.md`/`docs/BACKEND_API.md`.
- Code reviews MUST verify implementation matches `docs/` (not just `AGENTS.md`).

## Project

Lightweight Sentry backend. Bun + Elysia (HTTP) + ArkType (validation) + Drizzle ORM + NATS JetStream + ClickHouse + S3-compatible object store. Frontend consumes the exported `App` type via Eden Treaty. Entry point: `backend/index.ts`.

## Business rules

The domain hierarchy is strictly **Project → Environment (shared by apps)**. Do not flatten it.

- A **project** owns many **apps** (`apps.project_id`). Every app belongs to exactly one project.
- A **project** owns many **environments** (`environments.project_id`). Every environment belongs to exactly one project and is shared by all of its apps.
- An **app** is created inside an environment (`apps.environment_id`); the same environment may serve many apps.
- An environment `slug` MUST be unique within its project; the same slug MAY be reused across different projects.
- Every project MUST have exactly one default environment (`environments.is_default = 1`). Project creation auto-creates a default "testing" environment; the first environment created becomes the default; promoting another default demotes the previous one; deleting the default promotes the oldest remaining environment.
- Project creation MUST NOT create an app. Apps are created explicitly inside a chosen environment (`POST /api/admin/projects/:id/apps` with optional `environment` name).
- Deleting an app MUST NOT delete its environment (environments are shared); deleting a project cascades to its apps AND environments; deleting an environment cascades to the apps created inside it.
- Environments are exposed only under `/api/admin/environments/*` (admin-guarded); never expose them on an unauthenticated surface.
- **Feature flags are scoped to a project** — optionally narrowed to one of its apps (`project_id` + `app_id`); the narrower flag wins by key.
- **Experiments** layer on flags: sticky assignment, metric tracking, statistical analysis (Wilson CI + z-test).

## Commands

```bash
bun run dev        # hot-reload server
bun run start      # run server
bun run consumer   # standalone NATS consumer binary (stream/consumers + Postgres side effects)
bun run typecheck  # bun check — MUST pass
bun run test       # bun test --parallel=1 backend/tests/ e2e/ — MUST pass (generates the e2e identity provider's certificate first)
```

Before finishing any task: run `bun run typecheck` and `bun run test`. Never leave type errors.

## Architecture — mandatory layering

```
Route handler (backend/<domain>/index.ts)  ->  DAO (db/dao/*)  ->  Drizzle
```

- MUST keep handlers free of `drizzle-orm` imports and direct `db.*` calls.
- MUST keep DAOs free of HTTP concerns (exception: throwing the typed errors from `backend/errors.ts`).
- MUST add a new domain as `backend/<domain>/index.ts` exporting `new Elysia({ prefix })`, then register it in `backend/routes.ts`.
- MUST keep `backend/index.ts` thin: bootstrap, global `onError`, external clients only. There is no health endpoint — the UI's health signal is the live feed's NATS WebSocket connection.
- MUST group the routes of a domain file by credential surface — **public** (no credential), **dsn** (the SDK public key) and **oidc** (the admin token or a provider identity). Each surface is its own Elysia instance; the oidc groups resolve the identity, the others carry no admin check.
- MUST keep the admin surface under `/api/admin/*`; do NOT add a second top-level surface.
- NEVER add unrelated routes to an existing domain file.

## Pipeline Architecture (NATS-First)

```
Ingest Handler → NATS (sentry.events.<appNumber>, sentry.metrics)
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
   ClickHouse (engine          Side-effects Consumer
    tables + MVs)              (Postgres only)
         │                       │
         ▼                       ▼
   Events/Metrics              Issues, Alerts,
   Storage                     Releases
```

- **NATS required** — no availability branches, no in-process fallback. Boot retries, then fails fast.
- **Events are subject-sharded per app** — the API edge resolves the app before publishing and emits to `sentry.events.<appNumber>` (`apps.number`, the DSN path integer). The stream declares `sentry.events.*`; every `sentry.events` consumer filters `sentry.events.*`. A publish without the app token fails at the server.
- **NATS auth callout** — every connection that is not a config user is routed to the backend (the auth service) over `$SYS.REQ.USER.AUTH`; it verifies the presented credential (Keycloak JWT or master admin token) and answers with a signed, **sub-only**, per-app user claim (`sentry.events.<appNumber>` of the scope). No reply = denied. See `docs/nats.md`.
- **ClickHouse ingests by configuration** — `ENGINE = NATS` + durable JetStream pull consumer + Materialized View. Ack after MV insert; redelivery on failure.
- **Idempotent writes** — `ReplacingMergeTree` + `FINAL` reads; duplicates collapse.
- **Side-effects consumer = Postgres only** — its own binary (`backend/consumer.ts`, `bun run consumer`); it reads the `sentry.events.*` subjects from the `SENTRIES` stream through the `side-effects` durable pull consumer, so an event published while it is down is not lost. Applies issue tracking, alert triggers, and release tracking; never inserts rows into ClickHouse. The shared `backend/nats.ts` provisions the stream and the durable pull consumers, so both processes may start in either order.
- **Live feed = browser → NATS WebSocket** — no backend fanout, no `/events/live/feed`. The CONNECT carries the credential (`auth_token`); the callout's sub-only claim makes the feed honor the permission scope.
- **Object store = S3-required** — replay segments offloaded at ingestion; local dev uses RustFS. Backend never recorded in pointer; reads resolve at read time.

## Validation

- MUST declare a schema for every route input (`body`, `query`, `params`).
- Undeclared keys are dropped by the global ArkType config (`backend/arktype-config.ts`, imported first by
  `backend/index.ts`) — a validated body's undeclared keys can never reach a DAO, so spreading the body
  into DAO args is safe. The one exception: the alerting rule union declares per-node
  `onUndeclaredKey: "reject"` to discriminate its arms.
- MUST import consistently: `import { type as arktype } from "arktype"` (do not mix with Elysia's `t`/`type`).
- MUST validate UUIDs as `"string.uuid"` and enums as literals (e.g. `"'draft' | 'active'"`).
- NEVER trust unvalidated client input; do not replace schema validation with ad-hoc `if` checks.

## Types

- `backend/protocol/` is the single source of truth for domain/protocol types.
- NEVER add duplicate type files or module-local `*.ts` interface files; shared domain/protocol types belong in `backend/protocol/`.
- MUST use Drizzle inferred types (`$inferSelect` / `$inferInsert`) for DAO signatures.

## Database

- MUST generate IDs with `crypto.randomUUID()` in the handler or DAO; NEVER rely on a DB default for text PKs.
- MUST store timestamps in `timestamptz` columns (`db/schema/timestamps.ts` → `isoTimestamp`); the application reads and writes them as ISO-8601 UTC strings, so the API contract is unchanged. NEVER mix `Date` objects, ISO strings, and SQL `CURRENT_TIMESTAMP` in one column.
- MUST `JSON.stringify` JSON columns (`variants`, `targetingRules`, `segments`, `rules`, `experiment`, `envelopeHeader`, `envelopeItems`) on write and `JSON.parse` on read with a safe fallback.
- MUST implement DAO methods with the standard names: `create`, `findById`, `findByX`, `findByIdOrThrow`, `list`, `updateOrThrow`, `delete`.
- MUST cursor-paginate list endpoints and return `{ data }` (query `cursor`/`limit`; NEVER `page`/offset, never totals). A caller detects "more" by a full page.
- MUST make uniqueness race-safe at the database level: resolve conflicts with unique indexes + `onConflictDoNothing`/`onConflictDoUpdate` (or map `uniqueViolationConstraint` to `conflict(...)`); NEVER find-then-insert to pre-check a conflict.
- MUST route schema changes through Drizzle: `bunx drizzle-kit generate` (pinned to the same RC as `drizzle-orm`) writes `db/migrations/*`, which are applied at startup; NEVER hand-write DDL or invent new ClickHouse DDL in app code.

## Errors & responses

- MUST throw errors from `backend/errors.ts` (`notFound`, `badRequest`, `unauthorized`, `forbidden`, `conflict`, `payloadTooLarge`, `internalError`); the root Elysia `onError` maps them to the HTTP status and `{ error }` body. NEVER `throw status(...)` or return `{ error }` with HTTP 200.
- MUST throw `notFound("<Entity>", id)` for missing records (use `*OrThrow`); handlers and DAOs never import `elysia` for responses.
- MUST make `DELETE` idempotent: deleting an already-deleted resource answers success, never `404`. A `findByIdOrThrow` on a delete route is wrong — the resource may already be gone. Look the row up only for a state guard (e.g. "only draft flags can be deleted"), and treat a missing row as success.
- MUST log details server-side and return generic client errors; NEVER leak stack traces.
- MUST remove `console.log("[DEBUG] ...")` before committing; gate any diagnostic log behind an env flag.
- NEVER ship fabricated/mock data (e.g. random `userCount`, hardcoded `sampleUsers`); return `null` and document instead.

## Auth

- MUST check admin credentials in ONE place: `resolveIdentity` (`backend/auth.ts`) — `API-Key` compared in constant time against the admin token, or `Bearer <provider JWT>` verified with `jose` against the provider's JWKS, fail closed. The two credentials never share a header. It resolves to **an id** (`local-admin`, or `<issuer>-<subject>`); every oidc route group resolves it through `resolveAdminId` and reads `adminId`. An id is all the admin surface needs — do NOT build a user profile. The DSN/source-map-upload auth (`validateAuth`/`validateUploadAuth`) stays separate.
- MUST guard `/api/admin/*` with admin auth (fail closed): the admin token is an `API-Key`, a provider identity is a `Bearer` token.
- Token model: the admin token is the **master/fallback credential** and is always accepted (it is what the UI prompts for when no grant applies); with OIDC/OAuth2 configured a verified provider JWT is an _additional_ identity. The token is generated at boot and held **only as its `Bun.password` hash** (argon2id) in global Elysia state (`backend/index.ts`) — the plaintext never persists; requests present it under `API-Key` and the check is `Bun.password.verify`. It rotates daily at 00:00 UTC by the Elysia cron in the same file — no env var, no file, no HTTP surface for it. Tests pin it by writing the fixture hash to `app.store.adminTokenHash` (Bun suites); production code carries no test hook. `/api/admin/*` rejects every request without a credential. NEVER reintroduce built-in dev/test tokens, prefix/length bypasses, env/file configuration of the token, or "provider configured ⇒ admin token ignored".
- Browser login is the standard authorization-code + PKCE flow run by the SPA with `openid-client`. The public OIDC settings (`OIDC_ISSUER`/`OAUTH_ISSUER`, `OIDC_CLIENT_ID`/`OAUTH_CLIENT_ID`, `OIDC_SCOPES`, `OIDC_ALLOW_INSECURE_HTTP`) are compiled into the bundle at startup via `frontend/auth-env-plugin.ts` (it replaces `frontend/src/lib/auth-env.ts`); there is no auth config endpoint, and only those public names may cross into frontend code. The ID token is stored as the SPA's bearer credential and verified server-side like any provider JWT; the backend never handles the authorization code and there is no client secret in the browser (state + PKCE only — no nonce). A failed exchange falls back to the admin-token prompt for the session.
- JWT verification uses `jose` (the provider's discovery document resolves the JWKS; `jwtVerify` with the audience `OIDC_CLIENT_ID`/`OAUTH_CLIENT_ID` and the issuer `OIDC_ISSUER`, trailing slash normalized) and MUST fail closed; never log tokens. The `azp` claim must be the client id. The provider is discovered **once at boot**: without `OIDC_ISSUER` + `OIDC_CLIENT_ID` no provider JWT is accepted. A plain-HTTP issuer needs the explicit `OIDC_ALLOW_INSECURE_HTTP=true` opt-in — **HTTPS is the recommendation**, and the opt-in only relaxes the discovery, never the signature, audience or issuer check.
- Read permissions (`backend/permissions/engine.ts`): a verified identity's scope is the union of the enabled group rules matching its `groups`; an enabled grant for the identity id replaces the group assignment. Scope = environment **names** + app **name prefixes** expanded into visible apps/environments/projects. No matching grant → `401` with `NO_READ_PERMISSION_MESSAGE` (the UI then prompts for the admin token).
- Scoped identities are read-only: only the allowlisted GETs of the oidc surface (`isScopedReadPath`, `backend/permissions/engine.ts`) plus the guarded UI surfaces. MUST filter every scoped read with `scopedViewFor(...)` and answer `404` for out-of-scope details; everything else is `403`. The UI learns the state from `GET /api/admin/session` — it never guesses it from the token.
- Permission management is admin-token-only (`/api/admin/permissions/*`, Settings → Permissions). Group names and identity ids are stored/matched lowercased (unique indexes); scope lists are JSON text columns. Every change is recorded in the audit trail (`permission_audit`, `GET /api/admin/permissions/audit`).
- The UI surface (`/events/*`) resolves the same identity on every request — there is no open/dev mode. Replay reads live under `/api/admin/*` and take the same oidc guard.
- NEVER log or hardcode secrets/keys; tests pin the admin token via `app.store.adminToken` in the test helpers (`backend/tests/test-helpers.ts`, `e2e/test-helpers.ts`).

## Ingestion

- **NATS-first, always**: handlers publish via `dispatchIngestedEvent`; a broker failure answers `503` (`serviceUnavailable`) — there is no in-process fallback. The standalone `backend/consumer.ts` binary applies the Postgres side effects (issues, alerts, releases) from the `side-effects` durable pull consumer; ClickHouse ingests `sentry.events`/`sentry.metrics` itself (NATS engine tables + materialized views, ack after the insert). Event payloads and metric samples never land in Postgres.
- **MUST NOT auto-provision** projects/apps/DSNs during ingestion. Unknown ingest key/project or a `sentry_key` that does not match the resolved app → `401`, no writes.
- **MUST keep ingestion idempotent**: duplicate `event_id` inserts are ignored via `onConflictDoNothing` (retries must not 500).
- App resolution order in `resolveApp`: app number (path, DSN) → ingest key (path) → project id (path) + matching public key → public key alone (Sentry SDKs require numeric DSN project ids).
- **Metric extraction at API edge**: `backend/metrics/samples.ts` parses envelope once, publishes both `sentry.events.<appNumber>` and `sentry.metrics`. SQL-side extraction rejected.

## Testing

- MUST add or update a test for any new endpoint. API tests run in-process via `app.handle` under `backend/tests/` (pattern: `backend/tests/12-projects-apps.test.ts`; helpers in `backend/tests/test-helpers.ts`); suites that need a real HTTP listener or a browser — SDK-driven, WebView UI — stay in `e2e/` (OIDC + permissions pattern: `e2e/35-oidc.test.ts` + `e2e/38-permissions-ui.test.ts`; SPA OIDC login: `e2e/37-oidc-login.test.ts`).
- E2E tests boot the real app against in-memory PGlite; `e2e/preload.ts` (registered in `bunfig.toml`) closes the embedded client after each file, and new test files inherit this automatically.
- NEVER rely on manual curl for DSN/ingestion/auth verification.
- **Hop tests** — each pipeline stage tested independently:
  1. ingest → NATS
  2. NATS → ClickHouse
  3. NATS → Postgres (side effects)
  4. ClickHouse → API reads
  5. Live feed (browser → NATS)
  6. SDK E2E (full path)

## Hygiene

- NEVER commit `.tmp` files, commented-out dead code, or duplicate files; delete unused code.
- MUST follow naming: plural kebab-case route prefixes (`feature-flags`), `index.ts` per module, DAO methods per above.
- MUST read from env for hosts/ports; NEVER hardcode `localhost` outside dev.
- **Code comments MUST be minimal**: one short line explaining a non-obvious _why_ (a race, a constraint, a surprising invariant). NEVER restate what the code says, never narrate the change, and never cite `docs/` sections in a comment — the docs are the reference, not the code. If a comment needs more than two lines, the code is too clever or belongs in the doc.

## Known landmines (do not reproduce; fix if touched)

- **Postgres everywhere**: dev/test run in-process PGlite, production runs real Postgres via `drizzle-orm/bun-sql`. Same dialect, same `db/schema`, same `db/migrations` (applied at startup by `db/index.ts`) — never reintroduce a second dialect or hand-maintained DDL.
- **Raw counts**: must use `db.$count(...)` or cast `count(*)::int`: Bun SQL returns `int8` values outside i32 range as `BigInt` while PGlite returns `number`. Report deleted rows via `.returning()` + `.length`, never driver-specific `rowCount`/`changes`.
- **Sentry SDKs require numeric DSN project id**: the app DSN path is the DB-generated `apps.number`; `resolveApp` resolves it via `findByNumber` and keeps the ingest-key / project-id + public-key fallback. Keep that fallback when changing ingestion routing.
- **App DSNs are always `http://`** (the backend serves plain HTTP; TLS is a reverse-proxy concern). NEVER derive `https` from the host name — the wrong scheme makes SDKs fail the TLS handshake.
- **The app DSN is derived, never stored**: the API returns the ingredients (`publicKey` + `number`) and the caller composes `http://<publicKey>@<host>/<apps.number>` for the origin it reached (`frontend/src/lib/api.ts` → `appDsn`). The admin app responses MUST NOT carry a DSN or a host — the backend knows neither.
- **ClickHouse is the events store**: it ingests `sentry.events.*`/`sentry.metrics` from JetStream by configuration (NATS engine tables + materialized views, ack after the insert) and the events API list/get reads it directly (`backend/events-store.ts`, `SELECT … FINAL`) — there is no Postgres fallback. Postgres stays the control-plane source of truth; keep ClickHouse paths retry-tolerant (`backend/retry.ts`) but never reintroduce an app-side event store. The events table declares a retention TTL (`TTL toDateTime(receivedAt) + toIntervalMonth(1)`, one month by default); the admin reads the live value back from the table definition and changes it under Settings → Event retention (`GET`/`PUT /api/admin/settings/events-ttl`, admin-token-only). Boot only seeds the default when the table has no TTL — never overwrite an admin change.
- **Replay recording segments never sit in Postgres**: at ingestion (`backend/events/offload.ts`) each `replay_recording` payload is written to the S3-compatible object store (`backend/storage.ts` → `s3`; RustFS locally via the same `S3_*` config) and the envelope item keeps just the object key (`{ key }`). The backend is never recorded in the pointer: reads resolve keys against the storage configuration active at read time, so switching object stores means migrating the objects with them. Segment keys embed the segment start time, so the read path lists a session's keys in playback order and returns **presigned S3 URLs** (`GET /api/admin/events/:eventId/replay/:replayId`, paginated by `cursor`) — the browser fetches the bytes directly; never proxy recording payloads through the API. The offload runs before the NATS publish and is best-effort — a failed or timed-out write keeps the payload inline. NEVER fail, delay past the bound, or lose ingestion because of the object store.
- **Ingest request hygiene**: every ingestion request is bounded before the expensive work — the declared body size, the decompressed size (a gzip bomb is invisible to the proxy), the item/span counts and the server-wide body cap (`backend/ratelimit/hygiene.ts`, the knobs in `backend/ratelimit/config.ts`). Over the cap is a `413`; a request is never parsed, offloaded or published after it is rejected. These are **caps, not quotas** — the rate limits (per source, per app) are the reverse proxy's job.
- **A retried event id is answered without the work**: the id is the idempotency key — a recently seen id skips the object-store write and the publish (`wasRecentlyIngested`/`markIngested`, `backend/events/ingestion.ts`). The JetStream stream's disk is bounded (`NATS_STREAM_MAX_BYTES`, 1 GiB) so a flood fills the stream and the publish answers `503` instead of growing the disk — the SDK's retry carries the backpressure back to the sender.
- **Issue state** (`issues` table, unique per `(app_id, fingerprint)`) lives in Postgres and drives the `new_issue`/`regression` alert triggers **event-driven at ingestion** (`processIngestedEvent` → `backend/issues/tracking.ts`), with race-safe transitions (`onConflictDoNothing`, `WHERE status = 'resolved'`). NEVER move issue detection into the metric sweeper — the sweeper evaluates `threshold` rules only, and re-running transitions would re-fire one-shot alerts. Resolve via `PATCH /api/admin/issues/:id`; the resolve flips the status that the regression trigger watches.
- **Feature flags are scoped** — `feature_flags` carries `project_id` (required for a new flag) and `app_id` (optional); the key is unique per scope.
- **`fsync_after_insert` + `fsync_part_directory`** on ClickHouse target tables: without them, an acknowledged (inserted) batch can still be lost on a page-cache loss (power/VM reset); with them the ack is honest.
- **Long ClickHouse outage grows NATS disk unboundedly** (no stream limits) — consider `max_age` as a valve.
- **Redelivery after a crash can double-increment `issues.event_count`** (no ledger); alerts never double-fire.
- **Test suite requires docker services** (CI + local): Postgres, ClickHouse, NATS, RustFS. NATS runs with the auth callout enabled in every environment (dev replicates prod): internal connections authenticate with the config users (`NATS_AUTH_USER`/`NATS_AUTH_PASSWORD`), and any test driving a browser-style connection presents a real credential — the callout has no dev bypass.

For full endpoint tables, schema columns, and rationale, see `docs/BACKEND_API.md`.
