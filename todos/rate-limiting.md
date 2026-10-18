# Rate limiting — implementation batches & open questions

Moved out of [`docs/rate-limiting.md`](../docs/rate-limiting.md), which describes the design.
**Current state: nothing implemented** — the ingester has no rate limiter, no quotas and no size
caps. Section references (§2, §6, …) point at that document. `bun run typecheck` + full
`bun run test` before every batch.

## Implementation batches

- [ ] 0. Foundation: `TOO_MANY_REQUESTS` code + helper + header passthrough in the root `onError`;
      `backend/ratelimit/config.ts` + `source.ts` (socket IP, trusted hop, IPv6 /64, `TRUST_PROXY`;
      lazy read + test reset); document the reverse-proxy requirement.
- [ ] 1. Request hygiene: ingestion-only `Content-Length` guard + decompressed-size cap in
      `readBody` (incl. the item-header peek and large-envelope switch,
      `INGEST_MAX_LARGE_ENVELOPE_BYTES`), envelope/replay/OTLP item caps; `413` paths; tests.
- [ ] 2. In-process buckets at events/s: per-key + **pre-auth per-source** + global ceiling
      (header-based class detection lands here; the per-key rate uses the code default 20/s until
      batch 4's settings row); charge model (pre 1 / post `items - 1`); `429` + `Retry-After` +
      `X-Sentry-Rate-Limits`; `stats.ts` counters; tests 2–3, 8–9 (the WS-feed piece of 9 in e2e).
- [ ] 3. Fingerprints: post-parse extraction + client-class classification refinement (contexts),
      per-fingerprint bucket (`client` class only), behaviour-based escalation/auto-block (in-memory
      first); tests 1, 4–5.
- [ ] 4. Global + per-app limits & notifications: `rate_limit_settings` (seeded single source — no
      env fallback), `apps.eventsPerSecond` / `notifyChannelIds` / `notifyCooldownMinutes`, resolution
      order, `GET/PATCH /api/admin/rate-limits` + `PATCH /api/admin/apps/:appId/rate-limit`, app + global
      alert fan-out via alert channels with cooldown (global + per-app override, in-memory) — tests
      6–7.
- [ ] 5. Persistence + admin hardening: `ingest_blocks` + `rate_limit_notifications` tables + DAOs,
      rotate-key, manual blocks (source/fingerprint/app), overview (with the blocks list) + block
      create/delete endpoints, `deleteAppCascade` wiring, notification cooldown persisted across
      restarts; `BACKEND_API.md` +
      `AGENTS.md` updates; tests 8.
- [ ] 6. Settings UI (Settings → Rate limits): **global events/s + notification channels in one panel**,
      per-app override/notification table, current rate/429/last-notification, overview + manual
      blocks; e2e UI pass. The user-facing half of this plan.
- [ ] 7. Shared bucket state if we ever run multiple replicas (Postgres or NATS KV); document the switch.

## Open questions

- Reverse-proxy topology (what terminates TLS?) decides `TRUST_PROXY` / trusted-CIDR config and which
  hop the trust rule may use (`X-Real-IP` set by the proxy vs rightmost XFF) — the wrong config
  silently puts every client behind one IP (shared fate) or trusts a spoofable value.
- Rollout: the limiter is **always on** (no master switch) — announce the seeded defaults before
  deploying/upgrading and raise the knobs ahead of time; the emergency off switch is
  `eventsPerSecond = 0` (global or per app = unlimited), with per-source/global env knobs needing a
  restart.
- **Notifications:** send a "recovered" follow-up when the app drops back under its limit? A warning
  at e.g. 80% of the limit, or only on actual exceedance? (recommended v1: exceedance only + optional
  recovery later.)
- Server-class policy: fingerprint enforcement is skipped entirely (§2) — confirm server-side abuse
  blocks (if any) stay manual/admin-only rather than automatic, since one host can't be distinguished
  from a big legit deployment by volume.
- Blocks scope is ingestion only — admin UI and `/events/*` reads must never be limited here.
- Replay/attachment-heavy envelopes may deserve their own lower quota before the per-key bucket.
- Project/org-level limits (sum of apps) — later, if ever needed.
