import { edenTreaty } from '@elysiajs/eden';
import type { App } from '../../../backend/index';

// Admin auth token, configured in the sidebar and persisted in localStorage.
// There is no built-in fallback: without a token the admin API answers 401
// until one is set (or ADMIN_TOKEN is configured server-side).
//
// The first 401 opens the admin-token prompt (`AuthPrompt`), which is how the
// UI recovers when neither a stored token nor a provider identity is present.
export const AUTH_REQUIRED_EVENT = 'benedebug:auth-required';

const ADMIN_TOKEN_KEY = 'benedebug.adminToken';
const LEGACY_ADMIN_TOKEN_KEY = 'benemetrics.adminToken';
const ADMIN_TOKEN_KIND_KEY = 'benedebug.adminTokenKind';

/** The admin token is an API key, a provider identity is a bearer token. */
export type AdminTokenKind = 'admin' | 'oidc';

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

export function getAdminTokenKind(): AdminTokenKind {
  try {
    return localStorage.getItem(ADMIN_TOKEN_KIND_KEY) === 'oidc' ? 'oidc' : 'admin';
  } catch {
    return 'admin';
  }
}

export function setAdminToken(token: string, kind: AdminTokenKind = 'admin') {
  try {
    localStorage.setItem(ADMIN_TOKEN_KEY, token);
    localStorage.setItem(ADMIN_TOKEN_KIND_KEY, kind);
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
  if (token) {
    headers.set(
      'Authorization',
      getAdminTokenKind() === 'oidc' ? `Bearer ${token}` : `API-Key ${token}`,
    );
  }
  return fetch(input, { ...init, headers }).then((response) => {
    if (response.status === 401) {
      window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
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
  cursor?: string;
  limit?: number;
} = {}) {
  const query: Record<string, string | number> = {};
  if (params.projectId) query.projectId = params.projectId;
  if (params.environmentId) query.environmentId = params.environmentId;
  if (params.appId) query.appId = params.appId;
  if (params.cursor) query.cursor = params.cursor;
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
}

const ADMIN_PROFILE: AdminProfileDto = {
  id: "local-admin",
  email: "admin@company.com",
  name: "Admin User",
};

function decodeJwtSegment(segment: string): Record<string, unknown> | null {
  try {
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const payloadPart = parts[1];
  if (!payloadPart) return null;
  return decodeJwtSegment(payloadPart);
}

function decodeJwtHeader(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const headerPart = parts[0];
  if (!headerPart) return null;
  return decodeJwtSegment(headerPart);
}

/**
 * Local display aid. The admin API has no profile endpoint: an opaque admin
 * token maps to the fixed admin identity, while a JWT-shaped token exposes
 * its unverified claims for display. The server remains authoritative.
 */
export function viewerProfile(): AdminProfileDto | null {
  const token = getAdminToken();
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  if (!payload || !decodeJwtHeader(token)) return { ...ADMIN_PROFILE };

  const email = typeof payload.email === "string" ? payload.email : "";
  const name =
    typeof payload.name === "string"
      ? payload.name
      : typeof payload.preferred_username === "string"
        ? payload.preferred_username
        : email.split("@")[0] || "User";

  // The same id the backend resolves: `<issuer>-<subject>`.
  const issuer = typeof payload.iss === "string" ? payload.iss : "";
  const subject = typeof payload.sub === "string" ? payload.sub : "";
  return {
    id: issuer && subject ? `${issuer}-${subject}` : subject || "unknown",
    email,
    name,
  };
}

// Projects & Apps (admin)

export interface AppDto {
  id: string;
  projectId: string;
  environmentId: string;
  name: string;
  platform: string;
  ingestKey: string;
  number: number;
  publicKey: string;
  createdAt: string;
}

// The DSN is composed by the client: the backend stores no host, so the
// same app yields the right DSN for the origin the caller reached.
export function appDsn(
  app: { publicKey: string; number: number },
  origin?: string,
): string {
  const base =
    origin ?? (typeof window === "undefined" ? "http://localhost" : window.location.origin);
  const url = new URL(base);
  return `${url.protocol}//${app.publicKey}@${url.host}/${app.number}`;
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

// Experiments (admin) — statistical analysis of a flag's experiment:
// per-variant participants/conversions, Wilson confidence interval and
// two-proportion z-test p-value, plus the recommendation.
export interface ExperimentVariantResultDto {
  key: string;
  name: string;
  participants: number;
  conversions: number;
  conversionRate: number;
  confidenceInterval: [number, number];
  pValue?: number;
  isSignificant?: boolean;
  relativeImprovement?: number;
}

export interface ExperimentResultsDto {
  featureFlagId: string;
  experiment: {
    enabled: boolean;
    hypothesis?: string;
    primaryMetric?: string;
    status: string;
  };
  variants: ExperimentVariantResultDto[];
  recommendation: {
    winner?: string;
    confidence: "high" | "medium" | "low";
    action: "implement" | "continue";
  };
}

// Issues (admin) — derived at ingestion (they drive the issue alert
// triggers); resolving one arms the "regression" trigger for its next
// occurrence.

export interface IssueDto {
  id: string;
  appId: string;
  fingerprint: string;
  title: string;
  culprit: string | null;
  level: string;
  type: "error" | "message";
  firstRelease: string | null;
  lastRelease: string | null;
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
// The issue list takes the search grammar, not loose filters: the terms
// are the query language (`is:unresolved app:checkout lastSeen:-24h`).
export async function listIssues(params: {
  query?: string;
  sort?: "new" | "frequent" | "first-seen";
  cursor?: string;
  limit?: number;
} = {}) {
  const query: Record<string, string | number> = {};
  if (params.query) query.query = params.query;
  if (params.sort) query.sort = params.sort;
  if (params.cursor) query.cursor = params.cursor;
  if (params.limit) query.limit = params.limit;
  const response =
    Object.keys(query).length > 0
      ? await api.api.admin.issues.get({ $query: query })
      : await api.api.admin.issues.get();
  return response;
}

// One occurrence of an issue, as the server grouped it.
export interface IssueOccurrenceDto {
  messageId: string;
  eventId: string;
  receivedAt: string;
  title: string;
  level: string;
  release: string;
  environment: string;
  user: string;
}

// The issue's occurrences, newest first. The server owns the grouping, so
// the page never recomputes a fingerprint.
export async function listIssueOccurrences(
  issueId: string,
  params: { cursor?: string; limit?: number } = {},
) {
  const query: Record<string, string | number> = {};
  if (params.cursor) query.cursor = params.cursor;
  if (params.limit) query.limit = params.limit;
  return api.api.admin.issues[issueId].events.get({ $query: query });
}

export interface IssueStatsDto {
  from: string;
  to: string;
  stepSeconds: number;
  points: Array<{ bucketStart: string; eventCount: number; userCount: number }>;
  totals: { eventCount: number; userCount: number; firstSeen: string; lastSeen: string };
}

// The issue's bucketed counters over a window.
export async function getIssueStats(
  issueId: string,
  params: { from?: string; to?: string; stepSeconds?: number } = {},
) {
  const query: Record<string, string | number> = {};
  if (params.from) query.from = params.from;
  if (params.to) query.to = params.to;
  if (params.stepSeconds) query.stepSeconds = params.stepSeconds;
  return api.api.admin.issues[issueId].stats.get({ $query: query });
}

// Permissions (admin)

export interface PermissionRuleDto {
  id: string;
  name: string;
  environments: string[];
  appPrefixes: string[];
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PermissionGrantDto {
  id: string;
  identityId: string;
  label: string | null;
  environments: string[];
  appPrefixes: string[];
  isEnabled: boolean;
  /** The identity may perform the admin writes. */
  canWrite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PermissionAuditDto {
  id: string;
  actorId: string;
  target: "rule" | "grant";
  targetId: string;
  action: "create" | "update" | "delete";
  before: unknown;
  after: unknown;
  createdAt: string;
}

export interface SessionDto {
  id: string;
  isAdmin: boolean;
  scope: { environments: string[]; appPrefixes: string[] } | null;
}

// The caller's identity and read scope, answered by the server.
export async function getSession(): Promise<SessionDto | null> {
  const result = await api.api.admin.session.get();
  return (result?.data as SessionDto | null) ?? null;
}

export async function listPermissionRules(): Promise<PermissionRuleDto[]> {
  const result = await api.api.admin.permissions.rules.get({ $query: { limit: 100 } });
  return (result?.data as { data?: PermissionRuleDto[] } | null)?.data ?? [];
}

export async function listPermissionGrants(): Promise<PermissionGrantDto[]> {
  const result = await api.api.admin.permissions.grants.get({ $query: { limit: 100 } });
  return (result?.data as { data?: PermissionGrantDto[] } | null)?.data ?? [];
}

export async function listPermissionAudit(): Promise<PermissionAuditDto[]> {
  const result = await api.api.admin.permissions.audit.get({ $query: { limit: 50 } });
  return (result?.data as { data?: PermissionAuditDto[] } | null)?.data ?? [];
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
): Promise<{ data: EnvironmentDto[] } | null> {
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
