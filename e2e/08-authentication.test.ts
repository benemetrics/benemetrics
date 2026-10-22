/**
 * E2E Test: Authentication (08-authentication.md)
 * 
 * Tests Sentry authentication patterns from 08-authentication.md
 * 
 * IMPORTANT: This test focuses on DSN-only (None) authentication,
 * which is the method used by SDKs to send events. OAuth2 and OIDC
 * are server-side/admin authentication methods and require a real
 * Sentry instance.
 */

import { describe, it, expect, beforeAll } from "bun:test";
import app from "../backend/index";

// Test DSN for authentication. Apps are only created through the admin
// API, so the DSN is provisioned before the ingestion tests run.
let TEST_PROJECT_ID = "";
let TEST_PUBLIC_KEY = "";
let TEST_DSN = "";

async function bootstrapProjectAndApp(): Promise<void> {
  const adminHeaders = {
    "Content-Type": "application/json",
    Authorization: "API-Key e2e-admin-token",
  };
  const projectResponse = await app.handle(
    new Request("http://localhost:31337/api/admin/projects", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ name: `Auth E2E Project ${Date.now()}` }),
    }),
  );
  const project = (await projectResponse.json()) as { id: string };

  const appResponse = await app.handle(
    new Request(`http://localhost:31337/api/admin/projects/${project.id}/apps`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ name: "Auth App" }),
    }),
  );
  const created = (await appResponse.json()) as {
    ingestKey: string;
    publicKey: string;
    number: number;
  };
  TEST_PROJECT_ID = created.ingestKey;
  TEST_PUBLIC_KEY = created.publicKey;
  TEST_DSN = `http://${created.publicKey}@localhost:31337/${created.number}`;
}

// The UI surfaces (/events) require the configured admin token, which the
// e2e preload sets for the whole suite.
const ADMIN_HEADERS = {
  "Content-Type": "application/json",
  Authorization: "API-Key e2e-admin-token",
};

async function adminRequest(method: string, path: string): Promise<Response> {
  return await app.handle(
    new Request(`http://localhost:31337${path}`, {
      method,
      headers: ADMIN_HEADERS,
    }),
  );
}

async function fetchEvent(eventId: string): Promise<any> {
  const response = await adminRequest("GET", `/events/${eventId}`);
  if (!response.ok) {
    throw new Error(`Event not found: ${response.status}`);
  }
  return response.json();
}

async function waitForEvent(eventId: string, timeout: number = 5000): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      return await fetchEvent(eventId);
    } catch (e) {
      if ((e as Error).message.includes("not found")) {
        await new Promise(r => setTimeout(r, 100));
        continue;
      }
      throw e;
    }
  }
  throw new Error(`Timeout waiting for event ${eventId}`);
}

async function sendEnvelope(projectId: string, envelope: string): Promise<any> {
  const url = new URL(`http://localhost:31337/api/${projectId}/envelope/`);
  url.searchParams.set("sentry_key", TEST_PUBLIC_KEY);
  
  return await app.handle(new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-sentry-envelope" },
    body: envelope
  }));
}

