import { edenTreaty } from '@elysiajs/eden';
import type { App } from '../../../backend/index';

// In Bun's fullstack dev server, frontend and API share the same origin.
// The UI is served under /ui, so use the origin as base so API paths
// (/events, /api/...) resolve at the root, not relative to /ui.
export const api = edenTreaty<App>(window.location.origin) as any;

export type { App } from '../../../backend/index';

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

// Admin auth token for the built-in admin panel. In production this should
// come from the OAuth2/OIDC flow; for now it is configurable via localStorage
// with a dev fallback accepted by the backend's mock validator.
export function getAdminToken(): string {
  try {
    return localStorage.getItem('benemetrics.adminToken') ?? 'admin-panel-ui';
  } catch {
    return 'admin-panel-ui';
  }
}

export function setAdminToken(token: string) {
  try {
    localStorage.setItem('benemetrics.adminToken', token);
  } catch {
    // ignore storage failures
  }
}

const adminHeaders = (): Record<string, string> => ({
  Authorization: `Bearer ${getAdminToken()}`,
});

// Eden treaty v1 option shapes:
//  - no-body methods (get/delete): options go in the FIRST arg as { $headers }
//  - body methods (post/patch/put): body first, config second as { headers }
export async function createFeatureFlag(data: any) {
  const response = await api.api.admin['feature-flags'].post(data, { headers: adminHeaders() });
  return response;
}

export async function listFeatureFlags() {
  const response = await api.api.admin['feature-flags'].get({ $headers: adminHeaders() });
  return response;
}

export async function getFeatureFlag(id: string) {
  const response = await api.api.admin['feature-flags'][id].get({ $headers: adminHeaders() });
  return response;
}

export async function updateFeatureFlag(id: string, data: any) {
  const response = await api.api.admin['feature-flags'][id].patch(data, { headers: adminHeaders() });
  return response;
}

export async function updateFeatureFlagStatus(id: string, data: { status: string }) {
  const response = await api.api.admin['feature-flags'][id].status.post(data, { headers: adminHeaders() });
  return response;
}

export async function deleteFeatureFlag(id: string) {
  const response = await api.api.admin['feature-flags'][id].delete({ $headers: adminHeaders() });
  return response;
}

export async function createSegment(data: { name: string; description?: string; rules: any[] }) {
  const response = await api.api.admin.segments.post(data, { headers: adminHeaders() });
  return response;
}

export async function listSegments() {
  const response = await api.api.admin.segments.get({ $headers: adminHeaders() });
  return response;
}

export async function getSegment(id: string) {
  const response = await api.api.admin.segments[id].get({ $headers: adminHeaders() });
  return response;
}

// Projects & Apps (admin)

export interface AppDto {
  id: string;
  projectId: string;
  name: string;
  platform: string;
  ingestKey: string;
  dsn: string;
  publicKey: string;
  host: string;
  protocol: string;
  createdAt: string;
}

export interface ProjectDto {
  id: string;
  name: string;
  slug: string;
  description: string;
  appCount: number;
  createdAt: string;
}

export interface ProjectDetailDto extends ProjectDto {
  apps: AppDto[];
}

export async function createProject(data: { name: string; slug?: string; description?: string }) {
  const response = await api.api.admin.projects.post(data, { headers: adminHeaders() });
  return response;
}

export async function listProjects() {
  const response = await api.api.admin.projects.get({ $headers: adminHeaders() });
  return response;
}

export async function getProject(id: string) {
  const response = await api.api.admin.projects[id].get({ $headers: adminHeaders() });
  return response;
}

export async function deleteProject(id: string) {
  const response = await api.api.admin.projects[id].delete({ $headers: adminHeaders() });
  return response;
}

export async function createApp(projectId: string, data: { name: string; platform?: string; host?: string }) {
  const response = await api.api.admin.projects[projectId].apps.post(data, { headers: adminHeaders() });
  return response;
}

export async function listApps(projectId: string) {
  const response = await api.api.admin.projects[projectId].apps.get({ $headers: adminHeaders() });
  return response;
}

export async function getApp(appId: string) {
  const response = await api.api.admin.apps[appId].get({ $headers: adminHeaders() });
  return response;
}

export async function deleteApp(appId: string) {
  const response = await api.api.admin.apps[appId].delete({ $headers: adminHeaders() });
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