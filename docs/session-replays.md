# Session Replays — Architecture

**Status:** Design paper — session replay recording ingestion, object-store offload, and issue-linked playback.

---

## 1. Model in One Paragraph

Session replays are recorded by the client SDK (via rrweb) and uploaded as `replay_recording` envelope items. At ingestion, recording segments are **offloaded to an object store** (S3-compatible; local dev runs RustFS via the same `S3_*` config) and replaced in the envelope with a `{ key }` pointer — the recording payload never lands in Postgres. The replay session is linked to an error event via `contexts.replay.replay_id` (or `replay_event` metadata carrying `replay_id`). At read time, `GET /api/admin/events/:eventId/replay/:replayId` returns pages of **presigned S3 URLs** for the session's segments, in playback order; the browser fetches them directly and streams them into the rrweb player. Segment keys embed the segment start time, so the object listing is already playback-ordered and pagination needs no object reads.

---

## 2. Domain Model

### Replay Session (Implicit)

There is **no replay index in Postgres**. A replay session is identified by:

| Field       | Source                                                                                  |
| ----------- | --------------------------------------------------------------------------------------- |
| `replayId`  | From `replay_event` item payload `replay_id` or error event `contexts.replay.replay_id` |
| `projectId` | From the event's resolved app/project                                                   |
| `appId`     | From the event's resolved app                                                           |
| Segments    | Object store keys under `replays/<projectId>/<appId>/<replayId>/`                       |

### Recording Segment (Object Store)

| Property        | Description                                                                     |
| --------------- | ------------------------------------------------------------------------------- |
| **Key pattern** | `replays/<projectId>/<appId>/<replayId>/<startedAtMs>-<messageId>-<index>.json` |
| **Content**     | rrweb event array (JSON)                                                        |
| **Written by**  | Ingestion offload (`offloadReplayItems`)                                        |
| **Read by**     | `GET /api/admin/events/:eventId/replay/:replayId`                               |
| **Backend**     | S3 / RustFS via `S3_*` config (the object store is S3-required)                 |

### Offloaded Item Pointer (in Envelope)

```json
{
  "key": "replays/proj-123/app-456/replay-789/00001700000000000-msg-abc-0.json"
}
```

Replaces the inline rrweb array when offload succeeds. Shape validated by readers: offloaded payload is an object with `key`; inline payload is an array.

---

## 3. Ingestion Pipeline (Offload)

### Trigger

- Envelope contains item with `header.type === "replay_recording"`

### Offload Process (`offloadReplayItems`)

1. Derive `replayId` from `replay_event` metadata, else from the error event's `contexts.replay.replay_id` (fallback: the envelope event id)
2. Build object prefix: `replays/<projectId>/<appId>/<replayId>/`
3. For each `replay_recording` item:
   - Serialize payload to JSON
   - Generate key: `<prefix><startedAtMs>-<messageId>-<index>.json` (`startedAtMs` = earliest `event.timestamp`, zero-padded so lexical order is playback order)
   - Write to object store with **5-second timeout** (bounded best-effort)
   - On success: replace item payload with `{ key }`
   - On failure/timeout: **keep payload inline**, log error, ingestion continues

### Key Sanitization

- Object key parts sanitized: `[^A-Za-z0-9_-]` → `_`, max 128 chars

---

## 4. Storage Backends

### S3-Compatible (Required)

- Configured via `S3_BUCKET` (and `S3_ENDPOINT`, `S3_REGION`, credentials); `AWS_*` env vars as fallbacks
- Bun's native S3 client (`backend/storage.ts` → `s3`), configured from the `S3_*` env at boot
- Recommended: dedicated bucket `sentry-replays`
- Local dev runs **RustFS** (S3-compatible) through the same `S3_*` configuration
- The bucket must allow `GET`/`HEAD` from the UI origin (CORS): the browser fetches the presigned URLs directly. The compose `rustfs-init` applies a wildcard rule for local dev

### Backend Switching

