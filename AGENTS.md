# AGENTS.md

Agent operating rules for this repository. `BACKEND_API.md` is the long-form reference; this file is the contract you MUST follow when writing or changing backend code.

## Project

Lightweight Sentry backend. Bun + Elysia (HTTP) + ArkType (validation) + Drizzle ORM + NATS JetStream + ClickHouse. Frontend consumes the exported `App` type via Eden Treaty. Entry point: `backend/index.ts`.

## Business rules

The domain hierarchy is strictly **Project -> Environment (shared by apps)**. Do not flatten it.

- A **project** owns many **apps** (`apps.project_id`). Every app belongs to exactly one project.
- A **project** owns many **environments** (`environments.project_id`). Every environment belongs to exactly one project and is shared by all of its apps.
- An **app** is created inside an environment (`apps.environment_id`); the same environment may serve many apps.
- An environment `slug` MUST be unique within its project; the same slug MAY be reused across different projects.
- Every project MUST have exactly one default environment (`environments.is_default = 1`). Project creation auto-creates a default "testing" environment; the first environment created becomes the default; promoting another default demotes the previous one; deleting the default promotes the oldest remaining environment.
- Project creation MUST NOT create an app. Apps are created explicitly inside a chosen environment (`POST /api/admin/projects/:id/apps` with optional `environment` name).
- Deleting an app MUST NOT delete its environment (environments are shared); deleting a project cascades to its apps AND environments; deleting an environment cascades to the apps created inside it.
- Environments are exposed only under `/api/admin/environments/*` (admin-guarded); never expose them on an unauthenticated surface.

## Commands

```bash
bun run dev        # hot-reload server
bun run start      # run server
bun run typecheck  # bun check — MUST pass
bun run test       # bun test e2e/ — MUST pass
```

Before finishing any task: run `bun run typecheck` and `bun run test`. Never leave type errors.

## Architecture — mandatory layering

```
Route handler (backend/<domain>/index.ts)  ->  DAO (db/dao/*)  ->  Drizzle
```

- MUST keep handlers free of `drizzle-orm` imports and direct `db.*` calls.
- MUST keep DAOs free of HTTP concerns (exception: throwing the typed errors from `backend/errors.ts`).
- MUST add a new domain as `backend/<domain>/index.ts` exporting `new Elysia({ prefix })`, then register it in `backend/index.ts`.
- MUST keep `backend/index.ts` thin: bootstrap, `/health`, global `onError`, external clients only.
- MUST mount admin domains inside `adminRoutes` (`/api/admin/*`); do NOT add a second top-level surface.
- NEVER add unrelated routes to an existing domain file.

## Validation

