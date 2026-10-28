# NATS — topology, subjects and Auth Callout

The broker is a hard dependency: ingestion publishes to JetStream, ClickHouse
ingests by configuration, the side-effects consumer reads Postgres side
effects, and the browser's live feed subscribes directly over the NATS
WebSocket listener. This document is the ground truth for the NATS subject
topology and for how every connection is authenticated and authorized.

## 1. Subjects

```
sentry.events.<appNumber>   events (envelope payloads, newline-batched)
sentry.metrics              metric samples (newline-batched, JSONEachRow)
sentry.flags.changed        feature-flag change notifications
```

- `<appNumber>` is the app's DB-generated `apps.number` — the same integer the
  DSN path uses. It is globally unique and stable, which keeps NATS subject
  tokens small (regex/UUID tokens are allowed but wasteful).
- **Every** `sentry.events` publish carries the app number: the API edge
  resolves the app (DSN → app → number) *before* the publish, so the subject
  routes on the event's own contents, not on a per-deployment guess.
- The stream `SENTRIES` declares `sentry.events.*` (not the bare subject), so
  a malformed publish without the app token fails at the server instead of
  hiding in the wildcard.

### Consumers

| Consumer | Mode | Filter subject |
|---|---|---|
| `clickhouse-events` | ClickHouse NATS engine table + MV | `sentry.events.*` |
| `clickhouse-metrics` | ClickHouse NATS engine table + MV | `sentry.metrics` |
| `side-effects` | backend consumer binary (Postgres) | `sentry.events.*` |
| `flags-consumer` | backend (feature-flag SSE fan-out) | `sentry.flags.changed` |

## 2. Auth callout — every connection is authorized by the backend

The NATS server does not know users. Every connection **except the ones the
config authenticates itself** is routed through the
[auth callout](https://docs.nats.io/learn/security/auth-callout) (ADR-26):
the server publishes the connection attempt to `$SYS.REQ.USER.AUTH` and the
backend answers as the auth service with a signed user JWT that binds the
connection to an account and a permission set. A denied connection gets **no
reply** — the server times the callout out and the client learns nothing
(the recommended way to reject; the reason only appears in the server log).

There is no HTTP hop: NATS → backend is a NATS request/reply on
`$SYS.REQ.USER.AUTH`; the request is a JWT signed by the server (verified by
the auth service before use), and the reply is a JWT signed by the
**callout issuer** account key (`NATS_AUTH_KEY_SEED`, whose public key is the
`issuer` in the server config). The issuer key signs the verdict, so only the
backend can admit a client.

### Accounts

Everything shares the global account `$G`. The isolation is **the per-user
claim the callout mints** (sub-only, allowlisted app shards), not an account
boundary: a multi-account split would need stream imports to deliver anything
to the readers, and the per-user permissions already express the scope.

| Connection | Credential | Permissions |
|---|---|---|
| browser / provider identity | Keycloak JWT or admin token via `auth_token` | minted by the callout: sub-only allowlist (below) |
| backend + side-effects consumer | `NATS_AUTH_USER`/`NATS_AUTH_PASSWORD` config user | unrestricted; exempt from the callout via `auth_users` (it IS the auth service) |
| ClickHouse NATS engine | `NATS_INTERNAL_USER`/`NATS_INTERNAL_PASSWORD` config user | unrestricted; exempt via `auth_users` |

- A connection matching no config user (the browsers) always goes through the
  callout — there is no anonymous mode and no dev bypass.
- Only deployment-internal credentials may be listed in `auth_users`: the
  list exempts users from all checks, so adding an application user there
  would silently unauthenticated it.

### Credentials the callout accepts

The client presents its credential in the CONNECT options (`auth_token`),
which lands in the callout request as `connect_opts.auth_token`:

1. **Keycloak JWT** (`Bearer` credential of the SPA): verified exactly like
   HTTP requests — `jose` against the provider JWKS (audience/issuer/`azp`
   fail closed). The identity id and `groups` claim feed
   `resolveAccessForIdentity` (permissions engine); no matching
   grant/rule ⇒ no reply (denied).
2. **The master admin token** (`bnm_…`, presented under `API-Key` over HTTP):
   verified by constant-time hash comparison against the boot token hash —
   unrestricted, sub on `sentry.events.*`.

### The verdict: sub-only, scoped subjects

All admitted connections are **subscribe-only** (`pub: { allow: [] }` in the
user claim; an allowlisted direction with an empty list denies everything).
The granted `sub` subjects are the scoped view of the identity:

- admin token → `sentry.events.*`
- scoped identity → `sentry.events.<appNumber>` for **each app its scope
  resolves to** (app name prefixes + project grants, via `computeScopedView`)
- an identity whose scope resolves to no app is denied.

Because the subject carries the app number, scope enforcement is
broker-native: a scoped identity physically cannot subscribe (or receive)
another app's events, and publishing is impossible for every reader.

The minted user JWT expires with the credential (`exp` of the Keycloak claim,
capped at 24 h); a live feed whose JWT expires is reconnected by the UI with
its current token.

## 3. Server configuration

The nats-server config declares the config users and the callout block:

```text
authorization {
    users: [
        { user: $NATS_AUTH_USER,     password: $NATS_AUTH_PASSWORD }
        { user: $NATS_INTERNAL_USER, password: $NATS_INTERNAL_PASSWORD }
    ]
    auth_callout {
        issuer: $NATS_AUTH_ISSUER   # public key of the issuer account seed
        auth_users: [
            $NATS_AUTH_USER,        # the backend: the auth service itself
            $NATS_INTERNAL_USER     # the ClickHouse engine connection
        ]
    }
}
```

- The **issuer keypair** dev values are committed for local development
  (`NATS_AUTH_ISSUER`/`NATS_AUTH_KEY_SEED` defaults in the compose files);
  production generates its own pair (`scripts/nats-auth-keys.ts` prints a
  fresh `seed`/`issuer` pair) and keeps the seed in a secret. The seed never
  leaves the backend process env.
- `NATS_AUTH_USER`/`NATS_AUTH_PASSWORD` authenticate the backend process and
  the consumer binary; `NATS_INTERNAL_USER`/`NATS_INTERNAL_PASSWORD`
  authenticate the ClickHouse NATS engine connection.
- WebSocket TLS remains a deployment concern (the listener is plain HTTP in
  the compose stack; `no_tls: true`) — the callout request carries the
  presented credential in the clear on `$SYS.REQ.USER.AUTH`, so use the
  `xkey` encryption option in the server's `auth_callout` block when the
  broker is exposed to untrusted networks.

## 4. WebSockets (live feed)

- The browser opens `ws(s)://<host>:<port>` and speaks the NATS protocol;
  the CONNECT options carry `auth_token` = its current credential. Invalid /
  expired credentials are rejected by the callout before the subscription
  can enter.
- Subscriptions are per app: `sentry.events.<appNumber>` for the apps the
  UI displays. The UI derives the numbers from the admin app responses it
  already renders. A subscription the broker did not grant is rejected by
  NATS itself.

## 5. Testing

- **Hop tests** publish through internal (config-user) connections and use
  the WebSocket client in `backend/tests/44-hop-live-feed.test.ts` with a
  real credential; the callout service runs inside the backend process, so
  its verdicts are exercised on every connection (dev replicates prod —
  there is no anonymous/dev mode and no config switch that opens the
  listener).
- Subject sharding keeps every publish visible to the JetStream consumers
  (filter `sentry.events.*` covers all app shards).
