# Permissions — Architecture

**Status:** Design paper — the admin authorization model (admin token + OIDC scoped reads). Open items live in [`TODO.md`](../TODO.md).

---

## 1. Model in One Paragraph

There are exactly two credentials for the admin surface:

1. **Admin token** — a master secret, unrestricted, always accepted.
2. **Verified OIDC/OAuth2 JWT** — identity only, read-only, scoped by permission rules.

A verified identity is **an id** — `local-admin` for the admin token, `<issuer>-<subject>` for a provider JWT. An id receives a read scope (environment names + app-name prefixes) from the grants recorded for it. The scope expands into visibility sets (apps, environments, projects). List endpoints filter by these sets; detail reads outside the scope return 404. Scoped identities are read-only — writes return 403. With no grant, the user receives 401 with a message prompting for the admin token; the UI reacts to the 401 status and prompts accordingly.

Ingestion (DSN) and source-map uploads use separate authentication and are not part of this model.

---

## 2. Credentials & Enforcement

### Always Enforced

Auth is enforced on **every** request to every surface — there is no open mode. `/api/admin/*` and the UI surface (`/events/*`) both require an admin token or a verified provider JWT; without either, the answer is 401.

What changes is only _how_ identity is established: the master admin token, a verified OIDC/OAuth2 JWT, or (once implemented) an anonymous identity scoped by `backend/permissions.ts`. None of them exempts a surface from authentication.

An identity provider is considered **configured** only when **both** an issuer (`OIDC_ISSUER`/`OAUTH_ISSUER`) **and** an audience (`OIDC_AUDIENCE`/`OIDC_CLIENT_ID`/`OAUTH_CLIENT_ID`) are set. Audience without issuer (or issuer without audience) is a misconfiguration: JWT verification fails closed and only the admin token works.

Implementation: `resolveIdentity` (`backend/auth.ts`) checks the credentials — `API-Key <ADMIN_TOKEN>` (constant-time) or `Bearer <provider JWT>` (a `jose`-verified JWT against the provider's JWKS, the issuer's discovery document) — and resolves to **an id**. Every oidc route group of a domain file calls it through `resolveAdminId` from its own `.resolve` hook and reads `adminId`; the public and dsn groups carry no admin check. The UI surface (`backend/events/index.ts`) resolves the identity the same way. An id is all the admin surface needs — the backend builds no user profile.

### Admin Token

The admin token is the master credential. It is compared in constant time (no timing attacks, no prefix/length bypass). It yields the unrestricted id `local-admin` — the master identity, exempt from the scoped-read model. The token remains valid and accepted even when an identity provider is configured — it is never disabled by the presence of a provider.

**Revocation:** The token is generated at boot; only its `Bun.password` hash is kept in memory (`backend/index.ts`), and it rotates daily at 00:00 UTC (Elysia cron in the same file) — a presented old token fails from the next request.

**Lifecycle (known limitation):** the token never expires, is not bound to a person, and the UI keeps it in `sessionStorage` (per-tab, cleared on close). There is no rotation, revocation or sign-out story beyond replacing the environment variable and restarting; the audit trail records the rule/grant changes, not the token's use. Deployments that need a short-lived credential should use the provider identities (a scoped grant) and keep the admin token for the administrative writes.

### OIDC/OAuth2 JWT

A three-part JWT is verified **locally** using the provider's public signing keys (JWKS) when a provider is configured. The token is **never sent to the provider**.

#### Browser login (authorization code + PKCE)

