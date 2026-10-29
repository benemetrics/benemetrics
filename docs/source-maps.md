# Source Maps — Architecture

**Status:** Design paper — source map artifact storage, symbolication, and upload token management.

---

## 1. Model in One Paragraph

Source maps are uploaded as artifacts bound to a **release** (version string) within a **project**, scoped to an **app** and **environment**. The raw map document (version 3, JSON) is stored in Postgres; the artifact is keyed by `(projectId, release, filename)` for deduplication. At event read time, stack frames are symbolicated by matching the generated filename against uploaded artifacts and decoding the base64-VLQ mappings to original positions with source context. Machine-facing uploads use dedicated **upload tokens** (hashed, scoped to project+app+environment, raw value returned once at create/rotate). Admin surfaces manage artifacts and tokens; the CLI-compatible surface (`/api/0/...`) is used by `sentry-cli`.

---

## 2. Domain Model

### Source Map Artifact

| Field           | Type       | Notes                                                             |
| --------------- | ---------- | ----------------------------------------------------------------- |
| `id`            | UUID       | Primary key                                                       |
| `projectId`     | UUID       | Owner project                                                     |
| `appId`         | UUID       | Owner app (scoping boundary)                                      |
| `environmentId` | UUID       | Owner environment                                                 |
| `release`       | string     | Release version (e.g., `1.2.3`)                                   |
| `dist`          | string?    | Optional distribution identifier                                  |
| `filename`      | string     | Artifact name as sent by `sentry-cli` (e.g., `~/dist/app.js.map`) |
| `mapJson`       | text       | Raw source map document (version 3, JSON)                         |
| `createdAt`     | ISO string | Upload timestamp                                                  |

**Uniqueness**: `(projectId, release, filename)` — re-uploading the same artifact name to the same release **replaces it in place** (last wins, via `onConflictDoUpdate`), so a corrected map takes effect without cutting a new release. The artifact keeps its `id`; the parsed/decoded caches are versioned by the artifact's `createdAt` and invalidated on upload, so symbolication never serves a superseded body.

**Indexes**: `projectId`, `(projectId, release)` for listing.

### Upload Token

| Field           | Type        | Notes                                              |
| --------------- | ----------- | -------------------------------------------------- |
| `id`            | UUID        | Primary key                                        |
| `projectId`     | UUID        | Owner project                                      |
| `appId`         | UUID        | Scoped app                                         |
| `environmentId` | UUID        | Scoped environment                                 |
| `tokenHash`     | string      | SHA-256 of raw token (never stores plaintext)      |
| `tokenPrefix`   | string      | First 8 chars of raw token (for UI identification) |
| `name`          | string      | Human-readable label                               |
| `createdBy`     | string      | Admin identity who created it                      |
| `createdAt`     | ISO string  | Creation timestamp                                 |
| `lastUsedAt`    | ISO string? | Last successful authentication                     |
| `expiresAt`     | ISO string? | Optional TTL                                       |
| `revokedAt`     | ISO string? | Soft revocation timestamp                          |

**Security**: Raw token returned **exactly once** — at creation and at rotation. Never stored, never listed.

**Indexes**: `projectId`, `appId`, `environmentId`, `tokenHash` (for authentication lookup).

---

## 3. Upload Surface (CLI-Compatible)

Prefix: `/api/0/projects/:org/:project/`

Auth: `Authorization: Bearer <upload-token>` (scoped to project+app+environment; validated via upload auth).
`X-Upload-Token: <upload-token>` is accepted as an alternative header.

### Release Management

| Method | Path                  | Description                                                                       |
| ------ | --------------------- | --------------------------------------------------------------------------------- |
| `POST` | `/releases/`          | Create release (`{ version, ref?, url?, owner? }`); returns release + `projectId` |
| `POST` | `/releases/:version/` | Finalize release (`status: "finalized"`); 404 when the release was never created  |

### Artifact Upload / List / Delete

