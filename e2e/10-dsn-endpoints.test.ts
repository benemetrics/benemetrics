/**
 * E2E Test: DSN Creation Endpoints (10-admin.md)
 * 
 * Tests the DSN creation API endpoints from the admin documentation.
 * Starts a real server on an ephemeral port for testing.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import app from "../backend/index";

let baseUrl = "";
let server: any;

const TEST_DSN = "https://test-key@localhost:31337/123";

interface DsnResponse {
  dsn: string;
  projectId: string;
  publicKey: string;
  host: string;
  protocol: string;
}

async function apiRequest(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>
): Promise<Response> {
  const url = new URL(`${baseUrl}${path}`);
  url.searchParams.set("sentry_key", "test-key");
  
  const options: RequestInit = {
    method,
    headers: { 
      "Content-Type": "application/json",
      Authorization: "Bearer e2e-admin-token",
      ...headers 
    },
  };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  return await fetch(url, options);
}

describe("DSN Creation API", () => {
  beforeAll(async () => {
    app.listen(0);
    server = (app as any).server;
    baseUrl = `http://localhost:${server.port}`;
    
    await apiRequest("POST", "/events/clear", {}, { method: "POST" });
  });

  afterAll(async () => {
    await apiRequest("POST", "/events/clear", {}, { method: "POST" });
    server.stop();
  });

  beforeEach(async () => {
    await apiRequest("POST", "/events/clear", {}, { method: "POST" });
  });

  describe("POST /api/dsn/create", () => {
    it("should create a new DSN with specified projectId, host, and publicKey", async () => {
      const projectId = "test-project-123";
      const host = "sentry.example.com";
      const publicKey = "test-public-key-abc123";

      const response = await apiRequest("POST", "/api/dsn/create", {
        projectId,
        host,
        publicKey,
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as DsnResponse;
      expect(data.dsn).toContain("https://");
      expect(data.projectId).toBe(projectId);
      expect(data.publicKey).toBe(publicKey);
      expect(data.host).toBe(host);
      expect(data.protocol).toBe("https");

      const getResponse = await apiRequest("GET", `/api/dsn/${projectId}`);
      expect(getResponse.status).toBe(200);
      const getData = (await getResponse.json()) as DsnResponse;
      expect(getData.dsn).toBe(data.dsn);
      expect(getData.projectId).toBe(projectId);
      expect(getData.publicKey).toBe(publicKey);
    });

    it("should return 400 if projectId is missing", async () => {
      const response = await apiRequest("POST", "/api/dsn/create", {
        host: "sentry.example.com",
      });

      expect(response.status).toBe(400);
    });

    it("should return 400 if host is missing", async () => {
      const response = await apiRequest("POST", "/api/dsn/create", {
        projectId: "test-project",
      });

      expect(response.status).toBe(400);
    });
  });

  describe("GET /api/dsn/:projectId", () => {
    it("should retrieve a DSN that was previously created", async () => {
      const projectId = "test-project-456";
      const host = "sentry.example.com";
      const publicKey = "another-key-xyz789";

      await apiRequest("POST", "/api/dsn/create", {
        projectId,
        host,
        publicKey,
      });

      const response = await apiRequest("GET", `/api/dsn/${projectId}`);
      expect(response.status).toBe(200);
      const data = (await response.json()) as DsnResponse;
      expect(data.dsn).toContain("https://");
      expect(data.projectId).toBe(projectId);
      expect(data.publicKey).toBe(publicKey);
      expect(data.host).toBe(host);
    });

    it("should return 404 for non-existent project", async () => {
      const response = await apiRequest("GET", "/api/dsn/non-existent-project");
      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/dsn/generate", () => {
    it("should generate a new DSN with a random public key", async () => {
      const projectId = "test-project-789";
      const host = "sentry.example.com";

      const response = await apiRequest("POST", "/api/dsn/generate", {
        projectId,
        host,
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as DsnResponse;
      expect(data.dsn).toContain("https://");
      expect(data.publicKey).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(data.publicKey.length).toBeGreaterThan(0);
      expect(data.projectId).toBe(projectId);
      expect(data.host).toBe(host);
      expect(data.protocol).toBe("https");

      const getResponse = await apiRequest("GET", `/api/dsn/${projectId}`);
      expect(getResponse.status).toBe(200);
      const getData = (await getResponse.json()) as DsnResponse;
      expect(getData.dsn).toBe(data.dsn);
    });

    it("should return 400 if projectId is missing", async () => {
      const response = await apiRequest("POST", "/api/dsn/generate", {
        host: "sentry.example.com",
      });

      expect(response.status).toBe(400);
    });

    it("should return 400 if host is missing", async () => {
      const response = await apiRequest("POST", "/api/dsn/generate", {
        projectId: "test-project",
      });

      expect(response.status).toBe(400);
    });

    it("should generate a different DSN than the one created with a specific key", async () => {
      const projectId = "test-project-random";
      const host = "sentry.example.com";

      await apiRequest("POST", "/api/dsn/create", {
        projectId,
        host,
        publicKey: "specific-key-123",
      });

      const generateResponse = await apiRequest("POST", "/api/dsn/generate", {
        projectId,
        host,
      });

      const generateData = (await generateResponse.json()) as DsnResponse;
      expect(generateData.publicKey).not.toBe("specific-key-123");
    });
  });
});