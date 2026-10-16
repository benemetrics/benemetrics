// Shared source map artifact row -> response mapping. The admin
// surface names the timestamp `createdAt` while the Sentry-compatible
// CLI surface uses `dateCreated`, so only the common fields are
// mapped here; each surface adds its own timestamp key.

import type { SourceMap } from "db/schema/source-maps";
import type { SourceMapArtifactResponse } from "../protocol/source-map";

type ArtifactFields = Pick<
  SourceMap,
  | "id"
  | "projectId"
  | "appId"
  | "environmentId"
  | "release"
  | "dist"
  | "filename"
  | "size"
>;

export function toArtifactBase(map: ArtifactFields) {
  return {
    id: map.id,
    projectId: map.projectId,
    appId: map.appId,
    environmentId: map.environmentId,
    release: map.release,
    dist: map.dist,
    name: map.filename,
    size: map.size,
  };
}

export function toArtifactResponse(map: SourceMap): SourceMapArtifactResponse {
  return { ...toArtifactBase(map), createdAt: map.createdAt };
}
