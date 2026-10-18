# Backend API & Data-Layer Guide

> Audience: backend engineers (including juniors) working in `backend/` and `db/`.
> Goal: explain how the API is structured, how the database is organized, and the rules we follow so new code looks like it was written by the same person.

**Architecture Reference Documents** (in `docs/`) — **GROUND TRUTH**
- [`models.md`](docs/models.md) — Project → Environment → App hierarchy, invariants, scoped reads
- [`metrics.md`](docs/metrics.md) — Metric taxonomy, NATS→ClickHouse pipeline, series/breakdown APIs, alerting integration
- [`source-maps.md`](docs/source-maps.md) — Artifact storage, upload tokens, VLQ symbolication, CLI surface
- [`feature-flags.md`](docs/feature-flags.md) — Global flags, evaluation priority, experiments (Wilson CI + z-test), 3 surfaces
- [`session-replays.md`](docs/session-replays.md) — rrweb offload, object-store backends, playback assembly
- [`alerting.md`](docs/alerting.md) — Alerting system (channels, rules, sweeper, incident model)
- [`issues.md`](docs/issues.md) — Issue tracking, fingerprinting, query protocol, scoped reads
- [`permission.md`](docs/permission.md) — Admin auth model, scoped reads, group rules + whitelist

**Enforcement:** The `docs/` documents are the **single source of architectural truth**. This document MUST be consistent with `docs/`. When changing architecture: update `docs/` FIRST, then this document.

---

## 1. Stack at a Glance

| Concern | Choice |
|---------|--------|
| Runtime | **Bun** (`bun run backend/index.ts`) |
| HTTP Framework | **Elysia v1.x** (`elysia`) |
| Validation | **ArkType** (`arktype`) — via `import { type as arktype } from "arktype"` |
| ORM | **Drizzle ORM** (`drizzle-orm/pg-core`, `drizzle-orm/bun-sql`) |
| Default DB (dev) | **PGlite** (Postgres in WASM, file-backed `./.pglite`) |
| Test DB | In-memory **PGlite** when `NODE_ENV=test` |
| Production DB | **PostgreSQL** when `DATABASE_URL` is set (`drizzle-orm/bun-sql`) |
| Migrations | `drizzle-kit` → `db/migrations/*`, applied at startup |
| Messaging | **NATS JetStream** (required) — `sentry.events`, `sentry.metrics` subjects on `SENTRIES` stream |
| Analytics Store | **ClickHouse** (required) — `sentry_events`, `sentry_metrics` via NATS engine tables + MVs |
| Object Store | **S3-compatible** (required) — `S3_BUCKET` for replay segments; RustFS in dev (`:9100`) |
| Frontend Client | Eden Treaty (`@elysiajs/eden`) consumes exported `App` type |

**Entry point:** `backend/index.ts` (exports Elysia `app` for tests, listens on start).

---

## 1.1 Business Rules (Invariants)

The domain hierarchy is strictly **Project → Environment (shared by apps)**. It MUST NOT be flattened.

- A **project** owns many **apps** (`apps.project_id`); every app belongs to exactly one project.
- A **project** owns many **environments** (`environments.project_id`); every environment belongs to exactly one project and is shared by all of its apps.
- An **app** is created inside an environment (`apps.environment_id`); the same environment may serve many apps.
- An environment **slug** is unique within its project; the same slug MAY be reused across different projects.
- Every project has **exactly one default environment** (`environments.is_default = 1`):
  - Project creation auto-creates a default "testing" environment (and no app).
  - The first environment created becomes the default.
  - Promoting another environment to default demotes the previous default.
  - Deleting the default promotes the oldest remaining environment.
- Deleting an **app** MUST NOT delete its environments (they are shared); deleting a **project** cascades to its apps AND environments; deleting an **environment** cascades to the apps created inside it.
- Environments are admin-only: exposed exclusively via `/api/admin/environments/*`.
- **Feature flags are global** — not scoped to project/environment/app.
- **Experiments** layer on flags: sticky assignment, metric tracking, statistical analysis (Wilson CI + z-test).

---

## 2. Runtime Configuration

