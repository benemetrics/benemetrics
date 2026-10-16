import { sourceMapDAO } from "db/dao/source-maps";
import type { SourceMap } from "db/schema/source-maps";

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
const B64_LOOKUP: Record<string, number> = {};
for (let i = 0; i < B64.length; i++) {
  B64_LOOKUP[B64[i]!] = i;
}

function decodeVlq(segment: string, values: number[]): void {
  let shift = 0;
  let value = 0;
  for (const char of segment) {
    const digit = B64_LOOKUP[char];
    if (digit === undefined) {
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

// Decodes the base64-VLQ `mappings` field into absolute
// positions (source maps store deltas).
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
        // Segment without source info: generated-only position.
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

// Maps a 1-indexed generated position to its original position.
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

  const sourceLine = best.sourceLine; // 0-indexed
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

// Matches a generated frame filename against an uploaded
// artifact name: exact, basename, or the artifact's
// basename with the ".map" suffix stripped (Sentry
// convention: "app.js.map" is the map for "app.js").
function artifactMatches(mapFilename: string, filename: string): boolean {
  if (mapFilename === filename) return true;
  const mapBase = basename(mapFilename);
  const base = basename(filename);
  if (mapBase === base) return true;
  if (mapBase.endsWith(".map")) {
    return mapBase.slice(0, -4) === base;
  }
  return false;
}

const parsedMapCache = new Map<string, ParsedSourceMap>();
const MAX_PARSED_CACHE = 100;

export function parseMapCached(id: string, mapJson: string): ParsedSourceMap {
  const cached = parsedMapCache.get(id);
  if (cached) return cached;
  const parsed = JSON.parse(mapJson) as ParsedSourceMap;
  if (parsedMapCache.size >= MAX_PARSED_CACHE) parsedMapCache.clear();
  parsedMapCache.set(id, parsed);
  return parsed;
}

const decodedMappingsCache = new Map<string, Mapping[]>();

function decodedMappingsFor(id: string, map: ParsedSourceMap): Mapping[] {
  const cached = decodedMappingsCache.get(id);
  if (cached) return cached;
  const decoded = decodeMappings(map.mappings);
  if (decodedMappingsCache.size >= MAX_PARSED_CACHE) decodedMappingsCache.clear();
  decodedMappingsCache.set(id, decoded);
  return decoded;
}

export async function findSourceMapFor(
  projectId: string,
  release: string,
  filename: string,
): Promise<SourceMap | null> {
  const maps = await sourceMapDAO.findByRelease(projectId, release);
  if (maps.length === 0) return null;
  return maps.find((map) => artifactMatches(map.filename, filename)) ?? null;
}

// Rewrites exception stack frames in place with their original
// positions (Sentry frame conventions: original_filename,
// original_lineno, original_colno + source context lines).
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

  let symbolicated = false;
  for (const value of values) {
    const frames = value?.stacktrace?.frames;
    if (!Array.isArray(frames)) continue;

    for (const frame of frames) {
      const filename = frame.filename;
      if (typeof filename !== "string") continue;

      const map = maps.find((candidate) => artifactMatches(candidate.filename, filename));
      if (!map) continue;

      const lineno = typeof frame.lineno === "number" ? frame.lineno : 1;
      const colno = typeof frame.colno === "number" ? frame.colno : 0;

      let position: OriginalPosition | null = null;
      try {
        const parsed = parseMapCached(map.id, map.mapJson);
        position = originalPositionFor(
          parsed,
          lineno,
          colno,
          decodedMappingsFor(map.id, parsed),
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
        frame.pre_context = position.preContext;
        frame.post_context = position.postContext;
      }
      symbolicated = true;
    }
  }

  return symbolicated;
}
