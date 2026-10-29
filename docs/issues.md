# Issues — Architecture

**Status:** Design paper — how error issues are derived from ingested events, where every fact lives, how state changes, and how clients query them. Open items live in [`TODO.md`](../TODO.md).

---

## 1. Model in One Paragraph

An **issue** is a fingerprint-grouped projection of the `event` items ingested into one app. It exists exactly while events for its fingerprint exist — nothing else may create it. Identity is `(app_id, fingerprint)`; the same fingerprint in another app is a separate issue. State lives in Postgres (control plane: status, counters, the fields alerting and the list need); raw events live in ClickHouse; a derived ClickHouse index serves drill-down and stats. An issue is `unresolved` until resolved through the admin API; an event on a resolved issue reopens it (a **regression**). Transitions are detected event-driven at ingestion and fire the `new_issue`/`regression` alert triggers exactly once; the metric sweeper never touches issues.

---

## 2. Ingestion Pipeline

```
SDK ──POST /api/:projectId/envelope/──▶ Ingest Handler
        Parse envelope → convert spans → offload replay items
        Extract issue digests (grouping protocol)
                    │
                    ▼
        NATS sentry.events { id, projectId, appId, envelopeHeader, envelopeItems,
                              receivedAt, type, issueEvents }  // issueEvents = JSON text array
            ├──▶ ClickHouse (NATS engine table + materialized views)
            │      ├── sentry_events        — raw envelope (unchanged)
            │      └── sentry_issue_events — one row per digest
            └──▶ side-effects consumer (core NATS → Postgres)
                   Apply issue digests → issues projection and transitions
                   → new_issue / regression alert triggers (one-shot)
```

### Key Design Decisions

1. **Issues stay in Postgres** (control plane). ClickHouse gets a **derived issue index** for drill-down and stats — not the state itself.
2. **Issues are created only by ingestion.** No endpoint, seed, or admin write may insert an issue row. If it has no events, it does not exist.
3. **Grouping happens at the API edge.** The ingest handler already parses and normalizes the envelope; it extracts one **issue digest** per `event` item. The NATS message carries the digests as JSON text (like `envelopeItems`), so the **consumer parses once**; ClickHouse parses via materialized view — neither re-parses the original envelope items.
4. **The fingerprint is the grouping protocol** — one implementation. Raw string, not hashed, readable in the UI.
5. **Issue identity is `(app_id, fingerprint)`.** Apps are the boundary: Sentry groups per project; we group per app because environments/apps are our hierarchy.
6. **One row per fingerprint; presentation fields are latest-writer-wins; counters are SQL increments guarded by the message id** — `markSeen` is idempotent, which fixes event count drift.
7. **Status model is `unresolved | resolved`.** `ignored`/`muted`/`assigned` are reserved grammar. A new event on a resolved issue is a regression (reopen).
8. **One query string for the list endpoint.** Sentry-style search syntax, parsed server-side into a typed AST; the handler resolves names/ids and the DAO only ever receives a typed filter.
9. **Issue drill-down is ClickHouse-native**: occurrences = `appId + fingerprint` rows; stats = `count()`/`uniq(user)` bucketed in ClickHouse. This replaces "load the app's event window and re-fingerprint it in the browser".
10. **Strict parsing over leniency:** unknown keys, unsupported values, malformed times, and bad operators answer `400` naming the offending term. Debuggability beats silent no-ops.
11. **Reads stay layered:** list = Postgres only (a ClickHouse outage does not break it); `release:` filters, occurrence lists and stats = ClickHouse (a ClickHouse outage answers 5xx — no Postgres fallback).
12. **Scoped reads cover every issue GET** (`/:id`, `/:id/events`, `/:id/stats`): `404` for out-of-scope details, empty list for out-of-scope filters — never a leak.

---

## 3. Eligibility

