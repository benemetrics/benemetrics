# 8. Authentication — None, OIDC, OAuth2

Sentry supports multiple authentication methods, but it's important to distinguish between:
- **Client/SDK authentication** (for sending events): Only DSN-based authentication (None method)
- **Server/Admin authentication** (for accessing Sentry UI/API): OIDC and OAuth2

This guide covers the three primary authentication modes and clarifies which are used by clients versus for server administration.

---

## Overview

| Auth Mode | Use Case | Complexity |
|-----------|----------|------------|
| **None (DSN-only)** | Development, internal tools, server-to-server | Low |
| **OIDC (OpenID Connect)** | Enterprise SSO, identity providers (Okta, Auth0, Azure AD) | Medium |
| **OAuth2** | Third-party integrations, custom apps, delegated access | Medium-High |

---

## 1. None (DSN-Based Authentication)

### How It Works

The DSN (Data Source Name) contains a public key and project ID. No secret is required for event ingestion.

```
https://<PUBLIC_KEY>@sentry.io/<PROJECT_ID>
```

### When to Use

- ✅ Development / local environments
- ✅ Server-to-server communication (backend services)
- ✅ Public client-side error tracking (frontend)
- ✅ Internal tools with network isolation

### Configuration

```typescript
// sentry.config.ts
import * as Sentry from "@sentry/<your-platform>";

Sentry.init({
  dsn: process.env.SENTRY_DSN, // Public DSN only
  environment: process.env.NODE_ENV,
  // No auth token needed for event ingestion
});
```

### Security Considerations

- **DSN is public** — anyone with the DSN can send events to your project
- **Rate limiting** — configure project-level rate limits in Sentry UI
- **IP allowlisting** — restrict ingestion to known IPs (self-hosted only)
- **Never expose DSN in client-side code** if you need strict control (use a proxy)

## Authentication Summary by Endpoint

| Endpoint Category | Paths | Auth Method | Credentials |
|-------------------|-------|-------------|-------------|
| **Sentry Ingestion** | `/api/:projectId/envelope/`, `/api/:projectId/store/` | DSN (None) | `sentry_key` query param or `X-Sentry-Auth` header |
| **Sentry DSN Management** | `/api/dsn/create`, `/api/dsn/:projectId`, `/api/dsn/generate` | DSN (None) | `sentry_key` query param or Bearer token with DSN public key |
| **Sentry Feature Flag Evaluation** | `/api/feature-flags/evaluate` | DSN (None) | `sentry_key` query param or Bearer token with DSN public key |
| **Admin Feature Flags** | `/api/admin/feature-flags/*` | OAuth2/OIDC | `Authorization: Bearer <token>` |
| **Admin Segments** | `/api/admin/segments/*` | OAuth2/OIDC | `Authorization: Bearer <token>` |

---

## 2. OIDC (OpenID Connect)

### How It Works

OIDC extends OAuth2 with an identity layer. Users authenticate via an Identity Provider (IdP), which returns an ID Token (JWT) containing user claims.

```
User → Sentry → IdP (Okta/Auth0/Azure AD) → User
                ↓
           ID Token (JWT)
                ↓
           Sentry validates & creates session
```

### Supported IdPs

| IdP | Configuration |
|-----|---------------|
| **Okta** | OIDC Web App integration |
| **Auth0** | Regular Web Application |
| **Azure AD / Entra ID** | App Registration (multitenant) |
| **Google Workspace** | OAuth 2.0 Client ID |
| **Keycloak** | OpenID Connect Client |
| **Generic OIDC** | Any OIDC-compliant provider |

### Sentry Server (Self-Hosted) Configuration

```yaml
# sentry/config.yml
auth:
  oidc:
    enabled: true
    # Provider configuration
    providers:
      - name: "Okta"
        issuer_url: "https://your-domain.okta.com"
        client_id: "${OKTA_CLIENT_ID}"
        client_secret: "${OKTA_CLIENT_SECRET}"
        # Optional: customize scopes
        scopes: ["openid", "profile", "email", "groups"]
        # Map IdP claims to Sentry user fields
        claim_mapping:
          email: "email"
          name: "name"
          groups: "groups"
      - name: "Azure AD"
        issuer_url: "https://login.microsoftonline.com/<tenant-id>/v2.0"
        client_id: "${AZURE_CLIENT_ID}"
        client_secret: "${AZURE_CLIENT_SECRET}"
        scopes: ["openid", "profile", "email"]
```

