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
| `OIDC_ISSUER`, `OAUTH_ISSUER` | – | Identity provider issuer (discovery base): enables JWT verification |
| `OIDC_JWKS_URL` | – | Optional JWKS override (skips OIDC discovery) |
| `OIDC_AUDIENCE`, `OIDC_CLIENT_ID`, `OAUTH_CLIENT_ID` | – | Expected `aud` claim (checked when set); `OIDC_CLIENT_ID`/`OAUTH_CLIENT_ID` also enable the browser login flow |
| `OIDC_SCOPES` | `openid email profile` | Scopes requested by the browser login flow |
| `OIDC_EMAIL_CLAIM`, `OIDC_GROUPS_CLAIM`, `OIDC_NAME_CLAIM` | `email`, `groups`, `name` | Claim mapping for verified identity |
| `OIDC_ALLOW_INSECURE_HTTP` | – | `true` lets the discovery read a plain-HTTP issuer (a local provider). **HTTPS is the recommendation** — the tokens would travel in the clear otherwise |
| `OIDC_INTROSPECTION` | – | `true` enables immediate revocation (RFC 7662): every verified JWT is re-checked per request against the provider's introspection endpoint (no cache; an outage is a `503`) |

**DB Selection Logic** (`db/index.ts`): `NODE_ENV=test` → in-memory PGlite; else `DATABASE_URL` present → Postgres (Bun SQL); else file-backed PGlite in `./.pglite`. Committed migrations in `db/migrations` applied at startup (idempotent, tracked in `drizzle.__drizzle_migrations`).

**Docker Compose** provides the whole stack — Postgres 17 (`:5432`), ClickHouse (`:8123`, `:9000`), RustFS (`:9100` S3 API, `:9101` console — `rustfsadmin`/`rustfsadmin`; `sentry-replays` bucket created by `rustfs-init`), NATS (`:4222` + WS `:9222`), Keycloak (`:8080`) and the API + the consumer (`:31337`). The environment of the API and the consumer is the `x-app-environment` block of `docker-compose.yml`; the NATS configuration is an inline compose config whose values come from the environment of the service.

**Container image** (`Dockerfile`): the API (`bun index.js`) and the side-effects consumer (`bun consumer.js`) are two entry points of the same image; the production bundle is inlined in the Dockerfile (`bun -e`, registering the virtual OIDC module that `bun build` cannot apply from bunfig).

**Helm chart** (`helm/benemetrics`): the API and the consumer as Deployments, the bundled Postgres/ClickHouse/NATS/object store as StatefulSets, the Ingress, the Secret and the bucket-init hook. Every dependency can be turned off (`dependencies.*.enabled`) in favour of a managed service; `clickhouse.natsUrl` is resolved from ClickHouse's point of view.

**Package Scripts:**
```bash
bun run dev        # bun --hot backend/index.ts
bun run start      # bun backend/index.ts
bun run consumer   # bun backend/consumer.ts (standalone consumer binary)
bun run test       # bun test --parallel=1 backend/tests/ e2e/
bun run typecheck  # bun check
```

---

## 3. Directory Layout

