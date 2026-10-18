const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_LOOKUP: Record<string, number> = {};
for (let i = 0; i < B64.length; i++) B64_LOOKUP[B64[i]!] = i;

function decodeVlq(segment: string, values: number[]): void {
  let shift = 0;
  let value = 0;
  for (const char of segment) {
    const digit = B64_LOOKUP[char];
    if (digit === undefined) throw new Error(`Invalid base64 VLQ character: ${char}`);
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

export function decodeMappings(mappings: string): Array<{ generatedLine: number; generatedColumn: number; sourceIndex: number; sourceLine: number; sourceColumn: number }> {
  const result: Array<{ generatedLine: number; generatedColumn: number; sourceIndex: number; sourceLine: number; sourceColumn: number }> = [];
  let generatedLine = 0;
  let generatedColumn = 0;
  let sourceIndex = 0;
  let sourceLine = 0;
  let sourceColumn = 0;

  for (const line of mappings.split(";")) {
    generatedColumn = 0;
    for (const segment of line.split(",")) {
      if (!segment) continue;
      const values: number[] = [];
      decodeVlq(segment, values);
      generatedColumn += values[0] ?? 0;
      if (values.length >= 4) {
        sourceIndex += values[1]!;
        sourceLine += values[2]!;
        sourceColumn += values[3]!;
        result.push({ generatedLine, generatedColumn, sourceIndex, sourceLine, sourceColumn });
      } else {
        result.push({ generatedLine, generatedColumn, sourceIndex: -1, sourceLine: -1, sourceColumn: -1 });
      }
    }
    generatedLine++;
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
  map: { version: number; sources: string[]; sourcesContent?: Array<string | null>; mappings: string },
  line: number,
  column: number,
  predecoded?: Array<{ generatedLine: number; generatedColumn: number; sourceIndex: number; sourceLine: number; sourceColumn: number }>
): OriginalPosition | null {
  const mappings = predecoded ?? decodeMappings(map.mappings);
  const targetLine = line - 1;
  const targetColumn = Math.max(column - 1, 0);

  let best: { generatedLine: number; generatedColumn: number; sourceIndex: number; sourceLine: number; sourceColumn: number } | null = null;
  for (const mapping of mappings) {
    if (mapping.generatedLine > targetLine) break;
    if (mapping.generatedLine !== targetLine || mapping.sourceIndex < 0) continue;
    if (mapping.generatedColumn <= targetColumn) best = mapping;
  }
  if (!best) return null;

  const source = map.sources[best.sourceIndex];
  if (!source) return null;

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

  return { source, line: sourceLine + 1, column: best.sourceColumn + 1, contextLine, preContext, postContext };
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] ?? normalized;
}

function artifactMatches(mapFilename: string, filename: string): boolean {
  if (mapFilename === filename) return true;
  const mapBase = basename(mapFilename);
  const base = basename(filename);
  if (mapBase === base) return true;
  if (mapBase.endsWith(".map")) return mapBase.slice(0, -4) === base;
  return false;
}

const parsedMapCache = new Map<string, any>();
const decodedMappingsCache = new Map<string, any[]>();
const MAX_PARSED_CACHE = 100;

export function parseMapCached(id: string, mapJson: string): any {
  const cached = parsedMapCache.get(id);
  if (cached) return cached;
  const parsed = JSON.parse(mapJson);
  if (parsedMapCache.size >= MAX_PARSED_CACHE) parsedMapCache.clear();
  parsedMapCache.set(id, parsed);
  return parsed;
}

export function decodedMappingsFor(id: string, map: any): any[] {
  const cached = decodedMappingsCache.get(id);
  if (cached) return cached;
  const decoded = decodeMappings(map.mappings);
  if (decodedMappingsCache.size >= MAX_PARSED_CACHE) decodedMappingsCache.clear();
  decodedMappingsCache.set(id, decoded);
  return decoded;
}

export async function findSourceMapFor(projectId: string, release: string, filename: string) {
  // Would query DAO here
  return null;
}

export async function symbolicateEventPayload(projectId: string, release: string | null, payload: Record<string, unknown>): Promise<boolean> {
  if (!release) return false;
  // Implementation would find matching source maps and symbolicate
  return false;
}