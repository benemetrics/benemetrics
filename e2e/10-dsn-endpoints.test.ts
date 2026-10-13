/**
 * E2E Test: DSN Creation Endpoints (10-admin.md)
 * 
 * Tests the DSN creation API endpoints from the admin documentation.
 * Uses the Elysia way of running the API without attaching to a port.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import app from "../backend/index";

const SERVER_URL = "http://localhost:31337";

// Test DSN for authentication
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
  // Add DSN authentication
  const url = new URL(`${SERVER_URL}${path}`);
  url.searchParams.set("sentry_key", "test-key");
  
  const options: RequestInit = {
    method,
    headers: { 
      "Content-Type": "application/json",
      ...headers 
    },
  };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  return await app.handle(new Request(url, options));
}

describe("DSN Creation API", () => {
  beforeAll(async () => {
    await app.handle(new Request(`${SERVER_URL}/events/clear`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }));
  });

  afterAll(async () => {
    await app.handle(new Request(`${SERVER_URL}/events/clear`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }));
  });

  beforeEach(async () => {
    await app.handle(new Request(`${SERVER_URL}/events/clear`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }));
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

      // Verify the DSN can be retrieved
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
        // missing projectId
      });

      expect(response.status).toBe(400);
    });

    it("should return 400 if host is missing", async () => {
      const response = await apiRequest("POST", "/api/dsn/create", {
        projectId: "test-project",
        // missing host
      });

      expect(response.status).toBe(400);
    });
  });

  describe("GET /api/dsn/:projectId", () => {
    it("should retrieve a DSN that was previously created", async () => {
      const projectId = "test-project-456";
      const host = "sentry.example.com";
      const publicKey = "another-key-xyz789";

      // Create first
      await apiRequest("POST", "/api/dsn/create", {
        projectId,
        host,
        publicKey,
      });

      // Then retrieve
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

      // Verify the DSN can be retrieved
      const getResponse = await apiRequest("GET", `/api/dsn/${projectId}`);
      expect(getResponse.status).toBe(200);
      const getData = (await getResponse.json()) as DsnResponse;
      expect(getData.dsn).toBe(data.dsn);
    });

    it("should return 400 if projectId is missing", async () => {
      const response = await apiRequest("POST", "/api/dsn/generate", {
        host: "sentry.example.com",
        // missing projectId
      });

      expect(response.status).toBe(400);
    });

    it("should return 400 if host is missing", async () => {
      const response = await apiRequest("POST", "/api/dsn/generate", {
        projectId: "test-project",
        // missing host
      });

      expect(response.status).toBe(400);
    });

    it("should generate a different DSN than the one created with a specific key", async () => {
      const projectId = "test-project-random";
      const host = "sentry.example.com";

      // Create with specific key
      await apiRequest("POST", "/api/dsn/create", {
        projectId,
        host,
        publicKey: "specific-key-123",
      });

      // Generate with random key
      const generateResponse = await apiRequest("POST", "/api/dsn/generate", {
        projectId,
        host,
      });

      const generateData = (await generateResponse.json()) as DsnResponse;
      expect(generateData.publicKey).not.toBe("specific-key-123");
    });
  });
});