```
backend/
  index.ts                 # App bootstrap: module registration, NATS publish, CH init, alert sweeper, error handler
  auth.ts                  # validateAuth (DSN) + validateUploadAuth (source-map uploads)
  errors.ts                # ApiError + ErrorCode: thrown by routes/DAOs, mapped by root onError
  nats.ts                  # NATS connection + publish helpers (API side)
  consumer.ts              # Standalone consumer binary: stream/pull-consumer provisioning + Postgres side effects
  events-store.ts          # Events/Metrics reads: ClickHouse only (SELECT … FINAL)
  metrics-store.ts         # Metrics reads: ClickHouse only (quantile, toStartOfInterval)
  clickhouse.ts            # ClickHouse store on Waddler (over @clickhouse/client): queries, DDL, initClickHouse
  metrics/
    samples.ts             # Envelope → metric samples extraction (parseEnvelope + normalizeTransactionPayload)
  storage.ts               # Object storage: Bun S3 client (`s3`); the object store is S3-required
  admin/events/
    index.ts               # eventRoutes (/api/admin/events/:eventId/replay/:replayId) — paginated presigned replay segments
  feature-flags/
    index.ts               # featureFlagRoutes (/api/admin/feature-flags/*) — CRUD + lifecycle
    experiments.ts         # experimentRoutes (/api/admin/experiments/*) — lifecycle, results, participants
    evaluation.ts          # evaluationRoutes (/api/sentry/flags/evaluate, /experiment/track)
    stream.ts              # flagsStreamRoutes (/api/sentry/flags/stream) — SSE snapshot + changes
    openfeature.ts         # flagsV1Routes (/v1/flags/:key) — OpenFeature-compatible
    events.ts              # The flag-change bus: local fan-out + the stream subject
    service.ts             # Experiment results: participants, conversions, recommendation
    stats.ts               # Wilson interval + two-proportion z-test
  source-maps/
    index.ts               # sourceMapUploadRoutes (/api/0/projects/*) — the sentry-cli surface
    upload.ts              # Multipart upload parsing + source-map validation
    resolver.ts            # VLQ symbolication + bounded decoded-mappings cache
  alerting/
    index.ts               # alertingRoutes (/api/admin/alerting/*) — channels, rules, incidents, test
    notifiers.ts           # Uniform Notifier interface + webhook/slack/rocketchat/email + dispatcher
    resolver.ts            # Global → per-app config resolution (per-name override)
    evaluation.ts          # Metric computation, threshold engine, cooldown, sweeper + issue-trigger firing
  issues/
    tracking.ts            # Ingestion-time issue state transitions (new issue / regression)
  admin/
    index.ts               # adminRoutes (/api/admin) — single fail-closed credential check + mounted admin domains
    projects/index.ts      # projectRoutes, appRoutes (project + app management)
    segments/index.ts      # segmentRoutes (audience segments)
    environments/index.ts  # environmentRoutes (project environments, shared by apps)
    releases/index.ts      # releaseRoutes + buildReleaseIssueMetrics (pure)
    issues/index.ts        # issueRoutes (/api/admin/issues/*) — list/get/resolve
    settings/index.ts      # settingsRoutes (/api/admin/settings/events-ttl)
  protocol/                # Type-only interfaces (source of truth)
helm/benemetrics/            # The Helm chart: the API, the consumer and the bundled services
```

---

## 4. Request Flow

1. Bun starts `backend/index.ts`.
2. `new Elysia()` registers the root redirect, then `.use(...)` of the route modules (`backend/routes.ts`).
3. Route handler receives Elysia context (`{ body, query, params, request, set, status }`).
4. Input validated by route's `body` / `query` / `params` schema (ArkType); undeclared keys are dropped (`backend/arktype-config.ts`), so a `...body` spread into a DAO carries only declared fields.
5. Handler calls **DAO** from `db/dao/*` — handlers **never** touch Drizzle directly.
6. DAO runs Drizzle query, returns row (or throws `ApiError` from `backend/errors.ts`).
7. Handler shapes HTTP response; errors bubble to global `onError` → maps `ApiError` to HTTP status + `{ error }`, falls back to 500.

