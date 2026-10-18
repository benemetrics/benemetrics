import { app } from "../backend/index.ts";
import { getDb } from "../db/index.ts";

export async function handleFetch(input: string | Request, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : new Request(input, {
    ...init,
    headers: {
      Host: "localhost",
      ...init?.headers,
    },
  });
  return app.handle(request);
}

export function startTestApp() {
  // App is already started via bootstrap in index.ts
  return app;
}

export async function waitFor(fn: () => Promise<boolean>, timeoutMs = 5000, intervalMs = 50): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error("waitFor timeout");
}