| Method   | Path                                | Description                                                                                                                                            |
| -------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST`   | `/releases/:version/files/`         | Upload source map (multipart: `file` + `name` + optional `dist`); validates version 3 + `sources` + `mappings`; 10 MB limit; returns artifact metadata |
| `GET`    | `/releases/:version/files/`         | List artifacts for release (paginated)                                                                                                                 |
| `DELETE` | `/releases/:version/files/:fileId/` | Delete artifact (scoped to project+release)                                                                                                            |

**Upload validation**:

- Multipart form with `file` (the `.map`) and `name` (the `--url-prefix` path)
- File must be valid JSON, version 3, with `sources` array and `mappings` string
- Size limit: 10 MB
- Release auto-created if not found (draft status)

---

## 4. Admin Surface

Prefix: `/api/admin/source-maps` and `/api/admin/source-map-tokens`

Auth: Admin token only (scoped identities excluded)

### Artifacts

| Method   | Path                   | Description                                                                                    |
| -------- | ---------------------- | ---------------------------------------------------------------------------------------------- |
| `GET`    | `/source-maps`         | List artifacts (filter by `projectId`, `environmentId`, `release`; paginated)                  |
| `GET`    | `/source-maps/:id`     | Get artifact; `?include=content` returns raw `mapJson`                                         |
| `POST`   | `/source-maps/resolve` | Resolve one position: `{ projectId, release, filename, line, column }` → the original position |
| `DELETE` | `/source-maps/:id`     | Delete artifact                                                                                |

**Note**: Content (`mapJson` / `sourcesContent`) never exposed unless explicitly requested via `?include=content`.

### Tokens

| Method   | Path                            | Description                                                                                    |
| -------- | ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `POST`   | `/source-map-tokens`            | Create token (`{ name, projectId, appId, environmentId, expiresAt? }`); returns raw token once |
| `GET`    | `/source-map-tokens`            | List tokens (filter by `projectId`, `environmentId`; paginated)                                |
| `GET`    | `/source-map-tokens/:id`        | Get token (never returns raw token)                                                            |
| `POST`   | `/source-map-tokens/:id/rotate` | Rotate token (invalidates previous raw value immediately); returns new raw token once          |
| `DELETE` | `/source-map-tokens/:id`        | Revoke token (soft delete; keeps audit trail)                                                  |

**Token scoping**: Bound to one `projectId` + `appId` + `environmentId`. Validation at upload time checks:

- Token's `projectId` matches the project slug in the path
- Token's `environmentId` exists and belongs to the project
- Token not revoked, not expired

---

## 5. Symbolication Pipeline

### Resolution (at event read time)

1. Event carries `release` (string) and exception frames with `filename` / `lineno` / `colno`
2. Find all artifacts for `(projectId, release)` via index
3. Match artifact to frame:
   - Exact `filename` match
   - Basename match
   - Artifact basename with `.map` suffix stripped matches frame basename (Sentry convention: `app.js.map` → `app.js`)
4. If matched, decode mappings (VLQ) and resolve original position

### VLQ Decoding

- Base64-VLQ (variable-length quantity) per source map spec
- Mappings string split by `;` (lines) and `,` (segments)
- Each segment decodes to: `generatedColumnDelta`, `sourceIndexDelta`, `sourceLineDelta`, `sourceColumnDelta`
- Cumulative deltas yield absolute positions
- Segments without source info → generated-only position

### Caching

- **Parsed map cache**: in-memory, 100 entries max
- **Decoded mappings cache**: in-memory, 100 entries max
- Both are cleared wholesale at the size threshold (no TTL; process-local)
- Entries are keyed by artifact id **and** versioned by the artifact's `createdAt`, so a re-uploaded (replaced) artifact is re-parsed instead of serving the superseded body. An upload also invalidates the artifact's entries explicitly.

### Output

Symbolicated frames gain:

- `original_filename` (source file)
- `original_lineno` / `original_colno` (1-indexed)
- `context_line` / `pre_context` / `post_context` (from `sourcesContent` when available)

---

## 6. Invariants (Must Not Break)

| Invariant                                            | Enforcement                                                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Artifact unique per `(projectId, release, filename)` | Unique index; upsert uses conflict-do-update (last wins)                                                                        |
| Upload token raw value never persisted               | Only `tokenHash` (SHA-256) stored; raw returned once at create/rotate                                                           |
| Token scoped to project+app+environment              | Foreign keys + validation at upload auth                                                                                        |
| Token rotation invalidates previous value            | Rotation generates new hash, updates `tokenHash`, returns new raw                                                               |
| Revoked/expired tokens rejected                      | Auth checks `revokedAt` and `expiresAt`                                                                                         |
| Symbolication only for events with `release`         | Pipeline returns early if no release                                                                                            |
| Malformed mappings never crash read                  | Decode wrapped in error boundary; logs error, skips frame                                                                       |
| Admin-only token management                          | Route guard; scoped identities excluded from allowlist                                                                          |
| Artifact content never leaked in lists               | `mapJson` only included with explicit `?include=content`                                                                        |
| Symbolication never serves a superseded body         | The parse/decode caches are keyed by artifact id **and** versioned by `createdAt`; an upload invalidates the artifact's entries |

---

## 7. Data Flow Summary

```
sentry-cli
    │
    ├── releases new <version>
    │   POST /api/0/projects/:org/:project/releases/
    │   → create release (draft)
    │
    ├── releases files <version> upload-sourcemaps ./dist
    │   POST /api/0/projects/:org/:project/releases/:version/files/
    │   → multipart upload
    │   → validate map (v3, sources, mappings)
    │   → store artifact (projectId, appId, environmentId, release, filename, mapJson)
    │
    ├── releases finalize <version>
    │   POST /api/0/projects/:org/:project/releases/:version/
    │   → status = "finalized"
    │
Event ingestion (error with release)
    │
    ▼
GET /events/:id  (or /events list)
    │
    ├── Load event payload
    ├── Find artifacts for (projectId, release)
    ├── For each frame: match artifact by filename
    ├── Decode VLQ mappings (cached)
    ├── Resolve original position + context
    └── Return symbolicated payload
```

---

## 8. Related Architecture Docs

- [`models.md`](models.md) — Projects, environments, apps hierarchy (scoping for artifacts/tokens)
- [`events.md`](events.md) — Ingestion pipeline (release carried on events)
- [`permission.md`](permission.md) — Admin auth model (tokens admin-only)
- [`protocol/source-map.ts`](../backend/protocol/source-map.ts) — Type definitions for API contracts