- Only `event` items produce issues (error tracking). A message without a stack trace is still an issue — free text, `msg:` fingerprint.
- `transaction` (including converted span segments), `session`, `profile`, `replay_event`, `check_in`, `feedback`/`user_feedback` produce **no** issue.
- Multiple event items in one envelope: each digest counts for its fingerprint. Transitions (`new_issue`/`regression`) happen **once per fingerprint per message**; `event_count` increments by the number of items of that fingerprint in the message (the message-id guard makes redelivery idempotent).
- A message with no digests (non-event-only envelope) is a no-op for issue tracking.

---

## 4. Grouping Protocol (Fingerprint, Title, Culprit, Level, Type)

One implementation, single source of truth. The frontend must never re-implement it.

### 4.1 Fingerprint

1. **Explicit fingerprint** — `event.fingerprint` array: each `{{ default }}` component is expanded to the default component (rule 2/3), the rest join with `::` (`["database-error", "{{ default }}"]` → `database-error::TypeError@app.js:boom`). Truncated to 500 chars.
2. **Exception event** — take `exception.values[0]` (the SDK's primary exception; assumes first element is primary, matching current Sentry SDK behavior) and key by **crash frame + type**:
   - Crash frame = newest `in_app` frame with a `filename` → newest frame with a `filename` → newest frame (last array element, since SDKs send frames oldest-first). If no frames exist, falls to `unknown` fingerprint.
   - Key = `${type ?? "Error"}@${filename ?? ""}:${function ?? ""}`.
3. **Message event** — `msg:${message.slice(0, 200)}`.
4. **Fallback** — `unknown`.

The fingerprint is computed from the **raw** payload (before read-time symbolication). If a grouping rule ever changes, old issues keep their fingerprint — a new fingerprint is a new issue; that is accepted (Sentry behaves the same).

### 4.2 Title and Culprit

- **Title**: first exception `type: value` trimmed → message (200 chars) → fingerprint.
- **Culprit**: `event.culprit` when present, else `filename:lineno` of the crash frame (raw, pre-symbolication), else `null`.
- **Level** normalized lowercase (`fatal | error | warning | info | debug`), default `error`.
- **Type**: `error` when the payload has a non-empty `exception.values`, else `message`.

---

## 5. The Issue Digest (NATS Message Contract)

Computed in the ingest handler from normalized items (after `span → transaction` conversion), added to the NATS message as `issueEvents` — the `JSON.stringify` of the array, carried as text like `envelopeHeader`/`envelopeItems` so ClickHouse reads it into a plain `String` column with no format-setting dependency.

### Digest Fields

| Field         | Source                                                    |
| ------------- | --------------------------------------------------------- |
| `eventId`     | `payload.event_id` → envelope `event_id` → generated UUID |
| `fingerprint` | Grouping protocol output                                  |
| `title`       | Grouping protocol output                                  |
| `culprit`     | Grouping protocol output                                  |
| `level`       | Normalized lowercase                                      |
| `type`        | `error` \| `message`                                      |
| `release`     | Straight from payload, `null` when absent                 |
| `environment` | Straight from payload, `null` when absent                 |
| `user`        | `user.id` → `user.email` → `user.username`, else `null`   |

- The array is stringified when published — `issueEvents` is JSON **text** in the message — and parsed once by the consumer; the materialized view expands it with `JSONExtractArrayRaw`.
- `issueEvents` is optional so messages published by a pre-digest instance still work during rollout: the consumer falls back to extracting digests from `envelopeItems`; the fallback is deleted when the digest lands everywhere.

---

## 6. Issue State Machine

### 6.1 Transitions (Event-Driven at Ingestion)

All transitions are race-safe, one-shot, and happen in the Postgres consumer. The digest array is **deduplicated by fingerprint per message** before processing, so each fingerprint is handled once per envelope.

1. **First occurrence of a fingerprint for the app** → `createIfNew` (upsert on unique `(app_id, fingerprint)` index) → fires `new_issue`.
2. **Resolved issue receives an event** → `regressIfResolved` (conditional `UPDATE … WHERE status = 'resolved' RETURNING`) → fires `regression` + reopens issue.
3. **Otherwise** → `markSeen` (incremental update guarded by message id):

```
UPDATE issues
SET event_count = event_count + :occurrences,
    last_seen = :receivedAt,
    latest_event_id = :messageId,
    title = :title, culprit = :culprit, level = :level, type = :type,
    last_release = COALESCE(:release, last_release),
    first_release = CASE WHEN first_release IS NULL THEN :release ELSE first_release END,
    updated_at = :nowIso
WHERE app_id = :appId AND fingerprint = :fingerprint
  AND latest_event_id IS DISTINCT FROM :messageId
  AND last_seen <= :receivedAt
```

- `:nowIso` is `new Date().toISOString()` (the column is a `timestamptz`; the application writes and reads ISO-8601 UTC strings and the database compares the instants).
- The `latest_event_id IS DISTINCT FROM :messageId` guard makes redelivered messages (SDK retries reuse the same NATS message id) a no-op: no double `event_count`, no field churn.
- The `last_seen <= :receivedAt` guard makes an out-of-order redelivery a no-op (JetStream preserves per-subject order; this is belt-and-braces).
- `createIfNew` seeds the columns from the first digest and `event_count` from the occurrence count; a redelivered message that lost the insert race falls through to `markSeen` and is skipped by the guard.

### 6.2 Resolve / Reopen

- `PATCH /api/admin/issues/:id` with `{ status: 'unresolved' | 'resolved' }` is the only write path. Resolving arms the `regression` trigger for the issue's next event; reopening disarms it.
- Resolving does **not** change `event_count`, `first_seen` or `last_seen`.

### 6.3 Cascades

- Deleting an app cascades to its issues; environments are untouched (they are shared).
- Changing the grouping algorithm never rewrites existing rows: old issues keep their fingerprint until the app or project is deleted.

---

## 7. Postgres Projection (`issues`)

One row per fingerprint, unique `(app_id, fingerprint)`.

| Column                      | Type        | Notes                                                              |
| --------------------------- | ----------- | ------------------------------------------------------------------ |
| `id`                        | text PK     | Generated UUID                                                     |
| `app_id`                    | text        | Indexed; the grouping boundary                                     |
| `fingerprint`               | text        | Grouping key                                                       |
| `title`                     | text        | Latest occurrence's title                                          |
| `status`                    | text        | `unresolved` (default) / `resolved`                                |
| `event_count`               | integer     | Increments per occurrence, guarded by NATS message id              |
| `user_count`                | integer     | Distinct users, synced from the issue index on a `sort=users` read |
| `first_seen` / `last_seen`  | timestamptz | ISO-8601 UTC strings, written at ingestion                         |
| `latest_event_id`           | text        | NATS message id of the latest occurrence; enables UI drill-down    |
| `culprit`                   | text        | Nullable                                                           |
| `level`                     | text        | Default `error`; updated on every occurrence (latest-writer-wins)  |
| `type`                      | text        | `error \| message`                                                 |
| `first_release`             | text        | Nullable, set once                                                 |
| `last_release`              | text        | Nullable, latest                                                   |
| `created_at` / `updated_at` | timestamptz | ISO-8601 UTC strings                                               |

Indexes: `app_id`, `status`, unique `(app_id, fingerprint)`.

Standard DAO methods: `createIfNew`, `regressIfResolved`, `markSeen`, `findById`, `findByIdOrThrow`, `listPaged`, `updateOrThrow`, `deleteByApp`. List reads are cursor-paginated: `{ cursor?, limit? }` → `{ data }` (no page/offset, no totals).

---

## 8. ClickHouse Issue Index (`sentry_issue_events`)

One row per event item, fed by a materialized view on the events engine table.

### Schema

| Column        | Type          | Notes                     |
| ------------- | ------------- | ------------------------- |
| `messageId`   | String        | NATS message id           |
| `eventId`     | String        | Item event id — dedup key |
| `projectId`   | String        |                           |
| `appId`       | String        |                           |
| `fingerprint` | String        | Grouping key              |
| `title`       | String        |                           |
| `level`       | String        |                           |
| `type`        | String        | `error \| message`        |
| `release`     | String        | Nullable                  |
| `environment` | String        | Nullable                  |
| `user`        | String        | Nullable                  |
| `receivedAt`  | DateTime64(3) |                           |

Engine: `ReplacingMergeTree()` ordered by `(appId, fingerprint, receivedAt, eventId)`. TTL matches raw events (one month default, configurable via Settings → Event retention). `FINAL` used on reads to collapse redeliveries by `eventId`.

### Materialized View

Extracts `issueEvents` from the NATS engine table using `JSONExtractArrayRaw` + `arrayJoin`, parses `receivedAt` with `parseDateTime64BestEffortOrNull` + null guard (junk messages are skipped instead of wedging the insert loop).

### Queries

**Occurrences of an issue** (drill-down list, replaces browser re-fingerprinting):

- Filter by `appId` + `fingerprint`, order by `receivedAt DESC`, paginated.

**Issue stats** (bucketed):

- `toStartOfInterval(receivedAt, INTERVAL step SECOND)` → `count()` + `uniqIf(user, user != '')`.

**Issues seen in a release** (serves the `release:` query term):

- `DISTINCT fingerprint` from `sentry_issue_events` for visible apps matching the release.

**Retention**: The index is created with the same TTL as `sentry_events`. A Settings → Event retention change applies the new TTL to the index via `ALTER TABLE sentry_issue_events MODIFY TTL ...` — drill-down never outlives the raw events.

**Dimension breakdowns — non-goal for now**: the index carries the occurrence's `level`, `user` and `tags` (JSON text) and nothing more. Browser/OS-style server-side breakdowns are deliberately not built: the SDKs do not consistently send them as tags, so an honest aggregate would mean adding parsed columns to the index (schema + MV + read). Add one only when a real breakdown needs it; `tag:` filtering (`JSONExtractString(tags, key)`) already covers whatever the SDKs _do_ send.

---

## 9. Query Protocol

### 9.1 Endpoints (Prefix `/api/admin/issues`)

| Method | Path          | Description                                               |
| ------ | ------------- | --------------------------------------------------------- |
| GET    | `/`           | Paginated issues. `meta.terms` echoes the parsed query.   |
| GET    | `/:id`        | One issue (Postgres).                                     |
| GET    | `/:id/events` | The issue's occurrences from ClickHouse, newest first.    |
| GET    | `/:id/stats`  | Bucketed event/user counts from ClickHouse.               |
| PATCH  | `/:id`        | Resolve/reopen: `{ status: 'unresolved' \| 'resolved' }`. |

All are inside the admin guard; the scoped-read allowlist covers every issue GET, `/:id/events` and `/:id/stats` included. The list endpoint takes only `query`/`sort` (plus `cursor`/`limit`); `appId`/`projectId`/`status`/`q` are not part of the protocol.

### 9.2 Grammar

```
query      := group ( ( WS | "|" ) group )*
group      := term ( WS term )*
term       := negation? ( pair | text )
negation   := "!" | "-"                       (canonical "!", "-" accepted)
pair       := key ":" value
key        := "is" | "app" | "project" | "environment" | "level"
            | "release" | "event.type" | "firstSeen" | "lastSeen" | "timesSeen"
value      := operator? ( atom | time )
operator   := ">" | ">=" | "<" | "<=" | "="
atom       := quoted | unquoted                (quoted = "..." with spaces)
time       := "-" int ("m"|"h"|"d"|"w")       (relative to now)
            | "YYYY-MM-DD"                    (whole UTC day)
            | ISO-8601 datetime
text       := quoted | unquoted                (bare term = free text)
```

- Keys are case-insensitive; values for `is`/`level`/`event.type` are lowercased; names (`app`, `project`, `environment`, `release`) match case-insensitively.
- The terms of one group are **AND**ed; the groups are **OR**ed (`|`). The AND binds
  tighter: `a | b c` is `a OR (b AND c)`. A `|` inside a quoted atom is free text.
- Negation wraps a single term: `!is:resolved`, `-level:warning`.
- A bare `-` at the start of a term is negation; `-24h` inside a value is relative time — no ambiguity because values follow `key:`.
- A token whose prefix (before the first `:`) is a known or reserved key is parsed strictly; an unknown prefix is a `400`. Literal `key:value` text is searched by quoting it (`"https://api.example.com"`), which turns the whole token into free text. The same applies to a literal `|`.
- An empty group (`a |` or `| a`) is a `400`.

### 9.3 Term Semantics

| Term           | Values                                       | Backing Store              | Condition                                                                                                                                                       |
| -------------- | -------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `is:`          | `unresolved`, `resolved`                     | PG `status`                | Equality. Absent ⇒ all statuses.                                                                                                                                |
| `app:`         | App id or exact name (ci)                    | PG `apps`                  | Resolves to app ids; multiple name matches union. Unknown ⇒ `404`. Intersected with caller's scope.                                                             |
| `project:`     | Project id or slug (ci)                      | PG `projects`              | Resolves to the project's apps.                                                                                                                                 |
| `environment:` | Environment id or name (ci)                  | PG `environments` → `apps` | Resolves to apps created in matching environments.                                                                                                              |
| `level:`       | `fatal`, `error`, `warning`, `info`, `debug` | CH `level`                 | Equality against **any occurrence's** level (the ClickHouse issue index; the projection keeps the latest occurrence's level).                                   |
| `user:`        | the user id                                  | CH `user`                  | Equality against **any occurrence's** user.                                                                                                                     |
| `tag:`         | `<key>:<value>`                              | CH `tags`                  | Equality against **any occurrence's** tag.                                                                                                                      |
| `event.type:`  | `error`, `message`                           | PG `type`                  | Equality.                                                                                                                                                       |
| `release:`     | Version string (ci)                          | CH issue index             | Issues with ≥1 occurrence carrying that release **in any visible app** (fingerprint set from CH is the union across visible apps; `IN` filter).                 |
| `firstSeen:`   | Time                                         | PG `first_seen`            | See **Time Operators** below.                                                                                                                                   |
| `lastSeen:`    | Time                                         | PG `last_seen`             | See **Time Operators** below.                                                                                                                                   |
| `timesSeen:`   | Integer with `>`, `>=`, `<`, `<=`, `=`       | PG `event_count`           | Bare value = exact count.                                                                                                                                       |
| free text      | Any atom                                     | PG                         | Each token is an escaped `ILIKE %…%` over `title` **OR** `culprit` **OR** `fingerprint`; multiple tokens are **AND**ed. (OR across columns, AND across tokens.) |