**Module Registration** (`backend/index.ts`):
```ts
const app = new Elysia()
  .get("/", () => Response.redirect("/ui"))
  .use(eventsRoutes)        // prefix "events"
  .use(ingestionRoutes)     // prefix "api"
  .use(featureFlagRoutes)   // prefix "/api/admin/feature-flags"
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

### Pagination

Every list endpoint is **cursor-paginated** — there is no `page`/offset and no total:

- Query: `cursor` (opaque; the `id` of the last row the caller saw, omitted on the first request) and `limit` (default 20, max 100).
- Response: the list only, `{ data: [...] }` — no `pagination` object.
- "More" is inferred from a full page: when `data.length === limit` there may be another page; pass the last row's `id` back as `cursor` to continue. A short page ends the list.
- Rows are ordered by the resource's sort key (newest first) tie-broken by id; the cursor condition is the matching keyset slice, so a deep page never scans the rows before it.

### 5.1 System

There is no health endpoint: the UI's health signal is the live feed's NATS WebSocket connection state (the browser subscribes to `sentry.events` directly — see `frontend/src/lib/live-events.ts`).

### 5.2 Events API (ClickHouse Only)

Prefix: `/events` — `backend/events/index.ts` → `eventsRoutes`

| Method | Path | Query | Description |
|--------|------|-------|-------------|
| `GET` | `/events/` | `cursor`, `limit`, `since`, `projectId`, `environmentId`, `appId` | List events from ClickHouse (`SELECT … FINAL`), envelope → UI shape; `since` bounds the window in time (ISO timestamp) |
| `GET` | `/events/:eventId` | – | Fetch one event (parsed envelope item) |

**Auth:** Inline credential check on every request (no open mode): admin token or a JWKS-verified provider JWT. Scoped identities only read events of their visible apps.

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

- **Per app**, not per project: `POST /api/admin/projects/:id/apps` creates the app; every apps response carries its credentials (`publicKey`, `number`).
- Format: `http://<public-key>@<host>/<app-number>` — **always `http://`** (backend serves plain HTTP; TLS is reverse-proxy concern). The host belongs to the caller: the API returns no DSN and no host, the client composes the DSN for the origin it reached.
- No separate DSN management endpoint.
- **The resolution is cached**: the DSN path resolves on every ingested event, so the resolved app is held in a short-lived in-process cache (60 s TTL, purged when the app is deleted). The public key is still compared on every request.

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

Prefix: `/api/admin/feature-flags` — `backend/feature-flags/index.ts` → `featureFlagRoutes`

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/feature-flags/` | Flag definition (see schema) | Create flag (status `draft`) |
| `GET` | `/feature-flags/` | `cursor,limit,status,type,search` | Cursor-paginated list |
| `GET` | `/feature-flags/:id` | `id` (uuid) | Get one |
| `PATCH` | `/feature-flags/:id` | Partial flag | Update fields |
| `POST` | `/feature-flags/:id/status` | `{ status }` (`draft\|active\|paused\|archived`) | Change lifecycle status |
| `DELETE` | `/feature-flags/:id` | `id` (uuid) | Delete — **draft only** |

**Experiments:** Prefix `/api/admin/experiments` — `backend/feature-flags/experiments.ts` → `experimentRoutes`

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/:flagId/start` | Start the experiment (`status: "running"`) |
| `POST` | `/:flagId/stop` | Stop the experiment (`status: "completed"`) |
| `POST` | `/:flagId/promote` | Promote the recommended winner (weight 100) |
| `GET` | `/:flagId/results` | Results dashboard (participants, conversions, Wilson CI, z-test, recommendation) |
| `GET` | `/:flagId/users` | Assignments per variant (`cursor,limit,variantKey,search`) |
| `GET` | `/:flagId/users/:userId` | One user's stored assignment |

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

**Auth:** every SDK surface takes the DSN public key (`sentry_key` query parameter or the `X-Sentry-Auth` header) — the flags are global, so the key only proves the caller is a known SDK client. A missing or unknown key ⇒ `401`.

**Evaluation Priority (strict):**
1. **Targeting Rules** — first match wins (`user.*` / `context.*` attributes).
2. **Segments** — all rules must match (AND); weighted bucket by `user.id` hash.
3. **Rollout Percentage** — outside rollout ⇒ `control` variant.
4. **Weighted Random** — deterministic FNV-1a(`flagKey:userId`) % 100.

**Non-Active Flags:** `draft`/`paused`/`archived` ⇒ control/first variant. Unknown flag ⇒ `default`/`null`.

### 5.8 Admin — Projects & Apps

Prefix: `/api/admin/projects` — `backend/projects/index.ts` → `projectRoutes`

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

Prefix: `/api/admin/environments` — `backend/environments/index.ts` → `environmentRoutes`

| Method | Path | Body/Query | Description |
|--------|------|------------|-------------|
| `POST` | `/api/admin/environments/` | `{ projectId, name, slug?, isDefault? }` | Create; 404 unknown project, 409 duplicate slug |
| `GET` | `/api/admin/environments/` | `?projectId&cursor&limit` | Cursor-paginated list for project |
| `GET` | `/api/admin/environments/:id` | `id` (uuid) | Get one |
| `PATCH` | `/api/admin/environments/:id` | `{ name?, slug?, isDefault? }` | Update; 409 duplicate slug |
| `DELETE` | `/api/admin/environments/:id` | `id` (uuid) | Delete; cascades to apps created in it, promotes new default if needed |

