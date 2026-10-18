# Permissions — Architecture

**Status:** Design paper — the admin authorization model (admin token + OIDC scoped reads). Open items live in [`todos/permission.md`](../todos/permission.md).

---

## 1. Model in One Paragraph

There are exactly two credentials for the admin surface:

1. **Admin token** — a master secret, unrestricted, always accepted.
2. **Verified OIDC/OAuth2 JWT** — identity only, read-only, scoped by permission rules.

A verified identity receives a read scope (environment names + app-name prefixes) from enabled group rules, or from an enabled email whitelist entry that overrides groups entirely. The scope expands into visibility sets (apps, environments, projects). List endpoints filter by these sets; detail reads outside the scope return 404. Scoped identities are read-only — writes return 403. With no grant, the user receives 401 with a message prompting for the admin token; the UI reacts to the 401 status and prompts accordingly.

Ingestion (DSN) and source-map uploads use separate authentication and are not part of this model.

---

## 2. Credentials & Enforcement Modes

### When Enforcement Is Active

Enforcement is active when **any** of the following is true:

- Admin token is configured
- `NODE_ENV=production`
- An identity provider is **fully configured** (both issuer **and** audience present)

An identity provider is considered **fully configured** only when **both** an issuer (`OIDC_ISSUER`/`OAUTH_ISSUER`) **and** an audience (`OIDC_AUDIENCE`/`OIDC_CLIENT_ID`/`OAUTH_CLIENT_ID`) are set. If only audience is configured without an issuer, the provider is **not** considered configured — enforcement does not activate, and all JWT verification fails closed. This prevents the misconfiguration where audience-only "looks" configured but every token fails.

When enforcement is **off** (dev/test only), the UI surfaces (`/events`, `/storage`, `/replays`) are open — no credentials required. The admin API (`/api/admin/*`) **always** requires credentials — even in dev mode it returns 401 without a valid token.

### Admin Token

The admin token is the master credential. It is compared in constant time (no timing attacks, no prefix/length bypass). It yields an unrestricted "admin" identity with a fixed internal user record: `{ id: "admin-1", email: "admin@company.com", name: "Admin User", roles: ["admin"], groups: [] }`. The `roles` field is present but **unused for authorization**. The token remains valid and accepted even when an identity provider is configured — it is never disabled by the presence of a provider.

**Revocation:** Rotate by updating `ADMIN_TOKEN` environment variable and restarting the server. No hot-reload; active sessions terminate on next request. **Open item:** Zero-downtime token rotation mechanism (token versioning or key rotation).

### OIDC/OAuth2 JWT

A three-part JWT is verified **locally** using the provider's public signing keys (JWKS) when enforcement is active and a provider is configured. The token is **never sent to the provider**.

Verification flow:

1. **Discovery** — Fetch the provider's OpenID configuration (`.well-known/openid-configuration`) to locate the JWKS endpoint. Cached for 10 minutes. Can be overridden via `OIDC_JWKS_URL`. **Discovery failure (network error, non-2xx, invalid JSON) → verification fails closed.**
2. **JWKS retrieval** — Fetch the JSON Web Key Set (public keys) from the JWKS endpoint. Cached for 10 minutes. On an unknown `kid` (key rotation), re-fetch **once**. If the key is still not found, or JWKS fetch fails (network error, non-2xx), verification fails closed.
3. **Key selection** — Match the token's `kid` header to a JWKS key. If no `kid` is present, accept **only when JWKS contains exactly one key**; otherwise reject.
4. **Algorithm check** — Header `alg` must be in the allowlist (RS256/384/512, ES256/384/512) and match the key's `alg` parameter. `none` and HMAC algorithms are rejected.
5. **Signature verification** — Verify the JWT signature using WebCrypto against the selected public key. **Note:** ES512 uses the P-521 curve; not all WebCrypto runtimes support it. Test with your provider.
6. **Claims validation** — All must pass:
   - `exp` required, within clock skew tolerance (±60s, aligned with common provider expectations). Tokens expiring more than the skew tolerance in the past or future are rejected.
   - `nbf` honored when present (same skew tolerance).
   - `iss` matches configured issuer (trailing-slash normalized).
   - `aud` matches configured audience (string or array). **Required when issuer is configured.** If issuer is configured but audience is not, **every token from that issuer for any client is accepted** — this is a critical misconfiguration. Set `OIDC_AUDIENCE` to restrict to your client.
   - `azp` (authorized party) validated when `aud` is an array and `azp` is present: `azp` must match the configured audience.