**Time Operators** (apply to `firstSeen:` and `lastSeen:`):

| Operator | Bare absolute date (`YYYY-MM-DD`)                      | Bare relative (`-24h`)                                       | With explicit operator |
| -------- | ------------------------------------------------------ | ------------------------------------------------------------ | ---------------------- |
| (none)   | That UTC day (`≥ day 00:00:00` AND `< day+1 00:00:00`) | `firstSeen:` at/after now−24h; `lastSeen:` at/before now−24h | —                      |
| `>`      | Strictly after day end                                 | Strictly after now−24h                                       | Strictly after         |
| `>=`     | At or after day start                                  | At or after now−24h                                          | At or after            |
| `<`      | Strictly before day start                              | Strictly before now−24h                                      | Strictly before        |
| `<=`     | At or before day end                                   | At or before now−24h                                         | At or before           |
| `=`      | Exactly that UTC day                                   | Exactly now−24h                                              | Exactly                |

Reserved for later (parsed keys that answer `400 Unsupported term`): `assigned:`, `bookmarked:`, `has:`, `url:`.

### 9.4 Sort & Pagination

- `sort=new` (default): `last_seen DESC, id`. `sort=frequent`: `event_count DESC, last_seen DESC`. `sort=first-seen`: `first_seen DESC`. `sort=users`: `user_count DESC, last_seen DESC` — the distinct-user count is read from the ClickHouse issue index and synced into the rows (a set value, never an increment) before the read orders on them. Reserved `priority` answers `400`.
- `cursor` (the id of the last row seen; omitted on the first page) and `limit` (default 20, max 100); the response is just `{ data }`.