- `slug` defaults to kebab-case of `name`; unique per project.
- First environment = default; `isDefault: true` promotes + demotes previous.

### 5.10 Admin — Segments

Prefix: `/api/admin/segments` — `backend/segments/index.ts` → `segmentRoutes`

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/admin/segments/` | `{ name, description?, rules }` | Create segment |
| `GET` | `/api/admin/segments/` | `?cursor&limit` | Cursor-paginated list |
| `GET` | `/api/admin/segments/:id` | – | Get segment |

**Segment Rules:** Same targeting rule schema as flags (no `variantKey`); all rules must match (AND).

### 5.11 Admin — Alerting

Prefix: `/api/admin/alerting` — `backend/alerting/index.ts` → `alertingRoutes`

**Channels** (`type` → config): `webhook { url }`, `slack { webhookUrl }` or `{ token, channel }`, `rocketchat { webhookUrl }`, `email { to, from, host? }`, `pagerduty { routingKey }`, `opsgenie { apiKey }`, `msteams { webhookUrl }`, `victorops { apiKey, routingKey }`.

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
- Threshold rules: evaluated by the periodic sweeper only (`ALERT_EVALUATION_INTERVAL_MS`); ingestion does not fire them.
- Issue triggers (`new_issue`, `regression`): event-driven at ingestion (exactly once).
- Breaching rules dispatch uniform `AlertNotification` via `Notifier` interface; record `alert_incidents`; respect cooldown.
- Delivery failures logged, never fail ingestion.

### 5.12 Admin — Issues

Prefix: `/api/admin/issues` — `backend/issues/index.ts` → `issueRoutes`

| Method | Path | Body/Query | Description |
|--------|------|------------|-------------|
| `GET` | `/` | `?query&sort&cursor&limit` | The search grammar (`is:unresolved app:checkout lastSeen:-24h`); `sort` = `new`\|`frequent`\|`first-seen`\|`users`; returns `{ data, meta: { terms, sort } }` |
| `GET` | `/:id` | `id` (uuid) | Get one |
| `GET` | `/:id/events` | `?cursor&limit` | The issue's occurrences (ClickHouse issue index), newest first |
| `GET` | `/:id/stats` | `?from&to&stepSeconds` | Bucketed event/user counts (ClickHouse issue index) |
| `PATCH` | `/:id` | `{ status: 'unresolved'\|'resolved' }` | Resolve/reopen |

**Issue Model:** Keyed by `(appId, fingerprint)` (Sentry grouping: explicit fingerprint → newest in-app stack frame → message). Tracks `title`, `culprit`, `level`, `type`, `firstRelease`, `lastRelease`, `status`, `eventCount`, `firstSeen`, `lastSeen`, `latestEventId`. Transitions:
- First-ever fingerprint → **new issue** (fires `new_issue` trigger)
- Event for `resolved` issue → **regression** (flips to `unresolved`, fires `regression` trigger)
- Repeats while unresolved → bump `eventCount`/`lastSeen` only

**Race-Safe:** `onConflictDoNothing` insert + `UPDATE ... WHERE status = 'resolved' RETURNING`; concurrent deliveries fire exactly one alert. Resolve via `PATCH` arms `regression` trigger.

### 5.13 Admin — Permissions

Prefix: `/api/admin/permissions` — `backend/permissions/index.ts` → `permissionRoutes` (admin-token only)

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `/rules` | – | The group rules (cursor-paginated `{ data }`) |
| `POST` | `/rules` | `{ name, environments, appPrefixes, isEnabled? }` | Create group rule; 409 on a duplicate name |
| `PATCH` | `/rules/:id` | Partial | Update rule |
| `DELETE` | `/rules/:id` | `id` | Delete rule |
| `GET` | `/grants` | – | The identity grants (cursor-paginated `{ data }`) |
| `POST` | `/grants` | `{ identityId, label?, environments, appPrefixes, isEnabled?, canWrite? }` | Create an identity grant; 409 on a duplicate id. `canWrite` gives the identity the admin writes |
| `PATCH` | `/grants/:id` | Partial | Update grant |
| `DELETE` | `/grants/:id` | `id` | Delete grant |
| `GET` | `/audit` | – | The change trail (`?target=rule\|grant`) |
| `GET` | `/api/admin/session` | – | The caller's identity and read scope (`{ id, isAdmin, scope }`) |
| `PATCH` | `/users/:id` | Partial | Update entry |
| `DELETE` | `/users/:id` | `id` | Delete entry |

**Scope Semantics:** Verified identity → enabled whitelist entry for email replaces group assignment; else union of enabled group rules matching `groups`. Scope = environment **names** + app **full-name prefixes** → expanded to visible apps/environments/projects. No matching grant ⇒ `401` (UI prompts for admin token). Scoped identities are **read-only** (allowlisted GETs only).

### 5.14 Admin — Settings (Event Retention)

Prefix: `/api/admin/settings` — `backend/settings/index.ts` → `settingsRoutes` (admin-token only)

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `/events-ttl` | – | Read TTL from ClickHouse table definition: `{ table, expression, interval }` |
| `PUT` | `/events-ttl` | `{ amount, unit }` | Replace TTL (`ALTER TABLE ... MODIFY TTL`), re-read value |

- Default: `TTL toDateTime(receivedAt) + toIntervalMonth(1)` (1 month).
- Boot seeds default only when table has no TTL; **never overwrites** admin change.
- The metric samples share the retention (`sentry_metrics` gets the same TTL).

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

**CLI-Compatible Surface:** `/api/0/projects/:org/:project/` — `backend/source-maps/index.ts` → `sourceMapUploadRoutes` (upload token auth)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/releases/` | Create release (`{ version, ref?, url?, owner? }`) |
| `POST` | `/releases/:version/files/` | Upload source map (multipart: `file` + `name` + `dist?`); validates v3 + `sources` + `mappings`; 10 MB limit |
| `GET` | `/releases/:version/files/` | List artifacts for release |
| `DELETE` | `/releases/:version/files/:fileId/` | Delete artifact |
| `POST` | `/releases/:version/` | Finalize release (`status: "finalized"`) |
| `GET` | `/releases/:id/summary` | Release health from the ClickHouse issue index: the issues it touched, the new and the regressed ones |

