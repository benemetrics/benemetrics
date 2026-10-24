# TODO

Everything still open lives here — one file, one list. Done work is
**not** tracked; the design decisions and the by-design limits behind the
items below are documented in `docs/` (`docs/rate-limiting.md`,
`docs/permission.md` §3.4, `docs/metrics.md` §8, `docs/issues.md` §8).

## Backend — contract gaps

- [ ] **Server-side aggregations on the Overview** — deferred: the charts are
      no longer item-capped — the fetch is time-based (`since` bounds the
      events list to the selected window, 24 h / 7 d); moving the
      aggregation to the metrics series API is only worth it when the
      window's event count makes the refetch heavy
      (`docs/metrics.md` §8 documents the current design).

## Issues — held (with reason, not scheduled)

- [ ] **Server-side dimension aggregation for the issue metrics panel**
      (browser/OS/release breakdowns over the ClickHouse index) — held: the
      SDKs do not consistently send browser/OS as tags, so an honest aggregate
      would mean new parsed index columns (schema + MV + read). `docs/issues.md`
      §8 records the non-goal; `tag:` filtering already covers what the SDKs
      *do* send, and `release:` breakdowns read the index today.

## Permissions — design follow-ups

- [ ] Organization-level admin concept (only the global admin token today).
- [ ] Scope expansion caching for large deployments.

## Rate limiting — reverse-proxy owned

Per `AGENTS.md` (Hygiene landmine): the app owns only the **per-request hygiene
layer** (caps — `413` for oversized bodies, gzip bombs, item/span counts in
`backend/ratelimit/hygiene.ts` and `backend/ratelimit/config.ts`). Quotas,
blocks, notifications, and the Settings panel are **not built**; they are the
reverse proxy's job. `docs/rate-limiting.md` §1–§3 records the implemented
hygiene; §4+ is retained as a design archive only.

## Environment notes

- Docker services (Postgres, ClickHouse, NATS, RustFS) must be up for the
  full suite (CI + local).
- Local dev Postgres runs on host port **5433**
  (`DATABASE_URL=postgres://postgres:mysecretpassword@localhost:5433/sentry`).
- Dev server: `PORT=31338 bun run dev`; UI at
  `http://localhost:31338/ui`. The side-effects consumer is a separate
  binary (`bun run consumer`) — issue/release/alert side effects only run there.
- The frontend bundle is built at server start, so OIDC env changes need a restart.
