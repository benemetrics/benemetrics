# Backend review — current working tree

Snapshot: **2026-10-18 ~22:52** — branch `master` at `865c218` plus in-flight, uncommitted edits.

**Done this session (instructed):** all admin auth token checks moved into `backend/admin/index.ts` —
the `/api/admin/*` guard, `adminAuthEnforced`, `validateAdminAuth`/`validateAdminToken`,
`logAuthMode`, and `adminUserFor`. Importers updated: `backend/index.ts:12`,
`backend/events/index.ts:7`, `backend/replays/index.ts:3`,
`backend/admin/source-map-tokens/index.ts:7` (now uses `adminUserFor(request)?.id`).
The admin surface itself typechecks clean.

**Deleted by the ongoing rebuild** (tracked → gone, plus the earlier deletions):

| File                       | Status                                                        |
| -------------------------- | ------------------------------------------------------------- |
| `backend/auth.ts`          | deleted — 2 **non-admin** importers remain (§1.1)             |
| `backend/storage/index.ts` | deleted — replaced by 9-line `backend/storage.ts` stub (§1.2) |
| `backend/retry.ts`         | deleted — 2 importers (§1.3, new)                             |
| `db/json.ts`               | deleted — 2 importers (§1.4, new)                             |
| `db/pg-errors.ts`          | deleted — 3 importers (§1.4, new)                             |
| `db/index.ts`              | rewritten again — 8 lines (§1.5)                              |

Evidence: `bun run typecheck` → **15 errors in 14 files**.

---

## 1. Blockers

### 1.1 `backend/auth.ts` deleted; the two _non-admin_ auth checks still point at it (2 errors)

- `backend/events/ingestion.ts:4` — `validateAuth` (SDK `sentry_key` / DSN public-key check)
- `backend/api0/source-maps/index.ts:4` — `validateUploadAuth` (hashed, scoped, expiring upload tokens)

These are ingestion/upload-token checks, not admin token checks, so they are correctly
_not_ part of the admin move — but they need a home now that `auth.ts` is gone.
Restore `auth.ts` (it still holds both functions at HEAD) or relocate the two functions.

### 1.2 `backend/storage/index.ts` deleted; `backend/storage.ts` stub lacks the required exports (4 errors)

The stub only exports `s3Client`. Consumers need:

- `storageRoutes` — `backend/index.ts:7`
- `putObject` — `backend/events/offload.ts:1`
- `getObjectText`, `listObjectKeys` — `backend/replays/index.ts:8`

### 1.3 `backend/retry.ts` deleted — the app cannot boot (2 errors, new since 22:42)

- `backend/nats.ts:4` and `backend/clickhouse.ts:8` import `retryInit`; both call it in
  their `initNats()` / `initClickHouse()` boot paths (`nats.ts:137`, `clickhouse.ts:282`).
- The module is a compile-time import, so the server fails to start at all, not just on
  slow service starts. Restore it or inline a boot-retry helper.

### 1.4 `db/json.ts` + `db/pg-errors.ts` deleted — 5 modules (5 errors, new since 22:42)

- `parseJson` (safe JSON-column read with fallback): `backend/alerting/serialize.ts:13`,
  `db/dao/feature-flags.ts:8`
- `uniqueViolationConstraint` (maps Postgres `23505` → constraint name so DAOs can do
  race-safe `conflict(...)` instead of find-then-insert): `db/dao/alert-channels.ts:9`,
  `db/dao/alert-rules.ts:9`, `db/dao/environments.ts:5`

AGENTS.md requires uniqueness races to be resolved at the DB level via
`uniqueViolationConstraint` → `conflict(...)`; those DAOs currently can't map the error.

### 1.5 `db/index.ts` — 8-line rewrite still breaks the documented DB contract

```ts
if (!process.env.DATABASE_URL) throw "MISSING DATABASE URL"
export const db = drizzle(process.env.DATABASE_URL);
await migrate(db, { migrationsFolder: ... });
```

- Still **no PGlite branch** — dev/test run in-process PGlite per AGENTS.md; without
  `DATABASE_URL` nothing boots, so the e2e suite (`e2e/preload.ts`) cannot run.
- **`closeDb` is gone** → `e2e/preload.ts:11` (per-file PGlite cleanup depends on it).
- No `{ schema }` passed to `drizzle()` — schema-aware query building is disabled.
- Migrations **are** applied now (improvement over the 22:40 variant), but
  `throw "MISSING DATABASE URL"` throws a bare string — use `new Error(...)`.

The earlier variants (Promise-wrapped `db` at 22:39 — 119 DAO errors; no migrations at
22:40) are superseded by this one.

---

## 2. Contract deltas vs the staged `AGENTS.md` / `docs/`

### 2.1 ADMIN_TOKEN semantics inverted (in the deleted `auth.ts`, now living in `admin/index.ts`)

Staged AGENTS.md: "`ADMIN_TOKEN` is the **master/fallback credential** and is always accepted …
NEVER reintroduce … 'provider configured ⇒ admin token ignored'."