### 9.5 Response Shapes

**List** (`GET /api/admin/issues?query=is:unresolved app:checkout lastSeen:-24h&sort=frequent`):

```jsonc
{
  "data": [
    {
      "id": "...", "appId": "...", "fingerprint": "TypeError@app.js:boom",
      "title": "TypeError: Cannot read 'id' of null",
      "culprit": "app.js:12", "level": "error", "type": "error",
      "status": "unresolved", "eventCount": 412,
      "firstSeen": "...", "lastSeen": "...", "latestEventId": "...",
      "firstRelease": "2.3.0", "lastRelease": "2.3.1",
      "createdAt": "...", "updatedAt": "..."
    }
  ],
  "meta": { "terms": [ { "kind": "status", "value": "unresolved" }, ... ], "sort": "frequent" }
}
```

**Occurrences** (`GET /:id/events`):

```jsonc
{
  "data": [
    {
      "messageId": "...",
      "eventId": "...",
      "receivedAt": "...",
      "title": "...",
      "level": "error",
      "release": "2.3.1",
      "environment": "production",
      "user": "u_123",
    },
  ],
}
```

**Stats** (`GET /:id/stats?from=...&to=...&stepSeconds=...`):

```jsonc
{
  "from": "...",
  "to": "...",
  "stepSeconds": 3600,
  "points": [{ "bucketStart": "...", "eventCount": 12, "userCount": 3 }],
  "totals": {
    "eventCount": 412,
    "userCount": 37,
    "firstSeen": "...",
    "lastSeen": "...",
  },
}
```

