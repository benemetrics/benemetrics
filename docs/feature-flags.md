# Feature Flags & Experiments — Architecture

**Status:** Design paper — feature flag management, evaluation, targeting, segments, and A/B testing (experiments).

---

## 1. Model in One Paragraph

Feature flags are **global** (not scoped to project/environment/app) and managed via an admin surface. Each flag has a key, type (`boolean|string|number|json`), default value, weighted variants, targeting rules, segment references, and rollout percentage. Evaluation follows a strict priority order: targeting rules → segment matching → rollout percentage → weighted random assignment. Experiments layer on top of flags: when enabled, user-to-variant assignments are persisted for consistency, metrics are recorded per variant, and statistical analysis (Wilson confidence intervals, two-proportion z-tests) produces results with recommendations. Three evaluation surfaces exist: batched Sentry-style, SSE push stream, and OpenFeature-compatible single-flag endpoint.

---

## 2. Domain Model

### Feature Flag

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Primary key |
| `key` | string | Globally unique; used in evaluation requests |
| `name` | string | Human-readable |
| `description` | string | Optional |
| `type` | enum | `boolean` \| `string` \| `number` \| `json` |
| `defaultValue` | string/number/boolean | Fallback when no variant matches |
| `variants` | JSON array | Weighted variants; defaults generated if omitted |
| `targetingRules` | JSON array | Attribute-based rules (first match wins) |
| `segments` | UUID array | References to audience segments |
| `status` | enum | `draft` \| `active` \| `paused` \| `archived` |
| `rolloutPercentage` | integer | 0–100; outside rollout returns control variant |
| `experiment` | JSON object? | Experiment configuration (see below) |
| `createdAt` / `updatedAt` | ISO strings | Timestamps |

**Uniqueness**: `key` globally unique.

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

| Field | Type | Notes |
|-------|------|-------|
| `key` | string | Unique within flag |
| `name` | string | Human-readable |
| `value` | any | Typed per flag `type` |
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

| Field | Type | Notes |
|-------|------|-------|
| `attribute` | string | Dot-path: `user.*` or `context.*` |
| `operator` | enum | See supported operators below |
| `value` | any | Comparison value |
| `variantKey` | string? | If present: assignment rule. If absent: eligibility gate (all must match) |

**Supported operators**: `equals`, `not_equals`, `contains`, `not_contains`, `starts_with`, `ends_with`, `in`, `not_in`, `greater_than`, `less_than`, `greater_than_or_equal`, `less_than_or_equal`.

**Eligibility rules** (rules without `variantKey`): evaluated before segments; if any exists, at least one must match, else user is "outside experiment audience" → control variant.

### Segment

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Primary key |
| `name` | string | Human-readable |
| `description` | string | Optional |
| `rules` | JSON array | Same targeting rule schema (no `variantKey`) |
| `createdAt` | ISO string | |

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

| Field | Type | Notes |
|-------|------|-------|
| `enabled` | boolean | Activates experiment behavior |
| `hypothesis` | string | Description for reporting |
| `primaryMetric` | string | Metric name for statistical comparison |
| `confidenceLevel` | number | 0.90 / 0.95 / 0.99 (default 0.95) |
| `minimumSampleSize` | integer | Minimum participants per variant for recommendation |
| `status` | enum | `running` \| `paused` \| `completed` |
| `guardrailMetrics` | array | Safety metrics that can auto-pause the flag |

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

Results computed on demand (`GET /:id/experiment/results`):
- Participants per variant: `COUNT(*)` from `experiment_assignments`
- Conversions per variant: `COUNT(*)` from `experiment_metrics` where `metricName = primaryMetric`
- **Wilson score interval** for conversion rate confidence intervals
- **Two-proportion z-test** comparing each treatment vs control
- **Recommendation**:
  - Significant (`p < 1 - confidence`), positive lift, sample ≥ minimum → `implement` (high/medium confidence)
  - Otherwise → `continue`

---

## 5. Evaluation Surfaces

### Batched Evaluation (Sentry Wire Format)

```
POST /api/sentry/flags/evaluate
{
  user: { id, email?, name?, custom? },
  context?: Record<string, unknown>,
  flags: string[]
}
```
→ Returns array of `{ flagKey, variantKey, value, reason, errorCode?, assignmentId? }`

### Experiment Tracking

```
POST /api/sentry/flags/experiment/track
{ flagKey, userId, metric, value? }
```
→ Records metric; may trigger guardrail auto-pause.

### SSE Push Stream

```
GET /api/sentry/flags/stream?flags=key1,key2
```
- Sends `snapshot` on connect (full flag configs)
- Sends `configuration_changed` on flag CRUD/status change
- Heartbeat `: ping` every 20s
- Optional `flags` query to filter

### OpenFeature-Compatible (OpenFlag)

```
POST /v1/flags/:key
{ targetingKey, context? }
```
→ Single-flag response: `{ variant, value, reason, errorCode? }`
- Uses same evaluation engine with assignment persistence

---

## 6. Admin Surface (Admin-Token Only)

Prefix: `/api/admin/feature-flags`

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/feature-flags` | Create flag (status `draft`) |
| `GET` | `/feature-flags` | List (filter: `status`, `type`, `search`; paginated) |
| `GET` | `/feature-flags/:id` | Get one |
| `PATCH` | `/feature-flags/:id` | Update fields |
| `POST` | `/feature-flags/:id/status` | Change status (`draft|active|paused|archived`) |
| `DELETE` | `/feature-flags/:id` | Delete — **draft only** |

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

| Invariant | Enforcement |
|-----------|-------------|
| Flag key globally unique | Unique index on `feature_flags.key` |
| Variants weight sum = 100 | Validation on create/update |
| Targeting rule attribute path valid (`user.*` or `context.*`) | Schema validation |
| Segment rules use same operator set as targeting rules | Shared type; validation |
| Experiment assignment sticky | Unique index on `(flagId, userId)`; read-before-write with race handling |
| Guardrail auto-pause atomic | Status update in same transaction as metric record |
| Statistical methods use Wilson interval + z-test | Pure functions in `experiments/stats.ts` |
| Non-active flags never assign treatment variants | Evaluation returns control immediately |
| SSE stream sends snapshot on connect | `sendSnapshot` called in stream `start` |
| OpenFeature endpoint compatible wire format | Returns `{ variant, value, reason, errorCode? }` |

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
Client SDK
    │
    ├── POST /api/sentry/flags/evaluate (batch)
    │   └── Returns variant assignments + assignmentIds
    │
    ├── GET /api/sentry/flags/stream (SSE)
    │   └── Receives snapshot + config changes
    │
    └── POST /v1/flags/:key (OpenFeature)
        └── Returns single variant
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
    └── GET /:id/experiment/results
        ├── Participants per variant (assignments)
        ├── Conversions per variant (metrics, primaryMetric)
        ├── Wilson CI, z-test p-values
        └── Recommendation (implement/continue)
```

---

## 9. Related Architecture Docs

- [`models.md`](models.md) — Projects, environments, apps (flags are global, not scoped)
- [`permissions.md`](permissions.md) — Admin auth (flags admin-token only)
- [`alerting.md`](alerting.md) — Alerting (separate domain; flags not used for alerts)
- [`events.md`](events.md) — Ingestion (flags not involved in event pipeline)