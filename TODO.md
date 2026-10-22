# TODO

Everything still open lives here — one file, one list. Done work is
**not** tracked; the design decisions and the by-design limits behind the
items below are documented in `docs/` (`docs/rate-limiting.md`,
`docs/permission.md` §3.4, `docs/metrics.md` §8, `docs/issues.md` §8).

## Backend — contract gaps

- [ ] **Reject a provider JWT without `exp`** — `docs/permission.md` §2/§11
      require `exp`; the verifier (`backend/auth.ts`, `jwtVerify`) does not
      pass `requiredClaims` yet, and
      `e2e/35-oidc.test.ts` marks the case `it.todo`.
- [ ] **Server-side aggregations on the Overview** — deliberately deferred:
      the event-window charts still evaluate raw items client-side over the
      last `AGGREGATE_EVENT_LIMIT` (200); the issue counters and the issue
      reads are already aggregated server-side (ClickHouse index). Moving the
      charts to the metrics series API is the remaining work
      (`docs/metrics.md` §8 documents the limit).

## Issues — held (with reason, not scheduled)

- [ ] **Server-side dimension aggregation for the issue metrics panel**
      (browser/OS/release breakdowns over the ClickHouse index) — held: the
      SDKs do not consistently send browser/OS as tags, so an honest aggregate
      would mean new parsed index columns (schema + MV + read). `docs/issues.md`
      §8 records the non-goal; `tag:` filtering already covers what the SDKs
      *do* send, and `release:` breakdowns read the index today.

## Permissions — design follow-ups

- [ ] Organization-level admin concept (only the global `ADMIN_TOKEN` today).
- [ ] Zero-downtime `ADMIN_TOKEN` rotation (today: rotate the env var and restart).
- [ ] JWKS cache invalidation beyond the single re-fetch; scope expansion caching for large deployments.
- [ ] Clock-skew strategy beyond ±60 s; token introspection (RFC 7662) for immediate revocation.
- [ ] Whitelist revocation UX — distinguish a "read nothing" grant from "no grant" in the UI.

## Rate limiting — backlog

The app owns only the per-request hygiene (caps, not quotas) — `docs/rate-limiting.md`
documents why the quota/blocks/notifications stack is deliberately unbuilt:

- [ ] Per-app events/s **quota** + exceedance notifications — needs
      `rate_limit_settings` (seeded single source), the per-app override, the
      admin API and the panel. A quota, not a DoS guard; only then are
      fingerprints/auto-blocks (attribution, not a cap) worth building.
- [ ] Persistence + admin hardening — `ingest_blocks` +
      `rate_limit_notifications`, rotate-key, the manual blocks, the overview.
- [ ] Settings UI (Settings → Rate limits).
- [ ] Shared bucket state if we ever run multiple replicas (Postgres or
      NATS KV) — document the switch.

Open questions carried from the design: the limiter is always on — announce
the seeded defaults before deploying (the emergency off is
`eventsPerSecond = 0`); blocks scope to ingestion only (admin UI and
`/events/*` reads are never limited); replay/attachment-heavy envelopes may
deserve their own lower quota; project/org-level limits later, if ever.

## Environment notes

- Docker services (Postgres, ClickHouse, NATS, RustFS) must be up for the
  full suite (CI + local).
- Local dev Postgres runs on host port **5433**
  (`DATABASE_URL=postgres://postgres:mysecretpassword@localhost:5433/sentry`).
- Dev server: `PORT=31338 ADMIN_TOKEN=dev-admin-token bun run dev`; UI at
  `http://localhost:31338/ui`. The side-effects consumer is a separate
  binary (`bun run consumer`) — issue/release/alert side effects only run there.
- The frontend bundle is built at server start, so OIDC env changes need a restart.
