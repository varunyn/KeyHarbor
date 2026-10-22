import {
  changePassword,
  exists,
  loadVaultData,
  seal,
  setup,
  unlock,
  unlockWithKey,
  verifyPassword,
} from "./vault-auth";
import {
  captureProjectBackupSnapshot,
  createEncryptedProjectBackup,
  publishImmutableBackup,
  restoreEncryptedProjectBackup,
} from "./vault-backup";
import { VaultBase } from "./vault-base";
import {
  getFavorites,
  getStatistics,
  toggleProjectFavorite,
  toggleSecretFavorite,
} from "./vault-favorites";
import {
  atomicWriteCurrent,
  atomicWriteData,
  currentDiskFingerprint,
  enqueuePersistenceOperation,
  getNormalizedCopyOfData,
  getNormalizedCopyWhileLocked,
  isDiskStale,
  prepareForClose,
  saveNow,
  saveVault,
  scheduleAutoSave,
  tickPeriodicDiskSync,
  VAULT_EXTERNAL_CHANGE,
  writeData,
} from "./vault-persistence";
import { createProject, deleteProject, getProjects } from "./vault-projects";
import type {
  EnvironmentRecord,
  EnvironmentTarget,
  PeriodicDiskSyncResult,
  PrepareForCloseResult,
  ProjectBackupSnapshot,
  ProjectSummary,
  RestoreBackupResult,
  SecretRecord,
  TargetSelector,
  VaultBoundaryRecord,
  VaultBoundaryValue,
  VaultData,
  VaultFavorites,
  VaultReconcileExternalResult,
  VaultStatisticsResult,
} from "./vault-types";

// eslint-disable-next-line no-redeclare
class Vault extends VaultBase {
  static VAULT_EXTERNAL_CHANGE: string;

  exists(): boolean {
    return exists(this);
  }

  setup(password: string): Promise<void> {
    return setup(this, password);
  }

  unlock(password: string): Promise<void> {
    return unlock(this, password);
  }

  unlockWithKey(key: Buffer | Uint8Array): Promise<void> {
    return unlockWithKey(this, key);
  }

  _loadVaultData(key: Buffer | Uint8Array, errorMessage: string): void {
    loadVaultData(this, key, errorMessage);
  }

  seal(): void {
    seal(this);
  }

  changePassword(currentPassword: string, newPassword: string): Promise<void> {
    return changePassword(this, currentPassword, newPassword);
  }

  verifyPassword(password: string): boolean {
    return verifyPassword(this, password);
  }

  getProjects(): ProjectSummary[] {
    return getProjects(this);
  }

  createProject(name: string): void {
    createProject(this, name);
  }

  deleteProject(name: string): void {
    deleteProject(this, name);
  }

  captureProjectBackupSnapshot(projectName: string): ProjectBackupSnapshot {
    return captureProjectBackupSnapshot(this, projectName);
  }

  // Keep this helper on the existing overridable instance API.
  // eslint-disable-next-line class-methods-use-this
  _publishImmutableBackup(targetPath: string, bytes: Buffer): boolean {
    return publishImmutableBackup(targetPath, bytes);
  }

  createEncryptedProjectBackup(projectName: string): Buffer {
    return createEncryptedProjectBackup(this, projectName);
  }

  restoreEncryptedProjectBackup(
    encryptedBackup: Buffer,
    projectName?: string
  ): RestoreBackupResult {
    return restoreEncryptedProjectBackup(this, encryptedBackup, projectName);
  }

  toggleProjectFavorite(projectName: string): boolean {
    return toggleProjectFavorite(this, projectName);
  }

  toggleSecretFavorite(selector: TargetSelector, secretKey: string): boolean {
    return toggleSecretFavorite(this, selector, secretKey);
  }

  getFavorites(): VaultFavorites {
    return getFavorites(this);
  }

  getStatistics(
    selector: EnvironmentTarget | null = null
  ): VaultStatisticsResult {
    return getStatistics(this, selector);
  }

  tickPeriodicDiskSync(): Promise<PeriodicDiskSyncResult> {
    return tickPeriodicDiskSync(this);
  }

  isDirty(): boolean {
    return this.currentRevision !== this.persistedRevision;
  }

  prepareForClose(): Promise<PrepareForCloseResult> {
    return prepareForClose(this);
  }

  _getNormalizedCopyWhileLocked(incoming: VaultBoundaryValue): VaultData {
    return getNormalizedCopyWhileLocked(this, incoming);
  }

  _save(): Promise<VaultReconcileExternalResult | undefined> {
    return saveVault(this);
  }

  _enqueuePersistenceOperation<T>(operation: () => Promise<T> | T): Promise<T> {
    return enqueuePersistenceOperation(this, operation);
  }

  _atomicWriteCurrent(options: { createOnly?: boolean } = {}): Promise<void> {
    return atomicWriteCurrent(this, options);
  }

  _atomicWriteData(
    nextData: VaultData,
    options: {
      createOnly?: boolean;
      expectedDiskFingerprint?: string;
      expectedSessionRevision?: number;
      incrementRevision?: boolean;
    } = {}
  ): Promise<void> {
    return atomicWriteData(this, nextData, options);
  }

  _writeData(
    nextData: VaultData,
    options: {
      createOnly?: boolean;
      expectedDiskFingerprint?: string;
      expectedSessionRevision?: number;
      incrementRevision?: boolean;
    } = {}
  ): Promise<void> {
    return writeData(this, nextData, options);
  }

  _scheduleAutoSave(): void {
    scheduleAutoSave(this);
  }

  saveNow(
    options: VaultBoundaryRecord = {}
  ): Promise<VaultReconcileExternalResult | undefined> {
    return saveNow(this, options);
  }

  // Keep the async API: synchronous validation failures must remain rejected promises.
  // eslint-disable-next-line require-await
  async reconcileExternalChange(
    options: { origin?: string } = {}
  ): Promise<VaultReconcileExternalResult> {
    this._ensureUnlocked();
    return this._reconciliation.reconcileExternalChange(options);
  }

  // Keep the async API: synchronous validation failures must remain rejected promises.
  // eslint-disable-next-line require-await
  async resolveReconciliation(
    options: { reconciliationId?: string; decision?: string } = {}
  ): Promise<VaultReconcileExternalResult> {
    this._ensureUnlocked();
    return this._reconciliation.resolveReconciliation(options);
  }

  _isDiskStale(): boolean {
    return isDiskStale(this);
  }

  _currentDiskFingerprint(): string {
    return currentDiskFingerprint(this);
  }

  _getNormalizedCopyOfData(incoming: VaultBoundaryValue): VaultData {
    return getNormalizedCopyOfData(this, incoming);
  }
}

Vault.VAULT_EXTERNAL_CHANGE = VAULT_EXTERNAL_CHANGE;

// TypeScript declaration merging keeps the existing CommonJS constructor and exported type aliases.
// eslint-disable-next-line @typescript-eslint/no-namespace, no-redeclare
declare namespace Vault {
  export type Target = EnvironmentTarget;
  export type Selector = TargetSelector;
  export type Environment = EnvironmentRecord;
  export type Secret = SecretRecord;
}

export = Vault;
