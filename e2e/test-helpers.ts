/**
 * Shared e2e helpers.
 *
 * Starts the real backend on an ephemeral port and provisions a project +
 * app through the admin API. Ingestion never auto-creates apps anymore, so
 * SDK-based tests need a real DSN.
 */

import app from "../backend/index";

const ADMIN_HEADERS = {
  "Content-Type": "application/json",
  Authorization: "Bearer e2e-admin-token",
};

export interface TestServer {
  baseUrl: string;
  dsn: string;
  projectId: string;
  appId: string;
  stop: () => void;
}

export async function startTestServer(): Promise<TestServer> {
  app.listen(0);
  const server = (app as any).server;
  const baseUrl = `http://localhost:${server.port}`;

  const projectResponse = await fetch(`${baseUrl}/api/admin/projects`, {
    method: "POST",
    headers: ADMIN_HEADERS,
    body: JSON.stringify({ name: `E2E Project ${crypto.randomUUID().slice(0, 8)}` }),
  });
  if (!projectResponse.ok) {
    throw new Error(`Failed to create test project: ${projectResponse.status}`);
  }
  const project = (await projectResponse.json()) as { id: string };

  const appResponse = await fetch(`${baseUrl}/api/admin/projects/${project.id}/apps`, {
    method: "POST",
    headers: ADMIN_HEADERS,
    body: JSON.stringify({ name: "E2E App" }),
  });
  if (!appResponse.ok) {
    throw new Error(`Failed to create test app: ${appResponse.status}`);
  }
  const created = (await appResponse.json()) as {
    id: string;
    dsn: string;
    publicKey: string;
  };

  // Sentry SDKs reject non-numeric DSN project ids, so the SDK-facing DSN
  // uses a numeric placeholder path; the server resolves the app from the
  // (globally unique) public key in the DSN.
  const dsnUrl = new URL(created.dsn);
  dsnUrl.pathname = "/1";

  return {
    baseUrl,
    dsn: dsnUrl.toString(),
    projectId: project.id,
    appId: created.id,
    stop: () => server?.stop(true),
  };
}
