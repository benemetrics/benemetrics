# Backend Features

This document lists the features implemented on the backend, grouped by area.

## Projects & Apps

| Feature           | Description                                                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Create project    | `POST /api/admin/projects` — creates a project with an auto-derived slug. No app is created automatically.                    |
| List projects     | `GET /api/admin/projects` — returns all projects with their app counts.                                                       |
| Get project       | `GET /api/admin/projects/:id` — project detail including its apps.                                                            |
| Delete project    | `DELETE /api/admin/projects/:id` — deletes the project and cascades to its apps.                                              |
| Duplicate project | `POST /api/admin/projects/:id/duplicate` — copies apps with fresh IDs and ingest keys.                                        |
| Create app        | `POST /api/admin/projects/:id/apps` — creates an app inside a project, generating its ingest key, public key, and DSN number. |
| List apps         | `GET /api/admin/projects/:id/apps` — lists the apps belonging to a project.                                                   |

## Team / Permissions

| Feature                | Description                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Group rules (CRUD)     | `POST/GET/PATCH/DELETE /api/admin/permissions/rules` — map OIDC groups to project + app-prefix scopes.                                   |
| Identity grants (CRUD) | `POST/GET/PATCH/DELETE /api/admin/permissions/grants` — grant specific identities (users) explicit scopes, optionally with write access. |
| Audit trail            | `GET /api/admin/permissions/audit` — records every permission change (who, what, before/after).                                          |
| Known identities       | `GET /api/admin/permissions/identities` — identities that already have grants, for the user dropdown.                                    |
| Session / scope        | `GET /api/admin/session` — the caller's resolved identity and read scope.                                                                |

## Issues

| Feature          | Description                                                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| List issues      | `GET /api/admin/issues` — search grammar (`is:unresolved app:checkout lastSeen:-24h`), sortable by new/frequent/first-seen/users. |
| Get issue        | `GET /api/admin/issues/:id` — a single issue by fingerprint.                                                                      |
| Issue events     | `GET /api/admin/issues/:id/events` — the issue's occurrences, newest first.                                                       |
| Issue stats      | `GET /api/admin/issues/:id/stats` — bucketed event/user counts over a time window.                                                |
| Resolve / reopen | `PATCH /api/admin/issues/:id` — flip status between `unresolved` and `resolved`; resolving arms the regression trigger.           |

## Releases

| Feature         | Description                                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Releases CRUD   | Create, list, get, patch, delete releases.                                                                              |
| Release summary | `GET /api/admin/releases/:id/summary` — release health from the issue index (issues touched, new and regressed counts). |

## Alerting

| Feature               | Description                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| Alert channels (CRUD) | `webhook`, `slack`, `rocketchat`, `email`, `pagerduty`, `opsgenie`, `msteams`, `victorops`.     |
| Test notification     | `POST /api/admin/alerting/channels/:id/test` — sends a test and reports per-channel results.    |
| Alert rules (CRUD)    | `threshold`, `new_issue`, `regression` triggers with metric/operator/threshold/window/cooldown. |
| Incidents             | `GET /api/admin/alerting/incidents` — incident history.                                         |
| Effective config      | `GET /api/admin/alerting/apps/:appId/effective` — global config merged with per-app overrides.  |

## Feature Flags

| Feature       | Description                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Create flag   | `POST /api/admin/feature-flags` — scoped to a project, optionally narrowed to one of its apps. Defaults to `draft`.            |
| List flags    | `GET /api/admin/feature-flags` — filter by project, app, status, type, or search.                                              |
| Get flag      | `GET /api/admin/feature-flags/:id`.                                                                                            |
| Update flag   | `PATCH /api/admin/feature-flags/:id` — user-facing configuration only; status changes go through the status endpoint.          |
| Change status | `POST /api/admin/feature-flags/:id/status` — `draft` → `active` → `paused` → `archived`; archived flags cannot leave archived. |
| Delete flag   | `DELETE /api/admin/feature-flags/:id` — draft flags only; idempotent (missing flag returns success).                           |

## Experiments (layer on top of flags)

| Feature             | Description                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Start experiment    | `POST /api/admin/experiments/:flagId/start` — sets status to `running`.                                                        |
| Stop experiment     | `POST /api/admin/experiments/:flagId/stop` — sets status to `completed`.                                                       |
| Promote winner      | `POST /api/admin/experiments/:flagId/promote` — promotes the recommended variant to weight 100.                                |
| Results             | `GET /api/admin/experiments/:flagId/results` — participants, conversions, Wilson CI, two-proportion z-test, recommendation.    |
| Users / assignments | `GET /api/admin/experiments/:flagId/users` — assignments per variant; `GET /.../users/:userId` — one user's stored assignment. |

## Segments

| Feature        | Description                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------- |
| Create segment | `POST /api/admin/feature-flags/segments` — named, reusable targeting rule sets (AND logic). |
| List segments  | `GET /api/admin/feature-flags/segments`.                                                    |
| Get segment    | `GET /api/admin/feature-flags/segments/:id`.                                                |

## Flag Evaluation (SDK-facing, DSN-authenticated)

| Feature          | Description                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------- |
| Batched evaluate | `POST /api/sentry/flags/evaluate` — evaluate multiple flags for one user/context at once.   |
| Experiment track | `POST /api/sentry/flags/experiment/track` — record a metric value for a flag/user.          |
| SSE stream       | `GET /api/sentry/flags/stream?flags=...` — snapshot + `configuration_changed` push updates. |
| OpenFeature      | `POST /v1/flags/:key` — OpenFeature-compatible single-flag evaluation.                      |