- `/:id/stats` defaults: `to = now`, `from = issue.firstSeen`; `stepSeconds` auto-selects (≤6h → 1m, ≤48h → 5m, else 1h) and is echoed.
- **Stats totals** (`totals` object) are computed from ClickHouse over the query window: `eventCount = count()`, `userCount = uniqIf(user, user != '')`, `firstSeen/lastSeen = min/max receivedAt` in the window — **not** the issue's `first_seen`/`last_seen` from Postgres.
- The issue detail DTO is the same shape as the list element; occurrences/stats are separate reads (no accidental fan-out on `GET /:id`).

### 9.6 Parsing & Resolution Pipeline

```
Route handler (backend/issues/index.ts)
  ├─ Schema: { query? string, sort? 'new'|'frequent'|'first-seen'|'users', cursor? string, limit? int }
  ├─ parseIssueQuery(query) → pure, no I/O (backend/issues/query.ts)
  │     Tokenizer → terms → typed AST; throws badRequest on the offending term
  ├─ resolveQueryTerms(terms, view) → handler-side
  │     Names → ids (PG), scope intersection
  │     release: → query ClickHouse for fingerprint set (visible apps only) → fingerprints
  └─ issueDAO.listPaged(resolvedFilter) → db/dao/issues.ts (drizzle only)
```

