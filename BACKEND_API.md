# Backend API & Data-Layer Guide

> Audience: backend engineers (including juniors) working in `backend/` and `db/`.
> Goal: explain how the API is structured, how the database is organized, and the rules we follow so new code looks like it was written by the same person.

---

## 1. Stack at a glance

| Concern            | Choice                                                              |
| ------------------ | ------------------------------------------------------------------- |
| Runtime            | **Bun** (`bun run backend/index.ts`)                                |
| HTTP framework     | **Elysia v1.4** (`elysia`)                                          |
| Validation         | **ArkType** (`arktype`) — via ArkType's `type()` and Elysia schemas |
| ORM                | **Drizzle ORM**                                                     |
| Default DB (dev)   | **PGlite** (Postgres in WASM, file-backed `./.pglite`)              |
| Test DB            | in-memory **PGlite** when `NODE_ENV=test`                           |
| Production DB      | **PostgreSQL** when `DATABASE_URL` is set (`drizzle-orm/bun-sql`)   |
| Migrations         | `drizzle-kit` → `db/migrations/*`, applied at startup               |
| Messaging          | **NATS JetStream** optional (`sentry.events` subject, `SENTRIES` stream; NATS-first ingestion when connected) |
| Analytics store    | **ClickHouse** optional events store (`sentry_events`, `@clickhouse/client`, HTTP `:8123`) |
| Frontend client    | Eden Treaty (`@elysiajs/eden`) consumes the exported `App` type     |

Entry point: **`backend/index.ts`** (exports the Elysia `app` for tests, and listens on start).

---

## 1.1 Business rules

The domain hierarchy is strictly **Project → Environment (shared by apps)**. It MUST NOT be flattened.

- A **project** owns many **apps** (`apps.project_id`); every app belongs to exactly one project.
- A **project** owns many **environments** (`environments.project_id`); every environment belongs to exactly one project and is shared by all of its apps.
- An **app** is created inside an environment (`apps.environment_id`); the same environment may serve many apps.
- An environment **slug** is unique within its project, but the same slug MAY be reused across different projects.
- Every project has **exactly one default environment** (`environments.is_default = 1`):
  - project creation auto-creates a default "testing" environment (and no app);
  - the first environment created becomes the default;
  - promoting another environment to default demotes the previous default;
  - deleting the default promotes the oldest remaining environment.
- Deleting an **app** MUST NOT delete its environments (they are shared); deleting a **project** cascades to its apps AND environments; deleting an **environment** cascades to the apps created inside it.
- Environments are admin-only: exposed exclusively via `/api/admin/environments/*`.

---

## 2. Runtime configuration

| Env var               | Default                                            | Used for                       |
| --------------------- | -------------------------------------------------- | ------------------------------ |
| `PORT`                | `31337`                                            | HTTP server port               |
| `NODE_ENV`            | –                                                  | `test` ⇒ in-memory PGlite      |
| `DATABASE_URL`        | –                                                  | If set ⇒ PostgreSQL            |
| `NATS_SERVERS`        | `nats://localhost:4222`                            | JetStream connection           |
| `CLICKHOUSE_HOST`     | `localhost`                                        | ClickHouse HTTP host           |
| `CLICKHOUSE_PORT`     | `8123`                                             | ClickHouse HTTP port           |
| `CLICKHOUSE_DATABASE` | `default`                                          | ClickHouse database            |
| `CLICKHOUSE_USER`     | `default`                                          | ClickHouse HTTP user           |
| `CLICKHOUSE_PASSWORD` | –                                                  | ClickHouse HTTP password       |
| `NATS_TEST_URL`       | –                                                  | e2e only: enables the NATS broker test (`e2e/21-nats-first.test.ts`) |
| `CLICKHOUSE_TEST_URL` | –                                                  | e2e only: enables the ClickHouse store test (`e2e/22-clickhouse-store.test.ts`) |
| `ALERT_EVALUATION_INTERVAL_MS` | `60000`                                | Alert rule sweeper interval    |
| `ADMIN_TOKEN`         | –                                                  | Admin bearer token; accepted only while no OIDC/OAuth2 env is configured (fails closed when unset) |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID` | –                                       | Presence forces the admin guard on `/events/*` + `/api/dsn/*` |
| `OAUTH_ISSUER`, `OAUTH_CLIENT_ID` | –                                     | Same as OIDC (provider configured) |

- **DB selection logic** lives in `db/index.ts` and is resolved once (singleton `db`):
  `NODE_ENV=test` → in-memory PGlite; else `DATABASE_URL` present → Postgres (Bun SQL); else file-backed PGlite in `./.pglite`. Committed migrations in `db/migrations` are applied at startup (idempotent, tracked in `drizzle.__drizzle_migrations`).
- `docker-compose.yml` provides **Postgres 17** (`:5432`) and **ClickHouse** (`:8123`, `:9000`). NATS must be run separately.

Package scripts (`package.json`):

```bash
bun run dev        # bun --hot backend/index.ts
bun run start      # bun backend/index.ts
bun run test       # bun test e2e/
bun run typecheck  # bun check
```

---

## 3. Directory layout

```
backend/
  index.ts            # App bootstrap: health route, module registration, NATS/ClickHouse, alert sweeper, error handler
  auth.ts             # validateAuth (DSN) + validateAdminAuth + validateAdminToken + adminAuthEnforced (env-driven)
  errors.ts           # ApiError + ErrorCode (NOT_FOUND, ...): thrown by routes/DAOs, mapped by the root onError
  nats.ts             # JetStream publish (NATS-first) + consumer wiring, isNatsConnected
  events-consumer.ts  # applyEventMessage + persistence/live consumers (shared by broker + fallback paths)
  events-store.ts     # Stored-events reads: ClickHouse when available, Postgres fallback
  clickhouse.ts       # Optional events store (@clickhouse/client): best-effort pushes + list/get/clear
  live-events.ts      # WebSocket client registry + live fan-out (/events/live/feed)
  events/
    index.ts          # eventsRoutes (/events/*) + ingestionRoutes (/api/*/*) + alert evaluation hook
    ingestion.ts      # Shared ingestion helpers: resolveAuthorizedApp + NATS-first dispatch
    utils.ts          # Envelope parse/transform helpers (pure functions) + issue fingerprinting
  dsn/
    index.ts          # dsnRoutes (/api/dsn/*) — open in dev/test unless adminAuthEnforced()
  featureFlags/
    index.ts          # featureFlagRoutes (/api/admin/feature-flags/*) — CRUD
  evaluation/
    index.ts          # evaluationRoutes (/api/sentry/flags/evaluate) — flag evaluation engine
  source-maps/
    resolver.ts       # VLQ symbolication + bounded decoded-mappings cache
    serialization.ts  # Shared artifact row → response mapping
  alerting/
    index.ts          # alertingRoutes (/api/admin/alerting/*) — channels, rules, incidents, test send
    notifiers.ts      # Uniform Notifier interface + webhook/slack/rocketchat/email-stub + dispatcher
    resolver.ts       # Global → per-app config resolution (per-name override)
    evaluation.ts     # Metric computation, threshold engine, cooldown, sweeper + issue-trigger firing
    serialize.ts      # JSON column parsing + row → protocol mappers
  issues/
    tracking.ts       # Ingestion-time issue state transitions (new issue / regression)
  admin/
    index.ts          # adminRoutes (/api/admin) — composes featureFlags + projects + segments + ... + issues + alerting
    projects/index.ts # projectRoutes, appRoutes (project + app management)
    segments/index.ts # segmentRoutes (audience segments)
    environments/index.ts # environmentRoutes (project environments, shared by apps)
    releases/index.ts # releaseRoutes + computeIssueMetrics (pure)
    issues/index.ts   # issueRoutes (/api/admin/issues/*) — list/get/resolve
  protocol/           # Type-only interfaces (source of truth: dsn, envelope-header, item-header, otlp, alerting, issues, source-map)
