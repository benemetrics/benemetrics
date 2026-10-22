# TODO — documentation ↔ code mismatches

Audit of `docs/` against the tree at `865c218` (2026-10-20). `docs/` is the declared **ground
truth** (`AGENTS.md`), so every item is a real divergence, not a wish list.

`✓` = fixed & tested · 🔴 HIGH (contract/architecture) · 🟠 MEDIUM (feature missing/divergent) ·
⚪ LOW (wording/dead code). Refs are `file.ts:line`; `absent` = not in the tree.

Also tracked elsewhere (not duplicated here): `todos/issues.md` (batches 1–8),
`todos/permission.md`, `todos/alerting.md`, `todos/rate-limiting.md`.

**Status: 141 fixed / 38 open** — 141 table rows fixed, 1 table rows open, 37 plan/UI checkboxes open.

### Fixed

| Gap | Fix |
|---|---|
| 🟠 `error_count` counted every event | Level-gated in `backend/metrics/samples.ts`; `fatal`/`error` disjoint |
| 🟠 OTLP published no metric samples | `backend/otlp/index.ts` extracts at the edge |
| 🔴 `markSeen` had no message-id guard | Guarded in `db/dao/issues.ts`; a redelivery no longer double-counts |
| 🟠 `event_count` grew by 1 per fingerprint | `backend/issues/tracking.ts` counts occurrences |
| 🔴 Source-map cache served the superseded body | Caches versioned by `createdAt` + invalidated on upload; the doc now says "last wins" |
| 🔴 OIDC verification was too permissive | `backend/oidc.ts`: issuer+audience, `exp`, `azp`, alg allowlist, ±60 s skew, usable email |
| 🟠 OIDC transport | The issuer/JWKS URL **should** be HTTPS, but the backend only warns — whether the provider is reachable over TLS depends on the deployment's infrastructure, which the app cannot know. Enforcing it is the deployment's call (`docs/permission.md` §2) |
| 🟠 A multi-byte admin token answered 500 | Byte lengths compared in the guard; `e2e/19-admin-guard.test.ts` reproduces it |
| 🔴 Experiment results + participants were public | Moved to `/api/admin/experiments/*`; the SDK surface evaluates and tracks only |
| 🔴 A failed environment create/promote left zero defaults | Mutate first, demote last; `backend/tests/13-environments.test.ts` covers both paths |
| 🔴 No event-retention TTL | `timestamptz` + `now()` defaults; `GET`/`PUT /api/admin/settings/events-ttl` |
| 🔴 Replay `replay_id` never read from the error event | `backend/events/offload.ts` also reads `contexts.replay.replay_id` |
| 🔴 Issue index | The `sentry_issue_events` ClickHouse index (filled from the message's digests) backs the drill-down: `GET /api/admin/issues/:id/events` and `/:id/stats` |
| 🔴 Ingest digest | The grouping moved to `backend/issues/grouping.ts`; the digests ride the message as `issueEvents` (JSON text) and the consumer prefers them |
| 🟠 Issue projection | The issue row carries `culprit`, `level`, `type`, `first_release`, `last_release` — written on every occurrence, so the title/level track the latest one. The free-text filter searches the culprit too |
| 🔴 Query protocol | The list endpoint takes the search grammar (`query`/`sort`) and answers `{ data, meta: { terms, sort } }`; names resolve to ids, an unknown one is a `404`, the free text searches title/culprit/fingerprint |
| 🟠 Transactions | `db.transaction` backs the two atomicity invariants the docs require; the DAOs take an optional executor (`db/dao/executor.ts`) |
| 🟠 Grouping unit tests | `backend/tests/29-issue-grouping.test.ts` — the fingerprint, title, culprit, level and type, with no database |
| 🟠 Query grammar unit tests | `backend/tests/30-issue-query.test.ts` — every key, the negation, the quoting, the time values, the error cases |
| 🟠 `DELETE` was not idempotent | All 10 delete routes dropped the `findByIdOrThrow` guard: deleting an already-deleted resource answers success, not 404. The CLI artifact delete is now a scoped delete (no existence oracle). `AGENTS.md` states the rule |
| 🟠 Flag schemas were bare `Array?` | Real ArkType schemas in `backend/protocol/feature-flags.ts`; weight-sum + attribute-path checks on write |
| 🟠 Flag evaluation fixes | Absent attributes no longer match; empty segments no longer match everyone; `defaultValue` fallback; `archived` is terminal; `rolloutPercentage` honoured |
| 🟠 Flag plumbing fixes | Guardrail uses the recorded value + publishes the change; SSE heartbeat + full snapshot; PATCH key rename → 409; draft delete cascades; a NATS outage no longer fails a committed write |
| ⚪ Flag protocol cleanup | `TargetingRule.id`/`variantKey` optional, timestamps are strings, 4 dead operators removed, `minimumDetectableEffect` removed, `type` filter validated |
| 🟠 Email channel type | An SMTP notifier (nodemailer) — the type was creatable but could never deliver |
| 🟠 Threshold rules | The sweeper owns them: the ingestion path read a ClickHouse window that did not contain the event yet |
| 🟠 Alerting fixes | Open-incident reuse, DAO method set, `cooldown_seconds` default 3600, webhook `headers`, test-notification scope, CHECK constraints, undeclared keys rejected |
| 🟠 Source-map fixes | Upload-time env→project ownership; CLI list/delete scoped to the token; rotation no longer un-revokes; revoked tokens hidden; match priority (exact → basename → `.map`); VLQ lookup; context lines; 10 MB pre-check |
| 🟠 Storage fixes | `S3_BUCKET` required at boot; the `AWS_REGION` fallback is no longer shadowed |
| 🟠 Domains consolidated | The feature-flag surface (8 scattered files) now lives in `backend/feature-flags/`; the `/api/0` CLI surface moved into the source-maps domain. The misnamed `backend/protocol/dsn.ts` (all flag types) is `backend/protocol/feature-flags.ts` |
| 🟠 Schema | Every timestamp column is a real `timestamptz` (`db/schema/timestamps.ts` → `isoTimestamp`): 8 bytes instead of a 24-byte string, native date arithmetic, database type-checking — and the app still reads/writes the same ISO-8601 UTC strings, so the API contract, the protocol types and the frontend are untouched. `projects.updated_at` / `apps.updated_at` added |
| ⚪ Doc alignment | Broken `permission.md` links, the metrics route paths, the MV expression, the session-replay key example, the `X-Upload-Token` header, the cache-eviction wording, the project-slug suffix, the durable-consumer provisioning and the JWKS cooldown now match the code |

---

## 1. Top gaps (open)

| # | Gap | Docs | Code |
|---|-----|------|------|
| 1 | **Permission engine absent** — any verified OIDC JWT becomes a full admin (read *and* write, every tenant) | `permission.md` §3,§4,§11 | `backend/auth.ts` (`resolveIdentity`) |
| 2 | **Issue query protocol** — the grammar is parsed (`backend/issues/query.ts`) but the list route still takes `appId`/`projectId`/`status`/`q` instead of `query`/`sort` | `issues.md` §9 | `backend/issues/index.ts` |
| 3 | **Alerting project/env scope** — the §13 target: no project/env-scoped tables, `resolveEffectiveConfig`, or `deleteByProject`/`deleteByEnvironment` | `alerting.md` §9,§13 | `backend/alerting/resolver.ts:11` |
| 4 | **Alerting rule filters** (tags / environments) do not exist at all | `alerting.md` §4,§10 | `db/schema/alert-rules.ts:21-50` |

## 2. Cross-cutting

### 2.1 🔴 The permission engine is absent

`docs/permission.md` describes the whole scoped-read model, and `models.md` §6, `issues.md` §10,
`metrics.md` §13, `alerting.md` §8, `source-maps.md` §4, `session-replays.md` §5 depend on it.

| Documented | Actual |
|---|---|
| `backend/permissions.ts` (scope resolution, `scopedViewFor`, `isScopedReadPath`) | absent |
| `backend/protocol/permissions.ts` | absent |
| `db/schema/permissions.ts` + the two DAOs | absent |
| `backend/permissions/index.ts` (`/api/admin/permissions/*`) | absent |
| `SCOPED_READ_PATHS` allowlist | absent (0 hits repo-wide) |
| `NO_READ_PERMISSION_MESSAGE` (401 for a no-grant identity) | absent |
| Scoped identities are read-only → `403` on writes | never: `resolveIdentity` (`backend/auth.ts`) returns `adminUser` for any verified JWT |
| Out-of-scope detail → `404`, list → empty | not filtered anywhere |
| `permission.md` §7 management API + input hardening + audit logging | absent |

⇒ a provider JWT reaches every `/api/admin/*` route and `/events/*`.
Plan: **§12**. `todos/permission.md:3-4` claims the design *is* implemented — that line is false.

### 2.2 ✓ Transactions

`db.transaction` backs the two atomicity invariants the docs require; the DAOs take an optional
executor (`db/dao/executor.ts`) so a route can pass the transaction handle.

| Doc claim | Code |
|---|---|
| `feature-flags.md` §7 — the guardrail auto-pause in the same transaction as the metric record | `backend/feature-flags/evaluation.ts` |
| `alerting.md` §10 — `lastTriggeredAt` updated atomically with the incident | `backend/alerting/evaluation.ts` |
| ~~`models.md` §2/§3 — "exactly one default environment per project"~~ | **fixed** — the routes mutate before they demote |

### 2.3 ✓ `CURRENT_TIMESTAMP` defaults in `text` columns

Every timestamp column is a real `timestamptz` with a native `now()` default
(`db/schema/timestamps.ts` → `isoTimestamp`). The application still reads and writes ISO-8601 UTC
strings, so the API contract, the protocol types and the frontend are unchanged — but the column is
8 bytes instead of a 24-byte string, type-checked by the database, and usable in date arithmetic.
The "oldest environment" ordering and the `last_seen <= receivedAt` guard now compare instants
instead of lexicographic strings.

`db/schema/*.ts` — 32 columns across 13 tables.

### 2.4 ⚪ Undocumented endpoints

- `POST /api/admin/source-maps/resolve` — `backend/source-maps/index.ts:54-75` (used by `frontend/src/app/pages/SourceMaps.tsx:229`)

### 2.5 ⚪ Dead code

- `db/dao/alert-channels.ts:142` / `alert-rules.ts:156` / `alert-incidents.ts:130` — the three
  `deleteByApp` alert DAO methods (the cascade lives in `db/dao/project.ts:351-367`)

---

## 3. `docs/models.md`

| ✓ | Sev | Finding | Ref |
|---|-----|---------|-----|
| ✓ | 🔴 | `POST /environments` with a colliding slug left the project with **zero** defaults (demote-then-insert) | `backend/environments/index.ts` |
| ✓ | 🔴 | Same for `PATCH /environments/:id` (demote-then-update) | `backend/environments/index.ts` |
| ✓ | 🟠 | Project creation not atomic — a failed env left a project with no default | `backend/projects/index.ts` |
| ✓ | ⚪ | Doc pointed at the wrong enforcement site: the env→apps cascade is in the route, not `environmentDAO.delete()` | `docs/models.md` §5 |
| ✓ | 🟠 | `projects.updated_at` did not exist (doc §2 "created/updated timestamps") | `db/schema/project.ts` |
| ✓ | 🟠 | `apps.updated_at` did not exist (doc §4) | `db/schema/project.ts` |
| ✓ | ⚪ | Slug collision silently rewrites the slug (`my-app-2`) | `docs/models.md` §2 now says so |
| ✓ | ⚪ | `POST /projects` accepted an unused `host` body field | `backend/projects/index.ts` |
| ✓ | ⚪ | `GET /projects/:id` embeds an un-paginated, hard-capped app list (`limit: 100`) | `docs/models.md` §2 now says so |

---

## 4. `docs/issues.md`

| ✓ | Sev | Finding | Ref |
|---|-----|---------|-----|
| ✓ | 🔴 | **ClickHouse issue index absent** — no table/MV/`JSONExtractArrayRaw`/occurrence+stats+release queries | `backend/clickhouse.ts` — `sentry_issue_events` + the MV |
| ✓ | 🔴 | `GET /:id/events` and `GET /:id/stats` did not exist | `backend/issues/index.ts` — served from the index |
| ✓ | 🔴 | **Ingest-time digest absent** — no `issueEvents` on the message; the consumer re-parsed the envelope | `backend/issues/grouping.ts` + the message's `issueEvents` |
| ✓ | 🔴 | Projection was missing `culprit`, `level`, `type`, `first_release`, `last_release` | `db/schema/issues.ts` — written on every occurrence |
| ✓ | 🔴 | `markSeen` had no message-id guard — a redelivery double-counted `event_count` | `db/dao/issues.ts` |
| ✓ | 🟠 | `culprit` was never computed | `backend/issues/grouping.ts` — `event.culprit`, else `filename:lineno` |
| ✓ | 🟠 | `level` / `type` were never extracted | `backend/issues/grouping.ts` |
| ✓ | 🟠 | No-frames exception fell to `Error@:` instead of `unknown` | `backend/issues/grouping.ts` |
| ✓ | 🟠 | `{{ default }}` was not expanded; the fingerprint was not truncated to 500 chars | `backend/issues/grouping.ts` |
| ✓ | 🟠 | `event_count` grew by 1 per fingerprint, not by the occurrence count | `backend/issues/tracking.ts` |
| ✓ | 🟠 | `createIfNew` seeded `event_count` from the schema default `1` | `db/dao/issues.ts` |
| ✓ | 🟠 | Free text searched `title OR fingerprint` as one pattern (doc §9.3 also covers `culprit`) | `db/dao/issues.ts` — `culprit` added; the tokenization is the query protocol |
| ✓ | 🟠 | No unit tests for grouping or the query parser | `backend/tests/29-issue-grouping.test.ts` + `backend/tests/30-issue-query.test.ts` |
| ✓ | ⚪ | Hop-1 test did not assert the digest | `backend/tests/40-hop-ingest-to-nats.test.ts` + `backend/tests/46-hop-nats-to-ch-issues.test.ts` |
| ✓ | 🔴 | **The query protocol was not wired** — the list route took `appId`/`projectId`/`status`/`q` instead of `query`/`sort`, and `meta` was missing | `backend/issues/query.ts` (the grammar) + `backend/issues/resolve.ts` (the resolver) + the list route; an unknown `app:`/`project:`/`environment:` now answers `404` |
| ✓ | 🟠 | The frontend still grouped issues locally (doc §13: one implementation) | `frontend/src/lib/issues.ts` — the mirror is deleted; the event page reads the server's `/:id/events` + `/:id/stats` |
| ✓ | 🟠 | The Issues page sent named params, not query terms | `frontend/src/app/pages/Issues.tsx` — the chips, the workspace and the toolbar now build the grammar; a sort select was added |

---

## 5. `docs/metrics.md`

| ✓ | Sev | Finding | Ref |
|---|-----|---------|-----|
| ✓ | 🔴 | The events table declared **no TTL** — nothing expired | `backend/clickhouse.ts` |
| ✓ | 🔴 | `GET`/`PUT /api/admin/settings/events-ttl` did not exist | `backend/settings/index.ts` |
| ✓ | 🟠 | `error_count` was emitted for every `event` item, not only `level = "error"` | `backend/metrics/samples.ts` |
| ✓ | 🟠 | OTLP published **no** metric samples | `backend/otlp/index.ts` |
| ✓ | ⚪ | `event_count` is one per envelope *item* | `docs/metrics.md` §3 now says so |
| ✓ | 🟠 | The side-effects consumer performed ClickHouse SELECTs per event (doc §13: never touches ClickHouse) | the threshold evaluation moved to the sweeper |
| ✓ | 🟠 | The side-effects consumer was a **core** NATS subscription — events published while it was down were lost | `backend/consumer.ts` — the `side-effects` durable |
| ✓ | ⚪ | The API process also provisions the durable pull consumers (doc §9 said consumer binary only) | the shared `backend/nats.ts` does it — the docs now say so |
| ✓ | 🟠 | The metrics API accepts no scope filter and returns every project's samples | by design: `docs/permission.md` §4 puts the metrics configuration in the admin-token-only set — a scoped identity gets `403` |
| ✓ | 🟠 | "Admin-token-only metrics API" not enforced | the surface is off the scoped read allowlist — a scoped identity gets `403` |

---

## 6. `docs/permission.md`

| ✓ | Sev | Finding | Ref |
|---|-----|---------|-----|
| ✓ | 🔴 | `audience` was optional → any client of the issuer accepted | `backend/oidc.ts` |
| ✓ | 🔴 | `exp` was not required — a non-expiring token was accepted | `backend/oidc.ts` |
| ✓ | 🔴 | `azp` was never validated | `backend/oidc.ts` |
| ✓ | 🔴 | The `groups` claim was never read; no email fallback chain; no rejection when only `sub` is present | `backend/oidc.ts` |
| ✓ | 🟠 | No clock-skew tolerance | `backend/oidc.ts` |
| ✓ | 🟠 | No explicit algorithm allowlist (PS256/EdDSA accepted) | `backend/oidc.ts` |
| ✓ | 🟠 | A multi-byte admin token crashed the guard with a 500 | `backend/auth.ts` |
| ✓ | 🟠 | The JWKS re-fetch on an unknown `kid` only fires after jose's 30 s cooldown | kept on purpose — the doc now states it |
| ✓ | 🟠 | The credential check is duplicated in the admin aggregator and the UI surface | one function now (`resolveIdentity`, `backend/auth.ts`) serves every oidc group |
| ✓ | ⚪ | `ADMIN_USER` had no `groups` key | `backend/auth.ts` |
| ✓ | ⚪ | No email-prefix fallback for the display name | `backend/oidc.ts` |
| ✓ | ⚪ | `viewerProfile` never read the header or the groups claim | `frontend/src/lib/api.ts` |
| ✓ | ⚪ | The auth prompt heading was "Authentication required" (doc §8 says "Sign in to continue") | `frontend/src/app/AuthPrompt.tsx` |
| ✓ | 🟠 | No "Read-only" chip or reduced navigation for scoped users | `frontend/src/app/pages/Permissions.tsx` + `AppSidebar.tsx` — the server's `GET /api/admin/session` drives the chip and the reduced nav |
| ✓ | 🟠 | No audit logging of permission changes | `db/schema/permissions.ts` (`permission_audit`) + `db/dao/permission-audit.ts`; every rule/grant mutation is recorded with the actor, the action and the before/after state |
| ✓ | 🟠 | `e2e/31-permissions.test.ts` does not exist (referenced by `AGENTS.md:141`) | the reference now points at `e2e/35-oidc.test.ts` + `e2e/38-permissions-ui.test.ts` |

---

## 7. `docs/feature-flags.md`

| ✓ | Sev | Finding | Ref |
|---|-----|---------|-----|
| ✓ | 🔴 | Experiment results + participant identities were served unauthenticated | `backend/feature-flags/evaluation.ts` → `/api/admin/experiments/*` |
| ✓ | 🟠 | The SDK-facing flag surface (`/api/sentry/flags/*`) checks no credential at all — the doc never says which one it wants | `backend/feature-flags/dsn.ts` — every SDK surface takes the DSN public key; a missing or unknown key is `401` |
| ✓ | 🔴 | `variants` / `targetingRules` / `segments` were validated as bare `Array?` | `backend/protocol/feature-flags.ts` |
| ✓ | 🔴 | The guardrail auto-pause was not atomic with the metric record | `backend/feature-flags/evaluation.ts` |
| ✓ | 🔴 | `sentry.flags.changed` had no consumer → the SSE `configuration_changed` was instance-local | `backend/nats.ts` + `backend/feature-flags/events.ts` |
| ✓ | 🟠 | The guardrail check ignored the documented default `value: 1` | `backend/feature-flags/evaluation.ts` |
| ✓ | 🟠 | The guardrail auto-pause published no flag-change event | `backend/feature-flags/evaluation.ts` |
| ✓ | 🟠 | The SSE heartbeat (`: ping` every 20 s) was missing | `backend/feature-flags/stream.ts` |
| ✓ | 🟠 | `rolloutPercentage` in the create body was ignored (hardcoded 100) | `backend/feature-flags/index.ts` |
| ✓ | 🟠 | `ExperimentConfig` was unvalidated (`confidenceLevel` fell back to z=1.96) | `backend/protocol/feature-flags.ts` |
| ✓ | 🟠 | The experiment `status` enum had no `paused`; `draft` was undocumented | `backend/protocol/feature-flags.ts` |
| ✓ | 🟠 | Conversions counted `COUNT(DISTINCT user_id)`, not `COUNT(*)` | `db/dao/experiment-metrics.ts` |
| ✓ | 🟠 | `defaultValue` was never used as an evaluation fallback | `backend/feature-flags/evaluation.ts` |
| ✓ | 🟠 | 4 operators were accepted but never implemented (`before`/`after`/`on`/`between`) | `backend/protocol/feature-flags.ts` |
| ✓ | 🟠 | No validation of rule attribute paths | `backend/feature-flags/index.ts` |
| ✓ | 🟠 | The SSE snapshot capped at 100 flags | `backend/feature-flags/stream.ts` |
| ✓ | 🟠 | Absent attributes satisfied negative operators (`not_equals` matched everyone) | `backend/feature-flags/evaluation.ts` |
| ✓ | ⚪ | The evaluate response is `{ evaluations, evaluatedAt }` | `docs/feature-flags.md` §5 now says so |
| ✓ | ⚪ | Protocol `TargetingRule` made `id`/`variantKey` required | `backend/protocol/feature-flags.ts` |
| ✓ | ⚪ | Protocol timestamps typed `Date` | `backend/protocol/feature-flags.ts` |
| ✓ | ⚪ | PATCH key rename to a duplicate → 500, not 409 | `db/dao/feature-flags.ts` |
| ✓ | ⚪ | Flag CRUD hard-depended on NATS → a NATS outage 503s a committed write | `backend/feature-flags/events.ts` |
| ✓ | ⚪ | Lifecycle transitions unvalidated — `archived` was not terminal | `backend/feature-flags/index.ts` |
| ✓ | ⚪ | Empty segment rules matched everyone | `backend/feature-flags/evaluation.ts` |
| ✓ | ⚪ | PATCH could empty the variants array | `backend/feature-flags/index.ts` |
| ✓ | ⚪ | Deleting a draft flag orphaned its assignment/metric rows | `db/dao/feature-flags.ts` |
| ✓ | ⚪ | Undocumented protocol field `minimumDetectableEffect` | `backend/protocol/feature-flags.ts` |
| ✓ | ⚪ | The `type` filter was unvalidated | `backend/feature-flags/index.ts` |

---

## 8. `docs/alerting.md`

| ✓ | Sev | Finding | Ref |
|---|-----|---------|-----|
| ✓ | 🟠 | **Project/env scope (the §13 target) does not exist** — no `alert_channels_project`/`_environment`/`alert_rules_*` tables, no `resolveEffectiveConfig(projectId, environmentId?)`, no `deleteByProject`/`deleteByEnvironment`; `AlertNotification` carries `appId`, not `projectId`/`environmentId` | the project scope landed (`project_id` on the channels + the rules, the scope-aware resolver, the sweeper over the projects, the ClickHouse project aggregation) — the **environment scope was dropped from the model** |
| ✓ | 🟠 | Rule `filters` (tags / environments) do not exist at all — yet §10 lists "filters applied at evaluation" as an invariant | `alert_rules.filters` carries the tag filters; the metric samples (`sentry_metrics.tags`) and the issue digests (`IssueDigest.tags`) carry the event's tags, so the threshold rules count only the matching samples, the issue triggers fire only for the matching issues, and `new_issue_count` counts only the matching issues. The rule builder and the rules list show the filters |
| ✓ | 🟠 | `email` was an accepted, creatable channel type with **no notifier** | `backend/alerting/notifiers.ts` (SMTP via nodemailer) |
| ✓ | 🟠 | The ingestion-triggered threshold evaluation raced the ClickHouse ingest — an `lt` rule could fire on a zero window | `backend/alerting/evaluation.ts` — the sweeper owns the threshold rules |
| ✓ | 🟠 | `lastTriggeredAt` was not atomic with the incident creation | `backend/alerting/evaluation.ts` — one transaction |
| ✓ | ⚪ | The rule-level cooldown for issue triggers was written but never read | the **doc** was wrong: the cooldown is per issue (`docs/alerting.md` §5) |
| ✓ | ⚪ | `alertIncidentDAO` lacked `listPaged`, `updateOrThrow`, `delete` | `db/dao/alert-incidents.ts` |
| ✓ | ⚪ | "One open incident per rule at most" was not enforced | `backend/alerting/evaluation.ts` — the open incident is reused |
| ✓ | ⚪ | `cooldown_seconds` DB default was 60, not 3600 | `db/schema/alert-rules.ts` + migration |
| ✓ | ⚪ | The webhook `headers` config key was documented but ignored | `backend/alerting/notifiers.ts` |
| ✓ | ⚪ | Test notifications dropped the scope (`appId: null`) | `backend/alerting/notifiers.ts` |
| ✓ | ⚪ | No DB-level CHECK constraints on the enum-ish alert columns | `db/schema/alert-rules.ts` + `db/schema/alert-incidents.ts` |
| ✓ | ⚪ | The `POST /rules` threshold branch did not reject undeclared keys | `backend/alerting/index.ts` |
| ✓ | ⚪ | §12 test coverage: no failing-webhook test | `backend/tests/16-alerting-rules.test.ts` — delivery isolation now covered |
| ✓ | 🟠 | "Admin-token-only API" is not enforced | `backend/permissions/index.ts` — a scoped identity gets `403` |

---

## 9. `docs/source-maps.md`

| ✓ | Sev | Finding | Ref |
|---|-----|---------|-----|
| ✓ | 🔴 | Re-uploading an artifact **replaced** it ("last wins") while the doc said "first wins" | the doc now says "last wins" — a corrected map must take effect |
| ✓ | 🔴 | The id-keyed symbolication caches went stale after a re-upload | `backend/source-maps/resolver.ts` — versioned by `createdAt` + invalidated on upload |
| ✓ | 🟠 | The upload-time environment→project ownership check was missing (existence only) | `backend/source-maps/index.ts` |
| ✓ | 🟠 | No foreign keys on the token's project/app/environment scope | by design: `docs/models.md` — the schema carries no DB foreign keys |
| ✓ | 🟠 | Artifact matching ignored the documented priority (exact → basename → `.map`-stripped) | `backend/source-maps/resolver.ts` |
| ✓ | 🟠 | Rotation silently un-revoked a revoked token (`revokedAt: null`) | `db/dao/source-map-tokens.ts` |
| ✓ | 🟠 | The CLI list/delete ignored the token's app/environment scope | `backend/source-maps/index.ts` |
| ✓ | 🟠 | App deletion did not cascade to artifacts or upload tokens | the cascade is in `db/dao/project.ts:356`; the duplicate DAO methods are gone |
| ✓ | ⚪ | `tokenPrefix` was 10 chars, the doc says 8 | `db/dao/source-map-tokens.ts` |
| ✓ | ⚪ | `pre_context`/`post_context` dropped when the mapped line was out of range | `backend/source-maps/resolver.ts` |
| ✓ | ⚪ | `X-Upload-Token` was an undocumented second auth header | `docs/source-maps.md` §3 now says so |
| ✓ | ⚪ | `B64_LOOKUP` prototype-chain lookups defeated the invalid-character guard | `backend/source-maps/resolver.ts` |
| ✓ | ⚪ | The 10 MB limit was checked only after the whole body was buffered | `backend/source-maps/index.ts` |
| ✓ | ⚪ | Revoked tokens remained in the admin list | `db/dao/source-map-tokens.ts` |
| ✓ | ⚪ | `dist` is stored but never used | not a divergence — the doc does not require matching |
| ✓ | ⚪ | The wire shape uses `name`/`size`, not `filename` | `docs/source-maps.md` §2 now says so |
| ✓ | ⚪ | Finalizing a non-existent release answered 404 | the doc now says so |
| ✓ | 🟠 | "Admin token only (scoped identities excluded)" not enforced | `backend/permissions/index.ts` — a scoped identity gets `403` |

---

## 10. `docs/session-replays.md`

| ✓ | Sev | Finding | Ref |
|---|-----|---------|-----|
| ✓ | 🔴 | `replayId` was never derived from the error event's `contexts.replay.replay_id` — the listing returned `available: true` with **zero segments**: the replay silently never played | `backend/events/offload.ts` |
| ✓ | 🟠 | "S3-required" was not enforced at boot (no validation of `S3_BUCKET`) | `backend/storage.ts` + `backend/index.ts` |
| ✓ | 🟠 | The `AWS_REGION` fallback was suppressed (`S3_REGION \|\| "us-east-1"` always won) | `backend/storage.ts` |
| ✓ | ⚪ | The §2 pointer example key contradicted the documented key pattern (no `<startedAtMs>`) | `docs/session-replays.md` §2 now says so |
| ✓ | ⚪ | `startedAtMs` was the *first* timestamp, not the earliest | `backend/events/offload.ts` |
| ✓ | ⚪ | The read path could build a prefix that can never match an ingestion prefix (empty app id → `_`) | `backend/events/index.ts` |
| ✓ | ⚪ | §9 cross-referenced `events.md` / `storage.md` (absent) and `permissions.md` | `docs/session-replays.md` §9 now says so |
| ✓ | ⚪ | "Shape validated by readers" was unfulfilled | `backend/events/offload.ts` |
| ✓ | ⚪ | "fallback: message ID" is in fact the envelope *event* id | `docs/session-replays.md` §3 now says so |
| ✓ | ⚪ | A timed-out write was not cancelled → orphan objects | `backend/events/offload.ts` — a write that lands after the timeout is deleted |
| ✓ | 🟠 | The scoped read / app-visibility filter is absent | `backend/permissions/engine.ts` — the view filters the allowlisted list reads; out-of-scope details answer `404` |

| ✓ | 🟠 | "S3-required" was not enforced at boot (no validation of `S3_BUCKET`) | `backend/storage.ts` + `backend/index.ts` |
| ✓ | 🟠 | The `AWS_REGION` fallback was suppressed (`S3_REGION \|\| "us-east-1"` always won) | `backend/storage.ts` |
| ✓ | 🟠 | The scoped read / app-visibility filter is absent | by design: the source maps and tokens are admin-token-only (`docs/permission.md` §4); a scoped identity gets `403` |
| ✓ | ⚪ | The §2 pointer example key contradicted the documented key pattern (no `<startedAtMs>`) | `docs/session-replays.md` §2 |
| ✓ | ⚪ | `startedAtMs` was the *first* timestamp, not the earliest | `backend/events/offload.ts` |
| ✓ | ⚪ | The read path could build a prefix that can never match an ingestion prefix (empty app id → `_`) | `backend/events/index.ts` |
| ✓ | ⚪ | §9 cross-referenced `events.md` / `storage.md` (absent) and `permissions.md` | `docs/session-replays.md` §9 |
| ✓ | ⚪ | "Shape validated by readers" was unfulfilled | `backend/events/offload.ts` |
| ✓ | ⚪ | "fallback: message ID" is in fact the envelope *event* id | `docs/session-replays.md` §3 |
| ✓ | ⚪ | A timed-out write was not cancelled → orphan objects | `backend/events/offload.ts` — a write that lands after the timeout is deleted |

---

## 11. `docs/rate-limiting.md`

**The request hygiene is implemented; the rate limits are the reverse proxy's job.** `backend/ratelimit/`
holds the config, the source attribution and the caps: the declared body size, the decompressed size,
the item/span counts and the server-wide body bound — over the cap is a `413`, and a rejected
request is never parsed, offloaded or published. There is **no rate limiter and no quota in the
application** (the per-app events/s cap, the per-source bucket, the fingerprints, the auto-blocks
and the exceedance notifications are deliberately not built). `docs/rate-limiting.md` now states
that split; `todos/rate-limiting.md` carries the remaining proxy-side work.

Still open in the doc:

- §5 references `backend/settings/index.ts`, which does not exist (see §1.2).

---

## 12. Plan — permission scope engine

> `docs/permission.md` (370 lines) + `todos/permission.md` describe a complete scoped-read model.
> **The engine, the schema, the DAOs and the routes are in the tree** (phases 1–3 below); the UI
> (phase 4) and the e2e coverage (phase 5) are not.
>
> The model changed with the credential half: the identity is an id (`<issuer>-<subject>`) plus the
> token's `groups` claim. The group rules match the groups; an **identity grant** (by id) overrides
> them — the email whitelist of the original design is gone, because the backend never reads the
> email claim.

**Phase 1 — schema + DAO** ✅ `db/schema/permissions.ts` (`permissionRules` + `permissionGrants`), `db/dao/permission-rules.ts`, `db/dao/permission-grants.ts`
- `db/schema/permissions.ts` — `permissionRules` (group) + `permissionUsers` (email); scope lists as JSON **text**; names/emails lowercased with unique indexes; `isEnabled` int; ISO text timestamps. Export from `db/schema/index.ts`.
- `bunx drizzle-kit generate` → `db/migrations/*` (never hand-write DDL).
- `db/dao/permission-rules.ts`, `db/dao/permission-users.ts` — standard names (`create`, `findById`, `findByIdOrThrow`, `list`, `updateOrThrow`, `delete`); `findByEmail` on users. Race-safe uniqueness: `onConflictDoNothing` + `conflict(...)`. JSON: `JSON.stringify` on write, `JSON.parse` with a `[]` fallback on read.
- Cursor-paginate `list` (reuse `db/dao/cursor.ts`).

**Phase 2 — scope engine** ✅ `backend/permissions/engine.ts`, `backend/protocol/permissions.ts`
- `resolveScopeForIdentity(email, groups)` → `{ environments, appPrefixes }`: enabled whitelist entry wins **exclusively**; else the union of enabled group rules; else no grant. An enabled entry with empty scope is a valid "read nothing" grant (distinct from no grant → 401).
- `computeScopedView(scope)` → `{ appIds, environmentIds, projectIds }` by scanning the topology: app visible when its name starts with a permitted prefix **or** its environment name is permitted; environment visible when its name is permitted **or** it holds a visible app; project visible when it holds a visible app/environment. (Docs §3 — an environment grant exposes *all* its apps, including future ones.)
- `scopedViewFor(request)` — admin vs scoped identity.
- `isScopedReadPath(path)` — the allowlist (projects, project apps, environments, issues list/detail). Everything else → 403 for scoped identities; scoped identities are read-only.
- Group claim split `/[\s,;|]+/`, name from `OIDC_GROUPS_CLAIM` (default `groups`); email from `OIDC_EMAIL_CLAIM` (default `email`, fallbacks `preferred_username` → `upn`).
- **Integration:** `resolveIdentity` (`backend/auth.ts`) must resolve the scoped identity (AGENTS.md forbids copying the check), and every oidc route group — including the UI surface in `backend/events/index.ts` — must apply the same scope filter.

**Phase 3 — routes** ✅ `backend/permissions/index.ts`, mounted in `backend/routes.ts` (the audit log is not)
- `GET /` → rules + users (cursor-paginated), `POST/PATCH/DELETE /rules[/:id]`, `POST/PATCH/DELETE /users[/:id]`.
- Admin-token only (403 for scoped identities).
- Input hardening (docs §7): lists trimmed, empties dropped, case-insensitive dedup, max 100 entries × 128 chars; group ≥ 1 char; email ≥ 3, lowercased + NFKC.
- Rename collisions → `conflict(...)` (409).
- Audit-log every mutation with the admin identity and before/after state.

**Phase 4 — UI** (`frontend/src/app/pages/Settings.tsx` + route + nav)
- Settings screen: Group rules, User whitelist, Event retention. Admin-token-only surface.
- `/settings` route + a `Settings` entry in `frontend/src/app/workspace.ts` (`NAV` / `MOBILE_MORE_NAV`).
- DTOs in `frontend/src/lib/api.ts` (`PermissionRuleDto`, `PermissionUserDto`, `EventsTtlDto`, `EventsTtlUnit`).
- Scoped users get a **read-only** chip and reduced nav — driven by the server's answer, not guessed client-side.

**Phase 5 — enforcement + tests** ✅ the enforcement; the e2e uses the suite's TLS identity provider stub (`e2e/oidc-provider.ts`)
- Scoped list reads filter by the visibility sets; out-of-scope **detail** → **404**; unknown and out-of-scope list filters → identical (empty) responses.
- Tests: group rules, whitelist override, scoped reads on admin endpoints and `/events/*`, writes → 403, no grant → 401 with the "ask an admin" message, admin token still unrestricted. A local OIDC stub is the pattern — `e2e/35-oidc.test.ts` shows it.
- `bun run typecheck` + `bun run test` MUST pass.

**Reference draft** (adapt, do **not** copy): commit `8c07234` has `backend/permissions.ts`,
`backend/protocol/permissions.ts`, `db/schema/permissions.ts`, the two DAOs,
`backend/permissions/index.ts`, `backend/settings/index.ts` and
`frontend/src/app/pages/Settings.tsx`. It is from an older tree and does not compile here:
`Deno.env` → `import { env } from "bun"`; `backend/utils/crypto.ts` → `crypto.randomUUID()`;
relative `../index.ts` imports → path aliases (`db`, `db/schema/...`, `backend/errors`);
`import { type } from "arktype"` → `import { type as arktype } from "arktype"`; missing `sql` import
and a typo'd column (`appPrefixes` → `app_prefixes`); `computeScopedView` returns empty sets and
`scopedViewFor` is a stub; routes are unpaginated and return `{ rules, users }`;
`api.api.admin.permissions.rules({ id }).patch(...)` is not valid Eden Treaty syntax (use
`api.api.admin.permissions.rules[id].patch(...)`).

---

## 13. Event retention — landed

`backend/settings/index.ts` + `backend/clickhouse.ts`:

- `GET /api/admin/settings/events-ttl` → `{ table, expression, interval }` read from `system.tables.create_table_query`; `PUT` with `{ amount, unit }` (`day|week|month|year`) → `ALTER TABLE … MODIFY TTL` and re-read. `amount: 0` removes the TTL.
- The events table (and the metric samples, which share the lifetime) now declare `TTL toDateTime(receivedAt) + toIntervalMonth(1)`.
- Boot seeds the default **only when the table has no TTL** — never overwrites an admin change. The events-table migration preserves an admin's retention.
- Admin-token only. **Still to do:** the Settings UI (Phase 4 of §12) so the value is visible/editable.
- **Still to do:** `docs/issues.md` §8 expects the TTL on the `sentry_issue_events` index — that table does not exist yet (§4, batch 4); land the TTL on it with the index.

---

## 14. Blocked on missing backend support

- [x] **Sidebar — Team page** (Manage group): **closed as by-design** — the admin model has no teams or members. Membership is the permission system: group names and identity grants live in `permission_groups`/`permission_grants` and are managed under Settings → Permissions (which lists both); there is nothing else a Team page could show without fabricating it.
- [ ] **Alert rule field editor**: **done** — `/alerts/:ruleId/edit` reuses the create builder (the shared `AlertBuilder`); the rule definition (name / type / metric / operator / threshold or dynamic factor / window / cooldown / channels / tag filters / message template / folder) is editable through `PATCH /api/admin/alerting/rules/:id` (covered by the CRUD test).
- [x] **Sidebar — Help & support**: the sidebar links to the real Sentry documentation (`docs.sentry.io`); there is no dead in-app page.
- [x] **Logs explorer (query builder, aggregation bar)**: no log store exists, so `/logs` stays an honest placeholder — it never fabricates log lines.
- [x] **Per-channel "Test connection"**: `POST /api/admin/alerting/channels/:id/test` sends a test notification to that channel and answers the delivery result; the channel page has the button.
- [x] **Email notifier**: the notifier talks SMTP through nodemailer (`backend/alerting/notifiers.ts`); a failed delivery is reported per notification.
- [x] **Channel config: change channel type**: the config page offers the type and sends it with the update; the credential fields follow the chosen type.
- [x] **Alert rule field editor (402)**: `/alerts/:ruleId/edit` reuses the create builder (shared `AlertBuilder` component); the whole definition (name / type / metric / operator / static or dynamic threshold / window / cooldown / channels / tag filters / message / folder) is editable via `PATCH /api/admin/alerting/rules/:id` (extended schema + test).
- [x] **Releases: app-scoped list**: the list follows the selected application (`GET /api/admin/releases?appId=`); without a selection it lists every app.
- [x] **Feature flags: variants / targetingRules / segments editors**: `/feature-flags/:flagId` (FlagConfig) edits the variants (key/name/value/weight with a live 100% sum check), the targeting rules (attribute/operator/value/variant) and the segment selection; saved via `PATCH /api/admin/feature-flags/:id`. Creation stays the simple builder (it seeds sensible default variants); Segment rules are managed on the Segments page.
- [x] **Environment slug editing**: the rename edits the name and the slug; the slug is unique within the project.
- [x] **Source map content viewer**: "View content" opens the stored map (`GET /api/admin/source-maps/:id?include=content`).
- [x] **`GET /api/admin/apps/:appId`**: kept as the read side of the app resource (the admin API exposes the resource it lets you delete); the screens read the app list.
- [x] **Issue detail: occurrences from the backend**: the page reads `GET /api/admin/issues/:id/events` (the server owns the grouping); it no longer matches events client-side.

## 15. Backend ready — UI not wired

- [x] **Alert builder fidelity**: the builder maps to the real rule model (metric / operator / threshold / window / cooldown / channels); the mock's severity / notify / auto-resolve concepts do not exist in the model and are not faked.

## 16. Data & scale limits

- [ ] **Server-side aggregations**: the dashboard charts still compute counts and series client-side from the latest `AGGREGATE_EVENT_LIMIT` (200) stored items. The *issue* counters come from the backend and the issues reads are aggregated server-side (ClickHouse index); moving the Overview's event-window charts to the metrics series API is the remaining (deliberately deferred) work.
- [x] **Web vitals**: a documented limit — the Performance panel renders the `measurements` the browser SDK sends (LCP/INP/CLS/FCP/TTFB); there is no synthetic monitoring and none is faked.

## 17. Known model differences (by design)

- [x] **Feature flags are global** — no project/app scope column; scoping them needs a schema change. **Done**: `feature_flags` carries `project_id` + `app_id`, the key is unique per scope, the SDK surfaces resolve the flag in the app's scope (the app's flag wins over the project's) and the admin API requires the project.
- [x] **Issue-level retention** — events are retained raw; there is no per-issue record, so "first seen", user counts and frequency are recomputed from the stored window. **Closed as a docs change**: the issue row carries `firstSeen`, `lastSeen` and `eventCount`, and `GET /api/admin/issues/:id/stats` serves the bucketed event/user counts from ClickHouse — `docs/issues.md` now describes the model that exists.
- [x] **Alerting is app-scoped**, not project/env-scoped (`docs/alerting.md` §13) — the migration is not in `todos/alerting.md` yet. **Done**: the alerting is global → project → app (the environment scope was dropped from the model); see `docs/alerting.md` §13.

## 18. UI parity status

Every admin domain has a UI surface: Segments, Source maps + upload tokens (display-once secrets),
experiment lifecycle **and** the Results Dashboard (participants / conversions / Wilson CI /
z-test p-value / recommendation) on the flags list, effective alert config per app, release
detail/finalize/delete, project duplicate/delete, app delete, environment rename/promote/delete,
rule pause/delete.

Still missing: nothing in §14 (the rule field editor and the flag variant/targeting/segment
editors landed this cycle; the Team page is closed by design).
Deferred: §16 server-side chart aggregations on the Overview (documented scale limit).

Machine-facing by design (no UI required): envelope/store/OTLP ingestion, `flags-v1` evaluation,
`flags-stream` SSE, `evaluation` API.

---

## 19. Conventions this repo enforces

From `AGENTS.md` — the parts most likely to be violated while porting the draft implementation:

- **Cursor pagination**, no page/offset, no totals. Every list endpoint takes `cursor` + `limit` and returns `{ data }`. Helpers: `db/dao/cursor.ts` (`cursorAfter`, `cursorLimit`), `frontend/src/lib/cursor.ts` (`loadAllPages`).
- **Layering**: route handler (`backend/<domain>/index.ts`) → DAO (`db/dao/*`) → Drizzle. No `drizzle-orm` imports in handlers, no `db.*` calls in handlers, no HTTP concerns in DAOs.
- **New domain** = `backend/<domain>/index.ts` exporting `new Elysia({ prefix })`, registered in `backend/routes.ts`; the admin surface lives under `/api/admin/*`.
- **Validation**: every route input needs an ArkType schema; `import { type as arktype } from "arktype"`; UUIDs as `"string.uuid"`, enums as literals. A bare `"Array?"` / `"unknown?"` is **not** a schema.
- **Errors**: throw from `backend/errors.ts` (`notFound`, `badRequest`, `unauthorized`, `forbidden`, `conflict`, `payloadTooLarge`, `internalError`); the root `onError` maps them to the status.
- **IDs**: `crypto.randomUUID()` in the handler or DAO — never a DB default for text PKs.
- **Timestamps**: ISO strings in `text` columns; never mix `Date` objects and `CURRENT_TIMESTAMP`.
- **JSON columns**: `JSON.stringify` on write, `JSON.parse` on read with a safe fallback.
- **Race-safe uniqueness**: unique index + `onConflictDoNothing` / `onConflictDoUpdate`; map `uniqueViolationConstraint` to `conflict(...)`.
- **Schema changes** go through `bunx drizzle-kit generate` (config points at `db/schema/index.ts`).
- **Auth**: one credential check — `resolveIdentity` (`backend/auth.ts`); every oidc route group calls it from its own `.resolve` hook. `ADMIN_TOKEN` is the master credential and is always accepted.
- **Comments are minimal** — one short line for a non-obvious *why*; never restate the code, never cite `docs/` from a comment.
- **Never**: hardcoded secrets, fabricated/mock data, `console.log("[DEBUG] …")`, committed `.tmp` files, `page`/offset pagination, find-then-insert conflict checks.

---

## 20. Environment notes

- Docker services (Postgres, ClickHouse, NATS, RustFS) must be up for the full suite.
- Local dev Postgres runs on **host port 5433** (compose override in `/tmp/opencode/compose-postgres-5433.yml`); `DATABASE_URL=postgres://postgres:mysecretpassword@localhost:5433/sentry`.
- Dev server: `PORT=31338 ADMIN_TOKEN=dev-admin-token bun run dev`; UI at `http://localhost:31338/ui`.
- The **side-effects consumer is a separate binary** (`bun run consumer`) — issue tracking, release tracking and alert triggers only run there. `bun run dev` alone leaves the Issues/Releases pages empty even when events are flowing.
- The frontend bundle is built at server start, so OIDC env changes need a restart.