7. **Identity extraction** — From verified claims:
   - Email: primary claim (`OIDC_EMAIL_CLAIM`, default `email`) with fallbacks: `preferred_username` → `upn`. **If only `sub` is available, email extraction fails** — the token is rejected (whitelist matching requires a usable email; `sub` is an opaque identifier and cannot be used for whitelist lookups).
   - Groups: `OIDC_GROUPS_CLAIM` (default `groups`), split on commas/whitespace/semicolons/pipes (`/[\s,;|]+/`) if string, or used directly if array. Empty strings filtered out. Supports common IdP formats (comma, space, semicolon, pipe delimited).
   - Name: `OIDC_NAME_CLAIM` (default `name`), fallback to email prefix (before `@`).

Failures are silent (no token logging) and result in an unauthenticated request. The extracted email becomes the key for whitelist lookups.

**Production requirement:** Issuer and JWKS URLs **must use HTTPS**. HTTP is only for local testing; whoever controls the fetch can substitute signing keys.

---

## 3. Read Permission Model

### Scope Definition

A scope consists of two lists:

- **Environment names** — case-insensitive, matched **across all projects** (granting `environment: ["production"]` grants access to the `production` environment in **every project**; use app prefixes for project-scoped grants).
- **App name prefixes** — case-insensitive, matched against app names

### Scope Resolution

For a given identity (email + groups), the effective scope is determined in order:

1. **Email whitelist** — If an enabled whitelist entry exists for the email (stored lowercased), its scope is used **exclusively**. Groups are ignored. A disabled entry falls through to group rules. An enabled entry with empty lists is a valid "read nothing" grant (distinct from "no grant" — it explicitly revokes access).
2. **Group rules** — The user's groups (lowercased) are matched against enabled rules. All matching rules are merged (union of environments and app prefixes, trimmed and deduplicated). Empty group set yields no scope.
3. **No match** — No scope is granted.

**Note:** A disabled whitelist entry with no groups results in no grant (same as no whitelist entry).

### Scope Expansion to Visibility Sets

The scope (environment names + app prefixes) expands into concrete visibility sets by scanning all apps and environments at request time. **Expansion runs per-request; for large deployments, consider caching the visibility sets (open item).**

- **App visible** when its name starts with a permitted prefix **OR** its environment's name is permitted.
  > **⚠ Security implication:** Granting an environment name (e.g., `production`) grants access to **ALL apps in that environment**, regardless of app prefixes. This includes future apps added to that environment. Use app prefixes for fine-grained control.
- **Environment visible** when its name is permitted **OR** it contains a visible app.
- **Project visible** when it contains any visible app or environment.

The result is sets of visible app IDs, environment IDs, project IDs, plus per-project mappings for list filtering.

### Access Kinds

Every request resolves to one of three access kinds:

- **Open** — Enforcement off (dev/test only). UI surfaces accessible without credentials. Admin API still returns 401.
- **Admin** — Valid admin token. Unrestricted access to all endpoints.
- **Scoped (OIDC)** — Verified identity with a granted scope. Read-only access to allowlisted endpoints, filtered by visibility sets.

### No-Grant Handling

A verified identity with no matching whitelist entry and no matching group rules has **no grant**. This is distinct from an invalid token. The request is rejected with 401 and a specific message ("No read permission is configured for this account — ask an admin to grant your group access, or provide the admin token"). The UI prompts for the admin token on any 401 (it reacts to the status, not the message text).

**Whitelist revocation (empty scope):** An enabled whitelist entry with empty scope lists is a valid "read nothing" grant (not "no grant"). The user receives empty list responses and 404 on detail endpoints — same as any granted user with zero visible resources. No 401 is returned. This allows explicit revocation without triggering the "ask an admin" prompt.

---

## 4. Per-Surface Enforcement

### Admin API (`/api/admin/*`)

**Always credential-gated.** The request is resolved once per request (HTTP only; WebSocket upgrades handled separately).

- No credentials or "open" kind → 401 (even in dev)
- Admin kind → Allowed everywhere
- Scoped kind, no grant → 401 with no-grant message (checked before path allowlist)
- Scoped kind, with grant → Allowed **only** for GET requests matching the scoped read paths; all others → 403 "This endpoint requires the admin token"

**Scoped read paths (GET only):**

- Projects list and detail
- Project apps list
- Environments list (with optional project filter) and detail
- Issues list and detail
- Issue events (`/api/admin/issues/:id/events`) and stats (`/api/admin/issues/:id/stats`)

**Admin-token-only (excluded from scoped reads):**

- All writes (POST/PATCH/DELETE)
- Feature flags, experiments, segments, releases
- Source maps and source-map tokens
- Alerts and metrics configuration
- Permission management (`/api/admin/permissions/*`)
- Settings

