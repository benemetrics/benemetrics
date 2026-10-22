# Ingest rate limiting & abuse control — design

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

The per-app events/s quota, the per-source bucket, the device fingerprints, the auto-blocks and the
exceedance notifications of the original design are **not implemented in the application** — they
are quotas and attribution, and the proxy plus the per-request caps cover the DoS goal. The design
below is kept as the rationale for that split; the parts that are implemented are marked.

**Status:** design paper — how the ingest rate limiter is designed to work; the implementation
order, open questions and current status live in
[`todos/rate-limiting.md`](../todos/rate-limiting.md). Problem being solved: the DSN public key is
the only credential (`backend/events/ingestion.ts` → `resolveAuthorizedApp`), so **anyone holding
a copied DSN can write unlimited events for that app** (`TODO.md` §"Ingest protocol gaps"). The
design adds the Sentry-style model: cap per key, throttle the source, fingerprint suspicious
clients, notify on exceedance, and keep a recovery path (rotate / block).

**Touchpoints:** `backend/events/ingestion.ts` (`resolveAuthorizedApp`, `readBody`),
`backend/events/index.ts` (envelope / store routes), `backend/otlp/index.ts`, `backend/auth.ts`
(`sentry_key` extraction), `backend/errors.ts` + `backend/index.ts` (root `onError`),
`backend/apps/index.ts` (`deleteAppCascade`), `db/schema/project.ts`. `AGENTS.md`
(§Ingestion) and `BACKEND_API.md` carry the ingestion rules.

**Directives:** the limiter is **local and dependency-free** — it must work with NATS/ClickHouse down,
and it must **never live inside the NATS consumer** (redeliveries must not be throttled). Durable
state only for admin-managed settings, overrides and blocks. Notifications are always fire-and-forget.

**Model in one paragraph.** Four in-process token buckets at **events/second** — per app key, per
source IP (`client`/`unknown` traffic only), per device fingerprint (`client` only) and one
process-wide ceiling — answer `429` + `Retry-After` + `X-Sentry-Rate-Limits` so real SDKs back off.
Fingerprints hash the IP + SDK major + browser/OS + platform of a client request; server SDKs are
exempt from source/fingerprint throttling (their cap is the per-key quota). Settings live in one
`rate_limit_settings` row with per-app overrides, managed from Settings → Rate limits; exceedance
and block alerts go to existing alert channels (fire-and-forget); sustained abuse is stopped with
persisted `ingest_blocks` plus DSN rotation. Enforcement is local, fail-open and always on.

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