## Source Maps

### Admin surface (`/api/admin/source-maps`, admin-token-only)

| Feature         | Description                                                                            |
| --------------- | -------------------------------------------------------------------------------------- |
| List artifacts  | `GET /api/admin/source-maps` — filter by project/release.                              |
| Get artifact    | `GET /api/admin/source-maps/:id` — with `?include=content` to return the raw map JSON. |
| Delete artifact | `DELETE /api/admin/source-maps/:id`.                                                   |

### Upload tokens (`/api/admin/source-map-tokens`, admin-token-only)

| Feature      | Description                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------- |
| Create token | `POST /api/admin/source-map-tokens` — raw token returned exactly once.                                         |
| List tokens  | `GET /api/admin/source-map-tokens` — prefix only, never the raw token.                                         |
| Get token    | `GET /api/admin/source-map-tokens/:id`.                                                                        |
| Rotate token | `POST /api/admin/source-map-tokens/:id/rotate` — invalidates the previous token, returns a new raw token once. |
| Revoke token | `DELETE /api/admin/source-map-tokens/:id` — soft delete.                                                       |

### CLI-compatible surface (`/api/0/projects/:org/:project/`, upload-token auth)

| Feature           | Description                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------- |
| Create release    | `POST /releases/`.                                                                           |
| Upload source map | `POST /releases/:version/files/` — multipart, validates v3 + sources + mappings (10 MB cap). |
| List artifacts    | `GET /releases/:version/files/`.                                                             |
| Delete artifact   | `DELETE /releases/:version/files/:fileId/`.                                                  |
| Finalize release  | `POST /releases/:version/`.                                                                  |
| Release summary   | `GET /releases/:id/summary` — release health from ClickHouse.                                |

### Symbolication

At event read time, stack frames are matched to source-map artifacts by filename, VLQ mappings are decoded to original positions with source context, and results are cached (versioned by artifact upload time so re-uploads are never served stale).

## Settings

| Feature       | Description                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| Get event TTL | `GET /api/admin/settings/events-ttl` — reads the retention TTL from the ClickHouse table definition.         |
| Set event TTL | `PUT /api/admin/settings/events-ttl` — `{ amount, unit }` replaces the TTL via `ALTER TABLE ... MODIFY TTL`. |

## Session Replays

| Feature         | Description                                                                                                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Replay segments | `GET /api/admin/events/:eventId/replay/:replayId` — paginated presigned S3 URLs for replay segments in playback order. The browser fetches bytes directly; the backend never proxies recording payloads. |

## Ingestion (SDK → Server)

| Feature                | Description                                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Envelope ingestion     | `POST /api/:projectId/envelope/` — Sentry envelope format, handles gzip compression.                                                                  |
| Legacy store ingestion | `POST /api/:projectId/store/` — single JSON event.                                                                                                    |
| OTLP ingestion         | `POST /api/:projectId/otlp` — unified endpoint accepting traces, logs, and metrics in one request; each signal converted and published independently. |

## Events API (ClickHouse reads)

| Feature     | Description                                                        |
| ----------- | ------------------------------------------------------------------ |
| List events | `GET /events/` — cursor-paginated, filterable by project/app/time. |
| Get event   | `GET /events/:eventId` — a single parsed event.                    |

## Metrics API (ClickHouse reads)

| Feature          | Description                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------ |
| Metric series    | `GET /api/admin/metrics/series` — bucketed counts and percentiles (p50/p95/p99) over time. |
| Metric breakdown | `GET /api/admin/metrics/breakdown` — top-N dimensions for a metric and window.             |

## Authentication

| Feature           | Description                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Admin token       | `Authorization: API-Key <token>` — master admin credential, stored only as an argon2id hash, rotated daily at 00:00 UTC.   |
| Provider identity | `Authorization: Bearer <JWT>` — verified with `jose` against the OIDC provider's JWKS (audience + issuer + `azp` checked). |
| DSN auth          | `sentry_key` query param or `X-Sentry-Auth` header — validates ingestion calls against the resolved app's public key.      |
| Upload token auth | Bearer token or `X-Upload-Token` header — validates source-map uploads against hashed, revocable, expiring tokens.         |

## Scoped Reads

| Feature                     | Description                                                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read-only scoped identities | Non-admin identities are limited to allowlisted GET endpoints; filtered by their project/app scope; out-of-scope details return 404, writes return 403. |

## Pipeline (NATS-first)

| Feature                 | Description                                                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Event ingestion to NATS | Ingested events publish to `sentry.events`; metric samples publish to `sentry.metrics`.                                                                    |
| ClickHouse storage      | NATS engine tables + materialized views ingest into ClickHouse (`ReplacingMergeTree`, `FINAL` reads for idempotency, 1-month default TTL).                 |
| Side-effects consumer   | Standalone `backend/consumer.ts` binary applies issue tracking, alert triggers, and release tracking to Postgres from the `side-effects` durable consumer. |
| Replay offload          | `replay_recording` payloads written to the S3-compatible object store before NATS publish; envelope keeps only an object-key pointer.                      |
| Live feed               | Browser subscribes to `sentry.events` directly over NATS WebSocket (no backend fanout).                                                                    |