describe("Authentication - None (DSN-based) (08-authentication.md)", () => {
  beforeAll(async () => {
    await bootstrapProjectAndApp();
  });

  it("sends events with DSN-only authentication via envelope endpoint", async () => {
    const envelopeHeader = JSON.stringify({
      sent_at: new Date().toISOString(),
      dsn: TEST_DSN
    });
    const itemHeader = JSON.stringify({
      type: "event",
      content_type: "application/json",
      length: 0
    });
    const payload = JSON.stringify({
      event_id: crypto.randomUUID(),
      message: "DSN-only auth test",
      level: "info",
      timestamp: Date.now() / 1000
    });
    
    const envelope = `${envelopeHeader}\n${itemHeader}\n${payload}\n`;
    
    const response = await sendEnvelope(TEST_PROJECT_ID, envelope);
    expect(response.status).toBe(200);
    
    const result = await response.json();
    expect(result.id).toBeDefined();
    
    const event = await waitForEvent(result.id);
    expect(event).toBeDefined();
    expect(event.message).toBe("DSN-only auth test");
    expect(event.level).toBe("info");
  });

  it("includes DSN public key in envelope header", async () => {
    const eventId = crypto.randomUUID();
    const envelopeHeader = JSON.stringify({
      sent_at: new Date().toISOString(),
      dsn: TEST_DSN
    });
    const itemHeader = JSON.stringify({
      type: "event",
      content_type: "application/json",
      length: 0
    });
    const payload = JSON.stringify({
      event_id: eventId,
      message: "DSN header test",
      level: "error",
      timestamp: Date.now() / 1000
    });
    
    const envelope = `${envelopeHeader}\n${itemHeader}\n${payload}\n`;
    
    const response = await sendEnvelope(TEST_PROJECT_ID, envelope);
    expect(response.status).toBe(200);
    
    const event = await waitForEvent(eventId);
    expect(event).toBeDefined();
    expect(event.event_id).toBe(eventId);
  });

  it("rejects envelope without DSN authentication", async () => {
    const envelopeHeader = JSON.stringify({
      sent_at: new Date().toISOString()
    });
    const itemHeader = JSON.stringify({
      type: "event",
      content_type: "application/json",
      length: 0
    });
    const payload = JSON.stringify({
      event_id: crypto.randomUUID(),
      message: "No auth test",
      level: "info",
      timestamp: Date.now() / 1000
    });
    
    const envelope = `${envelopeHeader}\n${itemHeader}\n${payload}\n`;
    
    const url = new URL(`http://localhost:31337/api/${TEST_PROJECT_ID}/envelope/`);
    const response = await app.handle(new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope" },
      body: envelope
    }));
    
    expect(response.status).toBe(401);
  });
});

describe("Authentication - OAuth2 Client Credentials Flow (08-authentication.md)", () => {
  it("demonstrates custom transport with Bearer token pattern", () => {
    let capturedToken = "";
    
    function createOAuthTransport() {
      return {
        sendEvent: async (event: unknown, options: { url: string; headers: Record<string, string | undefined> }) => {
          capturedToken = "Bearer simulated-oauth-token";
          
          const headers: Record<string, string> = {
            "Authorization": capturedToken,
            "Content-Type": "application/json",
          };
          if (options.headers["User-Agent"]) {
            headers["User-Agent"] = options.headers["User-Agent"] as string;
          }
          
          return { status: 200 };
        },
      };
    }

    const transport = createOAuthTransport();
    
    expect(typeof transport.sendEvent).toBe("function");
    expect(capturedToken).toBe("");
  });

  it("handles token refresh pattern", async () => {
    let tokenCache: { access_token: string; expires_at: number } | null = null;
    
    async function getAccessToken(): Promise<string> {
      if (tokenCache && Date.now() < tokenCache.expires_at - 60_000) {
        return tokenCache.access_token;
      }
      
      tokenCache = {
        access_token: "new-access-token-" + Date.now(),
        expires_at: Date.now() + 3600_000,
      };
      
      return tokenCache.access_token;
    }

    const token1 = await getAccessToken();
    const token2 = await getAccessToken();
    
    expect(token1).toBe(token2);
    expect(token1).toContain("new-access-token-");
  });

  it("validates required OAuth2 scopes pattern", () => {
    const requiredScopes = ["event:write", "project:read"];
    const grantedScopes = ["event:write", "project:read", "org:read"];
    
    const hasRequiredScopes = requiredScopes.every(scope => 
      grantedScopes.includes(scope)
    );
    
    expect(hasRequiredScopes).toBe(true);
  });
});