### SDK Authentication (User Context)

For SDKs, OIDC is typically handled at the application level. The SDK receives the authenticated user context:

```typescript
// After user logs in via your OIDC flow
import * as Sentry from "@sentry/<your-platform>";

// Set user context from OIDC ID token claims
Sentry.setUser({
  id: idToken.sub,           // Subject (unique user ID)
  email: idToken.email,
  username: idToken.preferred_username,
  name: idToken.name,
  // Custom data
  ip_address: request.ip,
  segment: idToken.custom_segment,
  roles: idToken.groups || [],
});

// Optional: Set tags for filtering
Sentry.setTag("auth_provider", "oidc");
Sentry.setTag("organization", idToken.org_id);
```

### Token Validation (Backend)

```typescript
// middleware/oidc-validation.ts
import { JwtPayload, verify } from "jsonwebtoken";
import { fetchJwks } from "jwks-rsa";

const jwksClient = fetchJwks({
  jwksUri: `${process.env.OIDC_ISSUER_URL}/.well-known/jwks.json`,
  cache: true,
  rateLimit: true,
});

export async function validateOIDCToken(token: string): Promise<JwtPayload | null> {
  try {
    const decoded = verify(token, (header, callback) => {
      jwksClient.getSigningKey(header.kid, (err, key) => {
        callback(err, key?.getPublicKey());
      });
    }, {
      issuer: process.env.OIDC_ISSUER_URL,
      audience: process.env.OIDC_CLIENT_ID,
    });
    return decoded as JwtPayload;
  } catch {
    return null;
  }
}
```

### Group-Based Access Control

Map IdP groups to Sentry teams/roles:

```yaml
# sentry/config.yml
auth:
  oidc:
    group_mapping:
      "sentry-admins": "admin"
      "sentry-developers": "member"
      "sentry-viewers": "readonly"
    default_role: "member"
```

---

## 3. OAuth2

### How It Works

OAuth2 enables delegated access. Users authorize your application to access their Sentry data without sharing credentials.

```
User → Your App → Sentry (Authorization Server) → User
                    ↓
              Authorization Code
                    ↓
              Access Token + Refresh Token
                    ↓
              Your App → Sentry API (with Bearer token)
```

### OAuth2 Flows

| Flow | Use Case |
|------|----------|
| **Authorization Code** | Web apps, server-side apps (most secure) |
| **Authorization Code + PKCE** | SPAs, mobile apps (public clients) |
| **Client Credentials** | Server-to-server, daemon processes |
| **Device Code** | CLI tools, IoT devices |

### Registering an OAuth2 Application

1. **Sentry UI** → Settings → Developer Settings → OAuth Applications
2. **New Application** → Fill in:
   - **Name**: Your app name
   - **Redirect URI**: `https://yourapp.com/callback`
   - **Scopes**: Select required permissions
3. **Save** → Note `Client ID` and `Client Secret`

### Scopes Reference

| Scope | Description |
|-------|-------------|
| `event:read` | Read events/issues |
| `event:write` | Create events (ingestion) |
| `event:admin` | Manage events (delete, merge) |
| `org:read` | Read organization info |
| `org:write` | Manage organization |
| `project:read` | Read projects |
| `project:write` | Create/update projects |
| `project:admin` | Delete projects, manage keys |
| `team:read` | Read teams |
| `team:write` | Manage teams |
| `member:read` | Read members |
| `member:write` | Invite/remove members |
| `user:read` | Read user profile |
| `user:email` | Read user email |

### Authorization Code Flow (Web App)

