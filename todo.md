# TODO — missing pieces from the v2 design adaptation

Things the v2 design shows (or that the backend already supports) that are **not** in the UI yet,
grouped by what is blocking them. Nothing here is fabricated in the app: every item below was
deliberately skipped rather than faked.

## 1. Blocked on missing backend support

- [ ] **Sidebar — Team page** (Manage group): no team/member API; only `GET /api/admin/me` exists.
- [ ] **Sidebar — Settings page** (Manage group): no workspace settings API.
- [ ] **Sidebar — Help & support**: no real destination (Documentation already links out to the docs site).
- [ ] **Issues — status, assignment, bulk "Resolve selected"**: the backend stores raw envelopes; issue
      grouping, counts and severity are computed client-side (`frontend/src/lib/issues.ts`), so there is
      nowhere to persist an issue state.
- [ ] **Logs explorer (query builder, aggregation bar)**: no log store exists; `/logs` stays an honest
      placeholder.
- [ ] **Per-channel "Test connection"**: only alert *rules* have `POST /api/admin/alerting/rules/:id/test`.
      Add a channel-level test endpoint to light up the config page's test card.
- [ ] **Email notifier**: stub that always fails with "SMTP delivery not implemented yet"; needs real SMTP
      support in `backend/alerting/notifiers.ts`.
- [ ] **OIDC/OAuth admin login flow**: stubbed and fails closed; `ADMIN_TOKEN` is the only working
      credential until the provider flow is implemented (`backend/auth.ts`).

## 2. Backend ready — UI not wired yet (remaining quick wins)

- [ ] **Alert rule field editor**: pause/enable and delete are now on the Alerts page, but changing the
      rule definition itself (name / metric / threshold / window / cooldown / channels) still requires the
      API; `PATCH /api/admin/alerting/rules/:id` already accepts every field.
- [ ] **Releases: app-scoped list**: `GET /releases?appId=` exists; the list page still shows releases
      from every app (the detail screen now covers get / patch / finalize / delete / summary).
- [ ] **Channel config: change channel type**: `PATCH /channels/:id` accepts `type`; the config page keeps
      the type fixed and only edits name/config.
- [ ] **Feature flags: variants / targetingRules / segments editors**: accepted by `POST /feature-flags`
      and `PATCH /feature-flags/:id`; the builder only exposes name/key/type/default/rollout/activate
      (experiments are now start/stop/promote-able from the flags list).
- [ ] **Environment slug editing**: rename changes the name only; `PATCH /environments/:id` also accepts
      an explicit slug.
- [ ] **Alert builder fidelity**: the mock's severity / notify / auto-resolve concepts don't exist in the
      rule model; the builder maps to metric / operator / threshold / window / cooldown / channelIds instead
      (documented in the review step).

## 3. Data & scale limits

- [ ] **Server-side aggregations**: dashboards compute counts and charts client-side from the latest
      `AGGREGATE_EVENT_LIMIT` (200) stored items; accurate totals need aggregate endpoints (or time-range
      filters on `GET /events`, which today only filters by project / environment / app).
- [ ] **Web vitals**: the Performance panel only renders when browser transactions carry
      `measurements` (LCP/INP/CLS/FCP/TTFB) — real data, but requires Web Vitals instrumentation in the SDK;
      no synthetic monitoring exists.

## 4. Known model differences (by design, worth revisiting)

- [ ] **Feature flags are global**: unlike projects/environments/apps, flags have no project or app scope
      column; scoping them would need a schema change.
- [ ] **Issue-level retention**: events are retained raw; there is no per-issue record, so "first seen",
      user counts, and frequency are recomputed from the stored window on every page load.

## 5. Backend admin capabilities — UI parity status

Every admin domain now has a UI surface: Segments (`/segments`), Source maps + upload tokens
(`/source-maps`, with display-once secrets), experiment lifecycle on the flags list, effective alert
config per app on the Alerts page, release detail/finalize/delete, project duplicate/delete, app delete,
environment rename/promote/delete, and rule pause/delete. Remaining sub-features:

- [ ] **Source map content viewer**: `GET /source-maps/:id?include=content` returns the raw map JSON;
      the Source maps page lists, resolves and deletes maps but does not open the raw content.
- [ ] **`GET /apps/:appId`** is still unused — no screen needs a single-app read (Setup works from the
      workspace app list).
- [ ] **`POST /events/clear`** stays a dev/e2e helper, intentionally not exposed in the console.

### Machine-facing by design (no UI required)

Envelope/store/OTLP ingestion, `flags-v1` evaluation, `flags-stream` SSE, `evaluation` API, and
`POST /dsn/create|generate`.

