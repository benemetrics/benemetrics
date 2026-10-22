import { notFound } from "backend/errors";
import { appDAO, projectDAO } from "db/dao/project";
import { environmentDAO } from "db/dao/environments";
import { clickHouseReleaseFingerprints } from "../clickhouse";
import type {
  IssueQueryTerm,
  NumberOperator,
  TimeOperator,
  TimeValue,
} from "./query";

export interface TimeBound {
  gte?: string;
  gt?: string;
  lte?: string;
  lt?: string;
  eq?: string;
}

/**
 * Narrows the filters to the apps a scoped identity may see. The scope and
 * the terms intersect: a term can only narrow the scope, never widen it.
 */
export function narrowToScope(
  filters: IssueFilter[],
  appIds: string[],
): IssueFilter[] {
  return filters.map((filter) => {
    if (!filter.appIds) return { ...filter, appIds };
    return { ...filter, appIds: filter.appIds.filter((id) => appIds.includes(id)) };
  });
}

/**
 * The filters of every alternative. The alternatives are ORed, the terms
 * inside one are ANDed.
 */
export async function resolveIssueFilters(
  groups: IssueQueryTerm[][],
  options: {
    now?: Date;
    visibleAppIds?: string[];
    unknownIsEmpty?: boolean;
  } = {},
): Promise<IssueFilter[]> {
  const filters: IssueFilter[] = [];
  for (const terms of groups) {
    filters.push(await resolveIssueFilter(terms, options));
  }
  return filters;
}

export interface IssueFilter {
  statuses?: string[];
  excludedStatuses?: string[];
  appIds?: string[];
  excludedAppIds?: string[];
  levels?: string[];
  excludedLevels?: string[];
  types?: string[];
  excludedTypes?: string[];
  fingerprints?: string[];
  excludedFingerprints?: string[];
  text?: string[];
  excludedText?: string[];
  firstSeen?: TimeBound;
  lastSeen?: TimeBound;
  timesSeen?: { operator: NumberOperator; value: number };
}

