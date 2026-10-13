import { edenTreaty } from '@elysiajs/eden';
import type { App } from '../../backend/index';

// In Bun's fullstack dev server, frontend and API share the same origin
// Use relative URL so edenTreaty uses the current origin
export const api = edenTreaty<App>('');

export type { App } from '../../backend/index';

export async function checkHealth() {
  const response = await api.health.get();
  return response;
}

export async function listEvents() {
  const response = await api.events.get();
  return response;
}

export async function clearEvents() {
  const response = await api.events.clear.post();
  return response;
}

export async function getEvent(eventId: string) {
  const response = await api.events[eventId].get();
  return response;
}

export async function createDsn(data: { projectId: string; host: string; publicKey?: string }) {
  const response = await api.api.dsn.create.post(data);
  return response;
}

export async function getDsn(projectId: string) {
  const response = await api.api.dsn[projectId].get();
  return response;
}

export async function generateDsn(data: { projectId: string; host: string }) {
  const response = await api.api.dsn.generate.post(data);
  return response;
}

export async function evaluateFeatureFlags(data: { user: { id: string; email?: string; name?: string; attributes?: Record<string, any> }; flags: string[]; context?: Record<string, any> }) {
  const response = await api.api['feature-flags'].evaluate.post(data);
  return response;
}

export async function createFeatureFlag(data: any) {
  const response = await api.api.admin['feature-flags'].post(data);
  return response;
}

export async function listFeatureFlags() {
  const response = await api.api.admin['feature-flags'].get();
  return response;
}

export async function getFeatureFlag(id: string) {
  const response = await api.api.admin['feature-flags'][id].get();
  return response;
}

export async function updateFeatureFlag(id: string, data: any) {
  const response = await api.api.admin['feature-flags'][id].patch(data);
  return response;
}

export async function updateFeatureFlagStatus(id: string, data: { status: string }) {
  const response = await api.api.admin['feature-flags'][id].status.post(data);
  return response;
}

export async function deleteFeatureFlag(id: string) {
  const response = await api.api.admin['feature-flags'][id].delete();
  return response;
}

export async function createSegment(data: { name: string; description?: string; rules: any[] }) {
  const response = await api.api.admin.segments.post(data);
  return response;
}

export async function listSegments() {
  const response = await api.api.admin.segments.get();
  return response;
}

export async function getSegment(id: string) {
  const response = await api.api.admin.segments[id].get();
  return response;
}

export async function ingestEnvelope(projectId: string, body: string, headers: Record<string, string> = {}) {
  const response = await fetch(`/api/${projectId}/envelope/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body,
  });
  return response.json();
}

export async function ingestStore(projectId: string, body: any, headers: Record<string, string> = {}) {
  const response = await fetch(`/api/${projectId}/store/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
  return response.json();
}