- The parser exports `parseIssueQuery(input: string): IssueQueryTerm[]` and time-value helpers; never touches the DB; fully unit-testable. AST/term types live in `backend/protocol/issues.ts`.
- The resolved DAO filter is typed (`{ status?, appIds?, excludedAppIds?, level?, type?, time ranges, timesSeen?, fingerprints?, text[], negatedText[] }`) — the DAO never sees raw query text. Negated terms map to `NOT(condition)`.
- Resolved condition mapping lives in the DAO, keeping handlers free of database code.
- Scope: `scopedViewFor(request)` resolves once; a scoped caller's view intersects `appIds` (and constraints the `release:` fingerprint set). A filter that resolves outside the scope answers an empty page, never an error and never a leak.

### 9.7 Errors

- Parse errors: `badRequest("Invalid issue query: <reason> (<term>)")` → `400` via root `onError` (`{ error }` body). Never partially apply a query.
- Unknown `:id`, unknown `app:`/`project:`/`environment:` value: `notFound(...)` → `404`.
- ClickHouse failures on `release:`, `/:id/events`, `/:id/stats`: `internalError` → `5xx`. **If the list query contains a `release:` term, the entire list fails 5xx; other terms alone serve from Postgres.**

---

## 10. Scoped Reads and Permissions

