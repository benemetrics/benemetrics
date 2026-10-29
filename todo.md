# TODO

## Environment Feature Removal (Ditch the Environment concept entirely)

Collapse the Project → Environment → App hierarchy into Project → App.
Remove every reference to `environments`, `environment_id`, `EnvironmentDto`,
`environmentRoutes`, `environmentDAO`, and the `environment:` query term.

### Database schema (db/schema/)

- [x] `db/schema/environments.ts` — delete the `environments` pgTable + types
- [x] `db/schema/project.ts` — remove `environmentId` column from `apps` table
- [x] `db/schema/source-maps.ts` — remove `environmentId` column from `source_maps`
- [x] `db/schema/source-map-tokens.ts` — remove `environmentId` column + its index
- [x] `db/schema/permissions.ts` — remove `environments` JSON column from `permission_rules` and `permission_grants`
- [x] `db/schema/index.ts` — remove `export { environments } from "./environments"`

### Database DAOs (db/dao/)

- [x] `db/dao/environments.ts` — delete entire file (environmentDAO)
- [x] `db/dao/project.ts` (appDAO) — remove `listByEnvironment`, `listByEnvironmentIds`, `environmentId` from `create` input
- [x] `db/dao/source-maps.ts` — remove `environmentId` from create/list/filter
- [x] `db/dao/source-map-tokens.ts` — remove `environmentId` from create/list
- [x] `db/dao/permission-grants.ts` — remove `environments` field
- [x] `db/dao/permission-rules.ts` — remove `environments` field
- [x] `db/dao/issues.ts` — check for environment references (none found)

### Backend route handlers

- [x] `backend/environments/index.ts` — delete entire file (`environmentRoutes`, `/api/admin/environments/*`)
- [x] `backend/routes.ts` — remove `.use(environmentRoutes)` and its import
- [x] `backend/projects/index.ts` — remove default env creation on project POST, remove `environmentDAO` import, remove `environment` from app POST/response, remove `environmentDAO.deleteByProject` on project DELETE, remove environment from duplicate response
- [x] `backend/source-maps/index.ts` — remove `environmentDAO` import, remove environment validation on upload, remove `environmentId` from source map create/list, remove environment query param
- [x] `backend/source-map-tokens/index.ts` — remove `environmentId` from token scope/response (handled in source-maps/index.ts)
- [x] `backend/issues/index.ts` — remove `environment:` filter term handling, remove environmentId query param on events list
- [x] `backend/issues/resolve.ts` — remove `environmentDAO` import, remove `resolveEnvironmentAppIds` and `case "environment"` term
- [x] `backend/issues/query.ts` — remove `"environment"` kind from `IssueQueryTerm` union
- [x] `backend/issues/grouping.ts` — keep `environment` event data (not the Environment feature)
- [x] `backend/events/index.ts` — remove `environmentId` query param and `appDAO.listByEnvironment`
- [x] `backend/metrics/` — remove `environmentId` from series/breakdown queries
- [x] `backend/alerting/` — check for environment references (none found)
- [x] `backend/feature-flags/` — check for environment references (none found)

### Backend shared logic

- [x] `backend/auth.ts` — update source-map token comment (no longer project + environment)
- [x] `backend/permissions/engine.ts` — remove `environmentIds` from `ScopedView`, remove `environmentDAO` import, remove environment name resolution from `computeScopedView`, remove environment paths from `SCOPED_READ_PATHS`, update `PermissionScope` type (remove `environments`)
- [x] `backend/permissions/index.ts` — remove `environments` from rule/grant create/update
- [x] `backend/protocol/permissions.ts` — remove `environments` from schemas and `PermissionScope`
- [x] `backend/clickhouse.ts` — keep `row.environment` (event data, not the Environment feature)

### Frontend (frontend/src/)

- [x] `frontend/src/app/workspace.ts` — remove `ALL_ENVIRONMENTS` constant
- [x] `frontend/src/lib/api.ts` — remove `environmentId` from `listEvents`, `AppDto`, `SourceMapTokenDto`, `SourceMapArtifactDto`, remove `listEnvironments` + `EnvironmentDto`, remove `environments` from DTOs, remove `environmentId` from metric query params
- [x] `frontend/src/lib/metrics.ts` — remove `environmentId` from `MetricScope`/`MetricQuery`/`metricQuery`
- [x] `frontend/src/app/EnvironmentSwitcher.tsx` — delete entire file
- [x] `frontend/src/app/WorkspaceContext.tsx` — remove all environment state
- [x] `frontend/src/app/pages/Projects.tsx` — remove environment management UI
- [x] `frontend/src/app/pages/Overview.tsx` — remove environment filtering
- [x] `frontend/src/app/pages/Performance.tsx` — remove environmentId from scope
- [x] `frontend/src/app/pages/EventDetail.tsx` — remove environmentId from event list
- [x] `frontend/src/app/pages/Permissions.tsx` — remove environments from scope UI
- [x] `frontend/src/app/pages/SourceMaps.tsx` — remove environmentId from token/upload
- [x] `frontend/src/app/Topbar.tsx` — remove EnvironmentSwitcher