```typescript
// routes/auth/sentry.ts
import { generateCodeVerifier, generateCodeChallenge } from "oauth-pkce";

const SENTRY_AUTH_URL = "https://sentry.io/oauth/authorize";
const SENTRY_TOKEN_URL = "https://sentry.io/oauth/token";
const CLIENT_ID = process.env.SENTRY_CLIENT_ID!;
const CLIENT_SECRET = process.env.SENTRY_CLIENT_SECRET!;
const REDIRECT_URI = process.env.SENTRY_REDIRECT_URI!;

// Step 1: Initiate login
export async function initiateOAuth(req, res) {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = crypto.randomUUID();

  // Store for callback
  req.session.oauth = { codeVerifier, state };

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "event:read project:read org:read user:read",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  res.redirect(`${SENTRY_AUTH_URL}?${params.toString()}`);
}

// Step 2: Handle callback
export async function handleCallback(req, res) {
  const { code, state, error } = req.query;
  const { codeVerifier, state: storedState } = req.session.oauth;

  if (error) {
    return res.status(400).send(`OAuth error: ${error}`);
  }
  if (state !== storedState) {
    return res.status(400).send("Invalid state parameter");
  }

  // Exchange code for tokens
  const tokenResponse = await fetch(SENTRY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code as string,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code_verifier: codeVerifier,
    }),
  });

  const tokens = await tokenResponse.json();

  // Store tokens securely (encrypted in DB)
  await saveTokens(req.user.id, tokens);

  res.redirect("/dashboard");
}
```

### Client Credentials Flow (Server-to-Server)

```typescript
// services/sentry-api.ts
const SENTRY_TOKEN_URL = "https://sentry.io/oauth/token";

interface SentryTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: "Bearer";
}

let cachedTokens: SentryTokens | null = null;
let expiresAt = 0;

export async function getAccessToken(): Promise<string> {
  if (cachedTokens && Date.now() < expiresAt - 60_000) {
    return cachedTokens.access_token;
  }

  const response = await fetch(SENTRY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.SENTRY_CLIENT_ID!,
      client_secret: process.env.SENTRY_CLIENT_SECRET!,
      scope: "event:write project:read", // Minimal scopes
    }),
  });

  if (!response.ok) {
    throw new Error(`Token request failed: ${response.statusText}`);
  }

  cachedTokens = await response.json();
  expiresAt = Date.now() + cachedTokens.expires_in * 1000;
  return cachedTokens.access_token;
}

// Usage
export async function sendEvent(eventData: object) {
  const token = await getAccessToken();
  const response = await fetch(
    `https://sentry.io/api/0/projects/${ORG}/${PROJECT}/events/`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(eventData),
    }
  );
  return response.json();
}
```

### Refreshing Access Tokens

```typescript
async function refreshAccessToken(refreshToken: string): Promise<SentryTokens> {
  const response = await fetch(SENTRY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });

  if (!response.ok) {
    throw new Error("Token refresh failed - re-authentication required");
  }

  return response.json();
}
```

### Using Access Tokens with SDK

```typescript
// For server-side event ingestion with OAuth token
import * as Sentry from "@sentry/<your-platform>";

Sentry.init({
  // No DSN needed when using auth token directly
  // But you can still use DSN for convenience
  dsn: process.env.SENTRY_DSN,
  
  // Custom transport to add OAuth token
  transport: (options) => {
    return {
      sendEvent: async (event) => {
        const token = await getAccessToken();
        const response = await fetch(options.url, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
            "User-Agent": options.headers["User-Agent"],
          },
          body: JSON.stringify(event),
        });
        return response.json();
      },
    };
  },
});
```

---

## Comparison Matrix

| Feature | None (DSN) | OIDC | OAuth2 |
|---------|------------|------|--------|
| **User Authentication** | ❌ | ✅ | ✅ (via your app) |
| **SSO Support** | ❌ | ✅ | ❌ |
| **API Access** | ❌ (ingestion only) | ❌ | ✅ Full API |
| **Delegated Access** | ❌ | ❌ | ✅ |
| **Token Expiry** | N/A | Session-based | Access: 1h, Refresh: 90d |
| **Revocation** | DSN rotation | IdP session | Token revocation |
| **Audit Trail** | Limited | IdP logs | Sentry audit log |
| **Setup Complexity** | Low | Medium | Medium-High |

---

## Choosing the Right Method

```
┌─────────────────────────────────────────────────────────────┐
│                    Decision Tree                            │
└─────────────────────────────────────────────────────────────┘