server {
    client_max_body_size 20m;   # the application's caps are the real bound
    location /api/ {
        limit_req zone=sentry burst=20 nodelay;                 # browser/mobile
        limit_req zone=sentry_class burst=100 nodelay;           # server SDKs
        proxy_pass http://backend;
    }
}
```

The two knobs map onto the doc's layers: the per-source bucket (§2.2) and the global ceiling
(§2.4). The per-app quota (§2.1) and the per-fingerprint bucket (§2.3) stay unimplemented — the
first is a quota, the second is attribution.

## 0. Threat model

| # | Abuse | Baseline | Target |
|---|-------|-------|--------|
| A | Stolen/reused DSN: one key, bulk spam | accepted (401 only for unknown keys) | per-key token bucket → 429 |
| B | Key-hopping: many public DSNs from one source to bypass per-key limits | unlimited | per-source (IP) bucket across all apps (`client`/`unknown` traffic) |
| C | Shared-limiter DoS: trip the legit app's limit so its events drop | structural risk of any per-key limit | per-source limits + source blocks; victim can rotate the DSN |
| D | Resource exhaustion: PG/CH rows, S3/local replay segments, NATS disk | unbounded | size caps, item caps, per-key quotas |
| E | Envelope bombs: huge body / gzip bomb | `readBody` gunzips unbounded | content-length + decompressed-size caps |
| F | Key brute force | 32-char random key, fast 401 | per-source bucket (`client`/`unknown`) + global ceiling |

Non-goals: authenticating senders (impossible for a public DSN), blocking determined spoofers
(fingerprints are attribution/cost, not identity), storing raw IPs beyond the live bucket (hash
fingerprints, short TTLs, no raw IPs in logs by default).

**False-positive guard:** the abuser model must not collide with legitimate server traffic. A single
service host can push a large burst (incident error storm, batch backfill) through one IP, and for
server SDKs the whole fingerprint tuple collapses to one value — see §1 "client classes" and §2.

## 1. Fingerprint inputs (what we actually have)

**Pre-body (header-only — cheap, runs on every request):**

- **IP** — Bun socket IP (`server.requestIP(request)`); behind a proxy the **trusted hop only**
  (`X-Real-IP` / rightmost `X-Forwarded-For`, §4) when `TRUST_PROXY` is on (§8). Not available under
  `app.handle` (in-process API tests) — see §9.
- **SDK** — `X-Sentry-Auth` carries `sentry_client=sentry.javascript.browser/9.1.0` plus
  `sentry_version` / `sentry_key` (the limiter also reads `sentry_client`). `User-Agent`
  is a fallback (server SDKs set their own UA; browsers send the page UA).
- **Body shape** — `Content-Length`, `Content-Encoding` (gzip is decompressed in `readBody`).

**Post-parse (envelope/event, after `parseEnvelope`):**

- envelope header: `sdk { name, version }`, `dsn`, `sent_at`;
- event item: `sdk`, `platform`, `release`, `environment`, `contexts.browser { name, version }`,
  `contexts.os { name, version }`, `contexts.runtime`, and the envelope's item types
  (`event` / `transaction` / `replay_recording` / …).

**Proposed tuple** (hashed, never stored raw):

```
fp = sha256(app.id | ip | sdk.name@sdk.major | browser.name | os.name | platform)
```

- Fingerprint on **names + SDK major version only**: browser and SDK patch versions churn constantly
  (every Chrome update would mint a new fingerprint). Keep the full version for stats/overview.
- Fallback tuple when the body is unparseable: `sha256(app.id | ip | sdk.name@sdk.major | ua-family)`
  (same rules: app-scoped, major version only).
- Extra free signals: item types (`replay_recording`-only from a browser SDK is suspicious), release
  churn, **per-IP distinct-key count** (key-hopping counter).

### Client classes — the tuple means different things per class

Classify each request from the SDK name (`sentry.javascript.browser`, `sentry.javascript.react-native`,
`sentry.python`, `sentry.go`, …) plus the presence of `contexts.browser` / `contexts.os`:

- **`client` (browser/mobile):** one fingerprint ≈ one device/install. Many distinct fingerprints per
  app are normal; a single fingerprint flooding is genuinely abnormal.
- **`server` (Node/Python/Go/…):** the tuple **collapses to `(app, ip, sdk)`** — one host, no
  browser/OS context, and all of a service's traffic is "one fingerprint". A legit server can push a
  big burst. Server-class fingerprints are **stats/attribution only — never an enforcement unit**
  (§2, §5): the cap for server traffic is the per-key quota, and the block signal is behaviour
  (ignoring 429s, key-hopping), not volume.
- **`unknown` (no recognized client/server signal — includes no/unparseable body):** header signals
  only — the fallback tuple above.

Resolution: a recognized SDK name decides the class; with no recognized name,
`contexts.browser` / `contexts.os` presence means `client`, otherwise `unknown`. Pre-body only the
name/UA is available — `contexts.*` is the post-parse refinement the fingerprint bucket uses.

Class detection is spoofable (an abuser can present as a server SDK to skip the fingerprint and
per-source buckets) — see §5 "honest limits"; that is exactly why the per-key quota, not the
fingerprint, is the real cap.

## 2. Limit layers (cheapest first)

Evaluation order: hygiene → **pre-auth** per-source + global ceiling → per-key (after auth) →
per-fingerprint (post-parse).

0. **Request hygiene** — an ingestion-only `Content-Length` outer guard (pre-parse: 20 MiB
   envelope/store via `INGEST_MAX_LARGE_ENVELOPE_BYTES` — item types aren't known before reading —
   and 4 MiB OTLP; `maxRequestBodySize` is server-wide and must stay generous enough for 10 MB
   source-map uploads), plus a streaming cap in `readBody` that peeks item headers as it consumes
   the body: 1 MiB plain / 4 MiB decompressed for ordinary envelopes, switching to
   `INGEST_MAX_LARGE_ENVELOPE_BYTES` (20 MiB) once an `attachment`/`replay_recording` item is
   declared; replay + general item count/size caps before `offloadReplayItems` (charge model below).
   Reject `413`.
1. **Per-key (app)** — token bucket at **events/s**; the rate resolves as
   `apps.eventsPerSecond` (override) → `rate_limit_settings.eventsPerSecond` (global, panel-managed)
   (§6). Bounds A and D even when the sender rotates IPs; **this is the primary cap for `server`
   class** (a big incident burst is allowed up to the quota, then 429 + SDK backoff — by design,
   over-quota = drop). Overflow is what feeds the exceedance notification (§6).
2. **Per-source (IP), `client`/`unknown` class only** — bucket across all keys for one source;
   evaluated **pre-auth** with the class classified from headers (so invalid-key floods are counted
   too — §4). Catches B (key-hopping) and F. **`server`-class traffic is exempt**: a server fleet
   behind one egress IP must never be capped below its own quota — its bound is the per-key quota plus
   the global ceiling (which also keeps brute-force load bounded). The class is spoofable (§1); that is
   accepted, the per-key quota remains the damage cap. When no source can be attributed (no socket IP
   and no trusted hop — in-process `app.handle` suites), the bucket is skipped rather than keyed to a
   shared `unknown`.
3. **Per-fingerprint — `client` class only.** `(app, ip, client tuple)` bucket, generous; **skipped
   entirely for `server` class** (the tuple is a host signature, not a device) and when no source is
   attributable (same rule as §2.2). Used for attribution, block escalation (§5), and optionally a
   probation bucket for device fingerprints never seen before.
4. **Global ingress ceiling** — `INGEST_RATE_LIMIT_GLOBAL_PER_SEC` (default 200/s): a cheap counter
   protecting the process/DB/NATS from distributed floods; last resort. Plain `429` + `Retry-After`
   (no key to scope), surfaced in the overview counters only.

**Charge model — events, not requests.** A bucket at "events/s" must define what a request costs:
every bucket the request touches accrues its item count N — the pre-body check charges 1 (request
admission) and the post-parse check adds `items.length - 1` more for the buckets charged pre-body,
while the fingerprint bucket (first evaluable post-parse — its tuple needs the parsed body) is
charged the full `items.length` there. So an envelope with N items costs N in every bucket it
touches regardless of packing (`/store/` = 1, OTLP = span count). Hygiene caps items per envelope so
one request cannot bypass the per-key cap.

**Fail-open on internal errors.** Buckets/stats are wrapped so an unexpected limiter failure is logged
and the request proceeds — only deliberate rejections (`429`, `413`) and persisted blocks stop
ingestion (same best-effort rule as NATS/ClickHouse/object storage).

Algorithm: token bucket at **events/second**, monotonic counters. State is **in-process** (bounded
`Map` with LRU + TTL eviction, e.g. 50k entries) for v1 — single container, and the limiter must
not depend on NATS/Postgres being reachable. Shared state is a later phase (`todos/rate-limiting.md`, batch 7).

Deliberately simple for v1: no per-category buckets (Sentry's `error` / `transaction` separation) —
the header still announces `default`; finer per-item-type categories are a later refinement.

## 3. Response semantics (Sentry-compatible)

- `429 Too Many Requests` + `Retry-After: <sec>` + `X-Sentry-Rate-Limits: <retry_after>:<categories>:<scope>`
  (scope `key` | `project`; categories `default`, later `error` / `transaction` / `replay`).
- Why the headers matter: Sentry SDKs ship a **client rate limiter** that honors this header and stops
  sending for the category — legitimate SDKs stop hammering while the key is limited, and even an
  abuser using a real SDK backs off unless deliberately configured otherwise.
- Pre-auth rejections (per-source, global ceiling) have no key to scope, so they carry `Retry-After`
  only; once the app is resolved every `429` carries `X-Sentry-Rate-Limits` (scope `key`), including
  the per-key pre-body check. Size rejections (`413`) stay plain. Post-parse: same status, per-item
  categories once added.
- New `ErrorCode.TOO_MANY_REQUESTS` + `tooManyRequests(message, { retryAfter, categories, scope })` in
  `backend/errors.ts`; `ApiError` gains the optional rate-limit payload, and the root `onError`
  (`backend/index.ts`) passes rate-limit metadata into the response headers.

## 4. Where it hooks

- **Pre-auth source check** before `resolveAuthorizedApp` (i.e. before `resolveApp`'s DAO lookups, up
  to four per request) with headers + IP only: the per-source bucket counts `client`/`unknown`
  requests including `401`s (threat F; §2 layer 2), and the global ceiling counter (§2 layer 4) runs
  here too — brute-force load stays bounded even when `server` class is spoofed.
- `backend/events/ingestion.ts` → `resolveAuthorizedApp` is the shared gate for every ingestion path;
  add `enforceIngestLimit(request, app, "pre")` right after it (headers + IP only).
- Post-parse check in `backend/events/index.ts` (`/:projectId/envelope/`, `/:projectId/store/`) and
  `backend/otlp/index.ts` (`/:projectId/otlp/v1/traces`): `enforceIngestLimit(request, app, "post", parsed)`
  applies the post-parse charges per §2's charge model (`items.length - 1` top-up for pre-charged
  buckets, the full `items.length` for the fingerprint bucket) **before** `offloadReplayItems` /
  `dispatchIngestedEvent`, so both the NATS-first and in-process paths are covered and nothing is
  written when limited. (OTLP bodies are Elysia-parsed before the handler, so its size cap lives in
  the pre-parse guard, not the handler; `Content-Length`-less/chunked OTLP requests are rejected
  there — Elysia would otherwise read them unbounded.)
- **Never** in `backend/consumer.ts` — NATS redeliveries must not be rate limited.
- Source helper (`backend/ratelimit/source.ts`): `server?.requestIP(request)?.address` when listening;
  behind the proxy trust **only the hop the proxy itself adds** — `X-Real-IP`, or the rightmost
  `X-Forwarded-For` entry, never the client-supplied leftmost value — and only with `TRUST_PROXY`.
  Normalize for bucketing: IPv4 as-is, **IPv6 by /64**. Production sits behind the TLS reverse proxy
  (DSNs are `http://` by design), so **`TRUST_PROXY` must be configured** or every request looks like
  the proxy's IP.