```

---

## 4. How a request flows

1. Bun starts `backend/index.ts`.
2. `new Elysia()` registers, in order: `/health`, then `.use(...)` of each route module.
3. A route handler receives Elysia's context (`{ body, query, params, request, set, status }`).
4. Input is validated by the route's `body` / `query` / `params` schema (ArkType or Elysia `t`).
5. Handler calls a **DAO** from `db/dao/*` — handlers never touch Drizzle directly.
6. DAO runs a Drizzle query and returns a row (or throws an `ApiError` from `backend/errors.ts`, e.g. `notFound(...)`).
7. Handler shapes the HTTP response; errors bubble to the global `onError` handler, which maps `ApiError`s to their HTTP status + `{ error }` and falls back to 500.

Module registration in `backend/index.ts`:

```ts
const app = new Elysia()
  .get("/health", () => ({ status: "ok", timestamp: new Date().toISOString() }))
  .use(eventsRoutes)        // prefix "events"
  .use(ingestionRoutes)     // prefix "api"
  .use(dsnRoutes)           // prefix "dsn"
  .use(featureFlagRoutes)   // prefix "feature-flags"
  .use(evaluationRoutes)    // prefix "api/sentry/flags"
  .use(adminRoutes)         // prefix "/api/admin"
  .onError(({ code, error, set }) => {
    if (error instanceof ApiError) {          // backend/errors.ts
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

## 5. API reference

Prefixes below are written **without** a leading slash only where the source omits it; Elysia normalizes to `/`.

### 5.1 System

| Method | Path      | Description              | Auth |
| ------ | --------- | ------------------------ | ---- |
| GET    | `/health` | Liveness + timestamp     | none |

### 5.2 Events (stored events / issue triage)

`backend/events/index.ts` → `eventsRoutes` (prefix `events`)

| Method | Path                | Query                          | Description                              |
| ------ | ------------------- | ------------------------------ | ---------------------------------------- |
| GET    | `/events/`          | `page`, `limit`, `projectId`, `environmentId`, `appId` | List stored events (ClickHouse when available), envelope → UI shape. `appId` is the most specific scope and wins over `environmentId`; an unknown id returns 404 |
| POST   | `/events/clear`     | –                              | Delete all stored events (both stores)   |
| WS     | `/events/live/feed` | `token`                        | Live event push stream (WebSocket)       |
| GET    | `/events/:eventId`  | –                              | Fetch one event (parsed envelope item)   |

`/events/*` and `/api/dsn/*` require the admin bearer token once `adminAuthEnforced()` is true (production, `ADMIN_TOKEN` set, or OIDC/OAuth env configured); in dev/test without a configured identity provider they are open.

### 5.3 Ingestion (SDK → server)

`backend/events/index.ts` → `ingestionRoutes` (prefix `api`)

| Method | Path                     | Description                                                       |
| ------ | ------------------------ | ----------------------------------------------------------------- |
| POST   | `/api/:projectId/envelope/` | Sentry **envelope** ingestion. Handles `gzip` (`Content-Encoding`). |
| POST   | `/api/:projectId/store/`    | Legacy single-JSON event ingestion (`{ event_id, ... }`).         |

Both routes resolve the target app from the DSN (numeric app number, ingest key or project id in the path, matched against `sentry_key`), validate DSN auth, then persist via `storedEventDAO`. Unknown apps or mismatched keys ⇒ `401`; apps are **never** auto-provisioned during ingestion. Duplicate `event_id`s are ignored (`onConflictDoNothing`) so retries stay idempotent.

### 5.4 DSN management

`backend/dsn/index.ts` → `dsnRoutes` (prefix `api/dsn`)

| Method | Path                | Body / Params                     | Description                  |
| ------ | ------------------- | --------------------------------- | ---------------------------- |
| POST   | `/api/dsn/create`   | `{ projectId, host, publicKey? }` | Create or update the DSN for a project (key optional) |
| GET    | `/api/dsn/:projectId` | `projectId`                     | Fetch DSN for a project      |
| POST   | `/api/dsn/generate` | `{ projectId, host }`             | Create DSN with a fresh key  |

Each project has at most one DSN record; `create`/`generate` upsert on `projectId`. These routes are open in dev/test while no identity provider is configured and require the admin bearer token once `adminAuthEnforced()` is true.

### 5.5 Feature flags — CRUD

`backend/featureFlags/index.ts` → `featureFlagRoutes` (prefix `feature-flags`), mounted only inside `adminRoutes` → effective prefix `/api/admin/feature-flags` (always admin-guarded).

| Method | Path                      | Body                                   | Description                     |
| ------ | ------------------------- | -------------------------------------- | ------------------------------- |
| POST   | `/feature-flags/`         | flag definition (see schema below)     | Create a flag (status `draft`)  |
| GET    | `/feature-flags/`         | `page,limit,status,type,search`        | Paginated list                  |
| GET    | `/feature-flags/:id`      | `id` (uuid)                            | Get one                         |
| PATCH  | `/feature-flags/:id`      | partial flag                           | Update fields                   |
| POST   | `/feature-flags/:id/status` | `{ status }` (`draft\|active\|paused\|archived`) | Change lifecycle status |
| DELETE | `/feature-flags/:id`      | `id` (uuid)                            | Delete — **draft only**         |

Create body (ArkType):

```ts
{
  key: string,
  name: string,
  description?: string,
  type: "boolean" | "string" | "number" | "json",
  defaultValue: string | number | boolean,
  variants?: Array,
  targetingRules?: Array,
  segments?: Array,
  experiment?: string | number | boolean | null
}
```

If `variants` is omitted, the server generates defaults: `boolean` ⇒ `control`/`treatment` 50/50; otherwise a single `default` variant at 100%.

### 5.6 Feature flags — evaluation

`backend/evaluation/index.ts` → `evaluationRoutes` (prefix `api/sentry/flags`, **top-level only**)
`backend/flags-stream/index.ts` → `flagsStreamRoutes` (prefix `api/sentry/flags`, SSE push stream)
`backend/flags-v1/index.ts` → `flagsV1Routes` (prefix `v1/flags`, OpenFeature "OpenFlag"-compatible adapter)

| Method | Path                     | Body                          | Description                       |
| ------ | ------------------------ | ----------------------------- | --------------------------------- |
| POST   | `/api/sentry/flags/evaluate` | `{ user: { id, ... }, flags: string[] }` | Evaluate many flags for one user (Sentry wire format) |
| POST   | `/api/sentry/flags/experiment/track` | `{ flagKey, userId, metric, value? }` | Record an experiment metric |
| GET    | `/api/sentry/flags/stream`   | `?flags`                       | SSE stream of flag changes (`snapshot`, `configuration_changed`) |
| POST   | `/v1/flags/:key`         | `{ targetingKey, context? }`   | Evaluate one flag (OpenFlag wire format: `{ variant, value, reason, errorCode? }`) |

Evaluation order (in `evaluateFlag`):

1. **Targeting rules** — first match wins; attribute paths support `user.*` and `context.*`.
2. **Segments** — all segment rules must match; then weighted bucket by `user.id`.
3. **Rollout percentage** — outside rollout ⇒ `control` (or first) variant.
4. **Default** — weighted assignment by hashed `user.id`. Unknown flag ⇒ `default`/`null`; non-active flag ⇒ control/first variant.

Supported operators: `equals, not_equals, contains, not_contains, starts_with, ends_with, in, not_in, greater_than, less_than, greater_than_or_equal, less_than_or_equal`.

### 5.7 Admin — projects & apps

`backend/admin/projects/index.ts` → `projectRoutes` (effective prefix `/api/admin/projects`)

| Method | Path                                    | Description                       |
| ------ | --------------------------------------- | --------------------------------- |
| POST   | `/api/admin/projects/`                  | Create project (slug auto-derived)|
| GET    | `/api/admin/projects/`                  | List projects (with `appCount`)   |
| GET    | `/api/admin/projects/:id`               | Project detail + `apps`           |
| DELETE | `/api/admin/projects/:id`               | Delete project                    |
| POST   | `/api/admin/projects/:id/duplicate`     | Duplicate project (envs + apps)   |
| GET    | `/api/admin/projects/:id/apps`          | List apps                         |
| POST   | `/api/admin/projects/:id/apps`          | Create app (generates keys + DSN) |

- Project creation auto-creates a default "testing" environment and no app.
- `POST /api/admin/projects/:id/apps` accepts an optional `environment` name: the app is created inside that project environment (reusing it by slug/name when it exists, creating it otherwise); with no preference the project's default environment is used.
- App DSNs use `http://` — the backend serves plain HTTP, so HTTPS deployments front it with a reverse proxy; the DSN host defaults to the request's `Host` header.
- `POST /api/admin/projects/:id/duplicate` accepts `{ name?, slug?, description? }` (name defaults to `"<source> (copy)"`). It creates a new project and copies every environment (fresh ids, same names/slugs, default flag preserved) and every app (fresh id, number, ingest key and public key, so each duplicated app gets its own DSN; name, platform and host are kept). Slug collisions are resolved with `-copy`, `-copy-2`, ... suffixes.
- Apps are removed by deleting their owning project (`appDAO.delete`); environments are project-scoped and shared, so deleting an app leaves them intact and deleting the project removes them (`environmentDAO.deleteByProject`).

### 5.8 Admin — segments

`backend/admin/segments/index.ts` → `segmentRoutes` (effective prefix `/api/admin/segments`)

| Method | Path                       | Body                          | Description                        |
| ------ | -------------------------- | ----------------------------- | ---------------------------------- |
| POST   | `/api/admin/segments/`     | `{ name, description?, rules }` | Create segment                   |
| GET    | `/api/admin/segments/`     | `?page&limit`                 | Paginated list                     |
| GET    | `/api/admin/segments/:id`  | –                             | Get segment                        |

### 5.9 Admin — environments

`backend/admin/environments/index.ts` → `environmentRoutes` (effective prefix `/api/admin/environments`).
Implements the **Project 1..* Environment** business rule (see §1.1).

| Method | Path                                | Body / Query                                   | Description |
| ------ | ----------------------------------- | ---------------------------------------------- | ----------- |
| POST   | `/api/admin/environments/`          | `{ projectId, name, slug?, isDefault? }`       | Create; 404 unknown project, 409 duplicate slug |
| GET    | `/api/admin/environments/`          | `?projectId&page&limit`                        | Paginated list for a project |
| GET    | `/api/admin/environments/:id`       | `id` (uuid)                                    | Get one |
| PATCH  | `/api/admin/environments/:id`       | `{ name?, slug?, isDefault? }`                 | Update; 409 duplicate slug |
| DELETE | `/api/admin/environments/:id`       | `id` (uuid)                                    | Delete; cascades to the apps created in it, then promotes a new default if needed |

- `slug` defaults to a kebab-case derivation of `name`.
- The first environment of a project is always the default; passing `isDefault: true` promotes it and demotes the previous default.
- Environments are shared by the project's apps: deleting an app leaves them intact; deleting a project removes them; deleting an environment cascades to the apps **created inside it** (other apps and the rest of the project are untouched).

### 5.10 Admin — alerting

`backend/alerting/index.ts` → `alertingRoutes` (effective prefix `/api/admin/alerting`).
Global (default) configuration lives in rows with `appId: null`; an
app-scoped row with the same `name` replaces the global one (per-name
override — see `backend/alerting/resolver.ts`).

| Method | Path                                        | Body / Query                                   | Description |
| ------ | ------------------------------------------- | ---------------------------------------------- | ----------- |
| GET    | `/api/admin/alerting/channels`              | `?appId&page&limit`                            | Paginated channels (global scope by default) |
| POST   | `/api/admin/alerting/channels`              | `{ name, type, config?, appId? }`              | Create channel; 409 duplicate name in scope |
| GET    | `/api/admin/alerting/channels/:id`          | `id` (uuid)                                    | Get one |
| PATCH  | `/api/admin/alerting/channels/:id`          | partial `{ name?, type?, config? }`            | Update channel |
| DELETE | `/api/admin/alerting/channels/:id`          | `id` (uuid)                                    | Delete channel |
| GET    | `/api/admin/alerting/rules`                 | `?appId&page&limit`                            | Paginated rules (global scope by default) |
| POST   | `/api/admin/alerting/rules`                 | `{ name, trigger: 'threshold', metric, operator, threshold, windowSeconds, cooldownSeconds?, channelIds?, measurement?, appId? }` or `{ name, trigger: 'new_issue'\|'regression', cooldownSeconds?, channelIds?, appId? }` | Create rule; 409 duplicate name in scope |
| GET    | `/api/admin/alerting/rules/:id`             | `id` (uuid)                                    | Get one |
| PATCH  | `/api/admin/alerting/rules/:id`             | partial rule fields (incl. `trigger`)          | Update rule; switching triggers validates the field set |
| DELETE | `/api/admin/alerting/rules/:id`             | `id` (uuid)                                    | Delete rule |
| POST   | `/api/admin/alerting/rules/:id/test`        | `id` (uuid)                                    | Send test notification through the rule's channels; reports per-channel results |
| GET    | `/api/admin/alerting/apps/:appId/effective` | `appId` (uuid)                                 | Resolved config (global + app overrides merged) |
| GET    | `/api/admin/alerting/incidents`             | `?appId&page&limit`                            | Paginated incident history |

**Channels** (`type` → config): `webhook` `{ url }`, `slack` `{ webhookUrl }` or `{ token, channel }`, `rocketchat` `{ webhookUrl }`, `email` `{ to, from }` (SMTP via nodemailer is planned; currently a stub that reports a delivery failure).

**Rules**: `trigger` ∈ `threshold | new_issue | regression` (default `threshold`, so pre-existing payloads keep working). Threshold rules additionally require `metric` ∈ `event_count | error_count | fatal_count | new_issue_count | latency_p95 | latency_p99`, `operator` ∈ `gt | lt`, `threshold`, `windowSeconds` (evaluation window) and accept `measurement` (latency metrics, default `duration`). Issue triggers carry none of those fields and reject payloads that do; `channelIds` empty ⇒ all effective channels; `cooldownSeconds` is the minimum time between notifications — per rule for `threshold`, per issue for `new_issue`/`regression`.

**Evaluation** (`backend/alerting/evaluation.ts`): threshold rules run fire-and-forget after every ingestion and from a periodic sweeper (`startAlertSweeper`, `ALERT_EVALUATION_INTERVAL_MS`); breaching rules dispatch a uniform `AlertNotification` through every platform via the same `Notifier` interface (`backend/alerting/notifiers.ts`), record an `alert_incidents` row, and respect the cooldown — recovery closes open incidents. Issue triggers (`new_issue`, `regression`) are event-driven instead (see §5.11): ingestion detects the issue-state transition and fires matching rules exactly once; their incidents are recorded already resolved and carry the issue `fingerprint`. Delivery failures are logged and never fail ingestion.

### 5.11 Admin — issues

`backend/admin/issues/index.ts` → `issueRoutes` (effective prefix `/api/admin/issues`).
Issues live in Postgres (source of truth for alerting; ClickHouse stays the optional events read store) and are created/updated by ingestion, never through this API.

| Method | Path                        | Body / Query                  | Description |
| ------ | --------------------------- | ----------------------------- | ----------- |
| GET    | `/api/admin/issues/`        | `?appId&projectId&status&q&page&limit` | Paginated issues, newest `lastSeen` first; `q` matches title/fingerprint (ILIKE) |
| GET    | `/api/admin/issues/:id`     | `id` (uuid)                   | Get one |
| PATCH  | `/api/admin/issues/:id`     | `{ status: 'unresolved'\|'resolved' }` | Resolve or reopen an issue |

- An issue is keyed by `(appId, fingerprint)` (`fingerprint` groups events like Sentry: explicit fingerprint → newest in-app stack frame — SDKs send frames oldest-first, so the crash site is the last frame — → message) and tracks `status`, `eventCount`, `firstSeen`, `lastSeen`, and `latestEventId` (stored event id of the latest occurrence, the UI's drill-down target).
- Ingestion transitions: a first-ever fingerprint → **new issue**; a new event for a `resolved` issue → **regression** (status flips back to `unresolved`, `eventCount` increments). Repeats while unresolved only bump `eventCount`/`lastSeen` and never fire alerts.
- Transitions are race-safe (`onConflictDoNothing` insert + `UPDATE ... WHERE status = 'resolved' RETURNING`), so concurrent deliveries fire exactly one alert.
- Resolving is what arms the `regression` trigger for the issue's next event.
- Issues cascade with the app (`deleteAppCascade`) and are reset by the dev/test event clear (`/events/clear` → `issueDAO.clear()`).

---

## 6. Authentication

Both schemes live in `backend/auth.ts` and are applied via Elysia middleware hooks (`onBeforeHandle`), never copy-pasted per route.

### DSN / Sentry auth (ingestion)
`validateAuth(request, target)` in `backend/auth.ts`:

- Reads `sentry_key` **query param** or `X-Sentry-Auth` header.
- Header form: `sentry_key=XXX, sentry_project=YYY, sentry_client=...`.
- Valid only when the extracted key matches the resolved app's `publicKey`.
- Returns `{ valid, publicKey }`; callers throw `unauthorized("Unauthorized - Invalid DSN")` on failure (no DB writes).

### Admin auth (OAuth2/OIDC not implemented yet)
`validateAdminAuth(request)` in `backend/auth.ts`:

- Requires `Authorization: Bearer <token>` (constant-time comparison; no prefix/length bypass).
- With no identity provider configured, `ADMIN_TOKEN` is the only accepted credential (constant-time comparison); when it is unset the admin API fails closed with 401. There are no built-in dev/test tokens.
- Once `OIDC_*`/`OAUTH_*` is configured, `ADMIN_TOKEN` is ignored and admin auth delegates to the provider (the flow is not implemented yet, so requests fail closed).
- On direct startup the server logs the effective mode via `logAuthMode()`: with an identity provider configured it states that `ADMIN_TOKEN` is ignored; otherwise with no `ADMIN_TOKEN` it warns that `/api/admin/*` rejects every request (set `ADMIN_TOKEN` to log in), and with one configured it states that the configured token is required. The token value is never printed.
- Returns `{ valid, user? }` with a user `{ id, email, name, roles }`.

Guard wiring:

- `/api/admin/*` is **always** guarded: `backend/admin/index.ts` derives the auth result and fails closed in `onBeforeHandle` (401 before any handler runs).
- `/events/*` and `/api/dsn/*` are open in dev/test only while `adminAuthEnforced()` is false — i.e. no `ADMIN_TOKEN`, no `OIDC_*`/`OAUTH_*` env, and not production. As soon as an identity provider is configured they require the same admin bearer token.

---

## 7. Data layer (database)

### 7.1 Tables (`db/schema/*`, all declared with `pgTable`)

**projects**
| column | type | notes |
| --- | --- | --- |
| `id` | text | PK |
| `name` | text | not null |
| `slug` | text | not null, **unique**, indexed |
| `description` | text | default `""` |
| `created_at` | text | default `CURRENT_TIMESTAMP` |

**apps**
| column | type | notes |
| --- | --- | --- |
| `id` | text | PK |
| `number` | serial | not null, **unique** — numeric DSN project id |
| `project_id` | text | indexed |
| `environment_id` | text | not null, indexed (environment the app was created inside) |
| `name` | text | not null |
| `platform` | text | default `javascript` |
| `ingest_key` | text | not null, **unique**, indexed |
| `public_key` | text | not null |
| `host` | text | default `localhost` |
| `created_at` | text | default `CURRENT_TIMESTAMP` |

**dsn_records**
| column | type | notes |
| --- | --- | --- |
| `id` | text | PK |
| `project_id` | text | not null, **unique**, indexed |
| `public_key` | text | not null |
| `host` | text | default `https` |
| `protocol` | text | default `https` |
| `created_at` | text | default `CURRENT_TIMESTAMP` |

**stored_events**
| column | type | notes |
| --- | --- | --- |
| `id` | text | PK (event id) |
| `project_id` | text | indexed |
| `envelope_header` | text | JSON string |
| `envelope_items` | text | JSON string |
| `raw` | text | original envelope body |
| `received_at` | text | indexed |

**feature_flags**
| column | type | notes |
| --- | --- | --- |
| `id` | text | PK |
| `key` | text | **unique**, indexed |
| `name` | text | not null |
| `description` | text | default `""` |
| `type` | text | `boolean\|string\|number\|json` |
| `default_value` | text | not null |
| `variants` | text | JSON string, default `[]` |
| `targeting_rules` | text | JSON string, default `[]` |
| `segments` | text | JSON string, default `[]` |
| `status` | text | default `draft`, indexed |
| `rollout_percentage` | integer | default `100` |
| `experiment` | text | JSON string, nullable |
| `created_at` / `updated_at` | text | default `CURRENT_TIMESTAMP` |
| `created_by` / `updated_by` | text | not null |

**segments**
| column | type | notes |
| --- | --- | --- |
| `id` | text | PK |
| `name` | text | not null, indexed |
| `description` | text | default `""` |
| `rules` | text | JSON string, default `[]` |
| `user_count` | integer | default `0` |
| `created_at` / `updated_at` | text | default `CURRENT_TIMESTAMP` |

**environments**
| column | type | notes |
| --- | --- | --- |
| `id` | text | PK |
| `project_id` | text | not null, indexed (owner project) |
| `name` | text | not null |
| `slug` | text | not null; **unique per project** via `UNIQUE (project_id, slug)` |
| `is_default` | integer | not null, default `0` (1 = project default); exactly one per project via partial unique index |
| `created_at` / `updated_at` | text | default `CURRENT_TIMESTAMP` |

**alert_channels**
| column | type | notes |
| --- | --- | --- |
| `id` | text | PK |
| `name` | text | not null; **unique per scope**: `UNIQUE (app_id, name)` for app scopes plus a partial unique index on `name` where `app_id IS NULL` for global rows |
| `type` | text | `email\|webhook\|slack\|rocketchat` |
| `config` | text | JSON string, default `{}` |
| `app_id` | text | nullable; `NULL` = global (default) channel |
| `created_at` / `updated_at` | text | default `CURRENT_TIMESTAMP` |

**alert_rules**
| column | type | notes |
| --- | --- | --- |
| `id` | text | PK |
| `name` | text | not null; unique per scope (as above) |
| `trigger` | text | `threshold\|new_issue\|regression`, default `threshold` |
| `metric` | text | nullable; `event_count\|error_count\|fatal_count\|new_issue_count\|latency_p95\|latency_p99` (threshold rules only) |
| `operator` | text | nullable; `gt\|lt` (threshold rules only) |
| `threshold` | real | nullable (threshold rules only) |
| `window_seconds` | integer | nullable (threshold rules only; evaluation window) |
| `cooldown_seconds` | integer | default `3600` (min time between notifications; per issue for issue triggers) |
| `channel_ids` | text | JSON string, default `[]`; empty ⇒ all effective channels |
| `measurement` | text | nullable; measurement name for latency metrics |
| `app_id` | text | nullable; `NULL` = global (default) rule |
| `is_enabled` | integer | default `1` |
| `last_triggered_at` | text | nullable (cooldown bookkeeping) |
| `created_at` / `updated_at` | text | default `CURRENT_TIMESTAMP` |

**alert_incidents**
| column | type | notes |
| --- | --- | --- |
| `id` | text | PK |
| `rule_id` | text | not null, indexed |
| `app_id` | text | nullable, indexed |
| `trigger` | text | `threshold\|new_issue\|regression`, default `threshold` |
| `issue_fingerprint` | text | nullable; set on issue-trigger incidents (per-issue cooldown lookup) |
| `metric` | text | nullable (threshold incidents only) |
| `value` | real | nullable (observed metric value) |
| `threshold` | real | nullable |
| `status` | text | default `firing`; `resolved` when the metric recovers (issue-trigger incidents are recorded already `resolved` — one-shot) |
| `triggered_at` | text | not null |
| `resolved_at` | text | nullable |

**issues**
| column | type | notes |
| --- | --- | --- |
| `id` | text | PK |
| `app_id` | text | not null, indexed |
| `fingerprint` | text | not null; **unique per app** via `UNIQUE (app_id, fingerprint)` |
| `title` | text | not null (human-readable: top exception or message) |
| `status` | text | `unresolved\|resolved`, default `unresolved`, indexed |
| `event_count` | integer | default `1` |
| `first_seen` / `last_seen` | text | not null (ISO strings) |
| `latest_event_id` | text | nullable; stored event id of the most recent occurrence (UI drill-down) |
| `created_at` / `updated_at` | text | default `CURRENT_TIMESTAMP` |

**stored_events** (alerting addition)
| column | type | notes |
| --- | --- | --- |
| `app_id` | text | nullable, indexed; set at ingestion so metrics can be computed per app |

### 7.2 DAO conventions (`db/dao/*`)

Each DAO is a plain object exported as `<entity>DAO` (e.g. `storedEventDAO`, `featureFlagDAO`, `environmentDAO`). Standard methods:

- `create(data)` → race-safe insert: `onConflictDoNothing`/`onConflictDoUpdate` on the entity's unique index, then `.returning()`
- `findById(id)` / `findByX(value)` → `select ... where ... limit(1)`, returns `undefined` if absent
- `findByIdOrThrow(id)` → throws `notFound("<Entity>", id)` from `backend/errors.ts` when missing
- `list(options)` → returns `{ data, pagination }` (paginated) or `T[]`
- `updateOrThrow(id, patch)` → update + `.returning()`, 404 when missing
- `delete(id)` → boolean (`.returning()` + `.length`)

**Rules encoded here:**
- Handlers must call DAOs; DAOs own Drizzle queries and throw `backend/errors.ts` `ApiError`s (never `elysia`).
- "NotFound" is a `404` thrown as `notFound(...)`, mapped by the root `onError`.
- Conflicts are database-enforced: `create` inserts with `onConflictDoNothing`/`onConflictDoUpdate` and throws `conflict(...)` when it loses the race; updates map `uniqueViolationConstraint(err)` (`db/pg-errors.ts`) to `conflict(...)`. Never read-then-write to pre-check uniqueness.
- Keys are generated in the handler/DAO with `crypto.randomUUID()`; never rely on a DB default for text PKs.

### 7.3 JSON-in-text columns

`variants`, `targetingRules`, `segments`, `rules`, `experiment`, `envelopeHeader`, `envelopeItems` are `text` columns holding JSON strings. Handlers `JSON.stringify` on write; DAOs `JSON.parse` on read through the shared `parseJson` helper in `db/json.ts` (safe fallback when the column is null or malformed).

### 7.4 Dates & IDs

- Timestamps are `text` ISO strings (`new Date().toISOString()`), generated in the handler/DAO. Don't mix `Date` objects, ISO strings, and SQL `CURRENT_TIMESTAMP` in one table.
- IDs are UUIDs. Prefer `crypto.randomUUID()` (Bun built-in) and generate them at the **call site or DAO**, never rely on the DB (text PKs have no default).

---

## 8. Ingestion pipeline & protocol

- **Envelope format** (`backend/events/utils.ts#parseEnvelope`): line 1 = JSON header, then repeating `{ item header JSON line, payload }`. Payloads are read as `length` bytes (so JSON payloads may contain newlines); when the declared length does not yield valid JSON, or is absent, the newline-terminated line is used for compatibility with hand-written envelopes. Returns `{ header, items }` or `null`.
- `extractEventId`: header `event_id` → event/transaction payload `event_id` → span `trace_id` → random UUID.
- `convertSpanToTransaction`: turns Sentry **span** items (`version: 2`) into transaction-shaped payloads (segment span becomes the transaction; child spans collected; `sentry.measurement.*` attributes become `measurements`).
- `normalizeTransactionPayload`: hoists trace metadata from `contexts.trace`.
- Storage: parsed items are saved to `stored_events` (`raw` keeps the original body) via `storedEventDAO.create`, which uses `onConflictDoNothing` so duplicate `event_id` retries are idempotent (no error, no duplicate row, no re-publish).
- **NATS/ClickHouse** (`initNats`, `initClickHouse`): NATS-first ingestion — with a broker connected the handler publishes the envelope (`publishEvent`, 2s PubAck timeout) and consumers do the work: `sentry-events-consumer` (durable, sequential) persists to Postgres and pushes to ClickHouse best-effort, an ephemeral per-instance consumer fans out to WebSocket clients at `/events/live/feed`, and `sentry-releases-consumer` handles release events. When NATS is unavailable the handler applies the same `applyEventMessage` path in-process. ClickHouse is optional: `initClickHouse` probes and ensures the `sentry_events` table (`appId` included) at boot; stored events are pushed best-effort while it is available, and `/events` list + get read from it with per-request Postgres fallback (`backend/events-store.ts`). `/events/clear` clears both stores.

---

## 9. Known limitations / landmines

1. **One dialect, two drivers**: dev/test run in-process PGlite, production runs real Postgres via `drizzle-orm/bun-sql`; both use `db/schema` + the committed `db/migrations`, so schema drift is impossible. Watch driver-level result parsing (`int8` → `BigInt`/string in Bun SQL; use `count(*)::int` or `db.$count`) and keep `drizzle-kit` pinned to the same RC as `drizzle-orm`.
2. **Sentry SDK DSN constraint**: SDKs require a numeric DSN project id, so every app carries a DB-generated serial `number` used as the DSN path. `resolveApp` resolves numeric paths via `findByNumber` and keeps the ingest-key / project-id + public-key fallbacks for older DSNs; keep those fallbacks when changing ingestion routing.
3. **ClickHouse is the optional events read store**: stored events are pushed best-effort at store time; the events API serves list/get from it when `initClickHouse` succeeded and falls back to Postgres on any failure. Postgres remains the source of truth for writes, metrics and alerting.
4. **Identity providers are stubbed**: `adminAuthEnforced()` is env-driven (`ADMIN_TOKEN`, `OIDC_*`, `OAUTH_*`, `NODE_ENV=production`); there is no real OIDC/OAuth login flow yet.

---

## 10. Rules for the team (aligning junior devs)

### Architecture
1. **Layers are sacred**: Route handler → DAO → Drizzle. Handlers never import `drizzle-orm` or call `db.*` directly; DAOs never build HTTP `Request`/`Response` objects (throwing `backend/errors.ts` `ApiError`s is the exception).
2. **One module = one domain**: add a new domain as `backend/<domain>/index.ts` exporting a `new Elysia({ prefix })`. Register it in `backend/index.ts`. Do not add unrelated routes to existing files.
3. **Compose, don't duplicate prefixes**: if a module belongs under `/api/admin`, mount it inside `adminRoutes`, not at the top level.
4. **Keep `backend/index.ts` thin**: only bootstrap, cross-cutting concerns (health, error handler, external clients). Domain logic lives in modules.

### Types & validation
5. **`backend/protocol/` is the single source of truth for protocol/domain types.** Do not add duplicate type files in modules or `models/`.
6. **Every route with input must declare a schema** (`body`, `query`, and `params` where applicable). Use ArkType (`import { type as arktype } from "arktype"`) consistently. No unvalidated user input.
7. **Never trust the client**: validate UUIDs (`"string.uuid"`), enums (`"'draft' | 'active'"`), and required fields in the schema, not with ad-hoc `if` checks.
8. **Type the DAO return values** (`Promise<T | undefined>`), and prefer exported inferred types (`$inferSelect` / `$inferInsert`).

### Database
9. **IDs**: use `crypto.randomUUID()` (or `string.uuid`) generated in the DAO/handler. Don’t depend on a DB default for text PKs, and don’t add the `uuid` package back.
10. **Dates**: store ISO strings in `text` columns (`new Date().toISOString()`). Don’t mix `Date` objects and SQL `CURRENT_TIMESTAMP` in the same table.
11. **JSON columns**: `JSON.stringify` before write, `JSON.parse` after read (with a safe fallback to `[]`/`null`). Never bind a raw object/array to a `text` column.
12. **Migrations**: schema changes go through Drizzle (`schema: ./db/schema/index.ts`, `out: ./db/migrations` in `drizzle.config.ts`). Generate with `bunx drizzle-kit generate`; `db/index.ts` applies them at startup (idempotent). Do not hand-write DDL or ClickHouse DDL from application code beyond the existing bootstrap.
13. **`select *` is fine for these small tables, but list endpoints must paginate** and return `{ data, pagination: { page, limit, total, totalPages } }` — mirror `featureFlagDAO.list` and `storedEventDAO.list`.
14. **NotFound is a 404**: throw `notFound("<Entity>", id)` from the DAO via the `*OrThrow` helper. Don’t return `{ error }` with a 200.

### Errors & responses
15. **Throw `ApiError`s** from `backend/errors.ts` (`badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`, `payloadTooLarge`, `internalError`) for non-2xx responses; the root `onError` maps them to the HTTP status + `{ error }`. Never build error responses by hand or return a body that implies success.
16. **Fail loudly in logs, quietly to clients**: log details server-side; return stable, generic client errors. Do not leak stack traces.
17. **Remove debug logging** (`console.log("[DEBUG] ...")`) before committing, or gate it behind an env flag.
18. **Never ship fabricated/mock data** (e.g. random counts or hardcoded sample arrays). If a field isn’t real yet, return it as `null` and document it — don’t invent numbers.

### Auth
19. **Centralize auth** in one importable module. Both `validateAuth` and `validateAdminAuth` must live in a shared file and be applied via middleware/`onBeforeHandle`, not copy-pasted per route.
20. **Authorization is enforced on admin routes**: `/api/admin/*` fails closed in `adminRoutes.onBeforeHandle`; UI surfaces (`/events/*`, `/api/dsn/*`) follow `adminAuthEnforced()`.
21. **Secret handling**: never log tokens/keys; never hardcode real credentials. The e2e suite configures its own `ADMIN_TOKEN` in `e2e/preload.ts` — the app ships no built-in tokens.

### Testing & quality gates
22. **Every new endpoint gets an e2e test** under `e2e/` (see `e2e/10-dsn-endpoints.test.ts` for the "start real app on port 0" pattern). Rely on tests, not manual curl, for DSN/ingestion/auth.
23. **Run `bun run typecheck` and `bun run test` before pushing.** Do not commit with type errors.
24. **No `.tmp`, no commented-out dead code, no duplicate files.** If something is unused, delete it.
25. **Consistent naming**: routes plural and kebab-case (`feature-flags`, `stored-events`), DAO methods as in §7.2, files `index.ts` per module.

### External services
26. **NATS/ClickHouse are best-effort**: ingestion publishes NATS-first when the broker is connected and otherwise persists in-process; consumer and ClickHouse failures (push, read, clear) are always logged and never fail the request. Keep it that way — ingestion must not depend on either being up.
27. **Env-driven config only**: read hosts/ports from env; never hardcode `localhost` for anything that runs outside dev.

---

## 11. Quick checklist for any backend change

- [ ] Route declared with an input schema (body/query/params).
- [ ] Logic delegated to a DAO; no Drizzle in the handler.
- [ ] IDs generated with `crypto.randomUUID()`; dates stored as ISO strings; JSON columns stringified.
- [ ] Missing record ⇒ `notFound(...)`, validation error ⇒ `badRequest(...)`.
- [ ] Pagination shape unchanged for list endpoints.
- [ ] Auth guard applied for admin/ingestion routes as appropriate.
- [ ] Debug logs removed.
- [ ] e2e test added/updated in `e2e/`.
- [ ] `bun run typecheck` and `bun run test` pass.
