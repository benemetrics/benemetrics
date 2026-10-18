export interface PermissionRuleCreate {
  groupName: string;
  environments?: string[];
  appPrefixes?: string[];
  isEnabled?: boolean;
}

export interface PermissionRuleResponse {
  id: string;
  groupName: string;
  environments: string[];
  appPrefixes: string[];
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PermissionUserCreate {
  email: string;
  environments?: string[];
  appPrefixes?: string[];
  isEnabled?: boolean;
}

export interface PermissionUserResponse {
  id: string;
  email: string;
  environments: string[];
  appPrefixes: string[];
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ScopedView {
  appIds: Set<string>;
  environmentIds: Set<string>;
  projectIds: Set<string>;
}