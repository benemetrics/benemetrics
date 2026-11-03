# Feature Flags & Experiments — Architecture

**Status:** Design paper — feature flag management, evaluation, targeting, segments, and A/B testing (experiments).

---

## 1. Model in One Paragraph

Feature flags are **scoped to a project** (optionally narrowed to one of its apps) and managed via an admin surface. Each flag has a key, type (`boolean|string|number|json`), default value, weighted variants, targeting rules, segment references, and rollout percentage. Evaluation follows a strict priority order: targeting rules → segment matching → rollout percentage → weighted random assignment. Experiments layer on top of flags: when enabled, user-to-variant assignments are persisted for consistency, metrics are recorded per variant, and statistical analysis (Wilson confidence intervals, two-proportion z-tests) produces results with recommendations. Evaluation is exposed via the OpenFeature Remote Evaluation Protocol (OFREP): single-flag and bulk evaluation plus an SSE change-notification stream.

---

## 2. Domain Model

### Feature Flag

| Field                     | Type                  | Notes                                            |
| ------------------------- | --------------------- | ------------------------------------------------ |
| `id`                      | UUID                  | Primary key                                      |
| `key`                     | string                | Globally unique; used in evaluation requests     |
| `name`                    | string                | Human-readable                                   |
| `description`             | string                | Optional                                         |
| `type`                    | enum                  | `boolean` \| `string` \| `number` \| `json`      |
| `defaultValue`            | string/number/boolean | Fallback when no variant matches                 |
| `variants`                | JSON array            | Weighted variants; defaults generated if omitted |
| `targetingRules`          | JSON array            | Attribute-based rules (first match wins)         |
| `segments`                | UUID array            | References to audience segments                  |
| `status`                  | enum                  | `draft` \| `active` \| `paused` \| `archived`    |
| `rolloutPercentage`       | integer               | 0–100; outside rollout returns control variant   |
| `experiment`              | JSON object?          | Experiment configuration (see below)             |
| `createdAt` / `updatedAt` | ISO strings           | Timestamps                                       |

**Uniqueness**: `key` unique per scope (`project_id`, `app_id`).

**Indexes**: `key`, `status`.

### Variant

```json
{
  "key": "control",
  "name": "Control",
  "value": false,
  "weight": 50
}
```

| Field    | Type    | Notes                              |
| -------- | ------- | ---------------------------------- |
| `key`    | string  | Unique within flag                 |
| `name`   | string  | Human-readable                     |
| `value`  | any     | Typed per flag `type`              |
| `weight` | integer | 0–100; sums to 100 across variants |

**Defaults** (when `variants` omitted):

- `boolean` type → `control`/`treatment` 50/50
- Other types → single `default` variant at 100%

### Targeting Rule

```json
{
  "attribute": "user.email",
  "operator": "ends_with",
  "value": "@company.com",
  "variantKey": "treatment"
}
```

| Field        | Type    | Notes                                                                     |
| ------------ | ------- | ------------------------------------------------------------------------- |
| `attribute`  | string  | Dot-path: `user.*` or `context.*`                                         |
| `operator`   | enum    | See supported operators below                                             |
| `value`      | any     | Comparison value                                                          |
| `variantKey` | string? | If present: assignment rule. If absent: eligibility gate (all must match) |

**Supported operators**: `equals`, `not_equals`, `contains`, `not_contains`, `starts_with`, `ends_with`, `in`, `not_in`, `greater_than`, `less_than`, `greater_than_or_equal`, `less_than_or_equal`.

**Eligibility rules** (rules without `variantKey`): evaluated before segments; if any exists, at least one must match, else user is "outside experiment audience" → control variant.

### Segment

| Field         | Type       | Notes                                        |
| ------------- | ---------- | -------------------------------------------- |
| `id`          | UUID       | Primary key                                  |
| `name`        | string     | Human-readable                               |
| `description` | string     | Optional                                     |
| `rules`       | JSON array | Same targeting rule schema (no `variantKey`) |
| `createdAt`   | ISO string |                                              |

