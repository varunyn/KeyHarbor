import type Vault = require("./vault");

interface VaultEntry {
  id: string;
  name: string;
  path: string;
  encryptionKey: string;
  vaultInstanceId?: string | null;
  createdAt: string;
}

interface ManagerConfig {
  version: 1;
  managerFormatVersion: 2;
  systemVaultInstanceId: string | null;
  otherVaults: VaultEntry[];
  legacySourceFingerprint: string;
}

interface ConfigSaveResult {
  revision: number;
  status: string;
}

interface ConfigCloseStatus {
  code?: string;
  revision?: number;
  status: string;
}

interface RecoveryPayload {
  sessionData?: unknown;
  baseline?: unknown;
  config?: RecoveryPayload;
  version?: unknown;
  managerFormatVersion?: unknown;
  systemVaultInstanceId?: unknown;
  otherVaults?: unknown;
  legacySourceFingerprint?: unknown;
  [key: string]: unknown;
}

interface RecoveryHeader {
  kind?: "vault" | "manager_config";
  artifactId?: string;
  vaultId?: string | null;
  capsuleId: string;
}

interface RecoveryStore {
  enumerate?: () => Promise<RecoveryHeader[]>;
  listHeaders?: () => RecoveryHeader[];
  readCapsule: (id: string, key: Buffer) => { payload: RecoveryPayload };
  deleteCapsule: (id: string) => void;
  beginDestruction?: () => void;
  hasDestructionTombstone?: () => boolean;
  finishDestruction?: () => void;
}

interface SessionRecovery {
  kind: "vault" | "manager_config";
  artifactId: string;
  capsuleId: string;
  reason: "pending_recovery";
  allowedDecisions: ("keep_recovered" | "use_current" | "discard" | "defer")[];
}

interface VaultCloseResult {
  vaultId: string | null;
  status: string;
  code?: string;
  revision?: number;
}

interface VaultSyncResult {
  vaultId: string;
  didSync: boolean;
  conflict?: boolean;
  reconciliation?: unknown;
  error?: string;
}

type OpenSessionOptions =
  | {
      method: "setup";
      credential: string;
      recoveryHeaders?: RecoveryHeader[];
      signal?: AbortSignal;
    }
  | {
      method: "password";
      credential: string;
      recoveryHeaders?: RecoveryHeader[];
      signal?: AbortSignal;
    }
  | {
      method: "key";
      credential: Buffer;
      recoveryHeaders?: RecoveryHeader[];
      signal?: AbortSignal;
    };

interface OpenSessionResult {
  createContext: (signal: AbortSignal) => SessionContext;
  loggerKey: Buffer | null;
  provisioned: boolean;
  recovery: SessionRecovery[];
  state: string;
  vaults: { status: string; vaultId: string; code?: string }[];
}

interface VaultListEntry {
  id: string;
  isActive: boolean;
  isSystem: boolean;
  name: string;
  path: string;
  status: string;
}

type RegisteredVaultEntry = Omit<VaultEntry, "encryptionKey">;

type ConflictNotifier = (payload: {
  vaultId: string | null;
  reason?: string;
}) => void;

type VaultFacade = Pick<
  Vault,
  | "getVaultId"
  | "getVaultInstanceId"
  | "resolveEnvironmentTarget"
  | "getEnvironmentTargetIdentity"
  | "captureProjectBackupSnapshot"
  | "getEnvironments"
  | "createEnvironment"
  | "renameEnvironment"
  | "deleteEnvironment"
  | "setDefaultEnvironment"
  | "getImportProjectSnapshot"
  | "applySecretImportBatch"
  | "getProjectConfigurationBaseline"
  | "replaceProjectConfigurationBaseline"
  | "clearProjectConfigurationBaseline"
  | "getProjects"
  | "createProject"
  | "deleteProject"
  | "getSecrets"
  | "getSecret"
  | "setSecret"
  | "renameSecret"
  | "deleteSecret"
  | "getSecretHistory"
  | "restoreSecretVersion"
  | "getFavorites"
  | "toggleProjectFavorite"
  | "toggleSecretFavorite"
  | "getStatistics"
  | "verifyPassword"
  | "saveNow"
  | "reconcileExternalChange"
  | "resolveReconciliation"
  | "createEncryptedProjectBackup"
  | "restoreEncryptedProjectBackup"
> & { readonly isLocked: boolean };

interface SessionVaultsApi {
  create: (
    name: string,
    folderPath: string,
    password: string
  ) => Promise<RegisteredVaultEntry>;
  getByName: (name: string) => Promise<VaultFacade | null>;
  import: (
    name: string,
    archivePath: string,
    password: string
  ) => Promise<RegisteredVaultEntry>;
  list: () => VaultListEntry[];
  remove: (vaultId: string) => void;
  rename: (vaultId: string, name: string) => void;
  switch: (vaultId: string) => Promise<Vault | undefined>;
  syncAll: () => Promise<VaultSyncResult[]>;
}

interface SessionContext {
  signal: AbortSignal;
  activeVault: VaultFacade;
  vaults: SessionVaultsApi;
  security: { verifyPassword: (password: string) => boolean };
}

/**
 * Mutable manager state shared by the extracted vault-manager modules. The
 * VaultManager class owns it and delegates each responsibility to the module
 * that implements it.
 */
interface VaultManagerHost {
  activeVaultId: string;
  configCurrentRevision: number;
  configPath: string;
  configPersistedRevision: number;
  keyharborDir: string;
  legacyConfigPath: string;
  recoveryStore: RecoveryStore | null;
  systemVault: Vault;
  vaults: Map<string, Vault>;
  vaultsConfig: ManagerConfig;
  _activationFailures: Map<string, string>;
  _configDiskHash: string | null;
  _conflictNotifier: ConflictNotifier | null;
  _recoveryGeneration: Map<string, number>;
}

export type {
  ConfigCloseStatus,
  ConfigSaveResult,
  ConflictNotifier,
  ManagerConfig,
  OpenSessionOptions,
  OpenSessionResult,
  RecoveryHeader,
  RecoveryPayload,
  RecoveryStore,
  RegisteredVaultEntry,
  SessionContext,
  SessionRecovery,
  SessionVaultsApi,
  VaultCloseResult,
  VaultEntry,
  VaultFacade,
  VaultListEntry,
  VaultManagerHost,
  VaultSyncResult,
};
