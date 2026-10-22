import path = require("node:path");
import VaultReconciliation = require("./vault-reconciliation");
import { SEALED_DATA, SEALED_KEY } from "./vault-auth";
import {
  applySecretImportBatch,
  applySecretImportBatchNow,
  clearProjectConfigurationBaseline,
  getImportProjectSnapshot,
  getProjectConfigurationBaseline,
  replaceProjectConfigurationBaseline,
  setProjectConfigurationBaselineNow,
} from "./vault-baseline-import";
import {
  createEnvironment,
  deleteEnvironment,
  deleteEnvironmentIncarnation,
  environmentForSelector,
  environmentIncarnationKey,
  getEnvironmentIncarnation,
  getEnvironmentTargetIdentity,
  getEnvironments,
  normalizeEnvironmentName,
  reconcileEnvironmentIncarnations,
  reconcileProjectIncarnations,
  renameEnvironment,
  resetProjectIncarnations,
  resolveEnvironmentTarget,
  setDefaultEnvironment,
  setEnvironmentIncarnation,
} from "./vault-environments";
import { isFunction, sha256Hex } from "./vault-helpers";
import { normalizeVaultData } from "./vault-normalization";
import {
  approveRecoveredLegacySource,
  assertLegacyInputsUnchanged,
  createRecoverySnapshot,
  fingerprintPath,
  loadRecoverySnapshot,
  migrateLegacyFiles,
  normalizeRecoveryBaseline,
  persistLegacyIdentity,
} from "./vault-recovery";
import {
  deleteSecret,
  getSecret,
  getSecretHistory,
  getSecrets,
  normalizeSecretMeta,
  renameSecret,
  restoreSecretVersion,
  secretMetaChanged,
  setSecret,
  setSecrets,
} from "./vault-secrets";
import type {
  BaselineMutationResult,
  DeleteEnvironmentResult,
  EnvironmentResolution,
  EnvironmentSummary,
  EnvironmentTarget,
  EnvironmentTargetIdentity,
  ExternalTargetSelector,
  ImportProjectSnapshot,
  ProjectConfigurationBaselineResult,
  RecoverySnapshot,
  SecretHistoryResult,
  SecretImportChange,
  SecretMetadata,
  SecretReadView,
  TargetExpectation,
  TargetSelector,
  VaultBoundaryValue,
  VaultConflictNotifier,
  VaultConflictPayload,
  VaultData,
  VaultSyncBaseline,
} from "./vault-types";

export abstract class VaultBase {
  data: VaultData = SEALED_DATA;
  key: Buffer = SEALED_KEY;
  isLocked = true;
  dataDir: string;
  legacyVaultPath: string;
  legacySaltPath: string;
  readonly versionedVaultPath: string;
  readonly versionedSaltPath: string;
  vaultPath: string;
  saltPath: string;
  legacyVaultFingerprint: string | null = null;
  legacySaltFingerprint: string | null = null;
  _legacySaltLoadedFingerprint: string | null = null;
  _pendingLegacyRecoveryFingerprint: { vault: string; salt: string } | null =
    null;
  _needsFormatMigration = false;
  saveTimeout: NodeJS.Timeout | null = null;
  maxHistoryVersions = 50;
  _vaultId: string | null;
  _onConflictNotify: VaultConflictNotifier | null;
  _diskContentHash: string | null = null;
  _syncBaseline: VaultSyncBaseline | null = null;
  _periodicSyncInProgress = false;
  sessionRevision = 0;
  currentRevision = 0;
  persistedRevision = 0;
  vaultInstanceId: string | null = null;
  _projectIncarnations = new Map<string, string>();
  _environmentIncarnations = new Map<string, string>();
  _persistenceQueue: Promise<unknown> | null = null;
  _reconciliation: InstanceType<typeof VaultReconciliation>;

  constructor(
    dataDir: string,
    options: {
      vaultId?: string | null;
      onConflict?: VaultConflictNotifier | null;
    } = {}
  ) {
    this.dataDir = dataDir;
    this.legacyVaultPath = path.join(dataDir, "vault.enc");
    this.legacySaltPath = path.join(dataDir, "salt.txt");
    this.versionedVaultPath = path.join(dataDir, "vault-v2.enc");
    this.versionedSaltPath = path.join(dataDir, "salt-v2.txt");
    this.vaultPath = this.versionedVaultPath;
    this.saltPath = this.versionedSaltPath;
    this._vaultId = options.vaultId ?? null;
    this._onConflictNotify = isFunction(options.onConflict)
      ? options.onConflict
      : null;
    this._reconciliation = new VaultReconciliation(this);
  }

