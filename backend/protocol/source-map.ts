interface SourceMapArtifactResponse {
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

interface SourceMapArtifactListResponse {
  data: SourceMapArtifactResponse[];
}

interface SourceMapTokenResponse {
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

interface SourceMapTokenWithSecret extends SourceMapTokenResponse {
  token: string;
}

interface OriginalPosition {
  source: string;
  line: number;
  column: number;
  contextLine: string | null;
  preContext: string[];
  postContext: string[];
}

interface SourceMapResolveResponse {
  filename: string;
  release: string;
  line: number;
  column: number;
  original: OriginalPosition | null;
}

export type {
  SourceMapArtifactResponse,
  SourceMapArtifactListResponse,
  SourceMapTokenResponse,
  SourceMapTokenWithSecret,
  OriginalPosition,
  SourceMapResolveResponse,
};
