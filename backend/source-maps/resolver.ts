import { sourceMapDAO, type SourceMapContent } from "db/dao/source-maps";

interface Mapping {
  generatedLine: number;
  generatedColumn: number;
  sourceIndex: number;
  sourceLine: number;
  sourceColumn: number;
}

interface ParsedSourceMap {
  version: number;
  file?: string;
  sources: string[];
  sourcesContent?: Array<string | null>;
  names?: string[];
  mappings: string;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
// A null prototype keeps `constructor` and friends out of the lookup.
const B64_LOOKUP: Record<string, number> = Object.create(null);
for (let i = 0; i < B64.length; i++) {
  B64_LOOKUP[B64[i]!] = i;
}

function decodeVlq(segment: string, values: number[]): void {
  let shift = 0;
  let value = 0;
  for (const char of segment) {
    const digit = B64_LOOKUP[char];
    if (typeof digit !== "number") {
      throw new Error(`Invalid base64 VLQ character: ${char}`);
    }
    const hasContinuation = (digit & 32) !== 0;
    value += (digit & 31) * 2 ** shift;
    shift += 5;
    if (!hasContinuation) {
      const negative = (value & 1) === 1;
      value = Math.floor(value / 2);
      values.push(negative ? -value : value);
      value = 0;
      shift = 0;
    }
  }
}

export function decodeMappings(mappings: string): Mapping[] {
  const result: Mapping[] = [];
  let generatedLine = 0;
  let generatedColumn = 0;
  let sourceIndex = 0;
  let sourceLine = 0;
  let sourceColumn = 0;

  for (const line of mappings.split(";")) {
    generatedColumn = 0;
    for (const segment of line.split(",")) {
      if (segment.length === 0) continue;
      const values: number[] = [];
      decodeVlq(segment, values);
      generatedColumn += values[0] ?? 0;
      if (values.length >= 4) {
        sourceIndex += values[1]!;
        sourceLine += values[2]!;
        sourceColumn += values[3]!;
        result.push({
          generatedLine,
          generatedColumn,
          sourceIndex,
          sourceLine,
          sourceColumn,
        });
      } else {
        result.push({
          generatedLine,
          generatedColumn,
          sourceIndex: -1,
          sourceLine: -1,
          sourceColumn: -1,
        });
      }
    }
    generatedLine += 1;
  }

  return result;
}

export interface OriginalPosition {
  source: string;
  line: number;
  column: number;
  contextLine: string | null;
  preContext: string[];
  postContext: string[];
}

export function originalPositionFor(
  map: ParsedSourceMap,
  line: number,
  column: number,
  predecoded?: Mapping[],
): OriginalPosition | null {
  const mappings = predecoded ?? decodeMappings(map.mappings);
  const targetLine = line - 1;
  const targetColumn = Math.max(column - 1, 0);

  let best: Mapping | null = null;
  for (const mapping of mappings) {
    if (mapping.generatedLine > targetLine) break;
    if (mapping.generatedLine !== targetLine || mapping.sourceIndex < 0)
      continue;
    if (mapping.generatedColumn <= targetColumn) best = mapping;
  }
  if (!best) return null;

  const source = map.sources[best.sourceIndex];
  if (source === undefined) return null;

  const sourceLine = best.sourceLine;
  const content = map.sourcesContent?.[best.sourceIndex];
  let contextLine: string | null = null;
  let preContext: string[] = [];
  let postContext: string[] = [];
  if (typeof content === "string") {
    const lines = content.split("\n");
    contextLine = lines[sourceLine] ?? null;
    preContext = lines.slice(Math.max(sourceLine - 2, 0), sourceLine);
    postContext = lines.slice(sourceLine + 1, sourceLine + 3);
  }

  return {
    source,
    line: sourceLine + 1,
    column: best.sourceColumn + 1,
    contextLine,
    preContext,
    postContext,
  };
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] ?? normalized;
}

// An exact filename wins over a basename match.
function matchRank(mapFilename: string, filename: string): number {
  if (mapFilename === filename) return 0;
  if (basename(mapFilename) === basename(filename)) return 1;
  const mapBase = basename(mapFilename);
  if (mapBase.endsWith(".map") && mapBase.slice(0, -4) === basename(filename)) {
    return 2;
  }
  return -1;
}

