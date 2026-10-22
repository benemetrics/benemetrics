# Rate limiting — implementation batches & open questions

Moved out of [`docs/rate-limiting.md`](../docs/rate-limiting.md), which describes the design.
**Current state: the request hygiene is implemented; the rate limits are the reverse proxy's job.**
The application bounds the **per-request cost** (the declared body size, the decompressed size, the
item and span counts, the server-wide body bound) and rejects a request before the expensive work.
There is **no rate limiter and no quota in the application** — the per-IP/per-app rates, the
fingerprints, the auto-blocks and the notifications are deliberately not built: the proxy knows the
real client IP, and a quota is not what a DoS needs. Section references (§2, §6, …) point at that
document. `bun run typecheck` + full `bun run test` before every batch.

## Implementation batches

- [x] 0. Foundation: `TOO_MANY_REQUESTS` code + helper + header passthrough in the root `onError`;
      `backend/ratelimit/config.ts` + `source.ts` (socket IP, trusted hop, IPv6 /64, `TRUST_PROXY`;
      lazy read + test reset); document the reverse-proxy requirement.
- [x] 1. Request hygiene: ingestion-only `Content-Length` guard + decompressed-size cap in
      `readBody` (incl. the item-header peek and large-envelope switch,
      `INGEST_MAX_LARGE_ENVELOPE_BYTES`), envelope/replay/OTLP item caps; `413` paths; tests.
      Plus the two non-quota brakes: the retried-event-id dedupe (no offload, no publish) and the
      bounded JetStream stream (`NATS_STREAM_MAX_BYTES` → a `503` under a flood).
- [ ] 2. **The reverse proxy's job** (not the application): the per-IP request rate, the
      connection limits, the TLS termination. The proxy knows the real client IP without trusting a
      header, so it is the better place for it — the application's per-source bucket would have to
      trust `X-Forwarded-For` to be the same value.
- [ ] 3. Fingerprints and auto-blocks: attribution, not a cap — the tuple is client-controlled, and
      the proxy already throttles the source. Only worth building with the per-app quota.
- [ ] 4. Per-app events/s quota + the exceedance notifications: a quota, not a DoS guard. It needs
      `rate_limit_settings` (seeded single source), the per-app override, the admin API and the
      panel.
- [ ] 5. Persistence + admin hardening: `ingest_blocks` + `rate_limit_notifications`, rotate-key,
      the manual blocks, the overview.
- [ ] 6. Settings UI (Settings → Rate limits).
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