Issue reads inherit the admin guard and the scoped-read allowlist:

- `GET /api/admin/issues` (list) — out-of-scope `app:`/`project:`/`environment:` filters answer an empty list; otherwise `scopedViewFor` intersects `appIds`.
- `GET /api/admin/issues/:id` — `404` unless `view.appIds.has(issue.appId)`.
- `GET /:id/events` / `GET /:id/stats` — same check as `/:id` (loads the issue from Postgres first for scope check, then queries ClickHouse); added to `SCOPED_READ_PATHS`.
- Writes (`PATCH /:id`) are admin-token-only like every other mutation.
- Scope never widens a `release:` fingerprint set: the ClickHouse query is driven by the visible app ids.

---

## 11. Alerting Integration

- `new_issue` and `regression` are **event-driven at ingestion** (consumer → `trackIssue...` → `fireIssueTriggerRules`), one-shot and race-safe; the cooldown applies per issue (fingerprint).
- The metric sweeper evaluates `threshold` rules only and must never run issue transitions — re-running transitions would re-fire one-shot alerts.
- Incidents for issue triggers are **auto-resolved at creation** (the trigger itself is the incident; `resolved_at = now`) and carry the issue fingerprint; delivery failures are logged and never fail ingestion.
- The projection is what alerting reads (status, counters); the ClickHouse index is never consulted for alerts.

---

## 12. Frontend Consumption

- **Issues page**: toolbar input becomes the free-text part of `query`; status chips append `is:unresolved|resolved` (All = omit); sort select maps to `sort`. Tokens (`app:`, `project:`, `level:`, `release:`, `lastSeen:-24h`) are typed by hand; backend `400` messages surface inline.
- **Workspace context**: builds `app:<id>` / `project:<id>` terms from the selected context instead of named params; the sidebar badge uses `is:unresolved` + `limit=1`.
- **Event detail**: uses `/:id/events` (row links use `messageId`) and `/:id/stats`; the metrics panel aggregates over the issue's first page of occurrences. The page is reached with the issue it belongs to (`?issue=<issueId>`, set by the issue lists) — the server owns the grouping, so the page never recomputes a fingerprint. The frontend's local grouping implementation is deleted — the backend is the only grouping implementation. The Overview page keeps its window-based grouping (groups events by fingerprint in the browser for the current time window; this is a separate feature and does not use the issue API).
- **Source-map symbolication** is unchanged: it happens at read time on `/events/:id`; digests store raw (unsymbolicated) locations, like Sentry's raw fingerprints.

---

## 13. Invariants (Must Not Break)

- Issues are created and mutated **only** by the ingestion side effects; no API write may insert, seed or delete individual issues (only `PATCH` status and cascades).
- `(app_id, fingerprint)` is the identity; uniqueness is DB-level (unique index + upsert), never find-then-insert.
- Issue transitions stay one-shot and race-safe (`WHERE status = 'resolved'`, message-id guards); issue detection never moves into the metric sweeper.
- One grouping implementation (server-side); no duplicate fingerprint algorithm in the frontend.
- Event payloads never land in Postgres; issue drill-down and stats read ClickHouse only, with no Postgres fallback.
- Resolving flips the status the `regression` trigger watches — `PATCH /api/admin/issues/:id` is the only resolve path.
- Scoped reads filter (`empty` list / `404` detail); they never expose another scope's issues.
- Timestamps are `timestamptz` columns the application handles as ISO-8601 UTC strings; IDs come from generated UUIDs; JSON columns are stringified on write.

---

## 14. Testing

**Unit (pure):**

- Grouping: explicit fingerprint (including `{{ default }}` expansion), crash-frame selection (in-app last → last with filename → last), message/`unknown`; title/culprit/level/type extraction; digest dedup per fingerprint.
- Query parser: table-driven grammar — every key, negation forms, quoted values, operators, relative/absolute times, and each error case (unknown key, bad operator, malformed time, reserved key).