**Evaluation**: All rules in a segment must match (AND). If matched, weighted variant assignment by hashed `user.id`.

### Experiment Configuration

```json
{
  "enabled": true,
  "hypothesis": "New checkout flow increases conversion",
  "primaryMetric": "purchase_completed",
  "confidenceLevel": 0.95,
  "minimumSampleSize": 1000,
  "status": "running",
  "guardrailMetrics": [
    { "metric": "error_rate", "action": "pause", "threshold": 0.05 }
  ]
}
```

| Field               | Type    | Notes                                               |
| ------------------- | ------- | --------------------------------------------------- |
| `enabled`           | boolean | Activates experiment behavior                       |
| `hypothesis`        | string  | Description for reporting                           |
| `primaryMetric`     | string  | Metric name for statistical comparison              |
| `confidenceLevel`   | number  | 0.90 / 0.95 / 0.99 (default 0.95)                   |
| `minimumSampleSize` | integer | Minimum participants per variant for recommendation |
| `status`            | enum    | `running` \| `paused` \| `completed`                |
| `guardrailMetrics`  | array   | Safety metrics that can auto-pause the flag         |

---

## 3. Evaluation Pipeline

### Priority Order (Strict)

1. **Targeting Rules** — First match wins (attribute + operator + value). Assignment rules (`variantKey` present) return immediately. Eligibility rules (no `variantKey`) gate further evaluation.
2. **Segments** — All segment rules must match (AND). If matched, weighted assignment by `user.id` hash.
3. **Rollout Percentage** — If `< 100%`, bucket outside rollout → control variant.
4. **Weighted Random Assignment** — Deterministic by `FNV-1a(flagKey:userId)` modulo 100.

### Bucketing Algorithm

```
FNV-1a hash of "flagKey:userId" → 32-bit unsigned → modulo 100 → bucket [0, 99]
```

Deterministic, stateless, consistent across evaluations.

### Non-Active Flag Behavior

- `draft` / `paused` / `archived` → control (or first) variant, reason includes status
- Unknown flag → `default`/`null`, reason "Feature flag not found"

---

## 4. Experiment Behavior

### Assignment Persistence

When experiment enabled:

1. Check `experiment_assignments` for existing `(flagId, userId)`
2. If exists: return stored variant (sticky assignment)
3. If not: run evaluation pipeline, persist assignment with context snapshot
4. Race-safe: concurrent evaluations use unique index on `(flagId, userId)`; loser reads stored assignment

### Metric Recording

`POST /api/sentry/flags/experiment/track`:

- Validates assignment exists for user
- Records metric row: `flagId`, `variantKey`, `userId`, `metricName`, `value` (default 1)
- **Guardrail check**: If metric matches a guardrail with `action: "pause"` and `value > threshold`, flag status → `paused` immediately

### Statistical Analysis

Results computed on demand (`GET /api/admin/experiments/:flagId/results`):

- Participants per variant: `COUNT(*)` from `experiment_assignments`
- Conversions per variant: `COUNT(*)` from `experiment_metrics` where `metricName = primaryMetric`
- **Wilson score interval** for conversion rate confidence intervals
- **Two-proportion z-test** comparing each treatment vs control
- **Recommendation**:
  - Significant (`p < 1 - confidence`), positive lift, sample ≥ minimum → `implement` (high/medium confidence)
  - Otherwise → `continue`

---

## 5. Evaluation Surface (OFREP)

The evaluation surface implements the **OpenFeature Remote Evaluation Protocol
(OFREP)**, the vendor-agnostic API between OpenFeature providers and flag
management systems (spec: `open-feature/protocol`, service OpenAPI 0.4.0).

**Authentication** — the DSN public key, under either spec form plus the
legacy forms: `X-API-Key: <key>`, `Authorization: Bearer <key>`,
`X-Sentry-Auth: sentry_key=<key>`, or the `api_key`/`sentry_key` query
parameters (used by `EventSource`, which cannot set headers). The key names
the app, which carries the flag scope (the project and the app); a missing
or unknown key is rejected with `401` before any evaluation runs.

