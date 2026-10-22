import VaultReconciliation = require("./vault-reconciliation");
import crypto from "node:crypto";
import fs from "node:fs";
import CryptoUtil = require("./crypto");
import {
  copyJsonData,
  isObjectRecord,
  isString,
  sha256Hex,
} from "./vault-helpers";
import type {
  PeriodicDiskSyncResult,
  PrepareForCloseResult,
  VaultBoundaryRecord,
  VaultBoundaryValue,
  VaultData,
  VaultReconcileExternalResult,
} from "./vault-types";

export const VAULT_EXTERNAL_CHANGE = "VAULT_EXTERNAL_CHANGE";

export interface VaultPersistenceHost {
  data: VaultData;
  key: Buffer | null;
  vaultPath: string;
  isLocked: boolean;
  saveTimeout: NodeJS.Timeout | null;
  currentRevision: number;
  persistedRevision: number;
  sessionRevision: number;
  _vaultId: string | null;
  _diskContentHash: string | null;
  _periodicSyncInProgress: boolean;
  _persistenceQueue: Promise<unknown> | null;
  _reconciliation: VaultReconciliation;
  _ensureUnlocked: () => void;
  _assertLegacyInputsUnchanged: () => void;
  _currentDiskFingerprint: () => string;
  _setDiskHashFromCiphertext: (ciphertext: Buffer) => void;
  _installData: (data: VaultData) => void;
  _refreshSyncBaseline: () => void;
  _normalizeData: () => void;
  _save: () => Promise<VaultReconcileExternalResult | undefined>;
  _atomicWriteData: (
    nextData: VaultData,
    options?: {
      createOnly?: boolean;
      expectedDiskFingerprint?: string;
      expectedSessionRevision?: number;
      incrementRevision?: boolean;
    }
  ) => Promise<void>;
  _writeData: (
    nextData: VaultData,
    options?: {
      createOnly?: boolean;
      expectedDiskFingerprint?: string;
      expectedSessionRevision?: number;
      incrementRevision?: boolean;
    }
  ) => Promise<void>;
  isDirty: () => boolean;
  _isDiskStale: () => boolean;
  reconcileExternalChange: (options?: {
    origin?: string;
  }) => Promise<VaultReconcileExternalResult>;
}

export const isDiskStale = (vault: VaultPersistenceHost): boolean => {
  if (
    vault.isLocked ||
    vault._diskContentHash === null ||
    vault._diskContentHash === undefined
  ) {
    return false;
  }
  if (!fs.existsSync(vault.vaultPath)) {
    return true;
  }
  try {
    const current = fs.readFileSync(vault.vaultPath);
    return sha256Hex(current) !== vault._diskContentHash;
  } catch {
    return true;
  }
};

export const currentDiskFingerprint = (vault: VaultPersistenceHost): string => {
  try {
    return sha256Hex(fs.readFileSync(vault.vaultPath));
  } catch (error) {
    // SAFETY: Catch error is checked as an object record for ENOENT code before returning fallback.
    const err = error as VaultBoundaryValue;
    return isObjectRecord(err) && err.code === "ENOENT"
      ? "missing"
      : "unreadable";
  }
};

export const enqueuePersistenceOperation = <T>(
  vault: VaultPersistenceHost,
  operation: () => Promise<T> | T
): Promise<T> => {
  const previous = vault._persistenceQueue || Promise.resolve();
  const current = previous
    // Retain persistence-queue settlement and cleanup ordering without adding await boundaries.
    // eslint-disable-next-line promise/prefer-await-to-then
    .catch(() => {
      // A rejected save must not block subsequent queued persistence operations.
    })
    // Retain persistence-queue settlement and cleanup ordering without adding await boundaries.
    // eslint-disable-next-line promise/prefer-await-to-then
    .then(operation);
  vault._persistenceQueue = current;
  current
    // Retain persistence-queue settlement and cleanup ordering without adding await boundaries.
    // eslint-disable-next-line promise/prefer-await-to-then
    .finally(() => {
      if (vault._persistenceQueue === current) {
        vault._persistenceQueue = null;
      }
    })
    // Retain persistence-queue settlement and cleanup ordering without adding await boundaries.
    // eslint-disable-next-line promise/prefer-await-to-then
    .catch(() => {
      // A rejected save must not block subsequent queued persistence operations.
    });
  return current;
};

export const atomicWriteData = (
  vault: VaultPersistenceHost,
  nextData: VaultData,
  options: {
    expectedDiskFingerprint?: string;
    expectedSessionRevision?: number;
    incrementRevision?: boolean;
  } = {}
): Promise<void> =>
  enqueuePersistenceOperation(vault, () => vault._writeData(nextData, options));