### Tests (backend/tests/)

- [x] `backend/tests/test-helpers.ts` — check for environment usage
- [x] `backend/tests/12-projects-apps.test.ts` — rewrite without environment test cases
- [x] `backend/tests/13-environments.test.ts` — delete entire file
- [x] `backend/tests/17-source-maps.test.ts` — remove environmentId from source-map tests
- [x] `backend/tests/31-issue-query-protocol.test.ts` — remove environment DAO usage
- [x] `backend/tests/32-permissions.test.ts` — rewrite without environment scope tests
- [x] `backend/tests/44-hop-live-feed.test.ts` — check environment usage
- [x] `backend/tests/47-hop-ch-to-metrics-api.test.ts` — remove environmentId breakdown
- [x] `backend/tests/49-undeclared-keys.test.ts` — remove environment creation

### Tests (e2e/)

- [x] `e2e/34-project-environment-app-lifecycle.test.ts` — delete entire file
- [x] `e2e/23-backend-parity-ui.test.ts` — remove environment management UI test, remove environmentId from source-map upload
- [x] `e2e/27-event-detail-symbolication-ui.test.ts` — remove environment creation
- [x] `e2e/35-oidc.test.ts` — remove environments: [] from grant creation
- [x] `e2e/37-oidc-login.test.ts` — remove environments: [] from grant creation
- [ ] e2e/* — keep environment: "test" from SDK event payloads (event data, not the Environment feature)

### Docs

- [ ] docs/models.md — remove Environment section
- [ ] docs/BACKEND_API.md — remove environments endpoint table
- [ ] docs/permission.md — remove environment names from scope semantics
- [ ] docs/issues.md — remove environment: query key
- [ ] docs/metrics.md — remove environmentId from query params
- [ ] docs/feature-flags.md — remove environment references
- [ ] AGENTS.md — update hierarchy (Project → App, no Environment)

### Migrations

- [ ] Generate new migration via drizzle-kit generate to drop environments table and environment_id columns

### Docker compose

- [ ] docker-compose.yml / docker-compose.stress.yml — no changes needed

### Overview

Single OTLP endpoint `/api/:projectId/otlp` accepting **traces, logs, and metrics** in one request (OTLP HTTP/JSON supports mixed signals). Routes each signal to its NATS subject.

Current: `POST /api/:projectId/otlp/v1/traces` → `sentry.events`
Target: `POST /api/:projectId/otlp` → `sentry.events` + `sentry.logs` + `sentry.metrics`

---

### 1. How It Works

**Ingestion Flow:**

```
Client / Collector
      │
      ▼
POST /api/:projectId/otlp
      │
      ├── resourceSpans (traces) ──▶ convert to Sentry envelopes ──▶ NATS sentry.events ──▶ ClickHouse events
      │
      ├── resourceLogs (logs) ──────▶ convert to log entries ──────▶ NATS sentry.logs ─────▶ ClickHouse logs
      │
      └── resourceMetrics (metrics) ┤ convert to metric samples ───▶ NATS sentry.metrics ──▶ ClickHouse metrics
```

**Key Properties:**

- Single HTTP endpoint, single auth check (project + DSN key), single rate limit
- OTLP JSON payload may contain any combination of the three signals
- Each signal validated, converted, and published independently
- Partial failure = reject entire request (atomic per request)

---

### 2. Protocol Types Needed

Add to `backend/protocol/otlp.ts`:

- LogRecord, ScopeLogs, ResourceLogs, ExportLogsServiceRequest
- Metric, ScopeMetrics, ResourceMetrics, ExportMetricsServiceRequest
- Unified ExportRequest (all three optional arrays)

---

### 3. Route Behavior

**Endpoint:** `POST /api/:projectId/otlp`

**Auth:** Resolve app via projectId + DSN key (same as existing traces endpoint)

**Request Body:** OTLP JSON with optional `resourceSpans`, `resourceLogs`, `resourceMetrics`

**Processing:**

1. Validate body structure (ArkType: three optional unknown arrays)
2. For each present signal type:
   - Parse JSON
   - Convert to internal NATS payload
   - Publish to corresponding NATS subject
3. Wait for all publishes
4. Return `{ accepted: true }`

**Errors:**

- Invalid JSON → 400
- Unknown signal structure → 400
- NATS publish timeout/failure → 503
- Auth failure → 401

---

### 4. Converters (Three Independent Modules)

| Converter                           | Input           | Output NATS Subject |
| ----------------------------------- | --------------- | ------------------- |
| `convertOtlpToEnvelopes` (existing) | resourceSpans   | `sentry.events`     |
| `convertOtlpLogsToEntries` (new)    | resourceLogs    | `sentry.logs`       |
| `convertOtlpMetricsToSamples` (new) | resourceMetrics | `sentry.metrics`    |

**Logs Converter Logic:**

- Iterate resourceLogs → scopeLogs → logRecords
- Map OTLP severityNumber (1-17) → level string (trace/debug/info/warn/error/fatal)
- Extract traceId/spanId (normalize hex, validate length)
- Convert nano timestamps to ISO8601
- Extract resource attributes → K8s metadata (namespace, pod, container, labels, node)
- Include projectId, appId from auth resolution
- Output: JSON payload for `sentry.logs`

**Metrics Converter Logic:**

- Iterate resourceMetrics → scopeMetrics → metrics
- Handle Sum, Gauge, Histogram, ExponentialHistogram data points
- Extract name, type, value (double/int), timestamp, attributes
- Include projectId, appId
- Output: JSON payload for `sentry.metrics`

---

### 5. NATS Configuration

**Streams:**

- `SENTRY_LOGS` — subject `sentry.logs`, 1 GiB, 7 day max age
- `SENTRY_METRICS` — subject `sentry.metrics`, 1 GiB, 7 day max age

**Consumers (for ClickHouse):**

- `clickhouse-logs` on SENTRY_LOGS
- `clickhouse-metrics` on SENTRY_METRICS
- Explicit ack, 30s wait, max deliver 3

---

### 6. ClickHouse Storage

| Signal  | NATS Table   | Target Table | Engine             | Partition         | Order By                                        | TTL |
| ------- | ------------ | ------------ | ------------------ | ----------------- | ----------------------------------------------- | --- |
| Events  | events_nats  | events       | ReplacingMergeTree | toDate(timestamp) | (projectId, timestamp, eventId)                 | 90d |
| Logs    | logs_nats    | logs         | ReplacingMergeTree | toDate(timestamp) | (namespace, pod, container, timestamp, traceId) | 30d |
| Metrics | metrics_nats | metrics      | SummingMergeTree   | toDate(timestamp) | (projectId, name, timestamp, attributes)        | 90d |

**Materialized Views:** Each NATS table → target table (automatic on insert)

**Deduplication:**

- Events: ReplacingMergeTree on eventId
- Logs: ReplacingMergeTree on (namespace, pod, container, timestamp, traceId)
- Metrics: SummingMergeTree on (projectId, name, timestamp, attributes)

---

### 7. Query API (Admin Surface)

**Logs:**

- `GET /api/admin/logs/query` — filter by namespace, pod, container, level, traceId, time range, cursor pagination
- `GET /api/admin/logs/:traceId` — all logs for a trace (±5min window)

**Metrics:**

- `GET /api/admin/metrics/query` — filter by project, name, attributes, time range, aggregation

**Scoping:** All queries filtered by `scopedViewFor(adminId)` → namespace + app prefix allowlist

---

### 8. DaemonSet Collector Config

**Fluent Bit:**

- Tail `/var/log/containers/*.log`
- Parse (regex for plain text, JSON for structured)
- Enrich with K8s metadata (namespace, pod, labels)
- Add `sentry.io/project-id` from pod label as resource attribute
- HTTP output → `/api/${PROJECT_ID}/otlp`
- Content-Type: application/json

**Vector:**

- Source: kubernetes_logs
- Remap: extract level from message, parse timestamps, enrich K8s
- Sink: opentelemetry exporter → `/api/${PROJECT_ID}/otlp`

**Required Pod Label:** `sentry.io/project-id: "proj_abc123"`

---

### 9. Log-to-Issue Consumer

**Consumer:** `log-issues` on `SENTRY_LOGS` stream

**Logic:**

1. Consume log entries from NATS
2. Filter: level = error or fatal
3. Resolve projectId:
   - From log entry (set by converter from resource attributes)
   - Fallback: namespace_project_map table
4. Extract fingerprint from message (normalize: UUIDs→<uuid>, numbers→<num>, paths→<path>, timestamps→<ts>)
5. Upsert issue in Postgres:
   - Key: (projectId, fingerprint)
   - Update: lastSeen, eventCount++
   - Metadata: { traceId, source: "log", namespace, pod, container }
6. Ack message

**Alerting:** Standard issue transitions (new_issue, regression) fire alerts — no separate log alerting.

---

### 10. TraceId Correlation

**Flow:**

1. SDK/Collector generates traceId → sent in OTLP spans + logs + metrics
2. Backend extracts traceId from all three signals
3. Stored in ClickHouse: events.traceId, logs.traceId, metrics.traceId
4. Query: Event detail → lookup logs by traceId ±5min
5. UI: Unified trace view (spans + logs + metrics)

---

### 11. File Structure

```
backend/
├── otlp/
│   ├── index.ts              # Single POST /:projectId/otlp
│   ├── convert.ts            # Traces → envelopes (existing)
│   ├── convertLogs.ts        # Logs → sentry.logs payload
│   └── convertMetrics.ts     # Metrics → sentry.metrics payload
├── protocol/
│   └── otlp.ts               # + LogRecord, Metric types
├── nats.ts                   # + SENTRY_LOGS, SENTRY_METRICS streams + consumers
├── routes.ts                 # registers otlpRoutes
└── db/
    ├── schema/
    │   ├── logs.ts           # Drizzle schema
    │   └── metrics.ts        # Drizzle schema
    └── migrations/
        ├── 000X_logs.sql
        └── 000Y_metrics.sql
```

---

### 12. Rollout Checklist

| Step                                                  | Status |
| ----------------------------------------------------- | ------ |
| Add OTLP log/metric types to protocol/otlp.ts         | ⬜     |
| Create convertLogs.ts                                 | ⬜     |
| Create convertMetrics.ts                              | ⬜     |
| Replace otlp/index.ts with unified endpoint           | ⬜     |
| Add SENTRY_LOGS + SENTRY_METRICS streams to nats.ts   | ⬜     |
| Add logs + metrics Drizzle schemas + migrations       | ⬜     |
| Implement LogsDAO + MetricsDAO                        | ⬜     |
| Implement GET /api/admin/logs/query + scoped reads    | ⬜     |
| Implement GET /api/admin/metrics/query                | ⬜     |
| Add log-issues consumer to nats.ts                    | ⬜     |
| Implement consumer-log-issues.ts binary               | ⬜     |
| Unit tests (unified OTLP, conversion, query)          | ⬜     |
| E2E: OTLP mixed payload → all three NATS → ClickHouse | ⬜     |
| Document DaemonSet OTLP exporter config               | ⬜     |

---

### 13. Non-Goals

- No separate /traces, /logs, /metrics endpoints
- No custom JSON schema (OTLP is the schema)
- No live tail WebSocket
- No log-to-metric extraction
- No full-text search
- No separate retention per namespace

---

### 14. Permission settings UI

The permission scope is app-name prefixes only and the identity grant form
makes the admin paste a raw `<issuer>|<subject>` id. Both are hostile to the
admin: add project selects and a user dropdown.

#### Backend

- [x] `db/schema/permissions.ts` — add `project_ids` JSON column to `permission_rules` and `permission_grants`
- [x] `backend/protocol/permissions.ts` — extend `PermissionScope` with `projectIds`; add `projectIds` to rule/grant body + patch schemas
- [x] `db/dao/permission-rules.ts` & `db/dao/permission-grants.ts` — read/write `projectIds` (JSON); add `listIdentities` to the grants DAO
- [x] `db/dao/project.ts` — add `appDAO.listByProjectIds(projectIds)` returning the apps in the given projects
- [x] `backend/permissions/engine.ts` — `computeScopedView` expands `projectIds` to apps and unions them with the prefix-derived apps/projects
- [x] `backend/permissions/index.ts` — pass `projectIds` through rule/grant create/patch; add `GET /api/admin/permissions/identities` (known identities for the dropdown)
- [x] `db/migrations/*` — migration adding the `project_ids` columns (hand-written single-statement migrations; `drizzle-kit generate` couldn't run against a live DB in this environment)

#### Frontend

- [x] `frontend/src/lib/api.ts` — `PermissionRuleDto`/`PermissionGrantDto` gain `projectIds`; add `listPermissionIdentities` helper
- [x] `frontend/src/app/pages/Permissions.tsx` — group rule form: project multi-select + prefix/suffix text; identity grant form: user dropdown + project multi-select + prefix/suffix text; scope readout shows projects + prefixes

#### Tests

- [x] `backend/tests/32-permissions.test.ts` — cover `projectIds` scope propagation and the identities endpoint
- [x] `e2e/38-permissions-ui.test.ts` — cover the project select and prefix/suffix fields in the UI