**Evaluation priority** — unchanged from the native engine: targeting rules
first-match → segments (all rules must match) → rollout percentage →
FNV-1a(`flagKey:targetingKey`) weighted variants. Reason codes follow the
OpenFeature enum: `TARGETING_MATCH` (rule/segment/eligibility decisions),
`SPLIT` (rollout / weighted assignment / sticky stored assignment),
`DISABLED` (non-active flag → control variant), `STATIC`, `UNKNOWN`.

### Single-Flag Evaluation (server-side providers)

```
POST /ofrep/v1/evaluate/flags/{key}
{ "context": { "targetingKey": "user-123", ...attributes } }
```

- `200` → `{ key, value, reason, variant, metadata: { flagType } }`
- `404` → `{ key, errorCode: "FLAG_NOT_FOUND", errorDetails }`
- `400` → `{ key, errorCode: "TARGETING_KEY_MISSING" | "INVALID_CONTEXT", errorDetails }`

Targeting rules keep the legacy attribute roots (`user.*`, `context.*`);
they resolve against the flat OFREP context (`user.email` → `context.email`,
`user.id` → `targetingKey`).

### Bulk Evaluation (client-side providers)

```
POST /ofrep/v1/evaluate/flags
{ "context": { "targetingKey": "user-456", ...attributes } }
```

- Evaluates every flag visible to the scope (project-scope flags plus the
  unscoped ones) with the static context and returns
  `{ flags: Array<{ key, value, reason, variant, metadata }>, metadata: { version }, eventStreams: [...] }`.
- `ETag` echoes the scope's configuration hash; a matching `If-None-Match` →
  `304 Not Modified`.
- `eventStreams[0]` advertises `type: "sse"`, the stream URL
  (`/ofrep/v1/events?api_key=…`) and `inactivityDelaySec: 120`.

### Change-Notification Stream (SSE, via Elysia)

```
GET /ofrep/v1/events?api_key=<key>
```

- Implemented with Elysia's native SSE (async generator + the `sse()` helper),
  not a hand-rolled `ReadableStream`.
- On every flag CRUD/status change (published to the
  `sentry.flags.changed` stream subject and fanned out by every instance) the
  stream emits an SSE `message` event:
  `{ "type": "refetchEvaluation", "etag": "<etag>", "lastModified": <unix seconds> }`
  — the provider re-runs the bulk evaluation.
- A quiet connection receives a heartbeat (`{"type":"ping"}` — providers must
  ignore unknown payload types) every 20 s; the response always carries
  `content-type: text/event-stream`.

### Experiment Tracking (retained, outside OFREP)

```
POST /api/sentry/flags/experiment/track
{ flagKey, userId, metric, value? }
```

→ Records a metric row; a breaching `pause` guardrail pauses the flag in the
same transaction. Authenticated with the legacy DSN surface.

---

## 6. Admin Surface (Admin-Token Only)

Prefix: `/api/admin/feature-flags`

| Method   | Path                        | Description                                          |
| -------- | --------------------------- | ---------------------------------------------------- |
| `POST`   | `/feature-flags`            | Create flag (status `draft`)                         |
| `GET`    | `/feature-flags`            | List (filter: `status`, `type`, `search`; paginated) |
| `GET`    | `/feature-flags/:id`        | Get one                                              |
| `PATCH`  | `/feature-flags/:id`        | Update fields                                        |
| `POST`   | `/feature-flags/:id/status` | Change status (`draft                                | active | paused | archived`) |
| `DELETE` | `/feature-flags/:id`        | Delete — **draft only**                              |

### Experiments (Admin-Token Only)

Prefix: `/api/admin/experiments`