- MUST declare a schema for every route input (`body`, `query`, `params`).
- MUST import consistently: `import { type as arktype } from "arktype"` (do not mix with Elysia's `t`/`type`).
- MUST validate UUIDs as `"string.uuid"` and enums as literals (e.g. `"'draft' | 'active'"`).
- NEVER trust unvalidated client input; do not replace schema validation with ad-hoc `if` checks.

## Types

- `backend/protocol/` is the single source of truth for domain/protocol types.
- NEVER add duplicate type files or module-local `*.ts` interface files; shared domain/protocol types belong in `backend/protocol/`.
- MUST use Drizzle inferred types (`$inferSelect` / `$inferInsert`) for DAO signatures.

## Database

- MUST generate IDs with `crypto.randomUUID()` in the handler or DAO; NEVER rely on a DB default for text PKs.
- MUST store timestamps in `text` columns as ISO strings (`new Date().toISOString()`); NEVER mix `Date` objects, ISO strings, and SQL `CURRENT_TIMESTAMP` in one table.
- MUST `JSON.stringify` JSON columns (`variants`, `targetingRules`, `segments`, `rules`, `experiment`, `envelopeHeader`, `envelopeItems`) on write and `JSON.parse` on read with a safe fallback.
- MUST implement DAO methods with the standard names: `create`, `findById`, `findByX`, `findByIdOrThrow`, `list`, `updateOrThrow`, `delete`.
- MUST paginate list endpoints and return `{ data, pagination: { page, limit, total, totalPages } }`.
- MUST make uniqueness race-safe at the database level: resolve conflicts with unique indexes + `onConflictDoNothing`/`onConflictDoUpdate` (or map `uniqueViolationConstraint` to `conflict(...)`); NEVER find-then-insert to pre-check a conflict.
- MUST route schema changes through Drizzle: `bunx drizzle-kit generate` (pinned to the same RC as `drizzle-orm`) writes `db/migrations/*`, which are applied at startup; NEVER hand-write DDL or invent new ClickHouse DDL in app code.

## Errors & responses

- MUST throw errors from `backend/errors.ts` (`notFound`, `badRequest`, `unauthorized`, `forbidden`, `conflict`, `payloadTooLarge`, `internalError`); the root Elysia `onError` maps them to the HTTP status and `{ error }` body. NEVER `throw status(...)` or return `{ error }` with HTTP 200.
- MUST throw `notFound("<Entity>", id)` for missing records (use `*OrThrow`); handlers and DAOs never import `elysia` for responses.
- MUST log details server-side and return generic client errors; NEVER leak stack traces.
- MUST remove `console.log("[DEBUG] ...")` before committing; gate any diagnostic log behind an env flag.
- NEVER ship fabricated/mock data (e.g. random `userCount`, hardcoded `sampleUsers`); return `null` and document instead.

## Auth

- MUST centralize `validateAuth` and `validateAdminAuth` in `backend/auth.ts`; apply via middleware (`onBeforeHandle`), not copy-paste.
- MUST guard `/api/admin/*` with admin auth (Bearer token only, fail closed).
- Token model: `ADMIN_TOKEN` is the fallback admin credential, accepted only while no OIDC/OAuth2 env is configured; once a provider is configured admin auth delegates to it (flow still stubbed, fails closed). Without either, `/api/admin/*` rejects every request. NEVER reintroduce built-in dev/test tokens or prefix/length bypasses.
- UI surfaces (`/events/*`, `/api/dsn/*`) are open in dev/test only while `adminAuthEnforced()` is false (no `ADMIN_TOKEN`, no OIDC/OAuth env, not production); they MUST require the admin token as soon as `adminAuthEnforced()` is true.
- NEVER log or hardcode secrets/keys; the e2e `ADMIN_TOKEN` is test-only configuration defined in `e2e/preload.ts`.

## Ingestion

- NATS-first when the broker is connected: handlers publish via `publishEvent`; `sentry-events-consumer` persists (Postgres + best-effort ClickHouse) and a live consumer fans out to WebSocket clients at `/events/live/feed`. Without NATS the handler applies the same `applyEventMessage` path in-process. Native ingestion MUST NOT depend on NATS/ClickHouse being up.
- MUST treat NATS/ClickHouse failures as best-effort: log and continue, do not fail the request.
- MUST NOT auto-provision projects/apps/DSNs during ingestion. Unknown ingest key/project or a `sentry_key` that does not match the resolved app → `401`, no writes.
- MUST keep ingestion idempotent: duplicate `event_id` inserts are ignored via `onConflictDoNothing` (retries must not 500).
- App resolution order in `resolveApp`: app number (path, DSN) → ingest key (path) → project id (path) + matching public key → public key alone (Sentry SDKs require numeric DSN project ids).

## Testing

- MUST add or update an e2e test in `e2e/` for any new endpoint. Follow the "start real app on port 0" pattern in `e2e/10-dsn-endpoints.test.ts`.
- E2E tests boot the real app against in-memory PGlite; `e2e/preload.ts` (registered in `bunfig.toml`) closes the embedded client after each file, and new test files inherit this automatically.
- NEVER rely on manual curl for DSN/ingestion/auth verification.

## Hygiene

- NEVER commit `.tmp` files, commented-out dead code, or duplicate files; delete unused code.
- MUST follow naming: plural kebab-case route prefixes (`feature-flags`), `index.ts` per module, DAO methods per above.
- MUST read from env for hosts/ports; NEVER hardcode `localhost` outside dev.

## Known landmines (do not reproduce; fix if touched)

- Postgres everywhere: dev/test run in-process PGlite, production runs real Postgres via `drizzle-orm/bun-sql`. Same dialect, same `db/schema`, same `db/migrations` (applied at startup by `db/index.ts`) — never reintroduce a second dialect or hand-maintained DDL.
- Raw counts must use `db.$count(...)` or cast `count(*)::int`: Bun SQL returns `int8` values outside i32 range as `BigInt` while PGlite returns `number`. Report deleted rows via `.returning()` + `.length`, never driver-specific `rowCount`/`changes`.
- Sentry SDKs require a numeric DSN project id: the app DSN path is the DB-generated `apps.number`; `resolveApp` resolves it via `findByNumber` and keeps the ingest-key / project-id + public-key fallback. Keep that fallback when changing ingestion routing.
- App DSNs are always `http://` (the backend serves plain HTTP; TLS is a reverse-proxy concern). NEVER derive `https` from the host name — the wrong scheme makes SDKs fail the TLS handshake.
- ClickHouse is the optional events store (`@clickhouse/client`): stored events are pushed to it best-effort at store time, and the events API list/get reads from it when it is available with Postgres fallback (`backend/events-store.ts`). Postgres stays the source of truth (metrics/alerting never read ClickHouse); keep every ClickHouse path failure-tolerant.
- Replay recording segments are offloaded to S3-compatible storage when `S3_BUCKET` is set (`backend/object-store.ts` + `backend/events/offload.ts`): the stored item keeps a `{ offloaded: true, key, bytes }` pointer and the envelope `raw` body is blanked so the segment is stored nowhere twice. The offload runs at ingestion before NATS/store and is best-effort — disabled without S3 config, and a failed or timed-out upload keeps the payload inline. NEVER fail, delay past the bound, or lose ingestion because of the object store.
- Issue state (`issues` table, unique per `(app_id, fingerprint)`) lives in Postgres and drives the `new_issue`/`regression` alert triggers **event-driven at ingestion** (`processIngestedEvent` → `backend/issues/tracking.ts`), with race-safe transitions (`onConflictDoNothing`, `WHERE status = 'resolved'`). NEVER move issue detection into the metric sweeper — the sweeper evaluates `threshold` rules only, and re-running transitions would re-fire one-shot alerts. Resolve via `PATCH /api/admin/issues/:id`; the resolve flips the status that the regression trigger watches.

For full endpoint tables, schema columns, and rationale, see `BACKEND_API.md`.