The SPA signs in with the standard authorization-code flow via [`openid-client`](https://github.com/panva/openid-client); the backend never handles the code.

1. **Startup** — before React renders, the SPA reads the OIDC settings compiled into its bundle from the server environment by `frontend/auth-env-plugin.ts` (it replaces `frontend/src/lib/auth-env.ts`; issuer/client id/scope/insecure opt-in only). When a provider is configured and no token is stored (or a previous attempt failed), it redirects to the provider immediately; otherwise the app renders and the admin-token prompt handles any 401. Changing these variables requires a server restart so the bundle is rebuilt.
2. **Authorization request** — `openid-client` discovers the provider metadata and builds the authorization URL with `state` and a PKCE `S256` challenge. The verifier and state live in `sessionStorage`; the redirect URI is `${origin}/ui/auth/callback`.
3. **Callback** — `/ui/auth/callback` validates the state, exchanges the code at the provider's token endpoint (public client, no secret), and verifies the ID token. The ID token is stored in the same sessionStorage slot as the admin token (the raw token only) and sent as `Authorization: Bearer` on every request.
4. **Failure** — a failed exchange (denied consent, network error, bad token) sets a session flag and drops to the admin-token prompt instead of bouncing between the provider and the callback.

Provider requirements: a **public SPA client** (no client secret), the redirect URI `${origin}/ui/auth/callback` allowlisted, and CORS on the discovery, token, and JWKS endpoints. `OIDC_CLIENT_ID` (or `OAUTH_CLIENT_ID`) is the client id; `OIDC_SCOPES` defaults to `openid email profile`.

Verification flow:

1. **Discovery** — Fetch the provider's OpenID configuration (`.well-known/openid-configuration`) to locate the JWKS endpoint. The resolved JWKS URL is memoized for the process lifetime; a failed discovery is retried on the next request and fails closed until it succeeds. Can be overridden via `OIDC_JWKS_URL`. **Discovery failure (network error, non-2xx, invalid JSON) → verification fails closed.**
2. **JWKS retrieval** — Fetch the JSON Web Key Set (public keys) from the JWKS endpoint. Cached for 10 minutes. On an unknown `kid` (key rotation), re-fetch **once** — but not within 30 s of the last fetch, so a stream of unknown kids cannot amplify requests to the provider. If the key is still not found, or JWKS fetch fails (network error, non-2xx), verification fails closed.
3. **Key selection** — Match the token's `kid` header to a JWKS key. If no `kid` is present, accept **only when JWKS contains exactly one key**; otherwise reject.
4. **Algorithm check** — Header `alg` must be in the allowlist (RS256/384/512, ES256/384/512) and match the key's `alg` parameter. `none` and HMAC algorithms are rejected.
5. **Signature verification** — Verify the JWT signature using WebCrypto against the selected public key. **Note:** ES512 uses the P-521 curve; not all WebCrypto runtimes support it. Test with your provider.
6. **Claims validation** — All must pass:
   - `exp` required, within clock skew tolerance (±60s, aligned with common provider expectations). Tokens expiring more than the skew tolerance in the past or future are rejected.
   - `nbf` honored when present (same skew tolerance).
   - `iss` matches the configured issuer (the trailing slash is normalized).
   - `aud` matches configured audience (string or array). **Required when issuer is configured.** The audience is the client id (`OIDC_CLIENT_ID`/`OAUTH_CLIENT_ID`); without it the provider is not configured at all and every provider JWT is rejected. The `azp` claim, when present, must be the client id.
   - `azp` (authorized party) validated when `aud` is an array and `azp` is present: `azp` must match the configured audience.
7. **Identity extraction** — The id is `<issuer>-<subject>` from the verified claims. That id is the only identity the backend keeps: no email, no groups, no name. The UI decodes the token itself for its own display (the sidebar) — the backend never reads those claims.

Failures are silent (no token logging) and result in an unauthenticated request. The id becomes the key for the grant lookups.

**An outage is not an invalid credential:** a token the provider rejects (a bad signature, a wrong audience) is an unauthenticated request (401), but a provider that cannot be reached (the JWKS fetch failed or timed out) answers **503** — the operator can tell the two apart.

**Production requirement:** Issuer and JWKS URLs **must use HTTPS** — whoever controls the fetch can substitute signing keys. A plain-HTTP issuer is refused by the OIDC client unless the deployment opts in with `OIDC_ALLOW_INSECURE_HTTP=true` (for a local provider only — the tokens would travel in the clear). The opt-in relaxes the discovery only: the signature, the audience, the issuer and the `azp` checks stay in force.

---

## 3. Read Permission Model

### Scope Definition

A scope consists of two lists:

- **Environment names** — case-insensitive, matched **across all projects** (granting `environment: ["production"]` grants access to the `production` environment in **every project**; use app prefixes for project-scoped grants).
- **App name prefixes** — case-insensitive, matched against app names

### Scope Resolution

For a given identity (an id), the effective scope is determined in order:

1. **Identity grant** — If an enabled grant exists for the id, its scope is used **exclusively**. A disabled grant falls through. An enabled grant with empty lists is a valid "read nothing" grant (distinct from "no grant" — it explicitly revokes access).
2. **Group rules** — The id's groups are matched against enabled rules, and all matching rules are merged (union of environments and app prefixes, trimmed and deduplicated). The groups come from the token's `groups` claim, which the identity resolution does not read today — a group-based grant needs that claim plumbed through (open item).
3. **No match** — No scope is granted.

**Note:** A disabled grant results in no grant (same as no grant at all).

### Scope Expansion to Visibility Sets

The scope (environment names + app prefixes) expands into concrete visibility sets at request time. The queries filter on the names and the prefixes in SQL (the whole topology is not loaded), and the expansion still runs per request — for large deployments, consider caching the visibility sets (open item).

- **App visible** when its name starts with a permitted prefix **OR** its environment's name is permitted.
  > **⚠ Security implication:** Granting an environment name (e.g., `production`) grants access to **ALL apps in that environment**, regardless of app prefixes. This includes future apps added to that environment. Use app prefixes for fine-grained control.
- **The names match across every project** — an environment name or an app-name prefix is not bound to a project. A rule for `production` grants the reads in every project that has an environment with that name. A prefix is a plain prefix, so `prod` also matches `prod-experiments` (the prefix shadowing is part of the same rule).
- **Environment visible** when its name is permitted **OR** it contains a visible app.
- **Project visible** when it contains any visible app or environment.

The result is sets of visible app IDs, environment IDs, project IDs, plus per-project mappings for list filtering.

### Access Kinds

Every request resolves to one of three access kinds:

- **Admin** — Valid admin token. Unrestricted access to all endpoints.
- **Scoped (OIDC)** — Verified identity with a granted scope. Read-only access to allowlisted endpoints, filtered by visibility sets.
- **Writer (OIDC)** — A scoped identity whose grant carries the write access. It reads the same allowlisted endpoints and may also perform the admin writes. The grant's `canWrite` flag decides; the group rules never grant writes.

### No-Grant Handling

A verified identity with no matching grant and no matching group rules has **no grant**. This is distinct from an invalid token. The request is rejected with 401 and a specific message ("No read permission is configured for this account — ask an admin to grant your group access, or provide the admin token"). The UI prompts for the admin token on any 401 (it reacts to the status, not the message text).

**Grant revocation (empty scope):** An enabled grant with empty scope lists is a valid "read nothing" grant (not "no grant"). The user receives empty list responses and 404 on detail endpoints — same as any granted user with zero visible resources. No 401 is returned. This allows explicit revocation without triggering the "ask an admin" prompt.

---

## 4. Per-Surface Enforcement

### Admin API (`/api/admin/*`)

**Always credential-gated.** The request is resolved once per request (HTTP only; WebSocket upgrades handled separately).

- No credentials → 401 (every environment, including dev/test)
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

| Endpoint           | Behavior                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| Projects list      | Returns only visible projects; app counts reflect visible apps only                               |
| Project detail     | 404 if project not visible; nested apps filtered to visible                                       |
| Project apps       | 404 if project not visible; returns only visible apps                                             |
| Environments list  | Unknown/out-of-scope `projectId` filter → empty list; returns only visible environments           |
| Environment detail | 404 if environment not visible                                                                    |
| Issues list        | Unknown/out-of-scope `appId`/`projectId` filters → empty list; otherwise filtered to visible apps |
| Issue detail       | 404 if issue's app not visible                                                                    |

**Consistency rule:** For list endpoints, unknown filter IDs and out-of-scope IDs return **identical responses** (empty list). For detail endpoints, both return 404. This prevents existence probing.

**Issues list `projectId` filter:** Matches issues whose app belongs to that project.

### UI Surface (`/events/*`)

Always requires credentials — the admin token or a verified provider JWT (same resolution as the admin API). There is no open mode.

- **Events list** — App filter intersected with visible apps; explicit out-of-scope filter yields empty list
- **Event detail** — 404 unless event's app is visible
- **Live feed** — There is **no backend WebSocket**: the browser subscribes to NATS directly over the WebSocket listener and the backend does not fan the events out. The feed **does** honor the permission scope: the NATS auth callout (`docs/nats.md`) sends every connection to the backend, which verifies the credential (Keycloak JWT or the master admin token) and signs a sub-only user claim for exactly `sentry.events.<appNumber>` of the apps the identity's scope resolves to — an identity whose scope resolves to no app is denied. Publishing is denied for every reader connection. The events the UI _polls_ (`/events/*`) are scoped as described above.
- **Replays** — read under `/api/admin/events/:eventId/replay/:replayId`; follows the event's app scope via the admin guard; 404 for out-of-scope (indistinguishable from missing). The browser fetches the returned presigned object-store URLs directly; there is no `/storage/*` proxy surface.

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

4. **Non-goal — no teams/members entity.** There is no Team or Member table anywhere in the model; "membership" is exactly the permission system: the group rules (matched by the token's `groups` claim) plus the per-identity grants. A Team page can therefore only display groups, rules and grants — anything else would be fabricated.

### Identity Grants (Overrides for Individuals)

1. Admin creates a **grant** for a specific identity id (the id the token resolves to):
   - **Identity id** — The `<issuer>-<subject>` of the identity, exact match
   - **Environments** and **App prefixes** — Same as group rules
   - **Enabled** — Toggle to activate/deactivate

2. If an enabled grant exists for the identity, it **completely overrides** group rules. The identity's groups are ignored. This allows per-person exceptions (broader or narrower) without changing group membership.

3. A disabled grant falls through to group rules.

4. **Revocation via the grant:** An enabled grant with empty scope lists acts as an explicit "read nothing" grant. The user receives empty list responses and 404 on detail endpoints (not 401). This revokes access without triggering the "ask an admin" prompt.

### Scope Resolution Summary

| User has an enabled grant? | Result                                                  |
| -------------------------- | ------------------------------------------------------- |
| Yes (non-empty scope)      | The grant scope is used exclusively (groups ignored)    |
| Yes (empty scope)          | Valid "read nothing" grant — empty lists, 404 on detail |
| No                         | Union of all matching enabled group rules               |
| No match                   | No grant → 401 with "ask an admin" message              |

### Visibility Expansion (Automatic)

The admin does **not** assign apps, environments, or projects directly. They assign **names and prefixes**. The system automatically expands these into visibility sets at request time by scanning the current project/app/environment topology. This means:

- Adding a new app with a matching prefix → immediately visible to granted users
- Renaming an environment → may affect visibility (name-based matching)
- Moving an app between environments → visibility follows the environment name

### Admin Workflow

1. Admin authenticates with admin token
2. Opens Settings → Permissions
3. Creates group rules for each team (e.g., "backend-team" → environments: ["production", "staging"], appPrefixes: ["api-", "worker-"])
4. Optionally creates grants for individuals needing custom access
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

### Permission Grants (Identity Id → Scope)

Same shape as rules, with the identity id (unique) instead of the group name, plus an optional label for the admin UI. The identity id is what the token resolves to (`<issuer>-<subject>`), so a grant names exactly one identity.

### Storage Guarantees

- Scope lists stored as JSON text; corrupt/hand-edited JSON degrades to empty arrays (fail closed: "read nothing"). Invalid JSON or non-array values degrade to empty arrays.
- Uniqueness enforced at database level (unique indexes); creation attempts insert with `ON CONFLICT DO NOTHING`; if no row returned, queries for existing record and returns 409 on duplicate (maps unique violation to conflict error).
- Rename collisions (updating a group name or an identity id to an existing value) must map to conflict errors — see Open Items.
- The object store's scope is **key-shape coupled**: the replay segments live under `replays/<projectId>/<appId>/…` and the reads build that prefix from the stored event's project and app, so the key itself carries the scope. A new kind of offloaded object needs a matching prefix rule in `backend/events/offload.ts` — the scope is not a separate table.

---

## 7. Management API

**Prefix:** `/api/admin/permissions`  
**Access:** Admin token only (scoped identities rejected by the allowlist)

| Operation          | Description                                         |
| ------------------ | --------------------------------------------------- |
| GET /rules         | The group rules (cursor-paginated `{ data }`)       |
| POST /rules        | Create group rule; 409 on duplicate group name      |
| PATCH /rules/:id   | Partial update; rename into existing group → 409    |
| DELETE /rules/:id  | Remove by ID                                        |
| GET /grants        | The identity grants (cursor-paginated `{ data }`)   |
| POST /grants       | Create identity grant; 409 on duplicate identity id |
| PATCH /grants/:id  | Partial update                                      |
| DELETE /grants/:id | Remove by ID                                        |

**Input hardening:** Scope lists trimmed, empties dropped, case-insensitive deduplication, max 100 entries, each max 128 chars. Group name min 1 char; the identity id min 1 char. The group name and the identity id are stored lowercased. All inputs validated via schema (no ad-hoc checks).

**Groups claim split:** Uses regex `/[\s,;|]+/` (commas, whitespace, semicolons, pipes). Configurable via `OIDC_GROUPS_CLAIM`.

**Audit logging:** Every permission change (create/update/delete of rules and grants) is recorded with the admin identity, the action, and the state before and after. The trail is read back with `GET /api/admin/permissions/audit?target=rule|grant`.

**UI:** Permissions (admin token) — the group rules, the identity grants and the change trail. A scoped identity gets a read-only chip and the admin-only navigation entries are hidden; both are driven by `GET /api/admin/session`.

---

## 8. Frontend Flow

- Admin token kept in sessionStorage (per-tab, cleared on close); attached as `API-Key` on every request when set. An OIDC ID token shares the slot and goes out as `Bearer`. **Security note:** storage is still vulnerable to XSS; for production, consider httpOnly cookie storage or a secure token vault.
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

| Setting                                                      | Effect                                                                                                                                                                                                               |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin token                                                  | Master credential; always accepted. Generated at boot, held only as its `Bun.password` hash, rotated daily at 00:00 UTC (Elysia cron in `backend/index.ts`) — `bnm_`-prefixed mixed-case groups, no env var, no file |
| `OIDC_ISSUER` / `OAUTH_ISSUER`                               | Issuer + discovery base; provider considered configured. **HTTPS in production** — a plain-HTTP issuer needs `OIDC_ALLOW_INSECURE_HTTP=true`.                                                                        |
| `OIDC_JWKS_URL`                                              | JWKS override (skips discovery). **HTTPS in production** — a plain-HTTP issuer needs `OIDC_ALLOW_INSECURE_HTTP=true`.                                                                                                |
| `OIDC_ALLOW_INSECURE_HTTP`                                   | `true` allows a plain-HTTP issuer (local providers only). The signature, audience, issuer and `azp` checks are unchanged.                                                                                            |
| `OIDC_AUDIENCE` / `OIDC_CLIENT_ID` / `OAUTH_CLIENT_ID`       | Expected audience. **Critical:** Without this, any token from the configured issuer is accepted. `OIDC_CLIENT_ID`/`OAUTH_CLIENT_ID` also enable the browser login flow.                                              |
| `OIDC_SCOPES`                                                | Scopes requested by the browser login flow (default `openid email profile`).                                                                                                                                         |
| `OIDC_EMAIL_CLAIM` / `OIDC_GROUPS_CLAIM` / `OIDC_NAME_CLAIM` | Claim mapping (defaults: email, groups, name). Groups claim split on `/[\s,;                                                                                                                                         | ]+/`. |

Startup never prints secrets.

**Misconfiguration footguns:**

- Audience without issuer (or issuer without audience) means every provider JWT fails — only the admin token works
- Neither credential configured (no `ADMIN_TOKEN`, no provider) locks every surface in every environment
- Issuer/JWKS URLs must be HTTPS in any real deployment (whoever controls the fetch controls signing keys) — a plain-HTTP issuer needs the explicit `OIDC_ALLOW_INSECURE_HTTP=true` opt-in
- No audience configured + issuer configured = accepts tokens for any client from that issuer
- Browser login requires a public SPA client, the exact redirect URI allowlisted, and CORS on discovery/token/JWKS — without them startup falls back to the admin-token prompt
- The credential slot in sessionStorage is vulnerable to XSS — use httpOnly cookies or secure token vault in production
- The identity id is `<issuer>-<subject>`, so `sub` alone is enough — no email claim is required

---

## 10. Tests

- Admin guard: mutations rejected without/invalid token, accepted with token; UI surface rejected without credentials and accepted with the admin token; admin token stays valid once OIDC configured
- OIDC: local provider stub (discovery document + JWKS, signed RS256 JWTs) — a valid JWT authenticates `/api/admin/*` and `/events/*`; a wrong audience or unknown signing key is 401 (`e2e/35-oidc.test.ts`)
- Admin-token prompt: with no provider configured and no stored token, the UI renders the prompt; storing a valid token dismisses it (`e2e/36-admin-token-prompt.test.ts`)
- OIDC login from startup: a local provider stub (discovery + authorization + token + JWKS) receives the PKCE authorization request at startup, returns an ID token, and the SPA renders authenticated and calls the admin API with it (`e2e/37-oidc-login.test.ts`)
- Permissions: local OIDC stub (discovery + JWKS, signed RS256 JWTs) covering group rules, the grant override, scoped reads on admin endpoints and UI surfaces, writes return 403, no-grant returns 401 with message. Admin token is test-only (defined in test preload, never a real credential)

---

## 11. Invariants (Must Not Break)

- Admin credential check is one function (`resolveIdentity`, `backend/auth.ts`) that every oidc route group calls from its own `.resolve` hook; the read-permission engine stays centralized in `backend/permissions.ts` and is never copy-pasted
- Admin API fails closed; admin token is master and never disabled by provider configuration
- OIDC verification fails closed: no trust without verified signature, required `exp`, matched `iss`, configured `aud`, `nbf` when present; tokens never logged
- Scoped identities are read-only: only allowlisted GETs; every scoped read filtered by visibility sets; out-of-scope detail = 404 (never leak existence)
- No built-in dev/test tokens, prefix/length bypasses, or hardcoded secrets
- Permission management stays admin-token-only
- Group names and emails matched lowercased; uniqueness at database level (unique index + `ON CONFLICT DO NOTHING`), never find-then-insert

---

## 12. Open Items

The implemented contract keeps `exp` required (`§2`, `§11`) — **the verifier does not
enforce it yet** (`requiredClaims` is not passed; the case is `it.todo` in
`e2e/35-oidc.test.ts`); it is an open item in [`TODO.md`](../TODO.md). The other
still-open design follow-ups live there too. By-design limitations carried here
instead of in code: the master `ADMIN_TOKEN` never expires (rotate the env var and
restart; `§2`), identity lifetime is the JWT lifetime (no server-side session), and
the live feed is the NATS subject — no WebSocket upgrade tickets to design. The
rename conflicts, the whitelist only-`sub` case and the claim-split regex are
decided in the sections above.
