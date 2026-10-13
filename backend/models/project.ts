interface Project {
  id: string;
  name: string;
  slug: string;
  description: string;
  createdAt: Date;
}

interface AppRecord {
  id: string;
  projectId: string;
  name: string;
  platform: string;
  // Unique key used as the DSN path segment (ingestion routes to /api/:key/envelope/)
  ingestKey: string;
  publicKey: string;
  host: string;
  protocol: string;
  createdAt: Date;
}

interface ProjectCreateRequest {
  name: string;
  slug?: string;
  description?: string;
}

interface AppCreateRequest {
  name: string;
  platform?: string;
  host?: string;
}

// Serialized shapes (dates become ISO strings over JSON)
interface AppResponse {
  id: string;
  projectId: string;
  name: string;
  platform: string;
  ingestKey: string;
  dsn: string;
  publicKey: string;
  host: string;
  protocol: string;
  createdAt: string;
}

interface ProjectResponse {
  id: string;
  name: string;
  slug: string;
  description: string;
  appCount: number;
  createdAt: string;
}

interface ProjectDetailResponse extends ProjectResponse {
  apps: AppResponse[];
}

interface ProjectListResponse {
  data: ProjectResponse[];
}

interface AppListResponse {
  data: AppResponse[];
}

export type {
  Project, AppRecord,
  ProjectCreateRequest, AppCreateRequest,
  AppResponse, ProjectResponse, ProjectDetailResponse,
  ProjectListResponse, AppListResponse
};
