export interface StoredEvent {
  id: string;
  projectId: string;
  appId: string | null;
  envelopeHeader: string;
  envelopeItems: string;
  receivedAt: string;
}

export interface EventListQuery {
  page?: number;
  limit?: number;
  projectId?: string;
  environmentId?: string;
  appId?: string;
}

export interface EventListResponse {
  data: Array<{
    id: string;
    projectId: string;
    appId: string | null;
    receivedAt: string;
    // Parsed envelope data
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface EventDetailResponse {
  id: string;
  projectId: string;
  appId: string | null;
  receivedAt: string;
  envelopeHeader: Record<string, unknown>;
  envelopeItems: Array<{
    header: Record<string, unknown>;
    payload: unknown;
  }>;
}