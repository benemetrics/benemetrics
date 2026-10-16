# TODO — Gaps vs real Sentry

> Generated from full codebase review. Typecheck passes; e2e tests: 249 pass / 0 fail (self-contained on ephemeral ports).
> What already exists is listed first for context; the TODOs are everything real Sentry has that this code lacks.

## Already implemented (context)

- Ingestion: envelope + legacy store + OTLP/HTTP JSON traces, gzip, span→transaction conversion, DSN auth (`sentry_key`/`X-Sentry-Auth`), idempotent duplicate event ids, no auto-provisioning (unknown apps → `401`)
- Events/issues: raw envelope storage, list/get/clear, on-demand issue metrics grouped by fingerprint (`backend/events/utils.ts:80`)
- Releases: CRUD, finalize, summary; sentry-cli-compatible `/api/0/...releases...` surface with source-map upload (hashed project+environment tokens) and VLQ symbolication on read
- Feature flags: CRUD/lifecycle, evaluation engine (targeting rules, segments, rollout %, weighted bucketing), SSE flag stream, OpenFlag v1 adapter, experiments (assignments/metrics/guardrails/start-stop-promote)
- Alerting: channels (webhook/slack/rocketchat/email-stub), rules (event/error/fatal/new-issue counts, p95/p99 latency), global+per-app overrides, incidents, cooldown, test send, sweeper
- Admin: projects, apps, environments, segments, releases, source maps, tokens, alerting; bearer-token admin auth (always enforced on `/api/admin/*`)

## Platform model

- [ ] Organizations & teams: Sentry's hierarchy is Org → Team → Project; here projects are top-level. Add org/team slugs, memberships, org settings
- [ ] Users/members table and a real OAuth2/OIDC flow with roles/permissions and API/auth tokens. Current model: `ADMIN_TOKEN` is the fallback credential, accepted only while no OIDC/OAuth2 env is configured; once a provider is configured admin auth delegates to it (flow still stubbed, fails closed — `backend/auth.ts`). Built-in dev/test tokens and `admin-*` prefix/length bypasses were removed.

## Issues (biggest gap)

- [ ] `issues` table: issue state (resolved/ignored/snoozed/muted), regression detection, first/last seen, occurrence & user counts, assignees
- [ ] Grouping engine: fingerprinting rules, grouping config, stacktrace-based grouping (today one envelope row = one event; fingerprint only computed ad hoc for release metrics and `new_issue_count` alerts)
- [ ] Issue search (`is:unresolved level:error` syntax), tag/field facets, bulk actions (resolve/merge/delete), similar issues

## Ingest protocol gaps

- [ ] Rate limiting / quotas, `X-Sentry-Rate-Limits` headers, event size caps, sampling
- [ ] PII scrubbing / data scrubbers; GDPR deletion endpoint
- [ ] Handle declared-but-unhandled envelope item types (`backend/protocol/item-header.ts`): `session`, `profile`, `replay_event`, `check_in`, `attachment`
  - [ ] Session health / crash-free rate
  - [ ] Profiling (flamegraphs)
  - [ ] Session replay
  - [ ] Crons/monitors (check-ins, ok/missed/late)
  - [ ] Attachments
- [ ] Parse `sentry_client` for SDK-version telemetry; per-key DSN ingest quotas

## Performance

- [ ] Trace-tree endpoint, Apdex, web-vitals extraction, slow-transaction queries, span metrics

## Integrations & extras

- [ ] Suspect commits / commit tracking; deploys endpoint (`/releases/:version/deploys/`)
- [ ] GitHub/GitLab/Jira/Vercel integrations
- [ ] PagerDuty/Opsgenie/MS Teams notifiers (email is a stub)
- [ ] User-feedback API/UI (envelope `feedback` items are only echoed back)
- [ ] Breadcrumbs API (breadcrumbs currently ride inside event payloads)

## Analytics surface

- [ ] `/api/0/` org/project stats endpoints, time-series stats, Discover/events query API, tag-values endpoints
- [x] Query ClickHouse for stored events (events API list/get read from ClickHouse when available, Postgres fallback)
- [ ] Retention/partitioning policies (PGlite in dev/test, real Postgres in prod)

## Feature flags

- [ ] Evaluation/adoption analytics over time
- [ ] Audit log
- [ ] Webhooks on flag change (SSE exists)

## Frontend

- [ ] Missing pages: dashboards, release list, replay viewer, crons, alerts feed, settings (only IssuesTriage, IssueDetail, Performance, Admin exist)

## Codebase landmines

- [ ] Postgres everywhere: PGlite in dev/test, real Postgres in prod; schema + migrations are the single source of truth (no more SQLite fallback DDL). Watch Bun SQL's `int8` → `BigInt` parsing for raw counts (`count(*)::int` / `db.$count`).
- [ ] Sentry SDKs require numeric DSN project ids; app ingest keys are slug-based, so ingestion resolves apps by public key as a fallback — keep it in mind when changing DSN/routing
- [ ] ClickHouse is the optional events store: pushed best-effort at store time; the events API reads from it when available (Postgres fallback). Postgres stays the source of truth for metrics/alerting — don't move those reads to ClickHouse