| Method | Path                     | Description                                                                             |
| ------ | ------------------------ | --------------------------------------------------------------------------------------- |
| `POST` | `/:flagId/start`         | Start the experiment (`status: "running"`)                                              |
| `POST` | `/:flagId/stop`          | Stop the experiment (`status: "completed"`)                                             |
| `POST` | `/:flagId/promote`       | Promote the recommended winner (weight 100)                                             |
| `GET`  | `/:flagId/results`       | Results dashboard: participants, conversions, Wilson CI, z-test p-value, recommendation |
| `GET`  | `/:flagId/users`         | Assignments per variant (filter `variantKey`, `search`; paginated)                      |
| `GET`  | `/:flagId/users/:userId` | One user's stored assignment                                                            |

> The SDK-facing surface evaluates and tracks only. Experiment results and
> participant identities are admin-only — they are never served from
> `/api/sentry/flags/*`.

**Lifecycle**:

- `draft` → `active` → `paused` / `archived`
- `active` → `paused` via status endpoint or guardrail auto-pause
- `archived` is terminal
- Only `draft` flags deletable (safety)

**Flag body** (validated by ArkType):

```json
{
  "key": "string",
  "name": "string",
  "description": "string?",
  "type": "'boolean' | 'string' | 'number' | 'json'",
  "defaultValue": "string | number | boolean",
  "variants": "Array<{ key, name, value, weight }>?",
  "targetingRules": "Array<{ attribute, operator, value, variantKey? }>?",
  "segments": "string[]?",
  "experiment": "ExperimentConfig?",
  "rolloutPercentage": "number?"
}
```

---

## 7. Invariants (Must Not Break)

| Invariant                                                     | Enforcement                                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Flag key unique per scope                                     | Unique index on `(project_id, app_id, key)`                              |
| Variants weight sum = 100                                     | Validation on create/update                                              |
| Targeting rule attribute path valid (`user.*` or `context.*`) | Schema validation                                                        |
| Segment rules use same operator set as targeting rules        | Shared type; validation                                                  |
| Experimental assignment sticky                                  | Unique index on `(flagId, userId)`; read-before-write with race handling |
| Guardrail auto-pause atomic                                   | Status update in same transaction as metric record                       |
| Statistical methods use Wilson interval + z-test              | Pure functions in `backend/feature-flags/stats.ts`                       |
| Non-active flags never assign treatment variants              | Evaluation returns control immediately                                   |
| OFREP wire shape (spec conformance)                           | `/ofrep/v1/*` bodies follow the OpenFeature protocol OpenAPI             |
| SSE stream emits the OFREP event payload                      | Elysia `sse()` generator sends `{type: "refetchEvaluation", etag, lastModified}` |

---

## 8. Data Flow Summary

```
Admin UI
    │
    ├── Create flag (draft)
    ├── Edit variants/rules/segments/experiment
    └── Activate → status = "active"
                          │
                          ▼
client SDK (OpenFeature provider)
    │
    ├── POST /ofrep/v1/evaluate/flags (bulk, ETag-cached)
    │   └── Returns variant assignments for the whole scope
    │
    ├── POST /ofrep/v1/evaluate/flags/:key (single, per-request context)
    │   └── Returns one variant
    │
    └── GET /ofrep/v1/events (SSE)
        └── Receives `refetchEvaluation` change notifications
                          │
                          ▼
Experiment (if enabled)
    │
    ├── Assignment persisted (flagId, userId, variantKey, context)
    │
    ├── Client tracks metric
    │   POST /experiment/track { flagKey, userId, metric, value }
    │   └── Row in experiment_metrics
    │
    └── Guardrail check
        └── If threshold exceeded → flag status = "paused"
                          │
                          ▼
Results Dashboard
    │
    └── GET /api/admin/experiments/:flagId/results
        ├── Participants per variant (assignments)
        ├── Conversions per variant (metrics, primaryMetric)
        ├── Wilson CI, z-test p-values
        └── Recommendation (implement/continue)
```

---

## 9. Related Architecture Docs

- [`models.md`](models.md) — Projects, environments, apps (the flags are scoped to a project)
- [`permission.md`](permission.md) — Admin auth (flags admin-token only)
- [`alerting.md`](alerting.md) — Alerting (separate domain; flags not used for alerts)
- [`events.md`](events.md) — Ingestion (flags not involved in event pipeline)
