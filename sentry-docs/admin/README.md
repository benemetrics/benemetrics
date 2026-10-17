# Admin

Admin-facing documentation for this backend.

The backend ships a single admin surface under `/api/admin/*` (projects,
apps, environments, releases, source maps, feature flags, segments,
alerting) guarded by the admin credentials. The full endpoint tables live
in [`BACKEND_API.md`](../../BACKEND_API.md) at the repository root.

DSNs are per app: creating an app through
`POST /api/admin/projects/:id/apps` provisions its DSN, which every apps
response returns as `dsn` — there is no separate DSN creation endpoint.

## Documents

- [11-feature-flags-management.md](./11-feature-flags-management.md) —
  feature flag management endpoints and examples.
