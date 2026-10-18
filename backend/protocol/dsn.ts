export interface DSN {
  publicKey: string;
  projectId: string;
  host: string;
}

export interface ValidationResult {
  valid: boolean;
  publicKey: string;
  appId?: string;
}