**Hop tests** (one hop = test a single pipeline stage with mocked upstream/downstream):

- **Ingest → NATS**: published `sentry.events` message carries `issueEvents` with the expected digest.
- **NATS → Postgres**: projection fields and transitions; redelivered message does not double `event_count`; regression reopens once.
- **NATS → ClickHouse**: publish a message with digests; wait for `sentry_issue_events` rows (`FINAL`); a redelivery stays one row.
- **ClickHouse → API reads**: seed `sentry_issue_events` directly; assert `/:id/events` cursor pagination and `/:id/stats` buckets/totals.
- **Query protocol**: seed Postgres issues; exercise every grammar term and sort, cursor pagination, `400`/`404` cases, and scoped-read filtering.

**E2E (real HTTP + browser):** Issues UI test (status chips/query round-trips), issue detail metrics test (occurrences and metrics from the server endpoints), permissions test (scoped reads).

---

## 15. Accepted Consequences

- The NATS message grows by the digest array (small, flat rows).
- `sentry_issue_events` duplicates event dimensions in ClickHouse (one small row per event item); it is derived, replaceable and truncate-able — not the source of truth.
- `release:` list filters, occurrence lists and stats depend on ClickHouse (5xx when down); the plain list does not.
- `level:`, `user:` and `tag:` are any-occurrence and ClickHouse-backed (the issue index); `release:` is any-occurrence too.
- Drill-down of a batched envelope (`/events/:messageId`) shows the envelope's first event item — the existing `/events/:id` semantics.
- `event_count` is exact per message id; an SDK retry with the same `event_id` never double-counts.
- Strict parsing rejects terms Sentry would silently ignore; the error names the term and the frontend shows it. **Reserved terms (`assigned:`, `bookmarked:`, `has:`, `url:`) return `400 Unsupported term` to allow future growth without ambiguity.**

---

## 16. Open Questions

All open items live in [`TODO.md`](../TODO.md) — the dimension breakdowns are
documented as a non-goal in §8; everything else is decided.

---

## Appendix A — Worked Examples

```
is:unresolved app:checkout level:error timesSeen:>100 lastSeen:-24h
```

→ status=unresolved ∧ appIds=[checkout] ∧ level='error' ∧ event_count>100 ∧ last_seen ≥ now−24h, sort `new`.

```
!is:resolved release:"2.3.1 (build 4)" firstSeen:>2026-10-01 firstSeen:<2026-10-18
```

→ not status='resolved' ∧ fingerprint ∈ CH fingerprint set for that release ∧ `2026-10-01T00:00:00Z < first_seen < 2026-10-18T00:00:00Z` (two comparison terms).

```
TypeError boom
```

→ title/culprit/fingerprint ILIKE `%TypeError%` AND ILIKE `%boom%` (escaped), newest first.

---

## Appendix B — Mapping to Sentry

| Here                                             | Sentry Counterpart              | Source                                             |
| ------------------------------------------------ | ------------------------------- | -------------------------------------------------- |
| `is:unresolved` / `is:resolved`                  | Issue stream `is:` token        | Sentry issue search                                |
| Fingerprint rules (`{{ default }}`, crash frame) | Error Grouping (Fingerprinting) | `sentry-docs/01-error-tracking.md` §Error Grouping |
| `timesSeen:>N`                                   | `times-seen:`                   | Sentry issue search                                |
| `firstSeen:` / `lastSeen:` (+ relative `-24h`)   | `first-seen:` / `last-seen:`    | Sentry issue search                                |
| `release:`                                       | `release:`                      | `sentry-docs/02-release-tracking.md`               |
| `level:` / `event.type:`                         | `level:` / `event.type:error`   | `sentry-docs/07-protocol-spec.md` §Event Payload   |
| Digest fields (release, environment, user)       | Event payload fields            | `sentry-docs/07-protocol-spec.md` §Event Payload   |
| Resolve/reopen + regression alerts               | Resolve → regression            | `sentry-docs/06-alerting.md`                       |
