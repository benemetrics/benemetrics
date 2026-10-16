import { edenTreaty } from '@elysiajs/eden';
import type { App } from '../../../backend/index';

// Admin auth token, configured in the sidebar and persisted in localStorage.
// There is no built-in fallback: without a token the admin API answers 401
// until one is set (or ADMIN_TOKEN is configured server-side).
const ADMIN_TOKEN_KEY = 'benedebug.adminToken';
const LEGACY_ADMIN_TOKEN_KEY = 'benemetrics.adminToken';

export function getAdminToken(): string {
  try {
    return (
      localStorage.getItem(ADMIN_TOKEN_KEY) ??
      localStorage.getItem(LEGACY_ADMIN_TOKEN_KEY) ??
      ''
    );
  } catch {
    return '';
  }
}

export function setAdminToken(token: string) {
  try {
    localStorage.setItem(ADMIN_TOKEN_KEY, token);
    localStorage.removeItem(LEGACY_ADMIN_TOKEN_KEY);
  } catch {
    // ignore storage failures
  }
}

// Every request through Eden carries the admin token, so call sites never
// pass `$headers`; pages call the treaty directly for plain CRUD
// (`api.api.admin.releases.get()`). Only helpers that add real logic live in
// this module. `ingestEnvelope` authenticates with the DSN instead and is
// intentionally not routed through this client.
//
// In Bun's fullstack dev server, frontend and API share the same origin.
// The UI is served under /ui, so use the origin as base so API paths
// (/events, /api/...) resolve at the root, not relative to /ui.
//
// NOTE: Eden's generics only stay useful when routes annotate their
// responses; without those annotations response data degrades to `{}` and
// callers need casts. Kept as `any` until the backend routes carry response
// schemas.
const authedFetch = ((input: string | URL | Request, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  const token = getAdminToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}) as typeof fetch;

export const api = edenTreaty<App>(window.location.origin, { fetcher: authedFetch }) as any;

/** Upper bound for client-side aggregations (dashboard counts and charts). */
export const AGGREGATE_EVENT_LIMIT = 200;

// List stored events. Only defined query params are sent: Eden serializes
// `undefined` values as the literal string "undefined".
export async function listEvents(params: {
  projectId?: string;
  environmentId?: string;
  appId?: string;
  page?: number;
  limit?: number;
} = {}) {
  const query: Record<string, string | number> = {};
  if (params.projectId) query.projectId = params.projectId;
  if (params.environmentId) query.environmentId = params.environmentId;
  if (params.appId) query.appId = params.appId;
  if (params.page) query.page = params.page;
  if (params.limit) query.limit = params.limit;
  const response =
    Object.keys(query).length > 0
      ? await api.events.get({ $query: query })
      : await api.events.get();
  return response;
}

export interface AdminProfileDto {
  id: string;
  email: string;
  name: string;
  roles: string[];
}

// Projects & Apps (admin)

export interface AppDto {
  id: string;
  projectId: string;
  environmentId: string;
  name: string;
  platform: string;
  ingestKey: string;
  dsn: string;
  publicKey: string;
  host: string;
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

// Raw Sentry envelope ingestion (DSN auth, not the admin token).
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

// Releases (admin)

export interface ReleaseDto {
  id: string;
  appId: string;
  version: string;
  ref: string | null;
  url: string | null;
  owner: string | null;
  status: string;
  firstSeen: string;
  lastSeen: string;
  eventCount: number;
  latestEventId: string | null;
  createdAt: string;
  updatedAt: string;
}

// Alerting (admin)

export interface AlertChannelDto {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  appId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlertRuleDto {
  id: string;
  name: string;
  trigger: string;
  metric: string | null;
  operator: string | null;
  threshold: number | null;
  windowSeconds: number | null;
  cooldownSeconds: number;
  channelIds: string[];
  measurement: string | null;
  appId: string | null;
  isEnabled: boolean;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlertIncidentDto {
  id: string;
  ruleId: string;
  appId: string | null;
  trigger: string;
  metric: string | null;
  value: number | null;
  threshold: number | null;
  issueFingerprint: string | null;
  status: string;
  triggeredAt: string;
  resolvedAt: string | null;
}

// Environments (admin)

export interface EnvironmentDto {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

// Returns null on error so the workspace can keep its last environment list.
export async function listEnvironments(
  projectId: string,
): Promise<{ data: EnvironmentDto[]; pagination: unknown } | null> {
  try {
    const response = await api.api.admin.environments.get({
      $query: { projectId },
    });
    if (response?.error) return null;
    return response?.data ?? null;
  } catch {
    return null;
  }
}

// Segments (admin) — reusable targeting rule sets for feature flags.
// The backend parses the JSON `rules` column before returning it.

export interface SegmentDto {
  id: string;
  name: string;
  description: string;
  rules: Array<Record<string, unknown>>;
  userCount: number;
  createdAt: string;
  updatedAt: string;
}

// Releases (admin) — summary adds computed issue metrics.

export interface ReleaseIssueDto {
  fingerprint: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  isNew: boolean;
  isRegressed: boolean;
}

export interface ReleaseSummaryDto extends ReleaseDto {
  issueCount: number;
  newIssueCount: number;
  regressedIssueCount: number;
  issues: ReleaseIssueDto[];
}

// Source-map upload tokens (admin). The raw token is returned exactly
// once, at creation or rotation; list/get only expose the prefix.

export interface SourceMapTokenDto {
  id: string;
  name: string;
  projectId: string;
  appId: string;
  environmentId: string;
  tokenPrefix: string;
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface SourceMapTokenSecretDto extends SourceMapTokenDto {
  token: string;
}

// Uploaded source-map artifacts (admin). Uploads themselves go through
// the sentry-cli-compatible ingestion API, not this surface.

export interface SourceMapArtifactDto {
  id: string;
  projectId: string;
  appId: string;
  environmentId: string;
  release: string;
  dist: string | null;
  name: string;
  size: number;
  createdAt: string;
}

export interface SourceMapResolveResultDto {
  filename: string;
  release: string;
  line: number;
  column: number;
  original: {
    source: string;
    line: number;
    column: number;
    contextLine: string | null;
    preContext: string[];
    postContext: string[];
  } | null;
}
