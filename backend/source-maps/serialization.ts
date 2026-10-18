import type { SourceMap } from "../../db/schema/source-maps.ts";
import type { SourceMapArtifactResponse } from "../protocol/source-map.ts";

type ArtifactFields = Pick<SourceMap, "id" | "projectId" | "appId" | "environmentId" | "release" | "dist" | "filename" | "mapJson">;

export function toArtifactBase(map: ArtifactFields) {
  return {
    id: map.id,
    projectId: map.projectId,
    appId: map.appId,
    environmentId: map.environmentId,
    release: map.release,
    dist: map.dist,
    name: map.filename,
    size: Buffer.byteLength(map.mapJson, "utf8"),
  };
}

export function toArtifactResponse(map: SourceMap): SourceMapArtifactResponse {
  return { ...toArtifactBase(map), createdAt: map.createdAt };
}