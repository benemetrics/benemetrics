<div align="center">

<img src="docs/screenshots/overview.png" alt="Benemetrics overview" width="900" />

# Benemetrics

**A lightweight Sentry alternative — error tracking, performance monitoring, feature flags and alerting in one Bun binary.**

[![Bun](https://img.shields.io/badge/runtime-Bun%201.x-f5a3ff?style=flat-square&logo=bun&logoColor=white)](https://bun.com)
[![Elysia](https://img.shields.io/badge/http-Elysia-ff6b6b?style=flat-square)](https://elysiajs.com)
[![Self-hosted](https://img.shields.io/badge/deployment-self--hosted-8b5cf6?style=flat-square)](#deploy-on-kubernetes)

</div>

---

Benemetrics is a self-hosted error tracker and observability backend you can run
in one container. It speaks the **Sentry SDK protocol**, so the official SDKs
for JavaScript, Python, Go, Rust and friends work unchanged — point a DSN at
it and events start flowing.

It also ships the parts Sentry charges extra for: **session replay**,
**feature flags with A/B experiments**, **metric-based alerting** and
**role-scoped access control**, all in the same binary and the same database
story.

| | |
|---|---|
| **Runtime** | [Bun](https://bun.com) 1.x — one process, one bundle |
| **HTTP** | [Elysia](https://elysiajs.com) + [ArkType](https://arktype.io) validation |
| **Control plane** | PostgreSQL (Drizzle ORM) |
| **Event store** | ClickHouse (ReplacingMergeTree, TTL retention) |
| **Pipeline** | NATS JetStream — NATS-first, no in-process fallback |
| **Object store** | Any S3-compatible store (RustFS locally) |
| **UI** | React 19 SPA served by the backend itself |
| **Deploy** | Docker, Docker Compose, Helm chart |

---

## Contents

- [Screenshots](#screenshots)
- [Sponsor](#sponsor)
- [Features](#features)
- [Architecture](#architecture)
- [Quick start](#quick-start)
- [Deploy on Kubernetes](#deploy-on-kubernetes)
- [Configuration](#configuration)
- [The API](#the-api)
- [Development](#development)
- [Documentation](#documentation)

---

## Screenshots

### Overview

Unresolved issues, transactions, stored envelopes and active alerts in one
glance — the event volume chart and the live feed are fed by the same
pipeline that stores the events.

![Overview](docs/screenshots/overview.png)

### Issues

Errors grouped into issues by the backend's fingerprint, with a search
grammar (`is:unresolved app:checkout lastSeen:-24h`) and the issue's own
occurrences, counters and metrics.

![Issues](docs/screenshots/issues.png)

### Event detail

The stack trace, the event context, the breadcrumbs and the affected user —
symbolicated against the uploaded source maps at read time.

![Event detail](docs/screenshots/event-detail.png)

### Performance

Latency quantiles over time, the slowest transactions and the Web Vitals and
mobile vitals your SDKs report.

![Performance](docs/screenshots/performance.png)

### Feature flags and experiments

Targeting rules, segments, rollout percentages and a sticky assignment — plus
an experiment dashboard with Wilson confidence intervals, a two-proportion
z-test and a recommendation.

![Feature flags](docs/screenshots/feature-flags.png)

![Experiment results](docs/screenshots/experiment-results.png)

### Alerting

Threshold rules, issue triggers (new issue / regression) and the effective
configuration: global rows merged with the app-scoped overrides.

![Alerts](docs/screenshots/alerts.png)

### Projects, apps and environments

The hierarchy is **Project → Environment (shared by apps) → App**. Every app
owns its DSN and its credentials.

![Projects](docs/screenshots/projects.png)

### Permissions

Read access for verified identities: a group rule grants a scope to everyone
in a group, an identity grant overrides the groups for one identity. Every
change lands in the audit trail.

![Permissions](docs/screenshots/permissions.png)

---

## Sponsor

<a href="https://spicysquid.tech"><img src="docs/screenshots/sponsor-spicysquid.png" alt="SpicySquid" width="96" height="96" align="bottom" /></a> [SpicySquid](https://spicysquid.tech) is generously deploying a demo of Benemetrics — head over to [the demo deployment](https://benemetrics.spicysquid.tech) to try the project before you self-host.

---

## Features

**Error tracking**
- Sentry envelope ingestion (gzip aware), the legacy `store/` endpoint and
  OTLP traces
- Backend-side fingerprinting into issues, with status, counters and
  occurrence history
- Stack-trace symbolication from uploaded source maps, resolved at read time
- Session replay: the recording segments are offloaded to S3-compatible
  storage and served to the browser as presigned URLs
- Releases with per-release issue summaries (new / regressed)

**Performance monitoring**
- Transactions and spans ingested as first-class events
- Metric samples extracted at the API edge and aggregated in ClickHouse
  (`p50`, `p95`, `p99`, breakdowns by dimension)
- Web vitals and mobile vitals

**Feature flags and experiments**
- Global flags, project-scoped flags and app-scoped flags
- Targeting rules, reusable segments, rollout percentages and a deterministic
  weighted assignment
- Three evaluation surfaces: the Sentry batched endpoint, the OpenFeature
  endpoint and an SSE change stream
- Experiments with sticky assignment, metric tracking, Wilson intervals and a
  z-test

**Alerting**
- Threshold rules (event, error and fatal counts, p95/p99 latency) evaluated
  by a sweeper
- Issue triggers (new issue, regression) fired event-driven at ingestion
- Slack, email, webhook, Rocket.Chat, PagerDuty, Opsgenie, MS Teams and
  VictorOps channels
- Global, project-scoped and app-scoped rules and channels

**Access control**
- One admin token (`API-Key`) or an OIDC provider identity (`Bearer`)
- Scoped, read-only identities resolved from group rules and identity grants
- Every permission change recorded in an audit trail

---

## Architecture

Benemetrics is **NATS-first**: ingestion is a publish, never a write path.

```
        SDK
         │  envelope
         ▼
  ┌────────────────┐   publish    ┌──────────────────┐
  │   API + UI     │ ──────────▶ │  NATS JetStream  │
  │  (Bun/Elysia)  │              │     SENTRIES     │
  └───────┬────────┘              └────────┬─────────┘
          │ offload                         │
          ▼                         ┌────────┴─────────┐
  ┌────────────────┐                │                  │
  │  S3 / RustFS   │                ▼                  ▼
  │ replay segments │       ClickHouse           side-effects
  └────────────────┘       engine tables          consumer
                           (events, metrics)      (Postgres:
                                                  issues, alerts,
                                                   releases)
```

- **The API** resolves the app from the DSN, parses the envelope, extracts
  the metric samples, offloads the replay segments and publishes both
  subjects. A broker failure answers `503` — there is no in-process fallback.
- **ClickHouse** ingests `sentry.events.<appNumber>` and `sentry.metrics` *by
  configuration*: NATS engine tables + a durable pull consumer + materialized
  views. The insert is acknowledged only after the view wrote the row, so an
  acknowledged batch is durable (`fsync_after_insert`).
- **The side-effects consumer** is a second binary from the same image. It
  pulls the same stream and applies the Postgres transitions: issue tracking,
  alert triggers and release tracking. An event published while it is down is
  not lost.
- **The live feed** is the browser → NATS WebSocket. There is no backend
  fan-out; the connection state *is* the health signal of the UI. Every
  connection is authorized by the backend through the NATS auth callout —
  sub-only, scoped to the apps the identity may see (`docs/nats.md`).
- **The object store** is S3-required: the replay segments are written
  before the publish and served to the browser as presigned URLs. The backend
  never proxies the bytes.

Everything is idempotent: a retried event id is answered without the work, and
duplicate rows collapse in ClickHouse.

---

## Quick start

### Docker Compose

```bash
git clone https://github.com/your-org/benemetrics.git
cd benemetrics

# The whole stack: Postgres, ClickHouse, NATS (JetStream), RustFS,
# the API and the side-effects consumer
docker compose --profile app up -d
```

Open <http://localhost:31337/ui> and paste the admin token
(`dev-admin-token`, or the `ADMIN_TOKEN` you set) when the prompt appears.
The API serves the UI and the ingestion endpoints from the same origin.

Every setting the API needs lives in `docker-compose.yml` — the database
URL, the NATS servers, the ClickHouse endpoint, the object store and the
admin token.

Create a project, then an app inside it:

```bash
# The project
curl -H "Authorization: API-Key dev-admin-token" \
  -H "Content-Type: application/json" \
  -d '{"name":"Acme Storefront"}' \
  http://localhost:31337/api/admin/projects

# The app (the response carries its publicKey and number)
curl -H "Authorization: API-Key dev-admin-token" \
  -H "Content-Type: application/json" \
  -d '{"name":"web"}' \
  http://localhost:31337/api/admin/projects/<project-id>/apps
```

The DSN is `http://<publicKey>@<host>/<number>` — the API returns the
ingredients, the caller composes the DSN for the origin it reached.

### Local development

For the hot-reload workflow, run the services in compose and the API on the
host:

```bash
docker compose up -d          # the services only — no app profile
bun run dev                   # the API, hot reload
bun run consumer              # the side-effects consumer, in a second terminal
```

The environment of the host processes is the `x-app-environment` block of
`docker-compose.yml`, with the service names pointed at `localhost`:

```bash
export ADMIN_TOKEN=dev-admin-token
export DATABASE_URL=postgres://postgres:mysecretpassword@localhost:5432/sentry
export NATS_SERVERS=nats://localhost:4222
# The backend's NATS config user and the auth-callout issuer keypair
# (generate a fresh pair with `bun scripts/nats-auth-keys.ts`).
export NATS_AUTH_USER=sentries-auth
export NATS_AUTH_PASSWORD=sentries-dev-auth-pass
export NATS_AUTH_KEY_SEED=SAAICRLV2CKHUW4DJ4UWKWWZOXS7K4AZ7F3DWLXHXA5FUVBM2OUZ3O3ITM
export CLICKHOUSE_HOST=localhost
export CLICKHOUSE_NATS_URL=localhost:4222
export S3_ENDPOINT=http://localhost:9100
export S3_BUCKET=sentry-replays
export S3_ACCESS_KEY_ID=rustfsadmin
export S3_SECRET_ACCESS_KEY=rustfsadmin
```

### With the Sentry SDK

```ts
import * as Sentry from "@sentry/bun";

Sentry.init({
  dsn: "http://<publicKey>@localhost:31337/<app-number>",
  environment: "production",
  release: "my-app@1.0.0",
});
```

---

## Deploy on Kubernetes

The chart in [`helm/benemetrics`](helm/benemetrics) installs the API, the
side-effects consumer and — unless you point them at managed services —
Postgres, ClickHouse, NATS JetStream and an S3-compatible object store.

```bash
# 1. Build and push the image
docker build -t ghcr.io/benemetrics/benemetrics:0.1.0 .
docker push ghcr.io/benemetrics/benemetrics:0.1.0

# 2. Install
helm install benemetrics helm/benemetrics \
  --namespace benemetrics --create-namespace \
  --set image.repository=ghcr.io/benemetrics/benemetrics \
  --set image.tag=0.1.0 \
  --set ingress.hosts[0].host=benemetrics.example.com \
  --set ingress.hosts[0].paths[0].path=/ \
  --set ingress.hosts[0].paths[0].pathType=Prefix \
  --set ingress.className=nginx \
  --set adminToken="$(openssl rand -hex 24)"
```

Then:

```bash
helm -n benemetrics test benemetrics          # smoke test
kubectl -n benemetrics get pods
```

### Using managed services

Turn off the bundled dependency and point the chart at your own:

```yaml
dependencies:
  postgres: { enabled: false }
  clickhouse: { enabled: false }
  nats: { enabled: false }
  objectStorage: { enabled: false }

database:
  url: postgres://benemetrics:secret@postgres.acme.svc:5432/benemetrics
clickhouse:
  host: clickhouse.acme.svc
  natsUrl: nats.acme.svc:4222
nats:
  servers: nats://nats.acme.svc:4222
objectStorage:
  endpoint: https://s3.acme.svc
  bucket: benemetrics-replays
```

> `clickhouse.natsUrl` is resolved from **ClickHouse's** point of view: the
> engine tables connect to NATS themselves.

### The live feed

The browser subscribes to `sentry.events` over NATS WebSocket, so the
WebSocket listener has to be reachable from the browser. The UI reads
`globalThis.__NATS_WS_URL__` and falls back to `ws://<ui-host>:9222`; publish
that port (`dependencies.nats.websocket.service.type`) or inject your own
`ws://` endpoint.

### Chart values

| Key | Default | Description |
|---|---|---|
| `image.repository` | `ghcr.io/benemetrics/benemetrics` | The image built from the Dockerfile |
| `adminToken` | generated | The master credential (`API-Key`) |
| `backend.replicaCount` | `2` | API replicas |
| `backend.autoscaling.enabled` | `false` | HPA on the API |
| `backend.podDisruptionBudget.enabled` | `false` | PDB on the API |
| `consumer.enabled` | `true` | The side-effects consumer |
| `ingress.enabled` | `true` | Ingress for the UI and the API |
| `oidc.issuer` / `oidc.clientId` | `""` | An OIDC provider (optional) |
| `nats.websocketPort` | `9222` | The live feed listener |
| `objectStorage.bucket` | `benemetrics-replays` | The replay bucket |
| `dependencies.*.enabled` | `true` | The bundled services |

---

## Configuration

Every setting is an environment variable. The chart wires them for you.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `31337` | The HTTP port |
| `ADMIN_TOKEN` | — | The master admin credential (`API-Key <token>`) |
| `DATABASE_URL` | — | PostgreSQL; without it the dev PGlite database is used |
| `NATS_SERVERS` | — | `nats://host:4222`, comma separated |
| `NATS_STREAM_MAX_BYTES` | `1 GiB` | The JetStream stream bound |
| `CLICKHOUSE_HOST` / `_PORT` | `localhost` / `8123` | The ClickHouse HTTP endpoint |
| `CLICKHOUSE_DATABASE` / `_USER` / `_PASSWORD` | `default` | The credentials |
| `CLICKHOUSE_NATS_URL` | `nats:4222` | Where **ClickHouse** reaches NATS |
| `S3_ENDPOINT` / `S3_BUCKET` / `S3_REGION` | — | The object store (required) |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | — | The object store credentials |
| `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_SCOPES` | — | An optional OIDC provider |
| `ALERT_EVALUATION_INTERVAL_MS` | `60000` | The threshold-rule sweeper |
| `INIT_RETRY_ATTEMPTS` / `INIT_RETRY_DELAY_MS` | `5` / `1000` | The boot retries |

---

## The API

The full reference lives in [`docs/BACKEND_API.md`](docs/BACKEND_API.md). The shape:

| Surface | Prefix | Credential |
|---|---|---|
| Ingestion | `POST /api/:appNumber/envelope/` | The DSN public key |
| OTLP traces | `POST /api/:projectId/otlp/v1/traces` | The DSN public key |
| Events | `GET /events` | Admin token or provider JWT |
| Admin | `/api/admin/*` | Admin token or provider JWT |
| Flag evaluation | `POST /api/sentry/flags/evaluate` | The DSN public key |
| OpenFeature | `POST /v1/flags/:key` | The DSN public key |
| Source maps (CLI) | `/api/0/projects/:org/:project/*` | An upload token |
| UI | `/ui` | — |

Every list endpoint is cursor-paginated (`cursor` + `limit`, never `page`) and
returns `{ data }`.

---

## Development

```bash
bun install

docker compose up -d          # Postgres, ClickHouse, NATS, RustFS

bun run dev                   # the API with hot reload
bun run consumer              # the side-effects consumer
bun run typecheck             # bun check
bun run test                  # the whole suite (needs the docker services)
```

> The suite and a running app pull from the same JetStream durable, so the
> two compete for the events. Run the suite against the services alone
> (`docker compose up -d`, without the `app` profile).

### The local identity provider

`docker compose up -d keycloak` starts Keycloak on <http://localhost:8080>
(the admin console: `admin` / `admin`). The realm `benemetrics` is imported
from the compose config: the public SPA client `benemetrics`, the bearer
client `benemetrics-backend`, the groups `backend-team` / `frontend-team` and
the user `sso@example.com` (password `sentry`).

```bash
export OIDC_ISSUER="http://localhost:8080/realms/benemetrics"
export OIDC_CLIENT_ID="benemetrics-backend"
export OIDC_ALLOW_INSECURE_HTTP=true
bun run dev
```

A plain-HTTP issuer is refused by the OIDC client unless the deployment opts
in with `OIDC_ALLOW_INSECURE_HTTP=true` — the tokens would travel in the
clear. **HTTPS is the recommendation** for anything but a local provider: put
the provider behind TLS and point the issuer at its `https://` URL (the
issuer is what the backend and the browser agree on, so it has to match the
provider's own URL).

The layout:

```
backend/          the API — one directory per domain, one Elysia router each
  protocol/       the shared domain and protocol types
db/              the Drizzle schema, the migrations and the DAOs
frontend/        the React SPA, served by the backend
docs/            the architectural reference (the source of truth)
helm/benemetrics/ the Helm chart
e2e/             the end-to-end suites
```

---

## Documentation

The `docs/` directory is the architectural reference — it is the source of
truth for every decision in the codebase.

| Document | Subject |
|---|---|
| [`docs/models.md`](docs/models.md) | Projects, environments and apps |
| [`docs/metrics.md`](docs/metrics.md) | The metric taxonomy and the series APIs |
| [`docs/issues.md`](docs/issues.md) | Issue tracking, fingerprinting, the query protocol |
| [`docs/feature-flags.md`](docs/feature-flags.md) | Flags, evaluation priority, experiments |
| [`docs/alerting.md`](docs/alerting.md) | Channels, rules, the sweeper, incidents |
| [`docs/session-replays.md`](docs/session-replays.md) | The replay offload and the playback |
| [`docs/source-maps.md`](docs/source-maps.md) | The artifact storage and the symbolication |
| [`docs/permission.md`](docs/permission.md) | The admin model and the scoped reads |
| [`docs/rate-limiting.md`](docs/rate-limiting.md) | The request hygiene and the caps |
| [`docs/BACKEND_API.md`](docs/BACKEND_API.md) | The full endpoint and schema reference |

---

Built with [Bun](https://bun.com), [Elysia](https://elysiajs.com),
[ArkType](https://arktype.io), [Drizzle](https://orm.drizzle.team),
[NATS](https://nats.io), [ClickHouse](https://clickhouse.com) and
[React](https://react.dev).