| Env Var | Default | Purpose |
|---------|---------|---------|
| `PORT` | `31337` | HTTP server port |
| `NODE_ENV` | – | `test` ⇒ in-memory PGlite |
| `DATABASE_URL` | – | If set ⇒ PostgreSQL (production) |
| `NATS_SERVERS` | `nats://localhost:4222` | JetStream connection |
| `NATS_STREAM` | `SENTRIES` | NATS stream name |
| `CLICKHOUSE_HOST` | `localhost` | ClickHouse HTTP host |
| `CLICKHOUSE_PORT` | `8123` | ClickHouse HTTP port |
| `CLICKHOUSE_DATABASE` | `default` | ClickHouse database |
| `CLICKHOUSE_USER` | `default` | ClickHouse HTTP user |
| `CLICKHOUSE_PASSWORD` | – | ClickHouse HTTP password |
| `S3_BUCKET` | – | **Required** — S3 bucket for replay segments |
| `S3_ENDPOINT` | – | S3-compatible endpoint (RustFS, R2, …; `AWS_ENDPOINT` fallback) |
| `S3_REGION` | `us-east-1` | S3 region (`AWS_REGION` fallback) |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_SESSION_TOKEN` | – | S3 credentials (`AWS_*` fallbacks honored) |
| `ALERT_EVALUATION_INTERVAL_MS` | `60000` | Alert rule sweeper interval |
| `ADMIN_TOKEN` | – | Master admin bearer token — always accepted; fails closed when unset and no provider configured |
| `OIDC_ISSUER`, `OAUTH_ISSUER` | – | Identity provider issuer (discovery base): enables JWT verification and forces admin guard on `/events/*` + `/storage/*` + `/replays/*` |
| `OIDC_JWKS_URL` | – | Optional JWKS override (skips OIDC discovery) |
| `OIDC_AUDIENCE`, `OIDC_CLIENT_ID`, `OAUTH_CLIENT_ID` | – | Expected `aud` claim (checked when set) |
| `OIDC_EMAIL_CLAIM`, `OIDC_GROUPS_CLAIM`, `OIDC_NAME_CLAIM` | `email`, `groups`, `name` | Claim mapping for verified identity |

**DB Selection Logic** (`db/index.ts`): `NODE_ENV=test` → in-memory PGlite; else `DATABASE_URL` present → Postgres (Bun SQL); else file-backed PGlite in `./.pglite`. Committed migrations in `db/migrations` applied at startup (idempotent, tracked in `drizzle.__drizzle_migrations`).

**Docker Compose** provides: Postgres 17 (`:5432`), ClickHouse (`:8123`, `:9000`), RustFS (`:9100` S3 API, `:9101` console — `rustfsadmin`/`rustfsadmin`; `sentry-replays` bucket created by `rustfs-init`), NATS (`:4222` + WS `:4223`).

**Package Scripts:**
```bash
bun run dev        # bun --hot backend/index.ts
bun run start      # bun backend/index.ts
bun run test       # bun test --parallel=1 tests/ e2e/
bun run typecheck  # bun check
```

---

## 3. Directory Layout

```
backend/
  index.ts                 # App bootstrap: health, module registration, NATS/CH init, alert sweeper, error handler
  auth.ts                  # validateAuth (DSN) + validateAdminAuth/validateAdminToken + adminAuthEnforced
  oidc.ts                  # JWT verification: discovery → JWKS → WebCrypto signature → claims
  permissions.ts           # Read-permission engine: scope resolution → scoped view, guards, request cache
  errors.ts                # ApiError + ErrorCode: thrown by routes/DAOs, mapped by root onError
  nats.ts                  # JetStream publish + consumer wiring (durable pull consumers for CH)
  events-consumer.ts       # Side-effects consumer: issue tracking, alert triggers, clear
  events-store.ts          # Events/Metrics reads: ClickHouse only (SELECT … FINAL)
  metrics-store.ts         # Metrics reads: ClickHouse only (quantile, toStartOfInterval)
  clickhouse.ts            # ClickHouse client + initClickHouse (engine tables + MVs)
  metrics/
    samples.ts             # Envelope → metric samples extraction (parseEnvelope + normalizeTransactionPayload)
  storage/
    index.ts               # Object storage: S3 (required) + putObject/getObjectText/listObjectKeys
  replays/
    index.ts               # replayRoutes (/replays/by-event/:eventId) — assemble segments from object store
  featureFlags/
    index.ts               # featureFlagRoutes (/api/admin/feature-flags/*) — CRUD + lifecycle
  evaluation/
    index.ts               # evaluationRoutes (/api/sentry/flags/evaluate, /experiment/track, /stream)
  flags-v1/
    index.ts               # flagsV1Routes (/v1/flags/:key) — OpenFeature-compatible
  source-maps/
    resolver.ts            # VLQ symbolication + bounded decoded-mappings cache
    serialization.ts       # Artifact row → response mapping
  alerting/
    index.ts               # alertingRoutes (/api/admin/alerting/*) — channels, rules, incidents, test
    notifiers.ts           # Uniform Notifier interface + webhook/slack/rocketchat/email + dispatcher
    resolver.ts            # Global → per-app config resolution (per-name override)
    evaluation.ts          # Metric computation, threshold engine, cooldown, sweeper + issue-trigger firing
    serialize.ts           # JSON column parsing + row → protocol mappers
  issues/
    tracking.ts            # Ingestion-time issue state transitions (new issue / regression)
  admin/
    index.ts               # adminRoutes (/api/admin) — access derive + fail-closed guard + scoped read allowlist
    projects/index.ts      # projectRoutes, appRoutes (project + app management)
    permissions/index.ts   # permissionRoutes (/api/admin/permissions/*) — group rules + user whitelist
    segments/index.ts      # segmentRoutes (audience segments)
    environments/index.ts  # environmentRoutes (project environments, shared by apps)
    releases/index.ts      # releaseRoutes + computeIssueMetrics (pure)
    issues/index.ts        # issueRoutes (/api/admin/issues/*) — list/get/resolve
    settings/index.ts      # settingsRoutes (/api/admin/settings/events-ttl)
  protocol/                # Type-only interfaces (source of truth)
```

---

## 4. Request Flow

1. Bun starts `backend/index.ts`.
2. `new Elysia()` registers in order: `/health`, then `.use(...)` of each route module.
3. Route handler receives Elysia context (`{ body, query, params, request, set, status }`).
4. Input validated by route's `body` / `query` / `params` schema (ArkType).
5. Handler calls **DAO** from `db/dao/*` — handlers **never** touch Drizzle directly.
6. DAO runs Drizzle query, returns row (or throws `ApiError` from `backend/errors.ts`).
7. Handler shapes HTTP response; errors bubble to global `onError` → maps `ApiError` to HTTP status + `{ error }`, falls back to 500.

**Module Registration** (`backend/index.ts`):
```ts
const app = new Elysia()
  .get("/health", () => ({ status: "ok" }))
  .use(eventsRoutes)        // prefix "events"
  .use(ingestionRoutes)     // prefix "api"
  .use(featureFlagRoutes)   // prefix "feature-flags"
  .use(evaluationRoutes)    // prefix "api/sentry/flags"
  .use(flagsV1Routes)       // prefix "v1/flags"
  .use(adminRoutes)         // prefix "/api/admin"
  .onError(({ code, error, set }) => {
    if (error instanceof ApiError) {
      set.status = error.httpStatus;
      return { error: error.message };
    }
    console.error(`[${code}] ${error.message}`);
    set.status = 500;
    return { error: "Internal Server Error" };
  });
```

> Elysia composes prefixes: `adminRoutes` has prefix `/api/admin` and internally `.use(projectRoutes)` (prefix `projects`), producing `/api/admin/projects/*`.

---

## 5. API Reference

### 5.1 System

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/health` | Liveness probe (no data access) | none |

### 5.2 Events API (ClickHouse Only)

Prefix: `/events` — `backend/events/index.ts` → `eventsRoutes`

| Method | Path | Query | Description |
|--------|------|-------|-------------|
| `GET` | `/events/` | `page`, `limit`, `projectId`, `environmentId`, `appId` | List events from ClickHouse (`SELECT … FINAL`), envelope → UI shape |
| `GET` | `/events/:eventId` | – | Fetch one event (parsed envelope item) |
| `POST` | `/events/clear` | – | Truncate ClickHouse `sentry_events` + `sentry_metrics` + clear Postgres `issues` |

**Auth:** Once `adminAuthEnforced()` is true (production, `ADMIN_TOKEN` set, or OIDC/OAuth configured), requires admin bearer token or read-granted provider JWT. Scoped identities only read events of their visible apps.

### 5.3 Ingestion (SDK → Server)

Prefix: `/api` — `backend/events/index.ts` → `ingestionRoutes`

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/:projectId/envelope/` | Sentry **envelope** ingestion. Handles `gzip` (`Content-Encoding`). |
| `POST` | `/api/:projectId/store/` | Legacy single-JSON event ingestion (`{ event_id, ... }`). |

**App Resolution Order** (`resolveApp`):
1. App number (DSN path, `/api/123/envelope/`)
2. Ingest key (path)
3. Project ID (path) + matching public key
4. Public key alone (fallback for older DSNs)

**Validation:** `sentry_key` query param or `X-Sentry-Auth` header must match resolved app's `publicKey`. Unknown apps or mismatched keys ⇒ `401`. Apps **never** auto-provisioned during ingestion. Duplicate `event_id` ignored via `onConflictDoNothing` (idempotent retries).

**Pipeline:**
1. Parse envelope → extract metric samples (`backend/metrics/samples.ts`)
2. Publish `sentry.events` (envelope) + `sentry.metrics` (JSONEachRow samples) to NATS
3. NATS publish failure → `503` (`serviceUnavailable`) — **no in-process fallback**

### 5.4 DSNs

- **Per app**, not per project: `POST /api/admin/projects/:id/apps` creates app + DSN; every apps response carries `dsn`.
- Format: `http://<public-key>@<host>/<app-number>` — **always `http://`** (backend serves plain HTTP; TLS is reverse-proxy concern). Host derived at read time: `X-Forwarded-Host` → `Host` header.
- No separate DSN management endpoint.

### 5.5 Metrics API (ClickHouse Only)

Prefix: `/api/admin/metrics` — `backend/metrics/index.ts` → `metricsRoutes`

| Method | Path | Query | Response |
|--------|------|-------|----------|
| `GET` | `/metrics/series` | `metric`, `projectId\|environmentId\|appId`, `from`, `to`, `stepSeconds?` | `{ metric, unit, points: [{ bucketStart, count, mean, p50, p95, p99 }] }` |
| `GET` | `/metrics/breakdown` | `metric=duration`, `projectId\|environmentId\|appId`, `from`, `to`, `limit?` | `{ data: [{ dimension, count, mean, p50, p95 }] }` |

**Implementation:**
- `series`: `toStartOfInterval` + `quantile()` in ClickHouse; auto step ≤6h→1m, ≤48h→5m, else 1h.
- `breakdown`: Top-N dimensions by count for metric/window.
- **Admin-token only** — scoped identities rejected (not in `SCOPED_READ_PATHS`).

### 5.6 Feature Flags — CRUD (Admin-Token Only)

Prefix: `/api/admin/feature-flags` — `backend/featureFlags/index.ts` → `featureFlagRoutes`

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/feature-flags/` | Flag definition (see schema) | Create flag (status `draft`) |
| `GET` | `/feature-flags/` | `page,limit,status,type,search` | Paginated list |
| `GET` | `/feature-flags/:id` | `id` (uuid) | Get one |
| `PATCH` | `/feature-flags/:id` | Partial flag | Update fields |
| `POST` | `/feature-flags/:id/status` | `{ status }` (`draft\|active\|paused\|archived`) | Change lifecycle status |
| `DELETE` | `/feature-flags/:id` | `id` (uuid) | Delete — **draft only** |

**Create Body (ArkType):**
```ts
{
  key: string,
  name: string,
  description?: string,
  type: "boolean" | "string" | "number" | "json",
  defaultValue: string | number | boolean,
  variants?: Array<{ key, name, value, weight }>,
  targetingRules?: Array<{ attribute, operator, value, variantKey? }>,
  segments?: string[],
  experiment?: ExperimentConfig | null,
  rolloutPercentage?: number
}
```
**Defaults:** `boolean` type → `control`/`treatment` 50/50; else single `default` variant at 100%.

### 5.7 Feature Flags — Evaluation Surfaces

| Surface | Prefix | Handler | Wire Format |
|---------|--------|---------|-------------|
| Batched (Sentry) | `/api/sentry/flags` | `evaluationRoutes` | `POST /evaluate { user, context?, flags[] }` → `{ evaluations[] }` |
| Experiment Tracking | `/api/sentry/flags` | `evaluationRoutes` | `POST /experiment/track { flagKey, userId, metric, value? }` |
| SSE Push Stream | `/api/sentry/flags` | `flagsStreamRoutes` | `GET /stream?flags=key1,key2` → `snapshot`, `configuration_changed` |
| OpenFeature | `/v1/flags` | `flagsV1Routes` | `POST /:key { targetingKey, context? }` → `{ variant, value, reason, errorCode? }` |

**Evaluation Priority (strict):**
1. **Targeting Rules** — first match wins (`user.*` / `context.*` attributes).
2. **Segments** — all rules must match (AND); weighted bucket by `user.id` hash.
3. **Rollout Percentage** — outside rollout ⇒ `control` variant.
4. **Weighted Random** — deterministic FNV-1a(`flagKey:userId`) % 100.

**Non-Active Flags:** `draft`/`paused`/`archived` ⇒ control/first variant. Unknown flag ⇒ `default`/`null`.

### 5.8 Admin — Projects & Apps

Prefix: `/api/admin/projects` — `backend/admin/projects/index.ts` → `projectRoutes`

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/admin/projects/` | Create project (slug auto-derived from name) |
| `GET` | `/api/admin/projects/` | List projects (with `appCount`) |
| `GET` | `/api/admin/projects/:id` | Project detail + `apps` |
| `DELETE` | `/api/admin/projects/:id` | Delete project (cascades to apps + environments) |
| `POST` | `/api/admin/projects/:id/duplicate` | Duplicate project (envs + apps copied with fresh IDs/keys) |
| `GET` | `/api/admin/projects/:id/apps` | List apps |
| `POST` | `/api/admin/projects/:id/apps` | Create app (generates keys + DSN) |

**App Creation:** `POST /api/admin/projects/:id/apps` accepts optional `environment` name (slug/name); reuses or creates; defaults to project's default environment. Project creation auto-creates "testing" environment, **no app**.

### 5.9 Admin — Environments

Prefix: `/api/admin/environments` — `backend/admin/environments/index.ts` → `environmentRoutes`

| Method | Path | Body/Query | Description |
|--------|------|------------|-------------|
| `POST` | `/api/admin/environments/` | `{ projectId, name, slug?, isDefault? }` | Create; 404 unknown project, 409 duplicate slug |
| `GET` | `/api/admin/environments/` | `?projectId&page&limit` | Paginated list for project |
| `GET` | `/api/admin/environments/:id` | `id` (uuid) | Get one |
| `PATCH` | `/api/admin/environments/:id` | `{ name?, slug?, isDefault? }` | Update; 409 duplicate slug |
| `DELETE` | `/api/admin/environments/:id` | `id` (uuid) | Delete; cascades to apps created in it, promotes new default if needed |

- `slug` defaults to kebab-case of `name`; unique per project.
- First environment = default; `isDefault: true` promotes + demotes previous.

### 5.10 Admin — Segments

Prefix: `/api/admin/segments` — `backend/admin/segments/index.ts` → `segmentRoutes`

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/admin/segments/` | `{ name, description?, rules }` | Create segment |
| `GET` | `/api/admin/segments/` | `?page&limit` | Paginated list |
| `GET` | `/api/admin/segments/:id` | – | Get segment |

**Segment Rules:** Same targeting rule schema as flags (no `variantKey`); all rules must match (AND).

### 5.11 Admin — Alerting

Prefix: `/api/admin/alerting` — `backend/alerting/index.ts` → `alertingRoutes`

**Channels** (`type` → config): `webhook { url }`, `slack { webhookUrl }` or `{ token, channel }`, `rocketchat { webhookUrl }`, `email { to, from }`.

**Rules:** `trigger` ∈ `threshold | new_issue | regression` (default `threshold`). Threshold rules require `metric` ∈ `event_count | error_count | fatal_count | new_issue_count | latency_p95 | latency_p99`, `operator` ∈ `gt | lt`, `threshold`, `windowSeconds`, optional `measurement` (default `duration`). Issue triggers carry none of those fields.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/channels` | List channels (filter `appId`) |
| `POST` | `/channels` | Create channel |
| `GET` | `/channels/:id` | Get one |
| `PATCH` | `/channels/:id` | Update |
| `DELETE` | `/channels/:id` | Delete |
| `GET` | `/rules` | List rules (filter `appId`) |
| `POST` | `/rules` | Create rule |
| `GET` | `/rules/:id` | Get one |
| `PATCH` | `/rules/:id` | Update (switching triggers validates field set) |
| `DELETE` | `/rules/:id` | Delete |
| `POST` | `/rules/:id/test` | Test notification (reports per-channel results) |
| `GET` | `/apps/:appId/effective` | Resolved config (global + app overrides merged) |
| `GET` | `/incidents` | Incident history |

**Evaluation:**
- Threshold rules: fire-and-forget after ingestion + periodic sweeper (`ALERT_EVALUATION_INTERVAL_MS`).
- Issue triggers (`new_issue`, `regression`): event-driven at ingestion (exactly once).
- Breaching rules dispatch uniform `AlertNotification` via `Notifier` interface; record `alert_incidents`; respect cooldown.
- Delivery failures logged, never fail ingestion.

### 5.12 Admin — Issues

Prefix: `/api/admin/issues` — `backend/admin/issues/index.ts` → `issueRoutes`

| Method | Path | Body/Query | Description |
|--------|------|------------|-------------|
| `GET` | `/` | `?appId&projectId&status&q&page&limit` | Paginated issues, newest `lastSeen` first |
| `GET` | `/:id` | `id` (uuid) | Get one |
| `PATCH` | `/:id` | `{ status: 'unresolved'\|'resolved' }` | Resolve/reopen |

**Issue Model:** Keyed by `(appId, fingerprint)` (Sentry grouping: explicit fingerprint → newest in-app stack frame → message). Tracks `status`, `eventCount`, `firstSeen`, `lastSeen`, `latestEventId`. Transitions:
- First-ever fingerprint → **new issue** (fires `new_issue` trigger)
- Event for `resolved` issue → **regression** (flips to `unresolved`, fires `regression` trigger)
- Repeats while unresolved → bump `eventCount`/`lastSeen` only

**Race-Safe:** `onConflictDoNothing` insert + `UPDATE ... WHERE status = 'resolved' RETURNING`; concurrent deliveries fire exactly one alert. Resolve via `PATCH` arms `regression` trigger.

### 5.13 Admin — Permissions

Prefix: `/api/admin/permissions` — `backend/admin/permissions/index.ts` → `permissionRoutes` (admin-token only)

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `/` | – | All group rules + whitelist entries |
| `POST` | `/rules` | `{ groupName, environments?, appPrefixes?, isEnabled? }` | Create group rule |
| `PATCH` | `/rules/:id` | Partial | Update rule |
| `DELETE` | `/rules/:id` | `id` | Delete rule |
| `POST` | `/users` | `{ email, environments?, appPrefixes?, isEnabled? }` | Create whitelist entry |
| `PATCH` | `/users/:id` | Partial | Update entry |
| `DELETE` | `/users/:id` | `id` | Delete entry |

**Scope Semantics:** Verified identity → enabled whitelist entry for email replaces group assignment; else union of enabled group rules matching `groups`. Scope = environment **names** + app **full-name prefixes** → expanded to visible apps/environments/projects. No matching grant ⇒ `401` (UI prompts for admin token). Scoped identities are **read-only** (allowlisted GETs only).

### 5.14 Admin — Settings (Event Retention)

Prefix: `/api/admin/settings` — `backend/admin/settings/index.ts` → `settingsRoutes` (admin-token only)

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `/events-ttl` | – | Read TTL from ClickHouse table definition: `{ table, expression, interval }` |
| `PUT` | `/events-ttl` | `{ amount, unit }` | Replace TTL (`ALTER TABLE ... MODIFY TTL`), re-read value |

- Default: `TTL toDateTime(receivedAt) + toIntervalMonth(1)` (1 month).
- Boot seeds default only when table has no TTL; **never overwrites** admin change.

### 5.15 Source Maps (Admin + CLI-Compatible)

**Admin Surface:** `/api/admin/source-maps` (admin-token only)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/source-maps` | List artifacts (filter `projectId`, `environmentId`, `release`) |
| `GET` | `/source-maps/:id` | Get artifact; `?include=content` returns raw `mapJson` |
| `DELETE` | `/source-maps/:id` | Delete artifact |

**Tokens:** `/api/admin/source-map-tokens` (admin-token only)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/source-map-tokens` | Create token (`{ name, projectId, appId, environmentId, expiresAt? }`); returns raw token **once** |
| `GET` | `/source-map-tokens` | List tokens |
| `GET` | `/source-map-tokens/:id` | Get token (never returns raw) |
| `POST` | `/source-map-tokens/:id/rotate` | Rotate token (invalidates previous); returns new raw token once |
| `DELETE` | `/source-map-tokens/:id` | Revoke token (soft delete) |

**CLI-Compatible Surface:** `/api/0/projects/:org/:project/` (upload token auth)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/releases/` | Create release (`{ version, ref?, url?, owner? }`) |
| `POST` | `/releases/:version/files/` | Upload source map (multipart: `file` + `name` + `dist?`); validates v3 + `sources` + `mappings`; 10 MB limit |
| `GET` | `/releases/:version/files/` | List artifacts for release |
| `DELETE` | `/releases/:version/files/:fileId/` | Delete artifact |
| `POST` | `/releases/:version/` | Finalize release (`status: "finalized"`) |

**Symbolication:** At event read time, frames matched by filename (exact / basename / `.map` suffix stripped) → VLQ decode mappings → original position + source context. Cached parsed maps + decoded mappings (LRU, 100 entries).

### 5.16 Session Replays

Prefix: `/replays` — `backend/replays/index.ts` → `replayRoutes`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/replays/by-event/:eventId` | Resolve replay from event (`replay_event.replay_id` or `contexts.replay.replay_id`), assemble segments from object store |

**Response:** `{ replayId, available, truncated, bytes, segments[], events[] }` — concatenated rrweb stream ordered by earliest segment timestamp.

**Auth:** Dev/test open; prod requires admin token or read-granted provider identity. Scoped read filters by event's app visibility.

**Object Store Access:** `GET /storage/<key>` — serves local objects when local backend active (404 when S3 configured). Same auth/scoping as replays.

---

## 6. Authentication

### 6.1 DSN / Sentry Auth (Ingestion)
`validateAuth(request, target)` in `backend/auth.ts`:
- Reads `sentry_key` query param or `X-Sentry-Auth` header (`sentry_key=XXX, sentry_project=YYY, ...`).
- Valid only when extracted key matches resolved app's `publicKey`.
- Returns `{ valid, publicKey }`; callers throw `unauthorized("Unauthorized - Invalid DSN")` on failure (no DB writes).

### 6.2 Admin Auth (ADMIN_TOKEN + OIDC/OAuth2)
`validateAdminAuth(request)` / `validateAdminToken(token)` in `backend/auth.ts`:
- Requires `Authorization: Bearer <token>` (constant-time comparison for admin token).
- **`ADMIN_TOKEN` is master credential** — always accepted, provider configured or not (UI prompts for it when no grant applies). Without `ADMIN_TOKEN` and no provider ⇒ admin API fails closed (401). No built-in dev/test tokens.
- OIDC/OAuth2: JWT verified via `backend/oidc.ts` — discovery (cached 10 min) → JWKS (cached, re-fetched on unknown `kid`) → WebCrypto signature (`RS256/384/512`, `ES256/384/512`; `alg` allowlisted) → claims (`exp`/`nbf` ±60s skew, `iss` match, `aud` when configured). Failures logged (never token) → unauthenticated.
- Verified identity: `{ id, email, name, groups }` (claim mapping via `OIDC_*_CLAIM` env).

### 6.3 Read Permissions (Scoped Identities)
`backend/permissions.ts` resolves access once per request (cached on `Request`):
- **Whitelist entry for email** replaces group assignment entirely.
- Else **union of enabled group rules** matching identity's `groups` (case-insensitive).
- No match ⇒ `401` with `NO_READ_PERMISSION_MESSAGE` (UI shows admin-token prompt).
- **Scope → Visibility:** apps matching prefix OR living in matching environment name; environments matching name OR holding visible app; projects holding any visible app/env. Empty scope = valid "read nothing" grant.
- **Scoped = Read-Only:** Allowlisted GETs only (`/api/admin/projects*`, `/api/admin/environments*`, `/api/admin/issues*` + details). All writes ⇒ `403`. Allowlisted reads filtered by `scopedViewFor(...)`; out-of-scope details ⇒ `404` (never leak).

**Guard Wiring:**
- `/api/admin/*` → always guarded (`adminRoutes` derive + `onBeforeHandle` fail-closed).
- `/events/*`, `/storage/*`, `/replays/*` → open in dev/test while `!adminAuthEnforced()`; enforced ⇒ require admin token or granted provider identity.

---

## 7. Data Layer (PostgreSQL)

### 7.1 Tables (`db/schema/*`, all `pgTable`)

**projects** — `id` (PK), `name`, `slug` (unique), `description`, `created_at`

**apps** — `id` (PK), `number` (serial, unique — DSN path), `project_id`, `environment_id`, `name`, `platform` (default `javascript`), `ingest_key` (unique), `public_key`, `created_at`

**stored_events** — `id` (PK, event id), `project_id`, `app_id`, `envelope_header` (JSON), `envelope_items` (JSON; offloaded payloads = `{ key }`), `received_at` (ISO)

**feature_flags** — `id` (PK), `key` (unique), `name`, `description`, `type` (`boolean|string|number|json`), `default_value`, `variants` (JSON), `targeting_rules` (JSON), `segments` (JSON), `status` (`draft|active|paused|archived`), `rollout_percentage` (default 100), `experiment` (JSON), `created_at`, `updated_at`

**segments** — `id` (PK), `name`, `description`, `rules` (JSON), `created_at`

**environments** — `id` (PK), `project_id`, `name`, `slug` (unique per project), `is_default` (exactly one per project via partial unique index), `created_at`, `updated_at`

**alert_channels** — `id` (PK), `name`, `type`, `config` (JSON), `app_id` (nullable; NULL = global), unique per scope (`UNIQUE (app_id, name)` + partial unique on `name` where `app_id IS NULL`)

**alert_rules** — `id` (PK), `name`, `trigger`, `metric`, `operator`, `threshold`, `window_seconds`, `cooldown_seconds` (default 3600), `channel_ids` (JSON), `measurement`, `app_id` (NULL = global), `is_enabled`, `last_triggered_at`, `created_at`, `updated_at`; unique per scope

**alert_incidents** — `id` (PK), `rule_id`, `app_id`, `trigger`, `issue_fingerprint`, `metric`, `value`, `threshold`, `status` (`firing|resolved`), `triggered_at`, `resolved_at`

**issues** — `id` (PK), `app_id`, `fingerprint` (unique per app), `title`, `status` (`unresolved|resolved`), `event_count`, `first_seen`, `last_seen`, `latest_event_id`, `created_at`, `updated_at`

**permission_rules** — `id` (PK), `group_name` (unique, lowercased), `environments` (JSON array), `app_prefixes` (JSON array), `is_enabled`, `created_at`, `updated_at`

**permission_users** — `id` (PK), `email` (unique, lowercased), `environments` (JSON), `app_prefixes` (JSON), `is_enabled`, `created_at`, `updated_at`

**source_maps** — `id` (PK), `project_id`, `app_id`, `environment_id`, `release`, `dist`, `filename`, `map_json`, `created_at`; unique `(project_id, release, filename)`

**source_map_tokens** — `id` (PK), `project_id`, `app_id`, `environment_id`, `token_hash` (SHA-256), `token_prefix`, `name`, `created_by`, `created_at`, `last_used_at`, `expires_at`, `revoked_at`

**experiment_assignments** — `id` (PK), `flag_id`, `user_id`, `variant_key`, `context` (JSON), `assigned_at`; unique `(flag_id, user_id)`

**experiment_metrics** — `id` (PK), `flag_id`, `variant_key`, `user_id`, `metric_name`, `value` (real), `recorded_at`

### 7.2 DAO Conventions (`db/dao/*`)

Each DAO: plain object exported as `<entity>DAO` (e.g., `storedEventDAO`, `featureFlagDAO`).

**Standard Methods:**
- `create(data)` — race-safe: `onConflictDoNothing`/`onConflictDoUpdate` on unique index + `.returning()`
- `findById(id)` / `findByX(value)` — `select ... where ... limit(1)` → `undefined` if absent
- `findByIdOrThrow(id)` — throws `notFound("<Entity>", id)`
- `list(options)` → `{ data, pagination: { page, limit, total, totalPages } }` or `T[]`
- `updateOrThrow(id, patch)` — update + `.returning()`, 404 when missing
- `delete(id)` — boolean (`.returning()` + `.length`)

**Rules:**
- Handlers call DAOs; DAOs own Drizzle queries; throw `backend/errors.ts` `ApiError`s (never `elysia`).
- NotFound = `404` via `notFound(...)` mapped by root `onError`.
- Conflicts = DB-enforced: `create` uses `onConflictDoNothing`/`onConflictDoUpdate`, throws `conflict(...)` on race loss; updates map `uniqueViolationConstraint` to `conflict(...)`. **Never read-then-write.**
- IDs generated in handler/DAO with `crypto.randomUUID()`; never DB default for text PKs.

### 7.3 JSON-in-Text Columns

`variants`, `targetingRules`, `segments`, `rules`, `experiment`, `envelopeHeader`, `envelopeItems` — `text` columns holding JSON strings. Handlers `JSON.stringify` on write; DAOs `JSON.parse` on read via `parseJson` helper (`db/json.ts`, safe fallback).

### 7.4 Dates & IDs

- Timestamps = `text` ISO strings (`new Date().toISOString()`), generated in handler/DAO. **Never mix** `Date`, ISO strings, and SQL `CURRENT_TIMESTAMP`.
- IDs = UUIDs via `crypto.randomUUID()` (Bun built-in) at call site or DAO; never DB default.

---

## 8. Ingestion Pipeline & Protocol

### Envelope Format (`backend/events/utils.ts`)
- Line 1 = JSON header, then repeating `{ item header JSON line, payload }`.
- Payloads read as `length` bytes (JSON may contain newlines); fallback to newline-terminated line for hand-written envelopes.
- Returns `{ header, items }` or `null`.

### Processing
- `extractEventId`: header `event_id` → payload `event_id` → span `trace_id` → random UUID.
- `convertSpanToTransaction`: Sentry **span** items (`version: 2`) → transaction-shaped payloads (segment span = transaction; child spans collected; `sentry.measurement.*` → `measurements`).
- `normalizeTransactionPayload`: hoists trace metadata from `contexts.trace`.
- **Metric Extraction** (`backend/metrics/samples.ts`): `parseEnvelope` + `normalizeTransactionPayload` → every numeric measurement + sentinels → publish `sentry.events` + `sentry.metrics`.

### Replay Offload (`backend/events/offload.ts`)
- `replay_recording` items → object store **before** NATS publish.
- Key: `replays/<projectId>/<appId>/<replayId|messageId>/<messageId>-<index>.json`
- Stored item keeps `{ key }` pointer; readers resolve at read time (backend-agnostic).
- **Best-effort:** 5s timeout; failure/timeout → payload stays inline, ingestion never affected.

### NATS / ClickHouse Bootstrap
- **Order:** Postgres → NATS (stream + durable pull consumers `clickhouse-events`, `clickhouse-metrics`) → ClickHouse (engine tables + MVs) → fail fast.
- **ClickHouse DDL** (engine tables pull via NATS engine):
  ```sql
  CREATE TABLE nats_events (...) ENGINE = NATS SETTINGS nats_stream='SENTRIES', nats_consumer_name='clickhouse-events', nats_subjects='sentry.events', nats_format='JSONEachRow', input_format_skip_unknown_fields=1, nats_skip_broken_messages=10;
  CREATE TABLE sentry_events (...) ENGINE = ReplacingMergeTree() ORDER BY (projectId, receivedAt, id) SETTINGS fsync_after_insert=1, fsync_part_directory=1;
  CREATE MATERIALIZED VIEW sentry_events_mv TO sentry_events AS SELECT ... FROM nats_events WHERE type != 'clear';
  ```
- **Metrics tables** mirror exactly (`clickhouse-metrics` consumer).
- **TTL:** `TTL toDateTime(receivedAt) + toIntervalMonth(1)` (1 month default); admin-changeable via Settings → Event Retention; boot only seeds when no TTL exists.
- **Ack:** After MV insert succeeds; failed insert → redelivery.
- **Idempotency:** `ReplacingMergeTree` + `FINAL` reads; duplicates collapse.

### Side-Effects Consumer (`backend/events-consumer.ts`)
- Durable `sentry-events-consumer` (sequential, manual ack).
- Applies: issue tracking (`createIfNew` / `regressIfResolved` / `markSeen`), alert triggers (`new_issue`/`regression`), `clear` (truncates CH + clears PG issues).
- **Never touches ClickHouse** — CH outage never stalls side effects.

---

## 9. Error Handling Patterns

### ApiError Hierarchy (`backend/errors.ts`)
```ts
class ApiError extends Error {
  constructor(public httpStatus: number, public message: string, public code: string) { ... }
}
export const notFound = (entity: string, id: string) => new ApiError(404, `${entity} not found: ${id}`, "NOT_FOUND");
export const badRequest = (msg: string) => new ApiError(400, msg, "BAD_REQUEST");
export const unauthorized = (msg: string) => new ApiError(401, msg, "UNAUTHORIZED");
export const forbidden = (msg: string) => new ApiError(403, msg, "FORBIDDEN");
export const conflict = (msg: string) => new ApiError(409, msg, "CONFLICT");
export const payloadTooLarge = (msg: string) => new ApiError(413, msg, "PAYLOAD_TOO_LARGE");
export const internalError = (msg: string) => new ApiError(500, msg, "INTERNAL_ERROR");
export const serviceUnavailable = (msg: string) => new ApiError(503, msg, "SERVICE_UNAVAILABLE");
```

### Usage Rules
- **Handlers/DAOs throw `ApiError`** — never `throw status(...)` or return `{ error }` with 200.
- **Root `onError`** maps `ApiError` → HTTP status + `{ error }`; unknown → 500 + generic message.
- **Log details server-side** (with context); return generic client errors; **never leak stack traces**.
- **No debug logs in commits** — gate behind env flag if needed.
- **No fabricated data** — return `null` and document; don't invent numbers.

---

## 10. Testing Strategy

### Test Organization
| Directory | Transport | Purpose |
|-----------|-----------|---------|
| `tests/` | In-process (`app.handle(Request)`) | Unit/API tests — no network listener; `Host` header set for DSN consistency |
| `e2e/` | Real socket (docker-compose) | SDK-driven, WebView UI, WebSocket; boots real app vs PGlite |

**Test Command:** `bun run test` = `bun test --parallel=1 tests/ e2e/`
**Helpers:** `tests/test-helpers.ts` — `startTestApp()`, `handleFetch()`, `waitFor(fn)`.

### Hop Tests (One Stage Per Test)
| # | Test | Assertion |
|---|------|-----------|
| 1 | Ingest → NATS | POST envelope → assert `sentry.events` + `sentry.metrics` in stream |
| 2 | NATS → ClickHouse | Publish to NATS → `waitFor` row in `sentry_events`/`sentry_metrics` (`FINAL`); dup event id = 1 row |
| 3 | NATS → Postgres | Publish → assert issue/alert side effects; republished id ≠ 2nd issue/alert |
| 4 | ClickHouse → API | Seed CH directly → assert events/metrics endpoints |
| 5 | Live Feed | NATS WS client subscribes → publish → assert receipt |
| 6 | SDK E2E | Full path via real SDK; CH visibility assertions use `waitFor` |

### Requirements
- Every new endpoint gets a test.
- `bun run typecheck` and `bun run test` MUST pass before push.
- E2E uses `docker compose up -d` (Postgres, ClickHouse, NATS, RustFS).

---

## 11. Quick Checklist for Any Backend Change

- [ ] Route declared with input schema (`body`/`query`/`params`) using ArkType.
- [ ] Logic delegated to DAO; **no Drizzle in handler**.
- [ ] IDs = `crypto.randomUUID()`; dates = ISO strings; JSON columns = `JSON.stringify`.
- [ ] Missing record ⇒ `notFound(...)`; validation error ⇒ `badRequest(...)`.
- [ ] List endpoints paginate → `{ data, pagination: { page, limit, total, totalPages } }`.
- [ ] Auth guard applied correctly (admin/ingestion/scoped).
- [ ] New admin GETs for scoped identities added to `SCOPED_READ_PATHS` + filtered with `scopedViewFor(...)`.
- [ ] Debug logs removed.
- [ ] Test added/updated (`tests/` or `e2e/`).
- [ ] `bun run typecheck` and `bun run test` pass.