  abstract _getNormalizedCopyOfData(incoming: VaultBoundaryValue): VaultData;
  abstract _atomicWriteData(
    nextData: VaultData,
    options?: {
      createOnly?: boolean;
      expectedDiskFingerprint?: string;
      expectedSessionRevision?: number;
      incrementRevision?: boolean;
    }
  ): Promise<void>;
  abstract _scheduleAutoSave(): void;
  abstract _enqueuePersistenceOperation<T>(
    operation: () => Promise<T> | T
  ): Promise<T>;
  abstract _currentDiskFingerprint(): string;
  abstract _publishImmutableBackup(targetPath: string, bytes: Buffer): boolean;
  abstract _atomicWriteCurrent(options?: {
    createOnly?: boolean;
  }): Promise<void>;
  abstract _getNormalizedCopyWhileLocked(
    incoming: VaultBoundaryValue
  ): VaultData;
  abstract seal(): void;

  _refreshSyncBaseline(): void {
    this._syncBaseline = this._reconciliation.createBaseline(this.data);
  }

  setVaultId(vaultId: string | null): void {
    this._vaultId = vaultId || null;
  }

  getVaultId(): string | null {
    return this._vaultId;
  }

  setConflictNotifier(
    fn: VaultConflictNotifier | VaultBoundaryValue | null
  ): void {
    // SAFETY: isFunction validates callback callable signature before setting conflictNotifier.
    this._onConflictNotify = isFunction(fn)
      ? (fn as VaultConflictNotifier)
      : null;
  }