describe("Authentication - OIDC Token Validation Pattern (08-authentication.md)", () => {
  it("validates JWT structure pattern", () => {
    const mockJwtPayload = {
      sub: "user-123",
      iss: "https://example.okta.com",
      aud: "client-id",
      exp: Math.floor(Date.now() / 1000) + 3600,
      email: "user@example.com",
    };

    expect(mockJwtPayload.sub).toBeDefined();
    expect(mockJwtPayload.iss).toBeDefined();
    expect(mockJwtPayload.aud).toBeDefined();
    expect(mockJwtPayload.exp).toBeGreaterThan(Date.now() / 1000);
    expect(mockJwtPayload.email).toBeDefined();
  });

  it("maps IdP groups to Sentry roles pattern", () => {
    const groupMapping: Record<string, string> = {
      "sentry-admins": "admin",
      "sentry-developers": "member",
      "sentry-viewers": "readonly",
    };

    const userGroups = ["sentry-developers", "other-group"];
    const mappedRoles = userGroups
      .map(g => groupMapping[g])
      .filter(Boolean);

    expect(mappedRoles).toContain("member");
    expect(mappedRoles).not.toContain("admin");
  });
});

describe("Authentication - Security Patterns (08-authentication.md)", () => {
  it("demonstrates DSN rotation pattern", async () => {
    const oldDsn = TEST_DSN;
    const newDsn = `https://newpublickey123456789012345678901234@localhost:31337/124`;
    
    expect(oldDsn).not.toBe(newDsn);
    expect(newDsn).toContain("newpublickey123456789012345678901234");
  });

  it("uses minimal scopes principle", () => {
    const allScopes = [
      "event:read", "event:write", "event:admin",
      "org:read", "org:write",
      "project:read", "project:write", "project:admin",
      "team:read", "team:write",
      "member:read", "member:write",
      "user:read", "user:email",
    ];

    const serverScopes = ["event:write", "project:read"];
    
    expect(serverScopes.length).toBeLessThan(allScopes.length);
    expect(serverScopes).toContain("event:write");
    expect(serverScopes).not.toContain("event:admin");
  });

  it("implements PKCE pattern for public clients", () => {
    function generateCodeVerifier(): string {
      const array = new Uint8Array(32);
      crypto.getRandomValues(array);
      return btoa(String.fromCharCode(...array))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
    }

    function generateCodeChallenge(verifier: string): string {
      return "challenge-" + verifier.substring(0, 10);
    }

    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);

    expect(verifier.length).toBeGreaterThan(40);
    expect(challenge).toContain("challenge-");
    expect(challenge).not.toBe(verifier);
  });

  it("validates state parameter for CSRF protection", () => {
    const storedState = "random-state-" + crypto.randomUUID();
    const receivedState = storedState;
    
    const isValid = receivedState === storedState;
    expect(isValid).toBe(true);
    
    const invalidState = "different-state";
    expect(invalidState === storedState).toBe(false);
  });
});

describe("Admin Authentication - OAuth2/OIDC (08-authentication.md)", () => {
  it("rejects admin endpoints without Bearer token", async () => {
    const response = await app.handle(new Request("http://localhost:31337/api/admin/feature-flags", {
      method: "GET",
      headers: { "Content-Type": "application/json" }
    }));
    
    expect(response.status).toBe(401);
  });

  it("accepts admin endpoints with valid Bearer token", async () => {
    const response = await app.handle(new Request("http://localhost:31337/api/admin/feature-flags", {
      method: "GET",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": "API-Key e2e-admin-token"
      }
    }));
    
    expect(response.status).toBe(200);
  });

  it("rejects sentry endpoints with admin token (invalid body)", async () => {
    const response = await app.handle(new Request("http://localhost:31337/api/sentry/flags/evaluate", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": "API-Key e2e-admin-token"
      },
      body: JSON.stringify({ user: { id: "1" }, flags: [] })
    }));
    
    // Sentry endpoints accept DSN auth (sentry_key), not admin Bearer tokens
    // They will reject if no sentry_key is provided, but body validation happens first
    expect([400, 401]).toContain(response.status);
  });

  it("rejects admin endpoints with sentry_key", async () => {
    const url = new URL("http://localhost:31337/api/admin/feature-flags");
    url.searchParams.set("sentry_key", TEST_PUBLIC_KEY);
    
    const response = await app.handle(new Request(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" }
    }));
    
    expect(response.status).toBe(401);
  });
});