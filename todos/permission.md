# Permissions — open items

Moved out of [`docs/permission.md`](../docs/permission.md), which describes the design. The design
itself is implemented (admin token + OIDC scoped reads); **nothing listed here is started.**
Section references (§2, §3, …) point at that document.

- [ ] **Write scopes / per-user roles** — every non-read action requires the
      shared `ADMIN_TOKEN`; OIDC identities can only read. Consider
      admin/editor roles derived from groups.
- [ ] **No browser login flow / session** — the client must be handed a JWT
      or the admin token out of band; the UI decodes the JWT locally and
      there is no `/me`.
- [ ] **`GET /api/admin/permissions` is unpaginated** — returns all rules +
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
- [ ] **No audit trail** — permission rule/whitelist mutations and admin
      token usage are not logged with actor identity.
- [ ] **Audience is optional** — an issuer without `OIDC_AUDIENCE` accepts
      tokens that issuer minted for any client (§3). Require an audience
      or document the assumption.
- [ ] **Whitelist key / email verification** — the identity mapping can
      fall back to `preferred_username`/`upn`/`sub`, and `email_verified`
      is not checked; pin down which claim the whitelist matches and
      whether a verified email is required (§3, §4).
- [ ] **TLS for discovery/JWKS** — `OIDC_ISSUER`/`OIDC_JWKS_URL` may be
      plain `http`; require `https` outside local dev (§3, §9).
- [ ] **Master-credential lifecycle** — `ADMIN_TOKEN` never expires, is
      unrestricted and shared, and the UI keeps it in `localStorage`;
      there is no rotation/revocation/sign-out story (§8). Pairs with the
      audit-trail item above.
- [ ] **List-endpoint existence oracle** — §5 spells out the out-of-scope
      filter case only; unknown and out-of-scope ids must be answered
      identically (same status and shape — empty list or `404`, whichever
      the endpoint uses) so lists cannot probe existence (§5, §11).
- [ ] **PATCH uniqueness conflicts are unspecified** — 409 is documented
      for POST only; renaming a rule/user into an existing group/email
      must map the unique violation to `conflict(...)` too (§6, §7).
- [ ] **Storage scope checks only the `appId` segment** — a key whose
      `projectId` segment does not match the app's project passes the
      described rule; validate the full `(projectId, appId)` prefix (§5).
- [ ] **Email validation is length-only** — `email >= 3` accepts malformed
      entries; define format and normalization (trim, Unicode) for
      whitelist matching (§7).
- [ ] **No rate limiting** — failed admin credentials are not throttled;
      consider a bound on repeated failures per source (§2, §5).
- [ ] **Outages look like invalid credentials** — scope-resolution errors
      become `401` (§4); add a distinguishable signal or document the log
      check operators must use.