- New module `backend/ratelimit/`: `config.ts`, `source.ts`, `fingerprint.ts` (incl. client-class
  classification), `buckets.ts` (token bucket + LRU), `settings.ts` (cached settings row),
  `enforce.ts`, `notify.ts`, `stats.ts`.
- Admin routes: the new `/api/admin/rate-limits*` endpoints live in a new
  `backend/rate-limits/index.ts` domain mounted in `adminRoutes`; the app sub-resources
  (`rotate-key`, `rate-limit`) stay in the existing `backend/apps/index.ts` (AGENTS.md: no
  unrelated routes in an existing domain file).

## 5. Escalation & recovery (the "stop abusers" part)

- **Auto-block (narrow, evidence-based, never volume-only):** a source/fingerprint gets a persisted
  block for `INGEST_BLOCK_TTL_HOURS` only on abnormal *behaviour*:
  (a) keeps exceeding the limit **after** receiving 429s (a real SDK honors the headers, so ignoring
  them is a signal), (b) key-hopping (one source, many keys), (c) invalid-key floods, (d) envelope
  bombs. A single server host pushing a big incident burst under its per-key quota is **never**
  auto-blocked — for `server` class the fingerprint is the host, so fingerprint volume must not
  trigger blocks at all. Ordinary spikes get bucket-429s only; source blocks are checked pre-body
  (cheapest possible), app blocks right after auth, fingerprint blocks right after parse — all with
  `429` + `Retry-After` (the remaining TTL, or a fixed `60` s re-emitted per request when the block
  has no expiry), so SDKs back off for the whole block.
