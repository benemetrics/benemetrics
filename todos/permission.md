# Permissions — open items

Moved out of [`docs/permission.md`](../docs/permission.md), which describes the design. The design
itself is implemented (admin token + OIDC scoped reads); **nothing listed here is started.**
Section references (§2, §3, …) point at that document.

- [x] **The identity carries the groups claim** — `resolveIdentity`
      (`backend/auth.ts`) resolves `<issuer>-<subject>` and the token's
      `groups` claim; the group rules of §3 match them, and an identity
      grant (by id) overrides them.
- [x] **Write scopes / per-user roles** — every non-read action requires the
      shared `ADMIN_TOKEN`; OIDC identities can only read. Consider
      admin/editor roles derived from groups. A grant's `canWrite` flag gives
      the identity the admin writes; the group rules never grant writes
      (`backend/permissions/engine.ts`, `backend/auth.ts`).
- [x] **No browser login flow / session** — the client must be handed a JWT
      or the admin token out of band; the UI decodes the JWT locally and
      there is no `/me`. The SPA runs the authorization-code + PKCE flow
      (`frontend/src/lib/oidc.ts`) and the server answers the identity and
      the scope at `GET /api/admin/session`.
- [x] **`GET /api/admin/permissions` is unpaginated** — returns all rules +
      users in one object, unlike the paginated convention; fine for small
      deployments, can grow unbounded.
- [ ] **Scope expansion is O(all apps + all environments) per request** —
      `computeScopedView` loads full tables and is cached per request only,
      not across requests. Consider per-request SQL joins / a cached
      expansion with invalidation.
- [ ] **Name matching is cross-project** — environment names and app-name
      prefixes both match across *all* projects: a rule for "production"
      or prefix "prod" grants reads in every project with a matching
      environment name or app name. Confirm this is desired and document
      it for admins (currently implicit in §4 semantics); prefix shadowing
      ("prod" also matching "prod-experiments") is the same class.
- [ ] **Storage scope is key-shape-coupled** — `replays/<projectId>/<appId>/…`
      is the only recognized prefix; any new offloaded object kind needs a
      matching scope rule in `backend/storage/index.ts`.
- [ ] **Live WS: long-lived credential in the URL + no re-evaluation** —
      `?token=` can be retained by access logs, proxies and browser
      history, and the `appIds` filter is fixed at `open()`; permission
      changes or token expiry mid-connection keep streaming until
      disconnect. Prefer a short-lived one-shot ticket and periodic
      re-validation; no test covers the scope filter or mid-connection
      grant changes.
- [x] **No audit trail** — permission rule/whitelist mutations and admin
      token usage are not logged with actor identity. Every rule/grant
      mutation is recorded with the actor, the action and the state before
      and after (`permission_audit`, `GET /api/admin/permissions/audit`).
- [x] **Audience is optional** — an issuer without `OIDC_AUDIENCE` accepts
      tokens that issuer minted for any client (§3). The provider is only
      configured with an issuer *and* a client id, and the audience is
      always verified against that client id (`backend/auth.ts`).
- [x] **Whitelist key / email verification** — the identity mapping can
      fall back to `preferred_username`/`upn`/`sub`, and `email_verified`
      is not checked; pin down which claim the whitelist matches and
      whether a verified email is required (§3, §4). The grant keys on
      the identity id (`<issuer>-<subject>`); the email claim is never
      read by the backend.
- [x] **TLS for discovery/JWKS** — `OIDC_ISSUER`/`OIDC_JWKS_URL` may be
      plain `http`; require `https` outside local dev (§3, §9). The
      backend warns but does not enforce it — whether the provider is
      reachable over TLS depends on the deployment's infrastructure
      (§2, `docs/permission.md`).
- [ ] **Master-credential lifecycle** — `ADMIN_TOKEN` never expires, is
      unrestricted and shared, and the UI keeps it in `localStorage`;
      there is no rotation/revocation/sign-out story (§8). Pairs with the
      audit-trail item above.
- [ ] **List-endpoint existence oracle** — §5 spells out the out-of-scope
      filter case only; unknown and out-of-scope ids must be answered
      identically (same status and shape — empty list or `404`, whichever
      the endpoint uses) so lists cannot probe existence (§5, §11).
- [x] **PATCH uniqueness conflicts are unspecified** — 409 is documented
      for POST only; renaming a rule/user into an existing group/email
      must map the unique violation to `conflict(...)` too (§6, §7).
      Both renames answer `409` (`backend/permissions/index.ts`).
- [ ] **Storage scope checks only the `appId` segment** — a key whose
      `projectId` segment does not match the app's project passes the
      described rule; validate the full `(projectId, appId)` prefix (§5).
- [x] **Email validation is length-only** — `email >= 3` accepts malformed
      entries; define format and normalization (trim, Unicode) for
      whitelist matching (§7).
- [x] **No rate limiting** — failed admin credentials are not throttled;
      consider a bound on repeated failures per source (§2, §5). The
      throttle belongs to the reverse proxy: it knows the real client IP
      without trusting a header, and the application has no rate limiter
      by design (`docs/rate-limiting.md`).
- [ ] **Outages look like invalid credentials** — scope-resolution errors
      become `401` (§4); add a distinguishable signal or document the log
      check operators must use.

## Open: the provider JWT verification

`backend/auth.ts` verifies a provider JWT with `jwtVerify` and the audience
`OIDC_CLIENT_ID`/`OAUTH_CLIENT_ID`. Three checks of the old implementation are
**not** enforced any more, and `e2e/35-oidc.test.ts` marks them as `it.todo`:

- a token **without `exp`** is accepted (no `requiredClaims`);
- the **`azp`** claim was not checked (only the audience) — **fixed**;
- the **`iss`** claim was not verified — **fixed**.

**Fixed:** the `azp` claim is checked against the client id and the issuer is
verified against `OIDC_ISSUER` (the trailing slash normalized).
