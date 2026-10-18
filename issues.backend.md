# Backend Issues

## Critical Issues (Blocking TypeScript Compilation & Runtime)

### 1. Incorrect Import Paths (Multiple Files)
Many files have import paths with excessive `.ts` extensions or wrong relative paths:

| File | Current Import | Expected Import |
|------|---------------|-----------------|
| `backend/events/ingestion-routes.ts` | `"backend/errors"` | `"../../errors"` |
| `backend/events/ingestion-routes.ts` | `"../metrics/samples.ts.ts"` | `"../metrics/samples"` |
| `backend/events/ingestion-routes.ts` | `"../utils/crypto.ts.ts"` | `"../utils/crypto"` |
| `backend/events/ingestion-routes.ts` | `"db/dao/project"` | `"../../../db/dao/apps"` |
| `backend/events/ingestion.ts` | `"backend/errors"` | `"../../errors"` |
| `backend/events/ingestion.ts` | `"db/dao/project"` | `"../../../db/dao/apps"` |
| `backend/events/ingestion.ts` | `"db/schema/project"` | `"../../../db/schema/apps"` |
| `backend/events/ingestion.ts` | `"../nats.ts.ts"` | `"../nats"` |
| `backend/events/ingestion.ts` | `"../metrics/samples.ts.ts"` | `"../metrics/samples"` |
| `backend/nats.ts` | `"./events-consumer"` | Remove (circular) |
| `backend/events-consumer.ts` | `"../../../../../db/index.ts.ts.ts.ts.ts"` | `"../../../db/index"` |
| `backend/events-consumer.ts` | `"../../../../../db/dao/stored-events.ts.ts.ts.ts.ts"` | `"../../../db/dao/stored-events"` |
| `backend/events-consumer.ts` | `"../../../../../db/dao/issues.ts.ts.ts.ts.ts"` | `"../../../db/dao/issues"` |
| `backend/events-consumer.ts` | `"../../../../../db/dao/alert-rules.ts.ts.ts.ts.ts"` | `"../../../db/dao/alert-rules"` |
| `backend/events-consumer.ts` | `"./nats"` | Remove (circular) |
| `backend/admin/index.ts` | `"../../../../../permissions.ts.ts.ts.ts.ts.ts"` | `"../../permissions"` |
| `backend/admin/index.ts` | `"../../../../../errors.ts.ts.ts.ts.ts.ts"` | `"../../errors"` |
| `backend/admin/index.ts` | `"../../../../../featureFlags.ts.ts.ts.ts.ts.ts"` | `"../../featureFlags"` |
| `backend/admin/index.ts` | `"../../../../../alerting.ts.ts.ts.ts.ts.ts"` | `"../../alerting"` |
| `backend/admin/index.ts` | `"../../../../../source-maps.ts.ts.ts.ts.ts.ts"` | `"../../source-maps"` |
| `backend/admin/index.ts` | `"../../../../../source-map-tokens.ts.ts.ts.ts.ts.ts"` | `"../../source-map-tokens"` |
| `backend/permissions.ts` | `"../../../../../db/dao/permission-rules.ts.ts.ts.ts.ts"` | `"../../../db/dao/permission-rules"` |
| `backend/permissions.ts` | `"../../../../../db/dao/permission-users.ts.ts.ts.ts.ts"` | `"../../../db/dao/permission-users"` |

### 2. Circular Dependency: nats.ts ↔ events-consumer.ts
- `nats.ts` line 2: `import { dispatchIngestedEvent } from "./events-consumer";`
- `events-consumer.ts` line 7: `import { dispatchIngestedEvent } from "./nats";`
- **Fix**: Move `processIngestedEvent` to a separate file (e.g., `events/processor.ts`) that both can import without circular dependency.

### 3. Missing Imports
| File | Issue |
|------|-------|
| `backend/admin/index.ts` line 35 | Uses `crypto.timingSafeEqual` but `crypto` is not imported |
| `backend/events/ingestion-routes.ts` | Uses `SentryEventMessage` type but not imported |
| `backend/events/ingestion-routes.ts` | Uses `MetricSample` type but not imported |

### 4. Incorrect Function Call
**File**: `backend/events/ingestion.ts` line 59
```typescript
if (!app || !validateAuth(request, app).valid) {
```
**Problem**: `validateAuth` expects `(request: Request, target: "envelope" | "store")` but is called with `(request, app)`.
**Fix**: Should call `validateAuth(request, "envelope")` or similar.

### 5. Missing DAO Method
**File**: `backend/events/ingestion.ts` line 29
```typescript
const apps = await appDAO.listRawByProject(projectId);
```
**Problem**: `listRawByProject` method doesn't exist in `appDAO`.
**Fix**: Add `listRawByProject` method to `db/dao/apps.ts` or use existing `listByProject`.