export const writeData = async (
  vault: VaultPersistenceHost,
  nextData: VaultData,
  options: {
    createOnly?: boolean;
    expectedDiskFingerprint?: string;
    expectedSessionRevision?: number;
    incrementRevision?: boolean;
  } = {}
): Promise<void> => {
  vault._assertLegacyInputsUnchanged();
  const startingRevision = vault.currentRevision;
  const startingSessionRevision = vault.sessionRevision;
  if (
    options.expectedSessionRevision !== undefined &&
    options.expectedSessionRevision !== vault.sessionRevision
  ) {
    const error = new Error("Vault changed after reconciliation was prepared");
    error.code = "VAULT_RECONCILIATION_SUPERSEDED";
    throw error;
  }
  const normalizedData = copyJsonData(nextData);
  const encryptedData = CryptoUtil.encryptJson(normalizedData, vault.key);
  const temporaryPath = `${vault.vaultPath}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
  const expectedDiskFingerprint =
    options.expectedDiskFingerprint ?? vault._diskContentHash;
  try {
    await fs.promises.writeFile(temporaryPath, encryptedData, {
      mode: 0o600,
    });
    await fs.promises.chmod(temporaryPath, 0o600);
    if (
      vault.currentRevision !== startingRevision ||
      vault.sessionRevision !== startingSessionRevision
    ) {
      const error = new Error("Vault changed while preparing the save");
      error.code = "VAULT_REVISION_CHANGED";
      throw error;
    }
    if (
      expectedDiskFingerprint !== null &&
      vault._currentDiskFingerprint() !== expectedDiskFingerprint
    ) {
      const error = new Error("Vault file changed before it could be replaced");
      error.code = VAULT_EXTERNAL_CHANGE;
      throw error;
    }
    if (options.createOnly || expectedDiskFingerprint === null) {
      await fs.promises.link(temporaryPath, vault.vaultPath);
      await fs.promises.unlink(temporaryPath);
    } else {
      await fs.promises.rename(temporaryPath, vault.vaultPath);
    }
    vault._setDiskHashFromCiphertext(encryptedData);
    if (
      vault.currentRevision !== startingRevision ||
      vault.sessionRevision !== startingSessionRevision
    ) {
      const error = new Error("Vault changed while writing the save");
      error.code = "VAULT_REVISION_CHANGED";
      throw error;
    }
    vault._installData(normalizedData);
    if (options.incrementRevision === true) {
      vault.sessionRevision += 1;
      vault.currentRevision += 1;
    }
    vault._refreshSyncBaseline();
    vault.persistedRevision = vault.currentRevision;
  } catch (error) {
    try {
      await fs.promises.unlink(temporaryPath);
    } catch {
      // Best-effort cleanup or recovery probing must preserve the primary result.
    }
    throw error;
  }
};

export const atomicWriteCurrent = (
  vault: VaultPersistenceHost,
  options: { createOnly?: boolean } = {}
): Promise<void> => {
  if (!vault.key) {
    throw new Error("Cannot save locked vault");
  }
  vault._assertLegacyInputsUnchanged();
  return enqueuePersistenceOperation(vault, () =>
    vault._writeData(vault.data, {
      ...options,
      expectedDiskFingerprint:
        options.createOnly === true
          ? undefined
          : (vault._diskContentHash ?? undefined),
      expectedSessionRevision: vault.sessionRevision,
      incrementRevision: false,
    })
  );
};

export const saveVault = async (
  vault: VaultPersistenceHost
): Promise<VaultReconcileExternalResult | undefined> => {
  if (!vault.data || !vault.key) {
    return undefined;
  }
  if (vault._isDiskStale()) {
    const result = await vault.reconcileExternalChange({ origin: "save" });
    if (result.status === "needs_resolution") {
      const error = new Error("Vault reconciliation required");
      error.code = "VAULT_RECONCILIATION_REQUIRED";
      throw error;
    }
    return result;
  }
  try {
    await atomicWriteCurrent(vault);
    return undefined;
  } catch (error) {
    // SAFETY: Catch error is checked as an object record before inspecting code.
    const err = error as VaultBoundaryValue;
    if (isObjectRecord(err) && err.code !== VAULT_EXTERNAL_CHANGE) {
      throw error;
    }
    const result = await vault.reconcileExternalChange({ origin: "save" });
    if (result.status === "needs_resolution") {
      const reconciliationError = new Error("Vault reconciliation required");
      reconciliationError.code = "VAULT_RECONCILIATION_REQUIRED";
      throw reconciliationError;
    }
    return result;
  }
};

export const scheduleAutoSave = (vault: VaultPersistenceHost): void => {
  vault._ensureUnlocked();
  vault.sessionRevision += 1;
  vault.currentRevision += 1;
  if (vault.saveTimeout) {
    clearTimeout(vault.saveTimeout);
  }
  // eslint-disable-next-line promise/prefer-await-to-callbacks
  vault.saveTimeout = setTimeout(async () => {
    try {
      await vault._save();
    } catch (error) {
      // SAFETY: Catch error is checked as an object record before inspecting code.
      const err = error as VaultBoundaryValue;
      if (isObjectRecord(err) && err.code !== "VAULT_RECONCILIATION_REQUIRED") {
        // eslint-disable-next-line no-console
        console.error("Auto-save failed:", error);
      }
    }
  }, 1000);
};

// Keep the async API: synchronous validation failures must remain rejected promises.
// eslint-disable-next-line require-await
export const saveNow = async (
  vault: VaultPersistenceHost,
  _options: VaultBoundaryRecord = {}
): Promise<VaultReconcileExternalResult | undefined> => {
  if (vault.isLocked) {
    throw new Error("Vault is locked");
  }
  if (vault.saveTimeout) {
    clearTimeout(vault.saveTimeout);
    vault.saveTimeout = null;
  }
  return vault._save();
};

export const tickPeriodicDiskSync = async (
  vault: VaultPersistenceHost
): Promise<PeriodicDiskSyncResult> => {
  if (
    vault.isLocked ||
    vault._diskContentHash === null ||
    vault._diskContentHash === undefined
  ) {
    return { didSync: false };
  }
  if (!vault._isDiskStale()) {
    return { didSync: false };
  }
  if (vault._periodicSyncInProgress) {
    return { didSync: false };
  }
  vault._periodicSyncInProgress = true;
  try {
    if (vault.saveTimeout) {
      clearTimeout(vault.saveTimeout);
      vault.saveTimeout = null;
    }
    const result = await vault.reconcileExternalChange({ origin: "periodic" });
    if (result.status === "needs_resolution") {
      return { conflict: true, didSync: false, reconciliation: result };
    }
    return { didSync: result.status === "merged" };
  } catch (error) {
    // SAFETY: Catch error is checked as an object record before inspecting message.
    const err = error as VaultBoundaryValue;
    const message =
      isObjectRecord(err) && isString(err.message)
        ? err.message
        : String(error);
    return { didSync: false, error: message };
  } finally {
    vault._periodicSyncInProgress = false;
  }
};

export const prepareForClose = async (
  vault: VaultPersistenceHost
): Promise<PrepareForCloseResult> => {
  vault._ensureUnlocked();
  if (vault.saveTimeout) {
    clearTimeout(vault.saveTimeout);
    vault.saveTimeout = null;
  }
  const revision = vault.currentRevision;
  try {
    if (!vault.isDirty() && !vault._isDiskStale()) {
      return { revision, status: "clean", vaultId: vault._vaultId };
    }
    const result = await vault._save();
    if (
      result &&
      isObjectRecord(result) &&
      "status" in result &&
      result.status === "needs_resolution"
    ) {
      return {
        code: "VAULT_RECONCILIATION_REQUIRED",
        status: "needs_resolution",
        vaultId: vault._vaultId,
      };
    }
    if (
      vault.currentRevision !== revision &&
      vault.currentRevision !== vault.persistedRevision
    ) {
      return {
        code: "VAULT_REVISION_CHANGED",
        status: "failed",
        vaultId: vault._vaultId,
      };
    }
    return {
      revision: vault.persistedRevision,
      status: "persisted",
      vaultId: vault._vaultId,
    };
  } catch (error) {
    // SAFETY: Catch error is checked as an object record before inspecting code.
    const err = error as VaultBoundaryValue;
    if (
      isObjectRecord(err) &&
      (err.code === "VAULT_RECONCILIATION_REQUIRED" ||
        err.code === VAULT_EXTERNAL_CHANGE)
    ) {
      // SAFETY: err.code was checked above against known reconciliation string literals.
      return {
        code: err.code as string,
        status: "needs_resolution",
        vaultId: vault._vaultId,
      };
    }
    const code =
      isObjectRecord(err) && isString(err.code)
        ? err.code
        : "VAULT_PERSIST_FAILED";
    return {
      code,
      status: "failed",
      vaultId: vault._vaultId,
    };
  }
};

export const getNormalizedCopyOfData = (
  vault: VaultPersistenceHost,
  incoming: VaultBoundaryValue
): VaultData => {
  vault._ensureUnlocked();
  const prev = vault.data;
  // SAFETY: Raw incoming data payload is deep-copied before mutation and normalization.
  vault.data = copyJsonData(incoming as VaultData);
  try {
    vault._normalizeData();
    return copyJsonData(vault.data);
  } finally {
    vault.data = prev;
  }
};

export const getNormalizedCopyWhileLocked = (
  vault: VaultPersistenceHost,
  incoming: VaultBoundaryValue
): VaultData => {
  const wasLocked = vault.isLocked;
  const priorData = vault.data;
  vault.isLocked = false;
  // Closed Vaults retain the existing null public fields; active callers are guarded by _ensureUnlocked.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  vault.data = null!;
  try {
    return getNormalizedCopyOfData(vault, incoming);
  } finally {
    vault.data = priorData;
    vault.isLocked = wasLocked;
  }
};