**Symbolication:** At event read time, frames matched by filename (exact / basename / `.map` suffix stripped) → VLQ decode mappings → original position + source context. Cached parsed maps + decoded mappings (LRU, 100 entries), versioned by the artifact's `createdAt` so a re-uploaded artifact is never served from a stale cache. Re-uploading an artifact replaces it in place (last wins).

### 5.16 Session Replays

Prefix: `/api/admin/events/:eventId/replay` — `backend/events/index.ts` → `eventRoutes`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/events/:eventId/replay/:replayId?cursor=&limit=` | One page (default 10, max 50) of replay segment presigned URLs for the session, in playback order |

**Response:** `{ replayId, available, expiresAt, segments: [{ key, url, bytes }], nextCursor, hasMore }`. `url` is a presigned S3 GET. Object keys embed the segment start time, so listing is already playback-ordered and `startAfter` pagination needs no object reads. Pass `nextCursor` back as `cursor` until `hasMore` is false; `available: false` when the object store cannot be listed.

**Auth:** Admin token or read-granted provider identity (standard `/api/admin/*` guard).

**Object Store Access:** the object store is S3-required; the browser reads segment bytes straight from the presigned URL, so the backend never proxies recording payloads. The bucket must allow `GET`/`HEAD` from the UI origin (CORS); the compose `rustfs-init` applies a wildcard rule for local dev.

---

## 6. Authentication

### 6.1 DSN / Sentry Auth (Ingestion)
`validateAuth(request, target)` in `backend/auth.ts`:
- Reads `sentry_key` query param or `X-Sentry-Auth` header (`sentry_key=XXX, sentry_project=YYY, ...`).
- Valid only when extracted key matches resolved app's `publicKey`.
- Returns `{ valid, publicKey }`; callers throw `unauthorized("Unauthorized - Invalid DSN")` on failure (no DB writes).

### 6.2 Admin Auth (Admin Token + OIDC/OAuth2)
The credentials are checked in one place — `resolveIdentity` (`backend/auth.ts`). Every oidc route group of a domain file resolves the id in its own `.resolve` hook (`resolveAdminId` → `adminId`); the public and dsn groups carry no admin check:
- Two credentials, never mixed: `Authorization: API-Key <token>` (the master credential, constant-time compare) or `Authorization: Bearer <provider JWT>` (verified with `jose` against the provider's JWKS). Either way the request resolves to an id.
- **The admin token is the master credential** — always accepted, provider configured or not (UI prompts for it when no grant applies). It is generated at boot and held **only as its `Bun.password` hash** (argon2id) in global Elysia state on the app (`backend/index.ts`) — the plaintext never persists, requests are checked with `Bun.password.verify` against the registered hash. It rotates daily at 00:00 UTC by the Elysia cron in the same file; there is no env var, no file, and no HTTP surface for it. Format: `bnm_` + 4 groups of 6 mixed-case alphanumerics (`bnm_NjQcwY-nHp8JU-7CRKG5-CVdSez`, no `0`/`1`/`I`/`L`/`O`). Tests pin it by writing the fixture hash to `app.store.adminTokenHash`. No built-in dev/test tokens.
- OIDC/OAuth2: JWT verified with `jose` against the provider's JWKS (the issuer's discovery document; cached) + `jwtVerify` (audience `OIDC_CLIENT_ID`/`OAUTH_CLIENT_ID`). Failures ⇒ `401` (never token logging). Immediate revocation is opt-in via `OIDC_INTROSPECTION=true`: the provider must expose an RFC 7662 introspection endpoint, and every verified JWT is re-checked against it per request (`active !== true` ⇒ `401`; an unreachable endpoint is a provider outage ⇒ `503`).
- Verified identity: **an id** — `local-admin` for the admin token, `<issuer>-<subject>` for a provider JWT. An id is all the admin surface needs; every oidc route group carries it as `adminId`.

### 6.3 Read Permissions (Scoped Identities)
`backend/permissions/engine.ts` resolves access once per request (the view is cached on the `Request`):
- **Identity grant** (by id) replaces the group assignment entirely.
- Else **union of enabled group rules** matching identity's `groups` (case-insensitive, split on `/[\s,;|]+/`).
- No match ⇒ `401` with `NO_READ_PERMISSION_MESSAGE` (UI shows admin-token prompt).
- **Scope → Visibility:** apps matching prefix OR living in matching environment name; environments matching name OR holding visible app; projects holding any visible app/env. Empty scope = valid "read nothing" grant. The expansion is cached per process (key = the scope value; a TTL serves a stale topology for at most 10 s), so a large deployment does not re-query the topology per request.
- **Scoped = Read-Only:** Allowlisted GETs only (`/api/admin/projects*`, `/api/admin/environments*`, `/api/admin/issues*` + details). All writes ⇒ `403`. Allowlisted reads filtered by `scopedViewFor(...)`; out-of-scope details ⇒ `404` (never leak).

**Guard Wiring:**
- `/api/admin/*` → every oidc route group resolves the identity through `resolveAdminId` (`backend/auth.ts`, fail closed) before its handler runs. A scoped identity may only `GET` the allowlisted paths; everything else ⇒ `403`. Without a grant ⇒ `401` (`NO_READ_PERMISSION_MESSAGE`).
- `/events/*` → the same resolve (no open mode): admin token or a verified provider identity.

### 6.4 SPA OIDC Login (build-time config)

The SPA's public OIDC settings are compiled into the frontend bundle at startup by `frontend/auth-env-plugin.ts` as `virtual:auth-env` — there is no auth config endpoint:

| Name | Meaning |
|------|---------|
| `OIDC_ISSUER` / `OAUTH_ISSUER` | Issuer used for discovery |
| `OIDC_CLIENT_ID` / `OAUTH_CLIENT_ID` | Public SPA client id (also enables the flow) |
| `OIDC_SCOPES` | Scopes to request (`openid email profile` default) |

Only these public names are exposed to the bundle; never reference secrets (`ADMIN_TOKEN`, client secrets, object-store keys) from frontend code. Restart the server after changing them so the bundle is rebuilt.

When an issuer and client id are present, the SPA starts an authorization-code + PKCE flow with `openid-client` before React renders: discovery → authorization redirect (`state`, `nonce`, `S256`) → callback at `/ui/auth/callback` → code exchange at the provider's token endpoint (public client, no secret) → ID token stored as the bearer credential. A failed exchange falls back to the admin-token prompt for that session. The backend never sees the authorization code; it only verifies the resulting JWT against the provider's JWKS. Provider prerequisites: allowlist `${origin}/ui/auth/callback` and allow CORS on discovery/token/JWKS.

---

## 7. Data Layer (PostgreSQL)

### 7.1 Tables (`db/schema/*`, all `pgTable`)

**projects** — `id` (PK), `name`, `slug` (unique), `description`, `created_at`

**sentry_issue_events** (ClickHouse) — `messageId`, `eventId`, `projectId`, `appId`, `fingerprint`, `title`, `level`, `type`, `release`, `environment`, `user`, `receivedAt`; `ReplacingMergeTree` ordered by `(appId, fingerprint, receivedAt, eventId)`, TTL = the events retention. Filled by the `sentry_issue_events_mv` view from the digests the ingest handler attaches to the message.

**apps** — `id` (PK), `number` (serial, unique — DSN path), `project_id`, `environment_id`, `name`, `platform` (default `javascript`), `ingest_key` (unique), `public_key`, `created_at`

**stored_events** — `id` (PK, event id), `project_id`, `app_id`, `envelope_header` (JSON), `envelope_items` (JSON; offloaded payloads = `{ key }`), `received_at` (ISO)

**feature_flags** — `id` (PK), `key` (unique), `name`, `description`, `type` (`boolean|string|number|json`), `default_value`, `variants` (JSON), `targeting_rules` (JSON), `segments` (JSON), `status` (`draft|active|paused|archived`), `rollout_percentage` (default 100), `experiment` (JSON), `created_at`, `updated_at`

**segments** — `id` (PK), `name`, `description`, `rules` (JSON), `created_at`

**environments** — `id` (PK), `project_id`, `name`, `slug` (unique per project), `is_default` (exactly one per project via partial unique index), `created_at`, `updated_at`

**alert_channels** — `id` (PK), `name`, `type`, `config` (JSON), `app_id` (nullable; NULL = global), unique per scope (`UNIQUE (app_id, name)` + partial unique on `name` where `app_id IS NULL`)

**alert_rules** — `id` (PK), `name`, `trigger`, `metric`, `operator`, `threshold`, `window_seconds`, `cooldown_seconds` (default 3600), `channel_ids` (JSON), `measurement`, `app_id` (NULL = global), `is_enabled`, `last_triggered_at`, `created_at`, `updated_at`; unique per scope

**alert_incidents** — `id` (PK), `rule_id`, `app_id`, `trigger`, `issue_fingerprint`, `metric`, `value`, `threshold`, `status` (`firing|resolved`), `triggered_at`, `resolved_at`

**issues** — `id` (PK), `app_id`, `fingerprint` (unique per app), `title`, `culprit`, `level` (default `error`), `type` (`error|message`), `first_release`, `last_release`, `status` (`unresolved|resolved`), `event_count`, `first_seen`, `last_seen`, `latest_event_id`, `created_at`, `updated_at`

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
- `list(options)` → `{ data }` (cursor-paginated: `{ cursor?, limit? }`, see §5 Pagination)
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

- Timestamps = `timestamptz` columns (`db/schema/timestamps.ts` → `isoTimestamp`), written and read as ISO-8601 UTC strings (`new Date().toISOString()`), generated in handler/DAO. **Never mix** `Date`, ISO strings, and SQL `CURRENT_TIMESTAMP`.
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
- **Metric Extraction** (`backend/metrics/samples.ts`): `parseEnvelope` + `normalizeTransactionPayload` → every numeric measurement + sentinels → publish `sentry.events` + `sentry.metrics`. Level-gated sentinels: `error_count` when level = `error`, `fatal_count` when level = `fatal` (missing/unknown level ⇒ `error`). OTLP traces are extracted the same way (`backend/otlp/index.ts`).

### Replay Offload (`backend/events/offload.ts`)
- `replay_recording` items → object store **before** NATS publish.
- Key: `replays/<projectId>/<appId>/<replayId|messageId>/<startedAtMs>-<messageId>-<index>.json` (`startedAtMs` zero-padded so lexical order is playback order).
- Stored item keeps `{ key }` pointer; readers resolve at read time (backend-agnostic).
- **Best-effort:** 5s timeout; failure/timeout → payload stays inline, ingestion never affected.

### NATS / ClickHouse Bootstrap
- **Driver:** all backend ClickHouse statements (queries, DDL, engine tables + MVs, TTL seeding) go through Waddler (`waddler/clickhouse` over `@clickhouse/client`).
- **Order:** consumer binary (stream + durable pull consumers `clickhouse-events`, `clickhouse-metrics`) → API (`nats.ts` publish connection + ClickHouse engine tables/MVs) → fail fast.
- **ClickHouse DDL** (engine tables pull via NATS engine):
  ```sql
  CREATE TABLE nats_events (...) ENGINE = NATS SETTINGS nats_stream='SENTRIES', nats_consumer_name='clickhouse-events', nats_subjects='sentry.events', nats_format='JSONEachRow', input_format_skip_unknown_fields=1, nats_skip_broken_messages=10;
  CREATE TABLE sentry_events (...) ENGINE = ReplacingMergeTree() ORDER BY (projectId, receivedAt, id) SETTINGS fsync_after_insert=1, fsync_part_directory=1;
  CREATE MATERIALIZED VIEW sentry_events_mv TO sentry_events AS SELECT ... FROM nats_events;
  ```
- **Metrics tables** mirror exactly (`clickhouse-metrics` consumer).
- **TTL:** `TTL toDateTime(receivedAt) + toIntervalMonth(1)` (1 month default); admin-changeable via Settings → Event Retention; boot only seeds when no TTL exists.
- **Ack:** After MV insert succeeds; failed insert → redelivery.
- **Idempotency:** `ReplacingMergeTree` + `FINAL` reads; duplicates collapse.

### Side-Effects Consumer (`backend/consumer.ts`, `bun run consumer`)
- Runs as its own binary; the API only publishes and ClickHouse ingests by configuration.
- Provisions the `SENTRIES` stream and its durable pull consumers: `clickhouse-events` / `clickhouse-metrics` (ClickHouse's engine tables attach to them).
- Subscribes to `sentry.events` over core NATS (at-most-once) for the Postgres side effects; no side-effect durable is provisioned.
- Applies: issue tracking (`createIfNew` / `regressIfResolved` / `markSeen`), alert triggers (`new_issue`/`regression`), and release tracking (`recordEvent` → first/last seen, event count, latest event id).
- **Never inserts event/metric rows into ClickHouse** — ClickHouse's engine tables own that, so a CH outage never stalls side effects.

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
| `backend/tests/` | In-process (`app.handle(Request)`) | Unit/API tests — no network listener; `Host` header set for DSN consistency |
| `e2e/` | Real socket (docker-compose) | SDK-driven, WebView UI, WebSocket; boots real app vs PGlite |

**Test Command:** `bun run test` = `bun test --parallel=1 backend/tests/ e2e/`
**Helpers:** `backend/tests/test-helpers.ts` — `startTestApp()`, `handleFetch()`, `waitFor(fn)`.

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
- [ ] List endpoints are cursor-paginated → `{ data }` (query `cursor`/`limit`, no `page`/totals).
- [ ] Auth guard applied correctly (admin/ingestion/scoped).
- [ ] New admin GETs for scoped identities added to `SCOPED_READ_PATHS` + filtered with `scopedViewFor(...)`.
- [ ] Debug logs removed.
- [ ] Test added/updated (`backend/tests/` or `e2e/`).
- [ ] `bun run typecheck` and `bun run test` pass.