  _notifyConflict(payload: VaultConflictPayload): void {
    try {
      this._onConflictNotify?.({
        ...payload,
        vaultId: this._vaultId,
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(
        "Vault conflict notifier failed:",
        error instanceof Error ? error.message : error
      );
    }
  }

  _setDiskHashFromCiphertext(encryptedBuffer: Buffer): void {
    this._diskContentHash = sha256Hex(encryptedBuffer);
  }

  getVaultInstanceId(): string | null {
    return this.vaultInstanceId;
  }

  _ensureUnlocked(): void {
    if (this.isLocked) {
      throw new Error("Vault is locked");
    }
    this._assertLegacyInputsUnchanged();
  }

  _normalizeData(): void {
    normalizeVaultData(this);
  }

  _installData(nextData?: VaultData): void {
    if (!nextData) {
      return;
    }
    this.data = nextData;
    this.vaultInstanceId = this.data.vaultInstanceId || null;
    this._reconcileProjectIncarnations(this.data);
    this._reconcileEnvironmentIncarnations(this.data);
  }

  _migrateLegacyFiles(): Promise<boolean> {
    return migrateLegacyFiles(this);
  }

  _assertLegacyInputsUnchanged(): void {
    assertLegacyInputsUnchanged(this);
  }

  // Keep this helper on the existing overridable instance API.
  // eslint-disable-next-line class-methods-use-this
  _fingerprintPath(filePath: string): string {
    return fingerprintPath(filePath);
  }

  _persistLegacyIdentity(): Promise<boolean> {
    return persistLegacyIdentity(this);
  }

  createRecoverySnapshot(): RecoverySnapshot {
    return createRecoverySnapshot(this);
  }

  loadRecoverySnapshot(
    snapshot: RecoverySnapshot,
    key: Buffer | Uint8Array,
    options: {
      legacySourceFingerprint?: { vault: string; salt: string };
    } = {}
  ): void {
    loadRecoverySnapshot(this, snapshot, key, options);
  }

  // Keep this helper on the existing overridable instance API.
  // eslint-disable-next-line class-methods-use-this
  _normalizeRecoveryBaseline(
    baseline: VaultBoundaryValue,
    normalizedData: VaultData
  ): VaultSyncBaseline {
    return normalizeRecoveryBaseline(baseline, normalizedData);
  }

  approveRecoveredLegacySource(): Promise<boolean> {
    return approveRecoveredLegacySource(this);
  }

  _environmentForSelector(selector: TargetSelector): EnvironmentResolution {
    return environmentForSelector(this, selector);
  }

  resolveEnvironmentTarget(
    selector: ExternalTargetSelector
  ): EnvironmentTarget {
    return resolveEnvironmentTarget(this, selector);
  }

  getEnvironmentTargetIdentity(
    selector: TargetSelector
  ): EnvironmentTargetIdentity {
    return getEnvironmentTargetIdentity(this, selector);
  }

  // Keep this helper on the existing overridable instance API.
  // eslint-disable-next-line class-methods-use-this
  _environmentIncarnationKey(
    projectName: string,
    environmentId: string
  ): string {
    return environmentIncarnationKey(projectName, environmentId);
  }

  _getEnvironmentIncarnation(
    projectName: string,
    environmentId: string
  ): string | null {
    return getEnvironmentIncarnation(this, projectName, environmentId);
  }

  _setEnvironmentIncarnation(projectName: string, environmentId: string): void {
    setEnvironmentIncarnation(this, projectName, environmentId);
  }

  _deleteEnvironmentIncarnation(
    projectName: string,
    environmentId: string
  ): void {
    deleteEnvironmentIncarnation(this, projectName, environmentId);
  }

  getEnvironments(projectName: string): EnvironmentSummary[] {
    return getEnvironments(this, projectName);
  }

  createEnvironment(projectName: string, name: string): EnvironmentSummary {
    return createEnvironment(this, projectName, name);
  }

  renameEnvironment(
    projectName: string,
    environmentId: string,
    newName: string
  ): EnvironmentTargetIdentity {
    return renameEnvironment(this, projectName, environmentId, newName);
  }

  // Keep this helper on the existing overridable instance API.
  // eslint-disable-next-line class-methods-use-this
  _normalizeEnvironmentName(name: string): string {
    return normalizeEnvironmentName(name);
  }

  setDefaultEnvironment(projectName: string, environmentId: string): boolean {
    return setDefaultEnvironment(this, projectName, environmentId);
  }

  deleteEnvironment(
    projectName: string,
    environmentId: string,
    options: { force?: boolean; replacementDefaultEnvironmentId?: string } = {}
  ): DeleteEnvironmentResult {
    return deleteEnvironment(this, projectName, environmentId, options);
  }

  _resetProjectIncarnations(): void {
    resetProjectIncarnations(this);
  }

  _reconcileProjectIncarnations(nextData: VaultData): void {
    reconcileProjectIncarnations(this, nextData);
  }

  _reconcileEnvironmentIncarnations(nextData: VaultData): void {
    reconcileEnvironmentIncarnations(this, nextData);
  }

  getImportProjectSnapshot(
    selector: TargetSelector,
    keys: string[] = []
  ): ImportProjectSnapshot {
    return getImportProjectSnapshot(this, selector, keys);
  }

  getProjectConfigurationBaseline(
    selector: TargetSelector
  ): ProjectConfigurationBaselineResult {
    return getProjectConfigurationBaseline(this, selector);
  }

  replaceProjectConfigurationBaseline(
    selector: TargetSelector,
    requiredKeys: string[],
    expected: TargetExpectation = {}
  ): Promise<BaselineMutationResult> {
    return replaceProjectConfigurationBaseline(
      this,
      selector,
      requiredKeys,
      expected
    );
  }

  clearProjectConfigurationBaseline(
    selector: TargetSelector,
    expected: TargetExpectation = {}
  ): Promise<BaselineMutationResult> {
    return clearProjectConfigurationBaseline(this, selector, expected);
  }

  _setProjectConfigurationBaselineNow(
    selector: TargetSelector,
    requiredKeys: string[] | null,
    expected: TargetExpectation
  ): BaselineMutationResult {
    return setProjectConfigurationBaselineNow(
      this,
      selector,
      requiredKeys,
      expected
    );
  }

  applySecretImportBatch(
    selector: TargetSelector,
    changes: SecretImportChange[],
    expected?: TargetExpectation
  ): Promise<void> {
    return applySecretImportBatch(this, selector, changes, expected);
  }

  _applySecretImportBatchNow(
    selector: TargetSelector,
    changes: SecretImportChange[],
    expected?: TargetExpectation
  ): void {
    applySecretImportBatchNow(this, selector, changes, expected);
  }

  getSecrets(selector: TargetSelector): Record<string, SecretReadView> {
    return getSecrets(this, selector);
  }

  getSecret(selector: TargetSelector, key: string): SecretReadView {
    return getSecret(this, selector, key);
  }

  setSecret(
    selector: TargetSelector,
    key: string,
    value: string,
    expiresAt?: string | null,
    meta?: { description?: string; tags?: string[] } | null
  ): void {
    setSecret(this, selector, key, value, expiresAt, meta ?? undefined);
  }

  // Keep this helper on the existing overridable instance API.
  // eslint-disable-next-line class-methods-use-this
  _normalizeSecretMeta(meta: VaultBoundaryValue = null): SecretMetadata {
    return normalizeSecretMeta(meta);
  }

  // Keep this helper on the existing overridable instance API.
  // eslint-disable-next-line class-methods-use-this
  _secretMetaChanged(prev: SecretMetadata, next: SecretMetadata): boolean {
    return secretMetaChanged(prev, next);
  }

  setSecrets(selector: TargetSelector, secrets: Record<string, string>): void {
    setSecrets(this, selector, secrets);
  }

  renameSecret(selector: TargetSelector, fromKey: string, toKey: string): void {
    renameSecret(this, selector, fromKey, toKey);
  }

  deleteSecret(selector: TargetSelector, key: string): void {
    deleteSecret(this, selector, key);
  }

  getSecretHistory(selector: TargetSelector, key: string): SecretHistoryResult {
    return getSecretHistory(this, selector, key);
  }

  restoreSecretVersion(
    selector: TargetSelector,
    key: string,
    versionIndex: number
  ): void {
    restoreSecretVersion(this, selector, key, versionIndex);
  }
}