interface Versioned<T> {
  createdAt: string;
  value: T;
}

const parsedMapCache = new Map<string, Versioned<ParsedSourceMap>>();
const MAX_PARSED_CACHE = 100;

export function parseMapCached(artifact: SourceMapContent): ParsedSourceMap {
  const cached = parsedMapCache.get(artifact.id);
  if (cached && cached.createdAt === artifact.createdAt) return cached.value;
  const parsed = JSON.parse(artifact.mapJson) as ParsedSourceMap;
  if (parsedMapCache.size >= MAX_PARSED_CACHE) parsedMapCache.clear();
  parsedMapCache.set(artifact.id, {
    createdAt: artifact.createdAt,
    value: parsed,
  });
  return parsed;
}

const decodedMappingsCache = new Map<string, Versioned<Mapping[]>>();

function decodedMappingsFor(
  artifact: SourceMapContent,
  map: ParsedSourceMap,
): Mapping[] {
  const cached = decodedMappingsCache.get(artifact.id);
  if (cached && cached.createdAt === artifact.createdAt) return cached.value;
  const decoded = decodeMappings(map.mappings);
  if (decodedMappingsCache.size >= MAX_PARSED_CACHE)
    decodedMappingsCache.clear();
  decodedMappingsCache.set(artifact.id, {
    createdAt: artifact.createdAt,
    value: decoded,
  });
  return decoded;
}

// A re-upload replaces the artifact body; the cached parse must not survive it.
export function invalidateSourceMapCache(artifactId: string): void {
  parsedMapCache.delete(artifactId);
  decodedMappingsCache.delete(artifactId);
}

export async function findSourceMapFor(
  projectId: string,
  release: string,
  filename: string,
): Promise<SourceMapContent | null> {
  const maps = await sourceMapDAO.findByRelease(projectId, release);
  if (maps.length === 0) return null;
  let best: SourceMapContent | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const map of maps) {
    const rank = matchRank(map.filename, filename);
    if (rank >= 0 && rank < bestRank) {
      best = map;
      bestRank = rank;
    }
  }
  return best;
}

export async function symbolicateEventPayload(
  projectId: string,
  release: string | null,
  payload: Record<string, unknown>,
): Promise<boolean> {
  if (!release) return false;

  const exception = payload.exception as
    | {
        values?: Array<{
          stacktrace?: { frames?: Array<Record<string, unknown>> };
        }>;
      }
    | undefined;
  const values = exception?.values;
  if (!Array.isArray(values)) return false;

  const maps = await sourceMapDAO.findByRelease(projectId, release);
  if (maps.length === 0) return false;

  const bestFor = (filename: string): SourceMapContent | null => {
    let best: SourceMapContent | null = null;
    let bestRank = Number.POSITIVE_INFINITY;
    for (const candidate of maps) {
      const rank = matchRank(candidate.filename, filename);
      if (rank >= 0 && rank < bestRank) {
        best = candidate;
        bestRank = rank;
      }
    }
    return best;
  };

  let symbolicated = false;
  for (const value of values) {
    const frames = value?.stacktrace?.frames;
    if (!Array.isArray(frames)) continue;

    for (const frame of frames) {
      const filename = frame.filename;
      if (typeof filename !== "string") continue;

      const map = bestFor(filename);
      if (!map) continue;

      const lineno = typeof frame.lineno === "number" ? frame.lineno : 1;
      const colno = typeof frame.colno === "number" ? frame.colno : 0;

      let position: OriginalPosition | null = null;
      try {
        const parsed = parseMapCached(map);
        position = originalPositionFor(
          parsed,
          lineno,
          colno,
          decodedMappingsFor(map, parsed),
        );
      } catch (e) {
        console.error(
          `[source-maps] failed to decode mappings for artifact ${map.id}:`,
          e,
        );
        continue;
      }
      if (!position) continue;

      frame.original_filename = position.source;
      frame.original_lineno = position.line;
      frame.original_colno = position.column;
      if (position.contextLine !== null) {
        frame.context_line = position.contextLine;
      }
      frame.pre_context = position.preContext;
      frame.post_context = position.postContext;
      symbolicated = true;
    }
  }

  return symbolicated;
}