- The object store is configured from `S3_*` at boot; segment pointers stay backend-agnostic
- Objects **must be migrated** when switching object stores

---

## 5. Read Path (Playback Assembly)

### Endpoint

```
GET /api/admin/events/:eventId/replay/:replayId?cursor=&limit=
```

### Auth

- Admin token or read-granted provider identity (the `/api/admin/*` aggregator)
- Scoped read: filters by the event's app visibility (404 if out of scope)

### Page Algorithm

1. Load stored event by `eventId` → `projectId`, `appId`
2. Build object prefix: `replays/<projectId>/<appId>/<replayId>/`
3. Validate `cursor` (when present) starts with the prefix
4. `list({ prefix, maxKeys: limit, startAfter: cursor })` — keys embed the segment start, so listing is playback order
5. Presign each key → `url`
6. `nextCursor` = last key when the listing is truncated, else `null`

### Response Shape

```json
{
  "replayId": "string",
  "available": true,
  "expiresAt": "2026-01-15T10:30:00.000Z",
  "segments": [{ "key": "...", "url": "https://…presigned…", "bytes": 8192 }],
  "nextCursor": "replays/…/…json",
  "hasMore": true
}
```

### Degradation (Never Fail the Issue Page)

| Failure Mode            | Response                                                |
| ----------------------- | ------------------------------------------------------- |
| No replay link on event | Client renders the empty state (`replayId` null)        |
| Object listing fails    | `available: false`, empty                               |
| Invalid cursor          | `400`                                                   |
| Page bounds             | default 10, max 50 segments per page; walk `nextCursor` |

---

## 6. Object Store Access

The object store is **S3-required** (local dev runs RustFS through the same `S3_*` env). Segment bytes are read by the browser directly from the **presigned URL** returned by the replay endpoint; the backend never proxies them. There is no `GET /storage/<key>` surface — the pointer is backend-agnostic and readers resolve it against the store active at read time.

---

## 7. Invariants (Must Not Break)

| Invariant                                    | Enforcement                                                         |
| -------------------------------------------- | ------------------------------------------------------------------- |
| Recording payloads never in Postgres         | Offload runs before NATS publish; pointer replaces payload          |
| Ingestion never blocked by object store      | 5s timeout; failure keeps payload inline                            |
| Object store backend not recorded in pointer | Keys are backend-agnostic; readers resolve at read time             |
| Replay linked only via event metadata        | No separate replay index; `replayId` from envelope                  |
| Segment ordering by key                      | Keys embed the segment start ms, so listing is playback order       |
| Read bounds protect the API                  | 10 segments per page (max 50); `nextCursor` walks the session       |
| Storage failures degrade gracefully          | `available: false` when listing fails; client shows the empty state |
| Scoped reads filter by app visibility        | `scopedViewFor` on event's app; 404 for out-of-scope                |

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
    │   │   ├── s3.write(key, body) [5s timeout]
    │   │   ├── Success → replace with { key }
    │   │   └── Failure → keep inline, log
    │   └── Return modified items
    │
    ├── Publish to NATS (sentry.events)
    │
    ▼
Object Store (S3 / RustFS)
    │
    ▼
Error Event Ingestion (with contexts.replay.replay_id)
    │
    ▼
GET /api/admin/events/:eventId/replay/:replayId?cursor=&limit=
    │
    ├── Load event from ClickHouse → projectId, appId
    ├── List objects under prefix (keys are playback-ordered)
    ├── Presign each key
    └── Return { replayId, available, expiresAt, segments, nextCursor, hasMore }
    │
    ▼
Frontend: fetch presigned URLs → rrweb-player.addEvent() (streamed)
```

---

## 9. Related Architecture Docs

- [`models.md`](models.md) — Projects, environments, apps (scoping for replay visibility)
- [`permission.md`](permission.md) — Admin auth and scoped reads (replays follow event visibility)
- [`metrics.md`](metrics.md) — Metrics (replay recordings not measured; separate from metrics pipeline)
