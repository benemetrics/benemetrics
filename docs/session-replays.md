# Session Replays — Architecture

**Status:** Design paper — session replay recording ingestion, object-store offload, and issue-linked playback.

---

## 1. Model in One Paragraph

Session replays are recorded by the client SDK (via rrweb) and uploaded as `replay_recording` envelope items. At ingestion, recording segments are **offloaded to an object store** (S3-compatible when configured, local disk otherwise) and replaced in the envelope with a `{ key }` pointer — the recording payload never lands in Postgres. The replay session is linked to an error event via `contexts.replay.replay_id` (or `replay_event` metadata carrying `replay_id`). At read time, `GET /replays/by-event/:eventId` resolves the replay ID from the stored event, lists segment objects under the derived prefix (`replays/<projectId>/<appId>/<replayId>/`), reads and parses them, orders segments by their earliest rrweb timestamp, and returns a concatenated rrweb stream ready for the player. The object store backend is resolved **at read time**, so switching between S3 and local requires only migrating objects — no pointer rewriting.

---

## 2. Domain Model

### Replay Session (Implicit)

There is **no replay index in Postgres**. A replay session is identified by:

| Field | Source |
|-------|--------|
| `replayId` | From `replay_event` item payload `replay_id` or error event `contexts.replay.replay_id` |
| `projectId` | From the event's resolved app/project |
| `appId` | From the event's resolved app |
| Segments | Object store keys under `replays/<projectId>/<appId>/<replayId>/` |

### Recording Segment (Object Store)

| Property | Description |
|----------|-------------|
| **Key pattern** | `replays/<projectId>/<appId>/<replayId>/<messageId>-<index>.json` |
| **Content** | rrweb event array (JSON) |
| **Written by** | Ingestion offload (`offloadReplayItems`) |
| **Read by** | `GET /replays/by-event/:eventId` |
| **Backend** | S3 (when `S3_BUCKET` set) or local disk (`LOCAL_STORAGE_DIR`) |

### Offloaded Item Pointer (in Envelope)

```json
{ "key": "replays/proj-123/app-456/replay-789/msg-abc-0.json" }
```

Replaces the inline rrweb array when offload succeeds. Shape validated by readers: offloaded payload is an object with `key`; inline payload is an array.

---

## 3. Ingestion Pipeline (Offload)

### Trigger
- Envelope contains item with `header.type === "replay_recording"`

### Offload Process (`offloadReplayItems`)

1. Derive `replayId` from `replay_event` metadata (fallback: message ID)
2. Build object prefix: `replays/<projectId>/<appId>/<replayId>/`
3. For each `replay_recording` item:
   - Serialize payload to JSON
   - Generate key: `<prefix><messageId>-<index>.json`
   - Write to object store with **5-second timeout** (bounded best-effort)
   - On success: replace item payload with `{ key }`
   - On failure/timeout: **keep payload inline**, log error, ingestion continues

### Key Sanitization
- Object key parts sanitized: `[^A-Za-z0-9_-]` → `_`, max 128 chars
- Dots excluded to prevent directory traversal
- Local backend re-validates resolved path stays within storage root

### Atomic Writes (Local Backend)
- Write to temporary file `<key>.<uuid>.tmp`
- `rename()` to final key (POSIX atomic replace)
- On error: cleanup temp file, rethrow

---

## 4. Storage Backends

### S3-Compatible (Production)
- Configured via `S3_BUCKET` (and `S3_ENDPOINT`, `S3_REGION`, credentials)
- Bun native S3 client
- `AWS_*` env vars as fallbacks
- Recommended: dedicated bucket `sentry-replays`

### Local Disk (Dev/Test)
- Directory `LOCAL_STORAGE_DIR` (default `./.storage`)
- No external dependency
- Objects served via `GET /storage/<key>` (admin/scoped guarded)

### Backend Switching
- **Read-time resolution**: `activeStorageBackend()` checks `S3_BUCKET` per call
- No restart required to switch
- Objects **must be migrated** when switching backends (pointers are backend-agnostic)

---

## 5. Read Path (Playback Assembly)

### Endpoint
```
GET /replays/by-event/:eventId
```

### Auth
- Dev/test: open
- Production: admin token or scoped provider identity (read grant required)
- Scoped read: filters by event's app visibility (404 if out of scope)

### Assembly Algorithm

1. Load stored event by `eventId` (from event store)
2. Parse envelope → extract `replayId`:
   - Priority 1: `replay_event` item payload `replay_id`
   - Priority 2: Error event `contexts.replay.replay_id`
