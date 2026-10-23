export type ActionData = Record<string, unknown>;
export type EnvironmentTarget = Readonly<{
  projectName: string;
  environmentId: string;
}>;
export interface CapturedTarget {
  target: EnvironmentTarget;
  identity: {
    projectName: string;
    environmentId: string;
    environmentName: string;
    projectIncarnation: string | null;
    environmentIncarnation: string | null;
  };
  vaultId: string | null;
  vaultName: string;
  vaultInstanceId: string | null;
}
export type HttpApprovalAction = "read" | "write";
export interface HttpApprovalRequest {
  vaultId: string | null;
  vaultName: string;
  vaultInstanceId: string | null;
  projectName: string;
  /** Null only for Project grouping operations, which are never Environment-scoped. */
  environmentId: string | null;
  environmentName: string | null;
  keys: string[];
  action: HttpApprovalAction;
}
export interface HttpApprovalDecision {
  approved: boolean;
  reason?: string;
}
export type HttpApprovalCallback = (
  request: HttpApprovalRequest,
  signal: AbortSignal | null
) => Promise<HttpApprovalDecision> | HttpApprovalDecision;
export type HttpActionResponse =
  | {
      success: true;
      data?: unknown;
    }
  | {
      success: false;
      error: string;
      code?: string;
    };
export interface HttpVault {
  isLocked: boolean;
  getProjects: () => {
    name: string;
  }[];
  getEnvironments: (name: string) => unknown;
  resolveEnvironmentTarget: (selector: {
    projectName: string;
    environmentName?: string;
    environmentId?: string;
  }) => EnvironmentTarget;
  getEnvironmentTargetIdentity: (
    target: EnvironmentTarget
  ) => CapturedTarget["identity"];
  getVaultId?: () => string | null;
  getVaultInstanceId?: () => string | null;
  getSecrets: (target: EnvironmentTarget) => Record<string, unknown>;
  getSecret: (target: EnvironmentTarget, key: string) => unknown;
  setSecret: (
    target: EnvironmentTarget,
    key: string,
    value: unknown
  ) => unknown;
  createProject: (name: string) => unknown;
  saveNow: () => Promise<unknown>;
}
export interface HttpManager {
  getVaultByName?: (
    name: string
  ) => HttpVault | null | Promise<HttpVault | null>;
  getVaultList?: () => {
    id: string;
    name: string;
  }[];
  vaults?: Map<string, HttpVault>;
}
export interface HttpLogger {
  logAccess?: (
    message: string,
    project: string,
    keys: string[],
    target: Record<string, unknown>
  ) => unknown;
}
export interface HttpSessionContext {
  activeVault?: HttpVault | null;
  signal?: AbortSignal | null;
  vaults?: {
    getByName?: (
      name: string | null
    ) => HttpVault | null | Promise<HttpVault | null>;
    list?: () => unknown | Promise<unknown>;
  };
}
export interface HttpSession {
  snapshot: () => {
    state: string;
  };
  withActiveSession: <T>(
    operation: (context: HttpSessionContext) => T | Promise<T>
  ) => Promise<T>;
}
