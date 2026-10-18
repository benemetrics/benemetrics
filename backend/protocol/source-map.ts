export interface SourceMapArtifactResponse {
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

export interface SourceMapArtifactListResponse {
  data: SourceMapArtifactResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface SourceMapTokenResponse {
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

export interface SourceMapTokenWithSecret extends SourceMapTokenResponse {
  token: string;
}

export interface OriginalPosition {
  source: string;
  line: number;
  column: number;
  contextLine: string | null;
  preContext: string[];
  postContext: string[];
}

export interface SourceMapResolveResponse {
  filename: string;
  release: string;
  line: number;
  column: number;
  original: OriginalPosition | null;
}

export interface SourceMapUploadCreate {
  version: string;
  ref?: string;
  url?: string;
  owner?: string;
}

export interface SourceMapUploadResponse {
  version: string;
  ref: string | null;
  url: string | null;
  owner: string | null;
  status: string;
  dateCreated: string;
  projectId: string;
}