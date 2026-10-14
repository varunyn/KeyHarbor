import type { ChildProcess } from "node:child_process";

export interface AgentProxyTargetIdentity {
  readonly projectName: string;
  readonly environmentId: string;
  readonly environmentName: string;
  readonly projectIncarnation: string | null;
  readonly environmentIncarnation: string | null;
}

export interface AgentProxyVault {
  getVaultId: () => string;
  getVaultInstanceId: () => string;
  resolveEnvironmentTarget: (selector: {
    projectName: string;
    environmentName?: string;
  }) => { projectName: string; environmentId: string };
  getEnvironmentTargetIdentity: (selector: {
    projectName: string;
    environmentId: string;
  }) => AgentProxyTargetIdentity;
  getSecret: (
    selector: { projectName: string; environmentId: string },
    key: string
  ) => { value: string; expiresAt: string | null };
}

export interface AgentProxySessionContext {
  readonly signal: AbortSignal;
  readonly vaults: {
    getByName: (name: string) => Promise<AgentProxyVault | null>;
  };
}

export interface AgentProxyVaultSession {
  withActiveSession: <T>(
    operation: (context: AgentProxySessionContext) => Promise<T> | T
  ) => Promise<T>;
}

export interface AgentProxyApprovalRequest {
  action: "connect" | "use";
  vaultId: string | null;
  vaultInstanceId: string | null;
  environmentId: string;
  vaultName: string;
  projectName: string;
  environmentName: string;
  keys: string[];
  origin: string;
  method?: string;
  path?: string;
  bodyPreview?: string;
  bodyBytes?: number;
  requestDigest?: string;
  methods?: string[];
  pathPrefixes?: string[];
  allowPrivateNetwork?: boolean;
  customTrust?: boolean;
}

export interface AgentProxyApprovalDecision {
  approved: boolean;
  reason?: string;
}

export type AgentProxyApprover = (
  request: AgentProxyApprovalRequest,
  signal: AbortSignal
) => Promise<AgentProxyApprovalDecision>;

export interface AgentProxyCreateSessionData {
  projectName: string;
  environmentName?: string;
  vaultName?: string;
  key: string;
  origin: string;
  methods?: string[];
  pathPrefixes?: string[];
  ttlSeconds?: number;
  allowPrivateNetwork?: boolean;
  upstreamCaCertificate?: string;
  authHeader?: string;
  authPrefix?: string;
}

export interface AgentProxySessionInfo {
  sessionId: string;
  proxyUrl: string;
  caCertificate: string;
  expiresAt: string;
  placeholder: string;
  key: string;
  environmentName: string;
  projectName: string;
}

export interface AgentProxyCoordinatorOptions {
  session: AgentProxyVaultSession;
  helperPath: string;
  approve: AgentProxyApprover;
  logAccess?: (event: {
    action: "connect" | "use";
    vaultId: string | null;
    vaultInstanceId: string | null;
    environmentId: string;
    projectName: string;
    environmentName: string;
    key: string;
    origin: string;
    method?: string;
    path?: string;
    approved: boolean;
  }) => void;
}

export interface AgentProxyChild extends ChildProcess {
  stdin: NonNullable<ChildProcess["stdin"]>;
  stdout: NonNullable<ChildProcess["stdout"]>;
}