Need user login to Sentry UI?
  │
  ├─ YES → Use OIDC (configure IdP in Sentry server)
  │
  └─ NO → Need programmatic API access?
            │
            ├─ YES → Use OAuth2 (register OAuth app)
            │         ├─ Server-to-server? → Client Credentials
            │         ├─ User-facing app? → Authorization Code + PKCE
            │         └─ CLI/Device? → Device Code
            │
            └─ NO → Just sending events?
                      │
                      └─ YES → Use DSN (None)
```

---

## Security Best Practices

### For All Methods

- ✅ **Rotate secrets regularly** (DSN, client secrets, tokens)
- ✅ **Use minimal scopes** — only request what you need
- ✅ **Store tokens encrypted** — never in plain text
- ✅ **Implement token refresh** — handle expiry gracefully
- ✅ **Monitor audit logs** — watch for unusual activity
- ✅ **Use HTTPS everywhere** — enforce TLS 1.2+

### For OIDC

- ✅ **Validate ID tokens** — verify signature, issuer, audience, expiry
- ✅ **Use nonce** — prevent replay attacks
- ✅ **Map groups carefully** — principle of least privilege
- ✅ **Enable MFA** — at the IdP level

### For OAuth2

- ✅ **Use PKCE** — mandatory for public clients (SPAs, mobile)
- ✅ **Validate state parameter** — prevent CSRF
- ✅ **Store refresh tokens securely** — encrypt at rest
- ✅ **Implement token revocation** — on logout, permission change
- ✅ **Use short-lived access tokens** — 1 hour default

---

## Migration Guide

### From DSN to OAuth2 (Server-to-Server)

```typescript
// Before: DSN-only
Sentry.init({ dsn: "https://key@sentry.io/123" });

// After: OAuth2 Client Credentials
const transport = createOAuthTransport({
  clientId: process.env.SENTRY_CLIENT_ID,
  clientSecret: process.env.SENTRY_CLIENT_SECRET,
  scopes: ["event:write"],
});

Sentry.init({ transport });
```

### From Custom Auth to OIDC

1. Configure IdP (Okta, Auth0, etc.)
2. Add OIDC provider to Sentry server config
3. Test with a pilot group
4. Roll out to all users
5. Disable legacy auth methods

---

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| `invalid_grant` | Expired/invalid refresh token | Re-run authorization flow |
| `invalid_scope` | Scope not granted | Re-authorize with correct scopes |
| `redirect_uri_mismatch` | URI doesn't match registration | Update OAuth app or use exact URI |
| `unauthorized_client` | Client not allowed for flow | Check client type (confidential/public) |
| OIDC: `issuer mismatch` | Wrong issuer URL | Verify issuer matches IdP exactly |
| OIDC: `claims missing` | IdP not sending required claims | Configure IdP to send email, profile |

---

## Quick Reference

```typescript
// Environment variables needed
SENTRY_DSN="https://public@sentry.io/123"           // DSN (None)
SENTRY_AUTH_TOKEN="sntrys_..."                       // Auth token (legacy)
SENTRY_CLIENT_ID="oauth-client-id"                   // OAuth2
SENTRY_CLIENT_SECRET="oauth-client-secret"           // OAuth2
SENTRY_REDIRECT_URI="https://app.com/callback"       // OAuth2
OIDC_ISSUER_URL="https://your-domain.okta.com"       // OIDC
OIDC_CLIENT_ID="oidc-client-id"                      // OIDC
OIDC_CLIENT_SECRET="oidc-client-secret"              // OIDC
```

---

## Related Documentation

- [Sentry Self-Hosted Auth Configuration](https://docs.sentry.io/self-hosted/auth/)
- [OAuth2 API Reference](https://docs.sentry.io/api/auth/oauth2/)
- [OIDC Integration Guide](https://docs.sentry.io/product/auth/oidc/)
- [SDK Configuration](https://docs.sentry.io/platforms/)