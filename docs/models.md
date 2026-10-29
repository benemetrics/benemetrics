# Domain Models — Projects, Environments, Apps

**Status:** Design paper — the core domain hierarchy and its invariants.

---

## 1. Hierarchy in One Paragraph

The domain hierarchy is strictly **Project → Environment (shared by apps)**. It MUST NOT be flattened.

- A **project** owns many **apps** and many **environments**.
- An **environment** belongs to exactly one project and is shared by all of its apps.
- An **app** is created inside an environment; the same environment may serve many apps.

---

## 2. Project

### Identity

- UUID primary key
- Human-readable **slug** (derived from name, unique globally; a name that collides gets a numeric suffix)
- Name, optional description
- Created/updated timestamps (ISO strings)

### Ownership

- One-to-many → Apps (via `apps.project_id`)
- One-to-many → Environments (via `environments.project_id`)

### Default Environment

- Every project has **exactly one default environment** (`environments.is_default = 1`).
- Project creation auto-creates a default environment named "Testing" (slug `testing`).
- The first environment created becomes the default.
- Promoting another environment to default demotes the previous one.
- Deleting the default promotes the oldest remaining environment to default.

### Cascading Deletes

- Deleting a project cascades to **all its apps AND all its environments**.

### API

- `POST /projects` — create (slug auto-derived from name)
- `GET /projects` — list (with `appCount`)
- `GET /projects/:id` — detail + apps (the embedded list is capped; the full list is `GET /projects/:id/apps`)
- `DELETE /projects/:id` — delete project (cascades)
- `POST /projects/:id/duplicate` — duplicate project (envs + apps copied with fresh IDs/keys)

---

## 3. Environment

### Identity

- UUID primary key
- **Slug** unique **within its project** (same slug may be reused across different projects)
- Name (human-readable)
- `is_default` flag (exactly one per project)
- `project_id` (references project, no DB foreign key)
- Created/updated timestamps (ISO strings)

### Relationships

- Belongs to one project (via `environments.project_id`, no DB foreign key)
- Shared by many apps (via `apps.environment_id`, no DB foreign key)

### Lifecycle

- Created explicitly via admin API (not during project creation beyond the initial "testing" default)
- May be renamed (name + slug editable)
- Promoting to default demotes the previous default
- Deleting cascades to **apps created inside it** (other apps in the project are untouched)
- When the default is deleted, the oldest remaining environment becomes the new default

### API (Admin-Only)

- `POST /environments` — `{ projectId, name, slug?, isDefault? }`
- `GET /environments?projectId=` — paginated list for a project
- `GET /environments/:id` — get one
- `PATCH /environments/:id` — `{ name?, slug?, isDefault? }`
- `DELETE /environments/:id` — cascades to apps created in it, promotes new default if needed

> Environments are exposed **only** under `/api/admin/environments/*`; never on an unauthenticated surface.

---

## 4. App

### Identity

- UUID primary key
- **Number** (auto-incrementing integer, used in DSN path)
- Name, platform (e.g., `javascript`, `react-native`, `python`, etc.)
- `project_id` (references project, no DB foreign key)
- `environment_id` (references environment, no DB foreign key)
- Ingest key (secret, used for ingestion auth)
- Public key (used in DSN)
- Created/updated timestamps (ISO strings)

### DSN

- Per-app, not per-project
- Format: `http://<public-key>@<host>/<app-number>`
- The API returns the ingredients (`publicKey`, `number`); the caller composes the DSN for the origin it reached
- No separate DSN management endpoint

### Relationships

- Belongs to exactly one project (via `apps.project_id`, no DB foreign key)
- Created inside exactly one environment (via `apps.environment_id`, no DB foreign key)
- The app's `environment_id` is set at creation and does not change

### Creation

- `POST /projects/:id/apps` with optional `environment` name (slug or name)
  - If provided: reuse existing environment by slug/name, or create it
  - If omitted: use the project's default environment
- Project creation does **not** create an app; apps are created explicitly

### Deletion

- Deleting an app **does not** delete its environment (environments are shared)
- Apps are removed by deleting their owning project

### API

- `GET /projects/:id/apps` — list apps for a project
- `POST /projects/:id/apps` — create app (generates the public key + the app number)
- `GET /apps/:id` — get single app (admin scope only)
- `DELETE /apps/:id` — delete the app (its environment is shared and survives)

---

## 5. Invariants (Must Not Break)

| Invariant                                      | Enforcement                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Project → Environment → App hierarchy          | Application logic (no DB foreign keys)                                                           |
| Environment slug unique per project            | Unique index on `(project_id, slug)`                                                             |
| Exactly one default environment per project    | Unique partial index on `(project_id) WHERE is_default = 1`; application logic on promote/delete |
| App belongs to one project + one environment   | Application logic (no DB foreign keys)                                                           |
| App number unique globally                     | Unique index on `number` (DSN path requirement)                                                  |
| Ingest key unique globally                     | Unique index on `apps.ingest_key`                                                                |
| Public key generated randomly                  | Random 32-char string at creation (no DB uniqueness constraint)                                  |
| Deleting app → environment preserved           | No cascade from `apps` to `environments`                                                         |
| Deleting environment → apps in it deleted      | Application-level cascade in the environment delete handler (`backend/environments/index.ts`)    |
| Deleting project → apps + environments deleted | Application-level cascade in project DELETE handler                                              |
| Environments admin-only                        | Route guard: only under `/api/admin/environments/*`                                              |

---

## 6. Scoped Reads & Permissions

- **Admin token**: full read/write on all projects, environments, apps
- **Scoped (OIDC) identity**: read-only, filtered by grant
  - Grant specifies allowed **environment names** + **app name prefixes**
  - Visible apps = apps matching a prefix OR living in a matching environment name
  - Visible environments = environments matching by name OR holding a visible app
  - Visible projects = projects holding any visible app/environment
  - Out-of-scope detail requests answer `404` (never leak)
  - List endpoints return only visible items; counts reflect visible subset
  - All writes answer `403` (admin-token-only)

---

## 7. Related Architecture Docs

- [`alerting.md`](alerting.md) — Alerting scoped to project/environment
- [`issues.md`](issues.md) — Issues grouped by app (project/env via app)
- [`permission.md`](permission.md) — Admin auth model and scoped reads
- [`events.md`](events.md) — Ingestion resolves app via DSN/project+key
- [`metrics.md`](metrics.md) — Metrics queried by project/environment/app
