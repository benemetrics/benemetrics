import { type as arktype } from "arktype";
import { badRequest } from "backend/errors";

// The scope lists are bounded so a rule cannot grow without limit.
export const MAX_SCOPE_ENTRIES = 100;
export const MAX_SCOPE_ENTRY_LENGTH = 128;

export const permissionRuleBodySchema = arktype({
  name: "string >= 1",
  projectIds: "string[]?",
  appPrefixes: "string[]?",
  isEnabled: "boolean?",
});

export const permissionGrantBodySchema = arktype({
  identityId: "string >= 1",
  label: "string?",
  projectIds: "string[]?",
  appPrefixes: "string[]?",
  isEnabled: "boolean?",
  canWrite: "boolean?",
});

export const permissionRulePatchSchema = arktype({
  name: "string >= 1?",
  projectIds: "string[]?",
  appPrefixes: "string[]?",
  isEnabled: "boolean?",
});

export const permissionGrantPatchSchema = arktype({
  identityId: "string >= 1?",
  label: "string?",
  projectIds: "string[]?",
  appPrefixes: "string[]?",
  isEnabled: "boolean?",
  canWrite: "boolean?",
});

export interface PermissionScope {
  appPrefixes: string[];
  projectIds: string[];
}

/**
 * Trims the entries, drops the empties and deduplicates case-insensitively.
 */
export function normalizeScopeList(values: string[], field: string): string[] {
  if (values.length > MAX_SCOPE_ENTRIES) {
    throw badRequest(`"${field}" accepts at most ${MAX_SCOPE_ENTRIES} entries`);
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.length > MAX_SCOPE_ENTRY_LENGTH) {
      throw badRequest(
        `"${field}" entries are at most ${MAX_SCOPE_ENTRY_LENGTH} characters`,
      );
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(trimmed);
  }
  return normalized;
}