const UNIT_MS: Record<string, number> = {
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

const DAY_MS = 86_400_000;

function dayStart(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toISOString();
}

function dayEnd(date: string): string {
  return new Date(new Date(`${date}T00:00:00.000Z`).getTime() + DAY_MS).toISOString();
}

// The instant a time value points at: a relative offset from now, the start
// of a day, or an absolute timestamp.
function instantOf(value: TimeValue, now: Date): string {
  if (value.type === "relative") {
    return new Date(now.getTime() + value.amount * UNIT_MS[value.unit]!).toISOString();
  }
  if (value.type === "date") return dayStart(value.date);
  return value.at;
}

// The bound a time term contributes, per the documented operator table.
export function timeBound(
  kind: "firstSeen" | "lastSeen",
  operator: TimeOperator | null,
  value: TimeValue,
  now: Date,
): TimeBound {
  const isDay = value.type === "date";

  if (operator === null) {
    if (isDay) {
      // The whole UTC day.
      return { gte: dayStart(value.date), lt: dayEnd(value.date) };
    }
    const at = instantOf(value, now);
    // A bare relative time: at/after for firstSeen, at/before for lastSeen.
    return kind === "firstSeen" ? { gte: at } : { lte: at };
  }

  if (operator === "=") {
    if (isDay) return { gte: dayStart(value.date), lt: dayEnd(value.date) };
    return { eq: instantOf(value, now) };
  }

  const at = instantOf(value, now);
  switch (operator) {
    case ">":
      return { gt: isDay ? dayEnd(value.date) : at };
    case ">=":
      return { gte: at };
    case "<":
      return { lt: isDay ? dayStart(value.date) : at };
    case "<=":
      return { lte: isDay ? dayEnd(value.date) : at };
  }
}

// The app ids a name or id points at. A scoped identity gets an empty
// list for a name that does not exist — the same answer as a name that
// exists but is out of scope, so the list cannot be used to probe what
// exists.
async function resolveAppIds(
  value: string,
  unknownIsEmpty: boolean,
): Promise<string[]> {
  const byId = await appDAO.findById(value);
  if (byId) return [byId.id];
  const byName = await appDAO.findByName(value);
  if (byName) return [byName.id];
  if (unknownIsEmpty) return [];
  throw notFound("App", value);
}

async function resolveProjectAppIds(
  value: string,
  unknownIsEmpty: boolean,
): Promise<string[]> {
  const project = await projectDAO.findById(value).catch(() => undefined);
  const resolved = project ?? (await projectDAO.findBySlug(value));
  if (!resolved) {
    if (unknownIsEmpty) return [];
    throw notFound("Project", value);
  }
  return (await appDAO.listRawByProject(resolved.id)).map((app) => app.id);
}

async function resolveEnvironmentAppIds(
  value: string,
  unknownIsEmpty: boolean,
): Promise<string[]> {
  const byId = await environmentDAO.findById(value);
  const environments = byId
    ? [byId]
    : await environmentDAO.findByName(value);
  if (environments.length === 0) {
    if (unknownIsEmpty) return [];
    throw notFound("Environment", value);
  }
  const appIds: string[] = [];
  for (const environment of environments) {
    for (const app of await appDAO.listByEnvironment(environment.id)) {
      appIds.push(app.id);
    }
  }
  return appIds;
}

// Resolves the parsed terms into the filter the DAO queries with. The
// names are resolved to ids here; a ClickHouse failure is not caught — a
// `release:` term fails the whole list.
export async function resolveIssueFilter(
  terms: IssueQueryTerm[],
  options: {
    now?: Date;
    visibleAppIds?: string[];
    /** A name that does not resolve yields an empty list instead of a 404. */
    unknownIsEmpty?: boolean;
  } = {},
): Promise<IssueFilter> {
  const now = options.now ?? new Date();
  const unknownIsEmpty = options.unknownIsEmpty ?? false;
  const filter: IssueFilter = {};

  const add = <T>(list: T[] | undefined, ...values: T[]): T[] => [
    ...(list ?? []),
    ...values,
  ];

  // Two scope terms narrow each other: the apps of a project that are also
  // in one of its environments.
  const narrow = <T>(list: T[] | undefined, values: T[]): T[] => {
    if (!list) return values;
    const keep = new Set(values);
    return list.filter((value) => keep.has(value));
  };

  for (const term of terms) {
    switch (term.kind) {
      case "status": {
        if (term.negated) filter.excludedStatuses = add(filter.excludedStatuses, term.value);
        else filter.statuses = add(filter.statuses, term.value);
        break;
      }
      case "level": {
        if (term.negated) filter.excludedLevels = add(filter.excludedLevels, term.value);
        else filter.levels = add(filter.levels, term.value);
        break;
      }
      case "eventType": {
        if (term.negated) filter.excludedTypes = add(filter.excludedTypes, term.value);
        else filter.types = add(filter.types, term.value);
        break;
      }
      case "app": {
        const appIds = await resolveAppIds(term.value, unknownIsEmpty);
        if (term.negated) filter.excludedAppIds = add(filter.excludedAppIds, ...appIds);
        else filter.appIds = narrow(filter.appIds, appIds);
        break;
      }
      case "project": {
        const appIds = await resolveProjectAppIds(term.value, unknownIsEmpty);
        if (term.negated) filter.excludedAppIds = add(filter.excludedAppIds, ...appIds);
        else filter.appIds = narrow(filter.appIds, appIds);
        break;
      }
      case "environment": {
        const appIds = await resolveEnvironmentAppIds(term.value, unknownIsEmpty);
        if (term.negated) filter.excludedAppIds = add(filter.excludedAppIds, ...appIds);
        else filter.appIds = narrow(filter.appIds, appIds);
        break;
      }
      case "release": {
        const appIds =
          options.visibleAppIds ??
          (await appDAO.listAll()).map((app) => app.id);
        const fingerprints = await clickHouseReleaseFingerprints({
          release: term.value,
          appIds,
        });
        if (term.negated) {
          filter.excludedFingerprints = add(
            filter.excludedFingerprints,
            ...fingerprints,
          );
        } else {
          filter.fingerprints = add(filter.fingerprints, ...fingerprints);
        }
        break;
      }
      case "firstSeen": {
        filter.firstSeen = {
          ...filter.firstSeen,
          ...timeBound("firstSeen", term.operator, term.value, now),
        };
        break;
      }
      case "lastSeen": {
        filter.lastSeen = {
          ...filter.lastSeen,
          ...timeBound("lastSeen", term.operator, term.value, now),
        };
        break;
      }
      case "timesSeen": {
        filter.timesSeen = { operator: term.operator, value: term.value };
        break;
      }
      case "text": {
        if (term.negated) filter.excludedText = add(filter.excludedText, term.value);
        else filter.text = add(filter.text, term.value);
        break;
      }
    }
  }

  return filter;
}
