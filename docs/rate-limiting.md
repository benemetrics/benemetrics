# Ingest request hygiene (the application layer)

**Scope — what the application owns and what the proxy owns.** The goal is that a spamming client
SDK cannot DoS the server. That splits in two:

- **The application** (`backend/ratelimit/`): the **per-request cost is bounded** — the declared
  body size, the decompressed size (a gzip bomb is invisible to a proxy), the item and span counts,
  and the server-wide body bound. A request is rejected **before** the expensive work (the parse,
  the replay offload, the publish). These are caps, not quotas: nothing here limits how much a
  client sends over time.
- **The reverse proxy**: the **rate** limits — the per-IP request rate, the connections, the TLS
  termination. The proxy knows the real client IP without trusting a header, so it is the better
  place for it.

Two app-side brakes sit between the caps and the proxy's rates, and neither is a quota:

- **A retried event id is answered without the work** — the id is the idempotency key, so a client
  SDK stuck in a retry loop pays the parse once, not once per attempt (`wasRecentlyIngested` /
  `markIngested`, `backend/events/ingestion.ts`).
- **The JetStream stream's disk is bounded** (`NATS_STREAM_MAX_BYTES`, 1 GiB) — a flood fills the
  stream, the publish fails with a `503`, and the SDK's own retry carries the backpressure back to
  the sender. This is also the fix for the "a long outage grows the disk without limit" landmine.

The per-app events/s quota, per-source bucket, device fingerprints, auto-blocks, and exceedance
notifications are **not implemented in the application** — they are quotas and attribution, and the
proxy plus the per-request caps cover the DoS goal. A fingerprint is client-controlled (attribution,
not a cap); the shared bucket state for multiple replicas would need Postgres or NATS KV and a
documented switch. The full Sentry-style model (cap per key, throttle source, fingerprint clients,
notify on exceedance, rotate/block recovery) is documented below as a design archive only; the
implemented part is the hygiene layer and the two brakes above.

**Status:** implemented — per-request hygiene + two brakes. The quota/block/notification stack is
**deliberately unbuilt** per `AGENTS.md`: "the rate limits (per source, per app) are the reverse
proxy's job." `docs/BACKEND_API.md` carries the ingestion hygiene rules.

**Touchpoints:** `backend/events/ingestion.ts` (`resolveAuthorizedApp`, `readBody`),
`backend/events/index.ts` (envelope / store routes), `backend/otlp/index.ts`, `backend/auth.ts`
(`sentry_key` extraction), `backend/errors.ts` + `backend/index.ts` (root `onError`),
`backend/apps/index.ts` (`deleteAppCascade`). `AGENTS.md` (§Ingestion) and
`docs/BACKEND_API.md` carry the ingestion rules.

**Directives:** the hygiene layer is **local and dependency-free** — it must work with
NATS/ClickHouse down, and it must **never live inside the NATS consumer** (redeliveries must not be
throttled). No durable state for rate limiting.

### The proxy's configuration (the rate dimension)

The request *rate* is the one axis the caps cannot cover: a client sending ten thousand small
requests a second pays the per-request cost ten thousand times. Only a rate limit bounds that, and
the proxy is the right place for it — it knows the real client IP without trusting a header, and it
can drop the connection before the application is involved at all.

Two zones, so a server fleet is not capped like a browser:

```nginx
# A client SDK (browser/mobile): a modest request rate.
map $http_x_sentry_client $sentry_class {
    default        "server";   # an unknown SDK is treated as a server
    ~*browser      "client";
    ~*react-native "client";
    ~*android      "client";
    ~*flutter      "client";
}

limit_req_zone $sentry_binary_remote_addr zone=sentry:10m rate=10r/s;
limit_req_zone $sentry_class       zone=sentry_class:10m rate=200r/s;
```

### 1. Per-request hygiene (the implemented caps)

The backend rejects an ingestion request **before** it parses the body, offloads replay segments, or
publishes to NATS. These are hard bounds — they never throttle by rate, they simply refuse the work.