The moved code still implements the forbidden behavior: once any of `OIDC_ISSUER` /
`OIDC_CLIENT_ID` / `OAUTH_ISSUER` / `OAUTH_CLIENT_ID` is set, `validateAdminToken()`
rejects _every_ token and `logAuthMode()` prints "ADMIN_TOKEN is ignored".
`e2e/19-admin-guard.test.ts:97-118` pins that behavior today, so changing it is a
contract change: update the tests together with the code. Target per docs: ADMIN_TOKEN
always accepted; a verified provider JWT is an _additional_ identity; JWT verification
in `backend/oidc.ts` (discovery → JWKS → WebCrypto, **no new dependencies**).

### 2.2 The documented permission model is absent

Missing vs staged AGENTS.md / `docs/permission.md`: `backend/oidc.ts`, `backend/permissions.ts`
(group rules + whitelist, lowercased matching), `SCOPED_READ_PATHS` + `scopedViewFor(...)`,
`/api/admin/permissions/*`, `NO_READ_PERMISSION_MESSAGE`.

The `wip/session-rebuild` branch has a rough version — do **not** port it verbatim:

- `SCOPED_READ_PATHS` declared **twice** in its `backend/admin/index.ts`;
- `jose` imports (`jose` is not a dependency; docs require WebCrypto only);
- `crypto.timingSafeEqual(Buffer.from(token), Buffer.from(adminToken))` with **no length guard** —
  throws `RangeError` on different-length tokens instead of returning false (the version now
  in `admin/index.ts` has the length guard — keep it);
- `.ts`-suffixed imports; `sourceMapRoutes` / `alertingRoutes` imported from DAO/protocol files.

### 2.3 Documented event-retention settings surface missing

Staged AGENTS.md names `GET/PUT /api/admin/settings/events-ttl` (Settings → Event retention).
This tree has no `backend/admin/settings`. The wip branch has an `admin/settings/` module —
same port-and-clean decision as 2.2.

---

## 3. Smaller findings in code present in this tree

1. `backend/evaluation/index.ts:277` — `(flag.experiment?.guardrailMetrics ?? []).some((guardrail) => …)`
   — `guardrail` is implicitly `any` (the only non-missing-module typecheck error in the tree).
2. `backend/api0/source-maps/index.ts:1,183` — imports `status` from `elysia` and returns
   `status(201, ...)`. AGENTS.md: handlers never import `elysia` for responses; use `set.status`.
3. `backend/flags-stream/index.ts:31` — a stream opened without `?flags=` snapshots
   `featureFlagDAO.list({ page: 1, limit: 100 })`; flags past the first 100 are silently omitted.
4. `backend/replays/index.ts:21,143` — `MAX_BYTES` is enforced against `text.length` (UTF-16 code
   units), not encoded bytes; multibyte sessions can occupy ~3× the intended memory. Use
   `Buffer.byteLength`.
5. `backend/otlp/convert.ts:133,142` — `event_id` is the OTLP `spanId` (16 hex chars) or
   `randomHex(16)`; Sentry event ids are conventionally 32 hex chars. Confirm nothing assumes 32.
6. `backend/admin/source-map-tokens/index.ts:42` — `createdBy` now falls back to `"admin"` via
   `adminUserFor(request)?.id ?? "admin"`; the fallback string is a literal where the old code
   had the same shape, so behavior is unchanged, but the admin id is now the real user id when
   the token carries one.

---

## 4. What's solid (don't regress during the rebase)

- NATS-first ingestion (`backend/events/ingestion.ts` — 503 on broker failure, no in-process
  fallback), ClickHouse-only events/metrics reads, side-effect consumer staying in Postgres,
  race-safe issue transitions (`backend/issues/tracking.ts`), one-shot `new_issue` / `regression`
  triggers (`backend/alerting/evaluation.ts`).
- arktype validation on route inputs (`type as arktype`), typed errors from `backend/errors.ts`,
  centralized `onError`, pagination shape `{ data, pagination }`.
- Guarded `/events`, `/replays`, `/api/admin/*` (fail closed); upload tokens scoped per
  project/environment (`backend/api0/source-maps`); symbolication with bounded caches
  (`backend/source-maps/resolver.ts`); constant-time token comparison with a length guard.

## 5. Suggested order

1. Give the two non-admin auth functions a home (§1.1) and restore/replace `retry.ts` (§1.3) —
   without these the app does not import or boot at all.
2. Restore/replace `db/json.ts` + `db/pg-errors.ts` (§1.4) — the DAO conflict mapping is a
   documented contract.
3. Finish the storage module (§1.2).
4. Rework `db/index.ts` (§1.5): PGlite for dev/test, `closeDb`, `{ schema }`, `new Error(...)`
   guard — or update AGENTS.md + the test harness in the same change.
5. Reconcile the auth model with staged AGENTS.md (§2.1, tests included) and port the permission
   model cleanly (§2.2–2.3).
6. Then `bun run typecheck` and `bun run test` to green.

## 6. Verification

- `bun run typecheck` (22:52): **15 errors / 14 files** — 0 from the admin surface (the
  instructed move is clean); 2 from the missing non-admin auth functions; 4 from storage;
  2 from `retry.ts`; 5 from `db/json.ts` + `db/pg-errors.ts`; 1 `closeDb`; 1 implicit `any`.
- `bun run test` not run — the app cannot import while §1.1–1.4 are unresolved.
