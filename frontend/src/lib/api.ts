import { edenTreaty } from '@elysiajs/eden';
import type { App } from '../../../backend-backup/index';

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
  return fetch(input, { ...init, headers }).then((response) => {
    if (response.status === 401) {
      // The credential was rejected (missing/invalid token, or an
      // identity-provider user without a read grant): the shell listens
      // for this to show the admin-token prompt.
      try {
        window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
      } catch {
        // non-browser context — nothing to notify
      }
    }
    return response;
  });
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

/** Dispatched on any 401 so the shell can prompt for the admin token. */
export const AUTH_REQUIRED_EVENT = 'benedebug:auth-required';

// The signed-in identity is derived locally from the stored credential —
// there is no profile endpoint. A JWT issued by the identity provider
// carries the name/email/groups claims; the admin token has no identity,
// so it shows as "Admin by token". Identity-provider identities are
// always read-only: every write and management surface stays behind the
// admin token server-side.
export interface ViewerProfile {
  kind: 'admin' | 'user';
  readOnly: boolean;
  name: string;
  email: string;
  groups: string[];
}

function decodeBase64UrlJson(value: string): Record<string, unknown> | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function claimString(claims: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = claims[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function claimGroups(claims: Record<string, unknown>): string[] {
  const value = claims.groups;
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }
  if (typeof value === 'string') return value.split(/[,\s]+/).filter(Boolean);
  return [];
}

/** The identity for the stored credential, or null when none is set. */
export function viewerProfile(): ViewerProfile | null {
  const token = getAdminToken().trim();
  if (!token) return null;

  // A JWT (three parts with a JSON header + claims) is an
  // identity-provider token; anything else is the admin token.
  const parts = token.split('.');
  if (parts.length === 3) {
    const header = decodeBase64UrlJson(parts[0]!);
    const claims = decodeBase64UrlJson(parts[1]!);
    if (header && typeof header.alg === 'string' && claims) {
      const email = claimString(claims, 'email', 'preferred_username', 'upn', 'sub');
      const name =
        claimString(claims, 'name') || email.split('@')[0] || 'Signed in';
      return {
        kind: 'user',
        readOnly: true,
        name,
        email,
        groups: claimGroups(claims),
      };
    }
  }

  return {
    kind: 'admin',
    readOnly: false,
    name: 'Admin by token',
    email: '',
    groups: [],
  };
}

// Read permissions for OIDC users (admin-token-only management surface).

export interface PermissionRuleDto {
  id: string;
  groupName: string;
  environments: string[];
  appPrefixes: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PermissionUserDto {
  id: string;
  email: string;
  environments: string[];
  appPrefixes: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

// Settings (admin) — the ClickHouse events table declares its own retention
// TTL; the API reads it back from the table definition and rewrites it with
// ALTER ... MODIFY TTL. Admin-token-only, like the rest of Settings.

export type EventsTtlUnit =
  | 'SECOND'
  | 'MINUTE'
  | 'HOUR'
  | 'DAY'
  | 'WEEK'
  | 'MONTH'
  | 'YEAR';

export interface EventsTtlDto {
  table: string;
  expression: string | null;
  interval: { amount: number; unit: EventsTtlUnit } | null;
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

// Issues (admin) — derived at ingestion (they drive the issue alert
// triggers); resolving one arms the "regression" trigger for its next
// occurrence.

export interface IssueDto {
  id: string;
  appId: string;
  fingerprint: string;
  title: string;
  status: "unresolved" | "resolved";
  eventCount: number;
  firstSeen: string;
  lastSeen: string;
  latestEventId: string | null;
  createdAt: string;
  updatedAt: string;
}

// List issues. Only defined query params are sent: Eden serializes
// `undefined` values as the literal string "undefined".
export async function listIssues(params: {
  appId?: string;
  projectId?: string;
  status?: "unresolved" | "resolved";
  q?: string;
  page?: number;
  limit?: number;
} = {}) {
  const query: Record<string, string | number> = {};
  if (params.appId) query.appId = params.appId;
  if (params.projectId) query.projectId = params.projectId;
  if (params.status) query.status = params.status;
  if (params.q) query.q = params.q;
  if (params.page) query.page = params.page;
  if (params.limit) query.limit = params.limit;
  const response =
    Object.keys(query).length > 0
      ? await api.api.admin.issues.get({ $query: query })
      : await api.api.admin.issues.get();
  return response;
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
  createdAt: string;
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