- **Admin recovery** (admin-token-only, following existing admin patterns):
  - `POST /api/admin/apps/:appId/rotate-key` → new `publicKey`/`ingestKey`; old DSNs 401 immediately
    (mirror the display-once rotate/revoke pattern in `backend/source-maps/index.ts`).
    Caveat: a browser-bundle DSN is public; rotation requires the app owner to redeploy — it resets
    abuse, it does not prevent recurrence.
  - **Manual app-scoped block** (`ingest_blocks` scope `app`, via the blocks API below) — the kill
    switch for a key under sustained attack, with no new column: blocked requests get `429` until the
    block is removed; manual blocks are permanent unless the create form sets an expiry.
  - Per-app override: `eventsPerSecond` (§6) — the knob for server-class apps that legitimately need
    more than the global default.
  - `GET /api/admin/rate-limits/overview` (top fingerprints/sources, 429 counters, and the current
    blocks with their ids — the read side for the panel's block list; no separate GET blocks route) +
    `POST /api/admin/rate-limits/blocks` / `DELETE /api/admin/rate-limits/blocks/:id` (manual
    deny/allow; scopes `source` / `fingerprint` / `app`).
- **Honest limits**: every fingerprint field is client-controlled (`User-Agent`, `sentry_client`,
  `contexts.*`, `X-Forwarded-For` when the proxy config is loose), and client-class detection is
  spoofable the same way (an abuser can present as a server SDK to skip the fingerprint and
  per-source buckets). This layer buys attribution, cheap blocking, and protection against
  unsophisticated floods — it is never the only line of defence. The real fixes remain quotas
  (damage cap), rotation (recovery), and a proxy with real auth for server-side senders.

## 6. Global limit (events/s), per-app override & exceedance notifications

**Resolution order** for the per-key bucket rate, in **events/second**:
`apps.eventsPerSecond` (override) → `rate_limit_settings.eventsPerSecond` (global, panel-managed).
The settings row is the single source (no env fallbacks for these values); the migration seeds the
defaults, and tests set the row via the API/DB fixture.

**Value semantics:** `null` = inherit; `0` = **unlimited** (no per-key bucket for that app — a global
`0` disables the per-key layer entirely, the sanctioned off switch); positive = hard events/s.
`notifyChannelIds` / `notifyCooldownMinutes` follow the same `null` = inherit rule. There is no master
switch: the limiter is always on; the row is the single source for these values and is read through
a short-TTL cache (§8).

### Storage

- New single-row `rate_limit_settings` table: `id` (`"default"`), `eventsPerSecond` (integer — seeded
  20), `notifyChannelIds` (JSON text — `alert_channels` ids, seeded empty), `notifyCooldownMinutes`
  (integer — seeded 15), `updatedAt`. This is the first global settings row in the schema; there is
  nothing to reuse. The default row is **seeded by the migration** (a `drizzle-kit generate --custom`
  migration — schema diffs can't emit INSERTs), not lazily created.
- `apps` (`db/schema/project.ts`) gains `eventsPerSecond` (integer, **nullable = inherit**,
  `0` = unlimited), `notifyChannelIds` (JSON text, **nullable = inherit global channels**) and
  `notifyCooldownMinutes` (integer, **nullable = inherit**); JSON columns are `JSON.stringify`/parse
  with a safe fallback per AGENTS.md. No `ingestEnabled` column — the app-level kill switch is a
  manual `ingest_blocks` row with scope `app` (§5).
- New `rate_limit_notifications` table (cooldown + audit), keyed by the **alert subject**: `id`,
  `scope` (`app` / `source` / `fingerprint`), `value` (app id or hashed source/fingerprint), `appId`
  (nullable — the app that triggered it), `windowStart`, `peakPerSecond`, `droppedCount`, `notifiedAt`,
  `channelIds`; the last `notifiedAt` per `(scope, value)` enforces the cooldown across restarts
  (in-memory first, persisted in batch 5). Rows are swept after N days; app rows cascade with their
  app.

### API (admin-token-only)

- `GET /api/admin/rate-limits` → global settings + per-app rows with **effective** values: app/project
  names, override (or "inherit"), effective events/s, channels, live counters (current rate, 429s,
  last notification).
- `PATCH /api/admin/rate-limits` → global `eventsPerSecond`, `notifyChannelIds`,
  `notifyCooldownMinutes`.
- `PATCH /api/admin/apps/:appId/rate-limit` → `eventsPerSecond` (`null` = inherit, `0` = unlimited),
  `notifyChannelIds` (`null` = inherit), `notifyCooldownMinutes` (`null` = inherit) — a dedicated
  sub-resource.
- AGENTS.md applies: ArkType schemas for every new route input; the app table in
  `GET /api/admin/rate-limits` is cursor-paginated (`{ data }`); ids via `crypto.randomUUID()`;
  ISO text timestamps. These endpoints stay **admin-token-only** (not in `SCOPED_READ_PATHS`): scoped
  identities get `403`, like Settings → Permissions.
- Live counter windows (defined once in `stats.ts`): `current rate` = events/s over the last 10 s;
  `peak` = highest 1-minute rollup around the first overflow (its minute is the row's `windowStart`);
  both reused by the panel.
- Notification targets are **existing `alert_channels`** (webhook / Slack / RocketChat / email), so the
  selector in the panel is the same multi-select the alert rules already use; delivery reuses
  `backend/alerting/notifiers.ts`. Every rate-limit alert fans out at **both levels** — the involved
  app's channels and the global channels — deduplicated.

### Notification behaviour (never on the ingestion path)

- **Trigger:** the app's bucket starts rejecting (first overflow in a window) → **one notification per
  cooldown per app** (`notifyCooldownMinutes`, default 15) — not one per dropped event. Under-limit
  traffic never notifies.
- **Message:** app + project, effective limit (events/s), observed peak (events/s), dropped count and
  window, and a link to the panel. Severity `warning`.
- **Delivery is fire-and-forget:** it runs after the 429 response is decided; webhook/channel failures
  only log. Ingestion behaviour and the 429 never depend on the notification outcome.
- **Auto-block alerts:** when a source/fingerprint block is created (auto or manual) or an app is
  manually blocked (§5), the involved apps **and** the global channels get a warning — the app-level
  alert plus the global alert system, deduplicated, each with its cooldown; a source block spanning
  N apps notifies all N (bounded) + global. Per-source/per-fingerprint *bucket overflow alone* does
  not notify (too noisy); it surfaces in the overview counters.
- Optional "recovered" follow-up when the app drops back under its limit — see [`todos/rate-limiting.md`](../todos/rate-limiting.md).

### Panel (Settings → Rate limits)

One admin-token-only screen, same patterns as the existing Settings pages
(`frontend/src/app/pages/Settings.tsx`, `.list-screen` / `.form-grid` / `Action`):

- **Global section:** **events/s input** (`0` = unlimited), notification channel multi-select,
  cooldown.
- **Per-app table:** app + project, effective limit, override input (empty = inherit, placeholder
  shows the global rate; `0` = unlimited; positive = hard rate), notification channels (inherit or
  override), cooldown (inherit or override), current rate / 429 counter, last notification time. The
  same values `PATCH` accepts — **limit and notification config live in the same panel**. The app
  detail screen links here.
- **Overview & blocks:** top sources/fingerprints + 429 counters + the current block list (from the
  overview payload, §5), and manual block create/remove (scope + value/hash + reason + expiry) —
  same screen, same admin guard.

## 7. Persistence

- `rate_limit_settings`, `apps.eventsPerSecond` / `apps.notifyChannelIds` /
  `apps.notifyCooldownMinutes`, `rate_limit_notifications`, and `ingest_blocks` (`id`, `scope`
  `source`/`fingerprint`/`app`, `value` hashed for `source`/`fingerprint` (raw app id for `app`),
  `reason`, `createdAt`, `expiresAt`; unique on `(scope, value)`, race-safe upsert) — all migrations
  via `bunx drizzle-kit generate`; DAOs with the standard method names (`db/dao/ingest-blocks.ts`,
  `db/dao/rate-limit.ts`).
- Cascades are manual (no FKs): `deleteAppCascade` (`backend/apps/index.ts`) gains
  `rateLimitNotificationDAO.deleteByApp(appId)` and `ingestBlockDAO.deleteByApp(appId)`;
  `rate_limit_notifications` rows are swept after N days (e.g. 30) by the existing sweeper cadence.
- Buckets and live counters stay in-process; only settings, overrides, notifications and blocks are
  durable.
- If `todo.metrics.md` v4 (NATS/CH-only) lands first, rate-limit **stats** may live in ClickHouse, but
  **enforcement stays local**.

## 8. Config (env, read lazily in `backend/ratelimit/config.ts`)

| Var | Default (proposed) | Meaning |
|---|---|---|
| `INGEST_RATE_LIMIT_PER_IP_PER_SEC` | 10/s | per-source bucket, `client`/`unknown` only (server-class exempt, §2) |
| `INGEST_RATE_LIMIT_PER_FP_PER_SEC` | 5/s | per-fingerprint bucket (**`client` class only**) |
| `INGEST_RATE_LIMIT_GLOBAL_PER_SEC` | 200/s | process-wide ingress ceiling (plain `429`, §2.4) |
| `INGEST_RATE_LIMIT_BURST_SECONDS` | 2s | burst = rate × seconds |
| `INGEST_MAX_ENVELOPE_BYTES` | 1 MiB | default envelope cap (streamed in `readBody`) |
| `INGEST_MAX_DECOMPRESSED_BYTES` | 4 MiB | default gzip-bomb cap in `readBody` |
| `INGEST_MAX_LARGE_ENVELOPE_BYTES` | 20 MiB | replaces both caps when `attachment`/`replay_recording` items are declared (also the `Content-Length` outer bound) |
| `INGEST_MAX_OTLP_BYTES` | 4 MiB | OTLP body cap (batches run larger than envelopes) |
| `INGEST_MAX_ENVELOPE_ITEMS` | 100 | item-count cap per envelope (`/store/` = 1) |
| `INGEST_MAX_REPLAY_ITEMS` | 500 | replay envelopes use this instead of the general item cap |
| `INGEST_MAX_OTLP_SPANS` | 1000 | span-count cap per OTLP request |
| `TRUST_PROXY` | off | read `X-Forwarded-For` / `X-Real-IP` |
| `INGEST_BLOCK_TTL_HOURS` | 24h | auto-block duration (behaviour-based, §5) |

Events/s and the notification settings live in `rate_limit_settings` (panel) — there are no env
fallbacks for them, and there is no master switch (the limiter is always on).

Per-key defaults must assume a server-class app can legitimately burst; crossing the quota yields
429 + SDK backoff (the accepted cap), never an abuse verdict. Apps that need more get an override.
Env knobs are read **at call time** (or via a `resetRateLimitConfig()` test hook) so suites can set
them per file the way `e2e/31-permissions.test.ts` toggles OIDC env; the panel-managed row is read
through the same lazy cache (short TTL, invalidated on PATCH / test reset).

## 9. Testing (`backend/tests/` via `app.handle` for API-level; `e2e/` for real-socket suites)

- Unit tests (under `backend/tests/` too, so `bun run test` picks them up): fingerprint tuple + fallbacks;
  **client-class classification**; token bucket refill/eviction + charge model (1 then `items - 1`,
  full `items` for the post-parse-only fingerprint bucket); source extraction (socket vs trusted
  hop vs `unknown`, IPv6 /64); limit resolution (app override → settings row, `0` = unlimited).
- API tests run in-process under `backend/tests/` (`backend/tests/12-projects-apps.test.ts` + `backend/tests/test-helpers.ts`),
  setting rates through the settings row (admin API/fixture; seeded defaults otherwise), with
  `TRUST_PROXY` on and `X-Forwarded-For` set per simulated client (`app.handle` has no socket IP):
  1. burst from one client-class fingerprint → first N accepted, then `429` with `Retry-After` +
     `X-Sentry-Rate-Limits` shape; refill allows again.
  2. same key, rotating XFF → per-key limit still hits (A).
  3. one IP, rotating keys (create 3 apps, `client`-class headers) → per-source limit hits (B).
  4. spoofed `sentry_client`/browser per request → per-fingerprint bucket alone does not block
     (documented as expected); auto-block fires only on the behaviour signals.
  5. **server-class burst** (Node SDK, one IP, no browser context; N above the per-fingerprint limit
     and above the per-source default, but under the per-key quota) is fully accepted; crossing the
     per-key quota gets `429` + headers, never a block — the regression test for the false-positive
     guard.
  6. **Notifications:** a local webhook receiver (`webhook` alert channel) gets exactly one POST per
     configured channel when the app crosses its limit (app + global levels, deduplicated; effective
     events/s, peak, dropped count), no second POST inside the cooldown, none when under the limit; a
     failing webhook (500) still yields the same `429` — asserted with `waitFor` (delivery is
     fire-and-forget).
  7. **Overrides:** global events/s is applied; an app override wins over global; clearing it (`null`)
     inherits again, `0` means unlimited; channels/cooldown resolve the same way.
  8. gzip bomb / oversized body / item-cap overflow → `413` with no writes; rotate-key → old DSN
     `401`, new DSN accepted; manual app block → `429` until unblocked; blocks round-trip through the
     overview list (create → listed → `DELETE` → gone); unknown-key flood → pre-auth `429`, never a
     DB spike. (Lands in parts: `413` in batch 1, pre-auth in batch 2, admin parts in batch 5.)
  9. Reads stay unlimited: `/api/admin/*` and `/events/*` (in-process) plus the WS feed (e2e) keep
     working while ingestion is over quota.
- Existing suites keep passing with the limiter **always on** (no master switch): in-process
  suites have no attributable source, so the source/fingerprint buckets are skipped there, and the
  defaults (per-key 20/s + 2 s burst, 200/s ceiling) sit above suite volumes; real-socket e2e suites
  share `127.0.0.1`, so a bursty file raises the affected knob for itself rather than weakening the
  default.
- The Settings panel (batch 6) gets an e2e UI pass following `e2e/30-issue-detail-metrics.test.ts`.
- `bun run typecheck` + full `bun run test` before every batch.

## 10. Implementation batches

Moved to [`todos/rate-limiting.md`](../todos/rate-limiting.md).

## 11. Open questions

Moved to [`todos/rate-limiting.md`](../todos/rate-limiting.md).