**Filtering behavior for scoped reads:**

| Endpoint | Behavior |
|----------|----------|
| Projects list | Returns only visible projects; app counts reflect visible apps only |
| Project detail | 404 if project not visible; nested apps filtered to visible |
| Project apps | 404 if project not visible; returns only visible apps |
| Environments list | Unknown/out-of-scope `projectId` filter → empty list; returns only visible environments |
| Environment detail | 404 if environment not visible |
| Issues list | Unknown/out-of-scope `appId`/`projectId` filters → empty list; otherwise filtered to visible apps |
| Issue detail | 404 if issue's app not visible |

**Consistency rule:** For list endpoints, unknown filter IDs and out-of-scope IDs return **identical responses** (empty list). For detail endpoints, both return 404. This prevents existence probing.

**Issues list `projectId` filter:** Matches issues whose app belongs to that project.

### UI Surfaces (`/events/*`, `/storage/*`, `/replays/*`)

Open in dev/test when enforcement is off. When enforcement is on, credentials are required (same resolution as admin API).

- **Events list** — App filter intersected with visible apps; explicit out-of-scope filter yields empty list
- **Event detail** — 404 unless event's app is visible
- **Events clear (write)** — Requires admin token when enforcement is on; other valid credentials receive 403; missing/grantless credentials fail earlier with 401. **In dev-open mode (enforcement off), this write endpoint is allowed without credentials.** Note: `/events/clear` is a UI surface write endpoint, not an admin API endpoint. **Warning:** In dev-open mode, this destructive write is unauthenticated. Do not run dev-open mode on shared or exposed hosts.
- **Live events WebSocket** — Guarded separately (browsers cannot set headers on upgrade). Accepts token via query parameter. 401 without credentials, no-grant message without grant. Registers client with visible app IDs for fan-out filtering. **Security note:** Long-lived credential in URL (access logs, proxy logs, browser history, Referer headers). Current design uses the same token as HTTP; **open item:** short-lived one-shot ticket design for WebSocket upgrades with periodic re-validation. Stream is not re-validated after `open()` — if permissions are revoked, the socket stays connected until disconnect. **Mitigation:** Use short JWT expiry (e.g., 5–15 min) and rely on token expiration for revocation; for immediate revocation, configure the IdP to support token introspection (RFC 7662) — **open item:** implement introspection endpoint call on each WebSocket message or periodic re-check.
- **Storage (S3 only)** — Scoped callers may only fetch keys shaped `replays/<projectId>/<appId>/...` belonging to a visible app (projectId segment must match app's project); otherwise 404. Admin token has unrestricted access. In dev-open mode (enforcement off), storage is accessible without credentials. **Warning:** In dev-open mode, all replay data is publicly readable. Do not run dev-open mode on shared or exposed hosts.
- **Replays by event** — Follows event's app scope; 404 for out-of-scope (indistinguishable from missing).

### Environments Exposure

Environments are only listed and read under `/api/admin/environments/*` (admin token or scoped grant). App responses carry only the environment ID. Admin-only app-create and project-duplicate responses echo the involved environment object. No unauthenticated surface exposes environments. The scoped visibility sets are the only cross-tenant filter mechanism.

---

## 5. How Admins Grant Permissions

An admin (holding the admin token) grants read access to OIDC users through two mechanisms, managed exclusively via the Settings → Permissions UI (or the underlying API):

### Group Rules (Recommended for Teams)

1. Admin creates a **group rule** mapping an identity-provider group name to a scope:
   - **Group name** — Exact match (case-insensitive) against the `groups` claim from the user's verified JWT
   - **Environments** — List of environment names (across all projects) the group may access
   - **App prefixes** — List of app name prefixes the group may access
   - **Enabled** — Toggle to activate/deactivate without deleting

2. When a user authenticates, their groups are matched against enabled rules. All matching rules are merged (union). The user gains read access to:
   - Any app whose name starts with a permitted prefix
   - Any app inside a permitted environment
   - The containing environments and projects

3. Group rules are the primary mechanism for team-based access. A user in multiple groups receives the union of all matching rules.

### Email Whitelist (Overrides for Individuals)

1. Admin creates a **whitelist entry** for a specific email address (lowercased, exact match):
   - **Email** — Matched against the `email` claim (or fallback) from the user's verified JWT
   - **Environments** and **App prefixes** — Same as group rules
   - **Enabled** — Toggle to activate/deactivate

2. If an enabled whitelist entry exists for the user's email, it **completely overrides** group rules. The user's groups are ignored. This allows per-person exceptions (broader or narrower) without changing group membership.

3. A disabled whitelist entry falls through to group rules.

4. **Revocation via whitelist:** An enabled whitelist entry with empty scope lists acts as an explicit "read nothing" grant. The user receives empty list responses and 404 on detail endpoints (not 401). This revokes access without triggering the "ask an admin" prompt.

### Scope Resolution Summary

| User has enabled whitelist entry? | Result |
|-----------------------------------|--------|
| Yes (non-empty scope) | Whitelist scope used exclusively (groups ignored) |
| Yes (empty scope) | Valid "read nothing" grant — empty lists, 404 on detail |
| No | Union of all matching enabled group rules |
| No match | No grant → 401 with "ask an admin" message |

### Visibility Expansion (Automatic)

The admin does **not** assign apps, environments, or projects directly. They assign **names and prefixes**. The system automatically expands these into visibility sets at request time by scanning the current project/app/environment topology. This means:

- Adding a new app with a matching prefix → immediately visible to granted users
- Renaming an environment → may affect visibility (name-based matching)
- Moving an app between environments → visibility follows the environment name

### Admin Workflow

1. Admin authenticates with admin token
2. Opens Settings → Permissions
3. Creates group rules for each team (e.g., "backend-team" → environments: ["production", "staging"], appPrefixes: ["api-", "worker-"])
4. Optionally creates whitelist entries for individuals needing custom access
5. Users sign in via OIDC; their access is computed automatically on each request

---

## 6. Data Model

### Permission Rules (Group → Scope)

- Unique identifier
- Group name (stored lowercased, unique)
- Environment names (JSON array, default empty)
- App name prefixes (JSON array, default empty)
- Enabled flag (default on)
- Timestamps (ISO strings)

### Permission Users (Email Whitelist → Scope)

Same shape as rules, with email (lowercased, unique) instead of group name.

### Storage Guarantees

- Scope lists stored as JSON text; corrupt/hand-edited JSON degrades to empty arrays (fail closed: "read nothing"). Invalid JSON or non-array values degrade to empty arrays.
- Uniqueness enforced at database level (unique indexes); creation attempts insert with `ON CONFLICT DO NOTHING`; if no row returned, queries for existing record and returns 409 on duplicate (maps unique violation to conflict error).
- Rename collisions (updating group name or email to an existing value) must map to conflict errors — see Open Items.

---

## 7. Management API

**Prefix:** `/api/admin/permissions`  
**Access:** Admin token only (scoped identities rejected by the allowlist)

| Operation | Description |
|-----------|-------------|
| GET / | Returns all rules and users (paginated; standard envelope `{ data, pagination }`) |
| POST /rules | Create group rule; 409 on duplicate group name |
| PATCH /rules/:id | Partial update; rename into existing group → 409 |
| DELETE /rules/:id | Remove by ID |
| POST /users | Create whitelist entry; 409 on duplicate email |
| PATCH /users/:id | Partial update; rename into existing email → 409 |
| DELETE /users/:id | Remove by ID |

**Input hardening:** Scope lists trimmed, empties dropped, case-insensitive deduplication, max 100 entries, each max 128 chars. Group name min 1 char; email min 3 chars. Email normalized to lowercase + NFKC Unicode normalization before storage and matching; format validation is delegated to the identity provider. All inputs validated via schema (no ad-hoc checks).

**Groups claim split:** Uses regex `/[\s,;|]+/` (commas, whitespace, semicolons, pipes). Configurable via `OIDC_GROUPS_CLAIM`.

**Audit logging:** All permission changes (create/update/delete of rules and users) are logged with admin identity, timestamp, and before/after state. Logs are immutable and queryable via the admin API.

**UI:** Settings → Permissions (admin token). Copy explains group rules and whitelist override behavior.

---

## 8. Frontend Flow

- Admin token persisted in localStorage; attached as Bearer token on every request when set. **Security note:** localStorage is vulnerable to XSS; for production, consider httpOnly cookie storage or a secure token vault.
- Any 401 dispatches an auth-required event; shell shows "Sign in to continue" prompt (reacts to status, not message text)
- No `/me` / profile endpoint. Local display aid (`viewerProfile`):
  - No token stored → null ("Not signed in")
  - 3-part token with decodable header/claims → shows as read-only user (name, email, groups from local decode)
  - Any other token (admin token is opaque, not a JWT) → shows as admin (read/write)
  - **This is a local display aid only; server is authoritative.** Any JWT (even invalid/expired) with 3 decodable parts will show as a user locally, but the server will reject it. Admin token must be opaque (not a JWT) to display correctly.
- Scoped users see reduced navigation (overview, issues, performance, logs), a "Read-only" chip, and a prompt that saving the admin token unlocks writes
- Permissions screen has no read-only rendering mode; all calls rejected server-side because permission management is admin-token-only

---

## 9. Configuration Reference

| Setting | Effect |
|---------|--------|
| `ADMIN_TOKEN` | Master credential; enables enforcement; always accepted |
| `NODE_ENV=production` | Enables enforcement even without tokens/provider |
| `OIDC_ISSUER` / `OAUTH_ISSUER` | Issuer + discovery base; provider considered configured. **Must be HTTPS in production.** |
| `OIDC_JWKS_URL` | JWKS override (skips discovery). **Must be HTTPS in production.** |
| `OIDC_AUDIENCE` / `OIDC_CLIENT_ID` / `OAUTH_CLIENT_ID` | Expected audience. **Critical:** Without this, any token from the configured issuer is accepted. |
| `OIDC_EMAIL_CLAIM` / `OIDC_GROUPS_CLAIM` / `OIDC_NAME_CLAIM` | Claim mapping (defaults: email, groups, name). Groups claim split on `/[\s,;|]+/`. |

Startup logs the effective mode (provider configured / token required / locked). Never prints secrets.

**Misconfiguration footguns:**

- Audience without issuer counts as "configured" but every JWT fails (no issuer to verify against) — all surfaces lock unless admin token is set
- Production with neither credential locks all surfaces
- Issuer/JWKS URLs must be HTTPS in any real deployment (whoever controls the fetch controls signing keys)
- No audience configured + issuer configured = accepts tokens for any client from that issuer
- Dev-open mode (`NODE_ENV=development` + no `ADMIN_TOKEN`) exposes `/events/clear` (destructive write) and `/storage/*` (replay data) without authentication — never run dev-open mode on shared or exposed hosts
- Admin token in localStorage is vulnerable to XSS — use httpOnly cookies or secure token vault in production
- Email fallback to `sub` (opaque identifier) fails whitelist matching — token is rejected if only `sub` is available; ensure IdP provides `email`, `preferred_username`, or `upn`

---

## 10. Tests

- Admin guard: mutations rejected without/invalid token, accepted with token; UI surfaces open with no config, locked once admin token set; admin token stays valid once OIDC configured
- Permissions: local OIDC stub (discovery + JWKS, signed RS256 JWTs) covering group rules, whitelist override, scoped reads on admin endpoints and UI surfaces, writes return 403, no-grant returns 401 with message. Admin token is test-only (defined in test preload, never a real credential)

---

## 11. Invariants (Must Not Break)

- Authentication centralized in one module, applied via middleware — never copy-pasted
- Admin API fails closed; admin token is master and never disabled by provider configuration
- OIDC verification fails closed: no trust without verified signature, required `exp`, matched `iss`, configured `aud`, `nbf` when present; tokens never logged
- Scoped identities are read-only: only allowlisted GETs; every scoped read filtered by visibility sets; out-of-scope detail = 404 (never leak existence)
- No built-in dev/test tokens, prefix/length bypasses, or hardcoded secrets
- Permission management stays admin-token-only
- Group names and emails matched lowercased; uniqueness at database level (unique index + `ON CONFLICT DO NOTHING`), never find-then-insert

---

## 12. Open Items

All open items (gaps, open decisions, possible follow-ups) moved to [`todos/permission.md`](../todos/permission.md); nothing there is started.

**Current open items include:**

- Rename collision handling for group rules and whitelist entries (conflict error mapping)
- Pagination for management API GET / endpoint (implemented: paginated envelope)
- Short-lived one-shot ticket design for WebSocket upgrades with periodic re-validation
- Organization-level admin concept (currently only global admin token)
- JWKS cache invalidation strategy beyond single re-fetch
- Clock skew handling beyond ±60s (provider clock significantly off)
- Exact group claim split regex standardization across IdPs (implemented: `/[\s,;|]+/`)
- Whitelist key behavior when only `sub` claim is available (resolved: token rejected if only `sub`)
- Zero-downtime admin token rotation mechanism
- WebCrypto ES512 (P-521) runtime support dependency
- Scope expansion caching for large deployments
- Token introspection (RFC 7662) for immediate OIDC token revocation
- Dev-open mode safeguards (prevent accidental exposure on shared hosts)
- Whitelist revocation UX (distinguish "read nothing" grant from "no grant" in UI)
- Scoped user session lifetime tied to JWT `exp` (no server-side revocation check)
- Email Unicode normalization (NFKC) for whitelist matching