| Variable | Default | Meaning |
|---|---|---|
| `INGEST_MAX_ENVELOPE_BYTES` | 1 MiB | default envelope cap (streamed in `readBody`) |
| `INGEST_MAX_DECOMPRESSED_BYTES` | 4 MiB | default gzip-bomb cap in `readBody` |
| `INGEST_MAX_LARGE_ENVELOPE_BYTES` | 20 MiB | replaces both caps when `attachment`/`replay_recording` items are declared (also the `Content-Length` outer bound) |
| `INGEST_MAX_OTLP_BYTES` | 4 MiB | OTLP body cap (batches run larger than envelopes) |
| `INGEST_MAX_ENVELOPE_ITEMS` | 100 | item-count cap per envelope (`/store/` = 1) |
| `INGEST_MAX_REPLAY_ITEMS` | 500 | replay envelopes use this instead of the general item cap |
| `INGEST_MAX_OTLP_SPANS` | 1000 | span-count cap per OTLP request |

A request over any cap answers `413 Payload Too Large` with a JSON `{ error }` body; nothing is
written. The caps are **global** (no per-key or per-source state). They live in
`backend/ratelimit/config.ts` (read lazily at call time so test suites can override) and are
enforced in `backend/ratelimit/hygiene.ts` which is called from `readBody` before any parse.

### 2. The two brakes (not quotas)

#### 2.1 Idempotent event id (`wasRecentlyIngested` / `markIngested`)

At ingestion, `backend/events/ingestion.ts` checks whether the `event_id` has been seen recently
(in-memory LRU, TTL ~10 min). A hit skips the object-store offload and the NATS publish entirely,
returning `200` to the SDK. This stops a retry loop from multiplying the work; the first attempt
did the work, the retries are free.

#### 2.2 Bounded JetStream stream (`NATS_STREAM_MAX_BYTES`)

The `SENTRIES` stream is created with `max_bytes: 1 GiB`. If ingestion outpaces the consumer(s),
the stream fills, the publish answers `503 Service Unavailable`, and the SDK's retry carries the
backpressure back to the sender. This is also the valve for the landmine "a long ClickHouse outage
grows NATS disk unboundedly."

### 3. What is not built (design archive)

The following Sentry-style model was designed but is **not implemented** — it is a quota/attribution
stack that belongs at the reverse proxy (or a dedicated rate-limit service), not in the ingestion
application.

#### 3.1 Token buckets (events/second) — not implemented

Four in-process token buckets were specified:
- per app key (the DSN public key)
- per source IP (`client`/`unknown` traffic only; server-class exempt)
- per device fingerprint (`client` class only — IP + SDK major + browser/OS + platform)
- one process-wide ceiling (plain `429`, no Sentry headers)

Each bucket answers `429` + `Retry-After` + `X-Sentry-Rate-Limits` (scope `key` | `project`,
categories `default`, later `error`/`transaction`/`replay`) so real SDKs back off. The charge
model: `1` at pre-parse, `items - 1` top-up at post-parse for the per-key bucket, `items` for the
fingerprint bucket (post-parse only).

#### 3.2 Settings, overrides, notifications, blocks — not implemented

- Single-row `rate_limit_settings`: `eventsPerSecond` (seeded 20), `notifyChannelIds`,
  `notifyCooldownMinutes`.
- Per-app override on `apps`: `eventsPerSecond` (nullable = inherit, `0` = unlimited),
  `notifyChannelIds`, `notifyCooldownMinutes`.
- `rate_limit_notifications` table (cooldown + audit).
- `ingest_blocks` table: scope `source`/`fingerprint`/`app`, unique on `(scope, value)`.
- Admin API: `GET/PATCH /api/admin/rate-limits`, `PATCH /api/admin/apps/:appId/rate-limit`,
  block create/delete, overview.
- Settings panel (Settings → Rate limits): global section, per-app table, overview + blocks.

#### 3.3 Escalation & recovery — not implemented

Auto-block on behaviour signals only (ignoring 429s, key-hopping, invalid-key floods, envelope
bombs), never on volume alone; manual app-scoped block via `ingest_blocks`; DSN rotation
(`POST /api/admin/apps/:appId/rotate-key`); global `eventsPerSecond = 0` as the emergency off
switch.

#### 3.4 Testing — not implemented

The test matrix (burst, key rotation, IP rotation, spoofing, server-class burst, notifications,
overrides, 413/rotate-key/blocks) is documented but no tests exist for the unbuilt stack. The
existing hygiene layer is exercised by the current test suites.

---

*Archive ends here. The implemented layer is sections 1–2; sections 3.x are retained as the
rationale for the reverse-proxy split and are not scheduled.*