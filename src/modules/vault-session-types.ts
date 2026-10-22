/* eslint-disable @typescript-eslint/no-explicit-any */
export type SessionState =
  | "locked"
  | "opening"
  | "active"
  | "recovering"
  | "closing"
  | "destroying";

export type CloseReason = "manual" | "idle" | "quit";
export type OpenMethod = "setup" | "password" | "key";
export type OpenReason = "setup" | "manual" | "touch_id";
export type RecoveryDecision =
  | "keep_recovered"
  | "use_current"
  | "discard"
  | "defer";
export type RecoveryKind = "vault" | "manager_config";

export interface SessionPolicy {
  autoLockEnabled: boolean;
  autoLockTimeoutSeconds: number;
  diskSyncIntervalMs: number;
}

export interface SessionPolicyInput {
  autoLockEnabled?: boolean;
  autoLockTimeoutSeconds?: number;
  diskSyncIntervalMs?: number;
}

export interface VaultStatusEntry {
  code?: string;
  status: string;
  vaultId: string;
}

export interface WarningEntry {
  code: string;
  vaultId?: string;
}

export interface RecoveryEntry {
  allowedDecisions: RecoveryDecision[];
  artifactId: string;
  capsuleId: string;
  kind: RecoveryKind;
  reason: string;
}

export interface ArtifactEntry {
  code?: string;
  kind: string;
  status: string;
}

export interface SessionSnapshot {
  activeVaultId: string | null;
  reason: string | null;
  recovery: RecoveryEntry[];
  state: SessionState;
  transitionId: number;
  warnings: WarningEntry[];
}

export interface OpenRequest {
  credential: Buffer | string;
  method: OpenMethod;
  reason: OpenReason;
}

export interface CloseRequest {
  deadlineMs?: number;
  reason: CloseReason;
}

export interface DestroyRequest {
  confirmation: "delete";
  deadlineMs?: number;
}

export interface RecoveryRequest {
  artifactId: string;
  capsuleId: string;
  decision: RecoveryDecision;
  kind: RecoveryKind;
}

export interface OpenResult {
  outcome: string;
  provisioned: boolean;
  state: SessionState;
  transitionId: number;
  vaults: VaultStatusEntry[];
  warnings: WarningEntry[];
}

export interface CloseResult {
  outcome: string;
  reason: CloseReason;
  state: SessionState;
  transitionId: number;
  vaults: VaultStatusEntry[];
  warnings: WarningEntry[];
}

export interface DestroyResult {
  artifacts: ArtifactEntry[];
  outcome: string;
  state: SessionState;
  transitionId: number;
}

export interface LeaseEntry {
  controller: AbortController;
  settled: Promise<void>;
}

export interface MonitorScheduler {
  clearInterval: (handle: any) => void;
  getIdleTimeSeconds: () => number | Promise<number>;
  setInterval: (
    callback: () => void,
    milliseconds: number
  ) => ReturnType<typeof setInterval> | number;
}

export interface PolicyProvider {
  getPolicy?: () => SessionPolicyInput;
  (): SessionPolicyInput;
}

export interface VaultSessionDependencies {
  httpIngress?: any;
  logger?: any;
  monitorScheduler?: MonitorScheduler;
  onStateChange?: ((snapshot: SessionSnapshot) => void) | null;
  recoveryStore?: any;
  securityCoordinator?: any;
  settingsProvider?: PolicyProvider | { getPolicy?: () => SessionPolicyInput };
  vaultManager: any;
}

export interface SecurityContext {
  changePassword: (
    currentPassword: string,
    newPassword: string
  ) => Promise<unknown>;
  [key: string]: unknown;
}

export interface OperationContext {
  activeVault?: any;
  security: SecurityContext;
  signal: AbortSignal;
  [key: string]: any;
}

export interface VaultSessionHost {
  httpIngress: any;
  logger: any;
  monitorScheduler: MonitorScheduler;
  onStateChange: ((snapshot: SessionSnapshot) => void) | null;
  recoveryStore: any;
  securityCoordinator: any;
  settingsProvider: any;
  vaultManager: any;

  _closeReason: CloseReason | null;
  _contextFactory: ((signal: AbortSignal) => OperationContext) | null;
  _leases: Set<LeaseEntry>;
  _loggerKey: Buffer | null;
  _monitorGeneration: number;
  _monitorHandles: { autoLock: any; diskSync: any };
  _monitorTicks: Set<Promise<any>>;
  _openingController: AbortController | null;
  _policy: SessionPolicy;
  _policyRevision: number;
  _reason: string | null;
  _recovery: RecoveryEntry[];
  _state: SessionState;
  _transitionId: number;
  _transitionKind: string | null;
  _transitionPromise: Promise<any> | null;
  _vaults: VaultStatusEntry[];
  _warnings: WarningEntry[];

  _captureRuntime: (result: any) => void;
  _clearLoggerKey: () => void;
  _logFinalShutdownRecord: () => void;
  _recordWarning: (code: string) => void;
  _setState: (state: SessionState, reason: string | null) => void;
  close: (request?: Partial<CloseRequest>) => Promise<CloseResult>;
  snapshot: () => SessionSnapshot;
  withActiveSession: <T = any>(
    operation: (context: any) => Promise<T> | T
  ) => Promise<T>;
}