3. If no `replayId`: return empty replay (`available: true`, empty segments)
4. Build object prefix: `replays/<projectId>/<appId>/<replayId>/`
5. List object keys under prefix (max 500)
6. For each key (up to 500 segments / 10 MB total):
   - Read object text
   - Parse JSON → rrweb event array
   - Compute segment `startedAt` = earliest `event.timestamp` in segment
7. Sort segments:
   - Primary: `startedAt` ascending (earliest timestamp first)
   - Secondary: key lexicographic (fallback)
8. Concatenate all segment events → single rrweb stream
9. Return response

### Response Shape

```json
{
  "replayId": "string",
  "available": true,
  "truncated": false,
  "bytes": 123456,
  "segments": [
    { "key": "...", "events": 42, "bytes": 8192, "startedAt": "2026-01-15T10:30:00.000Z" }
  ],
  "events": [ ...rrweb events... ]
}
```

### Degradation (Never Fail the Issue Page)
| Failure Mode | Response |
|--------------|----------|
| No replay link on event | `replayId: null`, empty, `available: true` |
| Object listing fails | `available: false`, empty, logged |
| Object read fails | Skip segment, log, continue |
| JSON parse fails | Skip segment, continue |
| Bounds exceeded (500 seg / 10 MB) | `truncated: true`, return partial |

---

## 6. Object Store Access (`/storage/*`)

### Endpoint
```
GET /storage/<key>
```

### Purpose
- Direct object fetch (used by local backend when active)
- Only meaningful when local backend active; with S3 configured → 404

### Auth & Scoping
- Same as replays: dev/test open; prod requires admin token or read grant
- Scoped read: extracts `appId` from key (`replays/<projectId>/<appId>/...`) and checks visibility

### Security
- Path traversal prevented: `resolveLocalObjectPath()` validates key stays within storage root
- Only file objects served (directories skipped, `.tmp` files skipped)

---

## 7. Invariants (Must Not Break)

| Invariant | Enforcement |
|-----------|-------------|
| Recording payloads never in Postgres | Offload runs before NATS publish; pointer replaces payload |
| Ingestion never blocked by object store | 5s timeout; failure keeps payload inline |
| Object store backend not recorded in pointer | Keys are backend-agnostic; readers resolve at read time |
| Replay linked only via event metadata | No separate replay index; `replayId` from envelope |
| Segment ordering by timestamp, not key | Sort by earliest `event.timestamp` in segment |
| Read bounds protect server/client | 500 segments / 10 MB max per read; `truncated` flag |
| Storage failures degrade gracefully | Missing/parseable objects skipped; empty segments returned |
| Scoped reads filter by app visibility | `scopedViewFor` on event's app; 404 for out-of-scope |
| Local backend never escapes storage root | `resolveLocalObjectPath` validates relative path |
| Atomic local writes prevent partial reads | Temp file + atomic rename |

---

## 8. Data Flow Summary

```
Client SDK (rrweb)
    │
    ├── Records session → rrweb event batches
    │
    ├── Envelope with replay_recording items
    │   └── POST /api/:projectId/envelope/
    │
Ingestion Handler
    │
    ├── Parse envelope
    ├── offloadReplayItems()
    │   ├── Build prefix: replays/<projectId>/<appId>/<replayId>/
    │   ├── For each recording segment:
    │   │   ├── Serialize → JSON
    │   │   ├── putObject(key, body) [5s timeout]
    │   │   ├── Success → replace with { key }
    │   │   └── Failure → keep inline, log
    │   └── Return modified items
    │
    ├── Publish to NATS (sentry.events)
    │
    ▼
Object Store (S3 or local disk)
    │
    ▼
Error Event Ingestion (with contexts.replay.replay_id)
    │
    ▼
GET /replays/by-event/:eventId
    │
    ├── Load event from ClickHouse
    ├── Parse envelope → extract replayId
    ├── List objects under prefix
    ├── Read + parse each segment
    ├── Sort by earliest event.timestamp
    ├── Concatenate → rrweb stream
    └── Return { replayId, available, truncated, bytes, segments, events }
    │
    ▼
Frontend Player (rrweb-player)
```

---

## 9. Related Architecture Docs

- [`models.md`](models.md) — Projects, environments, apps (scoping for replay visibility)
- [`events.md`](events.md) — Ingestion pipeline (offload runs before NATS publish)
- [`storage.md`](storage.md) — Object store abstraction (S3/local, read-time resolution)
- [`permissions.md`](permissions.md) — Admin auth and scoped reads (replays follow event visibility)
- [`metrics.md`](metrics.md) — Metrics (replay recordings not measured; separate from metrics pipeline)