### 6. Duplicate Constant
**File**: `backend/admin/index.ts`
- Lines 18-26: `SCOPED_READ_PATHS` defined
- Lines 57-65: `SCOPED_READ_PATHS` defined again
**Fix**: Remove duplicate.

### 7. Implicit `any` Types
**File**: `backend/events/ingestion-routes.ts` line 21
```typescript
const convertedItems = parsed.items.map((item) =>
```
**Fix**: Add explicit type: `parsed.items.map((item: ParsedEnvelope["items"][0]) =>`

**File**: `backend/events/ingestion.ts` line 30
```typescript
const byProject = apps.find((app) => app.publicKey === requestKey);
```
**Fix**: Add explicit type to `app` parameter.

---

## Architecture Issues

### 8. events-consumer.ts Incomplete Implementation
The `processIngestedEvent` function has placeholder implementations:
- `extractIssueDigest` returns hardcoded values (lines 88-96)
- `fireIssueAlerts` is empty (lines 98-100)
- `evaluateThresholdAlerts` is empty (lines 102-104)

### 9. Alerting Sweeper Incomplete
**File**: `backend/alerting/evaluation.ts`
- `evaluateThresholdRules()` is empty (lines 32-34)
- `resolveEffectiveRulesForScope()` returns empty array (lines 68-70)

### 10. Permissions Module Incomplete
**File**: `backend/permissions.ts`
- `computeScopedView()` returns empty sets (lines 47-59)
- `scopedViewFor()` returns empty view without actual DAO queries (lines 61-75)
- `requireReadAccess()` does nothing (lines 77-80)

### 11. replayIdFromEnvelope Import Missing
**File**: `backend/replays/index.ts` line 5
```typescript
import { parseStoredEnvelope } from "../events/utils.ts.ts";
```
But `replayIdFromEnvelope` is imported from `../events/offload.ts.ts` (line 7) while it's actually exported from `../events/utils`.

### 12. findStoredEventByIdOrThrow Not Exported
**File**: `backend/replays/index.ts` line 5
```typescript
import { findStoredEventByIdOrThrow } from "../events-store.ts.ts";
```
But `eventsStore` doesn't export `findStoredEventByIdOrThrow`.

---

## Database Schema Issues

### 13. Unique Index for Default Environment
**File**: `db/schema/environments.ts` line 17
```typescript
projectDefaultUnique: uniqueIndex("environments_project_default_unique").on(table.projectId).where(table.isDefault.eq(1)),
```
This uses a partial unique index which is PostgreSQL-specific. For PGlite compatibility, this might not work correctly.

### 14. Missing `listRawByProject` in Apps DAO
Need to add this method to support ingestion resolution.

### 15. Alert Rules Channel IDs as Text
**File**: `db/schema/alert-rules.ts` line 14
```typescript
channelIds: text("channel_ids").notNull().default("[]"),
```
Should be JSON/array type for better querying.

---

## Feature Gaps

### 16. Replay Recording Offload
The `offloadReplayItems` function (in `backend/events/offload.ts`) only handles `replay_recording` type. Need to handle other large payload types.

### 17. Source Map Upload Endpoint
No HTTP endpoint for uploading source maps - only admin CRUD and resolution.

### 18. Experiment Metrics Aggregation
No endpoint for computing experiment results (Wilson CI, z-test) - only tracking.

### 19. Event Retention TTL
The ClickHouse TTL is set at table creation but there's no background job to clean up old data (relies on ClickHouse's TTL merge).

### 20. NATS Consumer Lag Monitoring
No monitoring/alerting for NATS consumer lag - critical for ingestion pipeline health.

---

## Test Infrastructure Issues

### 21. Test Database Cleanup
`e2e/preload.ts` sets up test env but doesn't clean up PGlite between test files.

### 22. Missing Integration Tests
No tests for:
- NATS → ClickHouse pipeline
- NATS → Postgres (side effects) pipeline
- Alert evaluation sweeper
- Permission scoping
- Feature flag evaluation with experiments

---

## Low Priority / Nice to Have

### 23. Structured Logging
Replace `console.log`/`console.error` with structured logger (pino or similar).

### 24. Metrics Export
No `/metrics` endpoint for Prometheus scraping.

### 25. Health Check Dependencies
`/health` endpoint doesn't check NATS, ClickHouse, or Postgres connectivity.

### 26. API Versioning
No versioning strategy for public API endpoints (`/api/:projectId/envelope/`).

### 27. Request Validation Middleware
No global request size limit or timeout configuration.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical (blocks compile/runtime) | 7 |
| Architecture (incomplete impl) | 4 |
| Database Schema | 3 |
| Feature Gaps | 4 |
| Test Infrastructure | 2 |
| Low Priority | 5 |
| **Total** | **25** |