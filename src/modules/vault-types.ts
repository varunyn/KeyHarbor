declare global {
  interface Error {
    code?: string;
  }
}

export interface StoredConfigurationBaseline {
  requiredKeys: string[];
  revision: string;
  updatedAt: string;
}

export interface SecretHistoryEntry {
  value: string;
  changedAt?: string | null;
  expiresAt?: string | null;
  description?: string;
  tags?: string[];
  isCurrent?: boolean;
}

export interface SecretMetadata {
  description: string;
  tags: string[];
}

export interface SecretRecord {
  value: string;
  expiresAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  description?: string;
  tags?: string[];
  history?: SecretHistoryEntry[];
}

export interface VaultBoundaryRecord {
  [key: string]: VaultBoundaryValue;
}

export type VaultBoundaryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly VaultBoundaryValue[]
  | VaultBoundaryRecord
  | SecretRecord
  | SecretHistoryEntry
  | EnvironmentRecord
  | ProjectRecord
  | StoredConfigurationBaseline
  | VaultSyncBaseline
  | VaultData;

export interface SecretReadView {
  value: string;
  expiresAt: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  description: string;
  tags: string[];
}

export interface VaultFavorites {
  projects: string[];
  secrets: Record<string, Record<string, string[]>>;
}

export interface VaultDictionary {
  [key: string]:
    | VaultBoundaryValue
    | SecretRecord
    | EnvironmentRecord
    | ProjectRecord
    | string[]
    | Record<string, string[]>;
}

export type EnvironmentTarget = Readonly<{
  projectName: string;
  environmentId: string;
}>;

export interface ImportProjectSnapshot {
  exists: boolean;
  incarnation: string | null;
  secrets: Record<string, SecretRecord | string | null>;
  environmentId?: string;
  environmentName?: string;
  projectIncarnation?: string | null;
  environmentIncarnation?: string | null;
}

export interface EnvironmentRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  secrets: Record<string, SecretRecord | string>;
  configurationBaseline?: StoredConfigurationBaseline;
}

export type EnvironmentSummary = Readonly<{
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  secretCount: number;
  isDefault: boolean;
}>;

export type EnvironmentTargetIdentity = EnvironmentTarget &
  Readonly<{
    environmentName: string;
    projectIncarnation: string | null;
    environmentIncarnation: string | null;
  }>;

export interface DeleteEnvironmentResult {
  affectedSecretCount: number;
  defaultEnvironmentId: string;
  deletedEnvironmentId: string;
}

export interface ProjectRecord {
  name: string;
  createdAt: string;
  updatedAt: string;
  defaultEnvironmentId: string;
  environments: Record<string, EnvironmentRecord>;
  secrets?: Record<string, SecretRecord | string>;
  configurationBaseline?: StoredConfigurationBaseline;
}

export interface VaultData {
  vaultFormatVersion: number;
  version?: string | number;
  vaultInstanceId?: string;
  createdAt?: string;
  updatedAt?: string;
  legacySourceFingerprint?: { vault: string; salt: string };
  favorites: VaultFavorites;
  projects: Record<string, ProjectRecord>;
}

export type TargetSelector = EnvironmentTarget;

export interface ExternalTargetSelector extends VaultBoundaryRecord {
  projectName: string;
  environmentId?: string;
  environmentName?: string;
}

export interface SecretImportChange {
  key: string;
  value: string;
  action: "add" | "replace";
}

export interface TargetExpectation {
  validateTarget?: () => void;
  incarnation?: string;
  environmentIncarnation?: string;
  baseline?: { exists: boolean; revision?: string };
  secrets?: Record<string, SecretRecord | null>;
}

export interface EnvironmentResolution {
  environment: EnvironmentRecord;
  project: ProjectRecord;
  target: EnvironmentTarget;
}

export interface VaultConflictDetail {
  readonly path?: string;
  readonly message?: string;
  readonly [key: string]: VaultBoundaryValue;
}

export interface VaultConflictPayload {
  readonly status?: string;
  readonly reconciliationId?: string;
  readonly reason?: string;
  readonly conflicts?: readonly VaultConflictDetail[];
  readonly vaultId?: string | null;
  readonly [key: string]: VaultBoundaryValue;
}

export type VaultConflictNotifier = (payload: VaultConflictPayload) => void;

export interface VaultReconcileExternalResult {
  status: string;
  reconciliationId?: string;
  reason?: string;
  allowedDecisions?: readonly string[];
  conflicts?: readonly VaultBoundaryValue[];
  [key: string]: VaultBoundaryValue;
}

export interface VaultSyncBaseline {
  projects: VaultBoundaryRecord;
  favorites: VaultFavorites;
}

export interface ProjectConfigurationBaselineResult extends Partial<EnvironmentTargetIdentity> {
  configurationBaseline: StoredConfigurationBaseline | null;
  exists: boolean;
  incarnation: string | null;
}

export interface BaselineMutationResult {
  changed: boolean;
}

export interface SecretHistoryResult {
  current: SecretHistoryEntry & { isCurrent: boolean };
  history: (SecretHistoryEntry & { isCurrent: boolean })[];
  totalVersions: number;
}

export interface RecoverySnapshot {
  sessionData?: unknown;
  baseline?: unknown;
  vaultId?: string | null;
  vaultInstanceId?: string | null;
  vaultPath?: string;
  diskFingerprint?: string;
  currentRevision?: number;
  persistedRevision?: number;
}

export interface VaultStatisticsResult {
  expiringSecrets: number;
  hasExpired: boolean;
  totalProjects: number;
  totalSecrets: number;
}

export interface ProjectBackupSnapshot {
  defaultEnvironmentId: string;
  encryptedBackup: Buffer;
  fingerprint: string;
  projectIncarnation: string | null;
  projectName: string;
  vaultId: string | null;
  vaultInstanceId: string | null;
}

export interface RestoreBackupResult {
  environmentCount: number;
  projectName: string;
}

export interface ProjectSummary {
  createdAt: string;
  defaultEnvironmentId: string;
  environmentCount: number;
  name: string;
  secretCount: number;
  updatedAt: string;
}

export interface PeriodicDiskSyncResult {
  conflict?: boolean;
  didSync: boolean;
  error?: string;
  reconciliation?: VaultReconcileExternalResult;
}

export interface PrepareForCloseResult {
  code?: string;
  revision?: number;
  status: "clean" | "persisted" | "needs_resolution" | "failed";
  vaultId: string | null;
}

export interface VaultReconciliationHost {
  vaultPath: string;
  key: Buffer | null;
  data: VaultData;
  sessionRevision: number;
  maxHistoryVersions: number;
  _diskContentHash: string | null;
  _syncBaseline: VaultSyncBaseline | null;
  _ensureUnlocked: () => void;
  _notifyConflict: (payload: VaultConflictPayload) => void;
  _setDiskHashFromCiphertext: (ciphertext: Buffer) => void;
  _refreshSyncBaseline: () => void;
  _installData: (data?: VaultData) => void;
  _getNormalizedCopyOfData: (incoming: VaultBoundaryValue) => VaultData;
  _atomicWriteData: (
    nextData: VaultData,
    options?: {
      createOnly?: boolean;
      expectedDiskFingerprint?: string;
      expectedSessionRevision?: number;
      incrementRevision?: boolean;
    }
  ) => Promise<void>;
}

export interface VaultReconciliationPlanPayload {
  allowedDecisions: readonly ("use_disk" | "keep_session")[];
  conflicts?: VaultConflictDetail[];
  reason: string;
  reconciliationId: string;
  status: "needs_resolution";
  [key: string]: VaultBoundaryValue;
}
