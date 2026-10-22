import crypto from "node:crypto";
import fs from "node:fs";
import CryptoUtil = require("./crypto");
import VaultReconciliation = require("./vault-reconciliation");
import { isObjectRecord, isString, sha256Hex } from "./vault-helpers";
import {
  normalizeVaultDataValue,
  VAULT_FORMAT_VERSION,
} from "./vault-normalization";
import type {
  VaultBoundaryValue,
  VaultData,
  VaultReconcileExternalResult,
  VaultSyncBaseline,
} from "./vault-types";

// Closed Vaults retain the existing null public fields; active callers are guarded by _ensureUnlocked.
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
export const SEALED_DATA: VaultData = null!;
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
export const SEALED_KEY: Buffer = null!;

export interface VaultAuthHost {
  vaultPath: string;
  saltPath: string;
  versionedVaultPath: string;
  versionedSaltPath: string;
  legacyVaultPath: string;
  legacySaltPath: string;
  isLocked: boolean;
  key: Buffer | null;
  data: VaultData;
  _needsFormatMigration: boolean;
  vaultInstanceId: string | null;
  saveTimeout: NodeJS.Timeout | null;
  currentRevision: number;
  persistedRevision: number;
  sessionRevision: number;
  _diskContentHash: string | null;
  _syncBaseline: VaultSyncBaseline | null;
  _legacySaltLoadedFingerprint: string | null;
  _pendingLegacyRecoveryFingerprint: { vault: string; salt: string } | null;
  _projectIncarnations: Map<string, string>;
  _environmentIncarnations: Map<string, string>;
  _reconciliation: VaultReconciliation;
  _ensureUnlocked: () => void;
  _resetProjectIncarnations: () => void;
  _atomicWriteCurrent: (options?: { createOnly?: boolean }) => Promise<void>;
  seal: () => void;
  exists: () => boolean;
  _migrateLegacyFiles: () => Promise<boolean>;
  _assertLegacyInputsUnchanged: () => void;
  _persistLegacyIdentity: () => Promise<boolean>;
  _setDiskHashFromCiphertext: (ciphertext: Buffer) => void;
  _normalizeData: () => void;
  _refreshSyncBaseline: () => void;
  _isDiskStale: () => boolean;
  reconcileExternalChange: (options?: {
    origin?: string;
  }) => Promise<VaultReconcileExternalResult>;
  _currentDiskFingerprint: () => string;
}

export const exists = (vault: VaultAuthHost): boolean =>
  (fs.existsSync(vault.vaultPath) && fs.existsSync(vault.saltPath)) ||
  (fs.existsSync(vault.legacyVaultPath) && fs.existsSync(vault.legacySaltPath));

export const setup = async (
  vault: VaultAuthHost,
  password: string
): Promise<void> => {
  vault.vaultPath = vault.versionedVaultPath;
  vault.saltPath = vault.versionedSaltPath;
  if (vault.exists()) {
    throw new Error("Vault already exists");
  }

  if (
    fs.existsSync(vault.legacyVaultPath) ||
    fs.existsSync(vault.legacySaltPath)
  ) {
    throw new Error(
      "Legacy Vault files exist; open the existing Vault to migrate it safely"
    );
  }
  if (fs.existsSync(vault.vaultPath) || fs.existsSync(vault.saltPath)) {
    throw new Error("Versioned Vault files already exist");
  }
  const salt = CryptoUtil.generateSalt();
  const saltTemporaryPath = `${vault.saltPath}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
  fs.writeFileSync(saltTemporaryPath, salt.toString("hex"), {
    flag: "wx",
    mode: 0o600,
  });
  try {
    fs.linkSync(saltTemporaryPath, vault.saltPath);
  } finally {
    fs.unlinkSync(saltTemporaryPath);
  }

  try {
    fs.chmodSync(vault.saltPath, 0o600);
  } catch (error) {
    // SAFETY: Catch error is logged for debugging without throwing.
    const err = error as VaultBoundaryValue;
    const msg =
      isObjectRecord(err) && isString(err.message)
        ? err.message
        : String(error);
    // eslint-disable-next-line no-console
    console.error("Failed to set salt file permissions:", msg);
  }

  vault.key = CryptoUtil.deriveKey(password, salt);

  // Preserve field order in existing serialized, fingerprinted, or encrypted records.
  // eslint-disable-next-line sort-keys
  vault.data = {
    vaultFormatVersion: VAULT_FORMAT_VERSION,
    version: "1.0.0",
    vaultInstanceId: crypto.randomBytes(32).toString("hex"),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    // Preserve field order in existing serialized, fingerprinted, or encrypted records.
    // eslint-disable-next-line sort-keys
    legacySourceFingerprint: { vault: "missing", salt: "missing" },
    favorites: {
      projects: [],
      secrets: Object.create(null),
    },
    projects: Object.create(null),
  };

  vault.vaultInstanceId = vault.data.vaultInstanceId ?? null;
  vault._resetProjectIncarnations();
  vault.currentRevision = 1;
  try {
    await vault._atomicWriteCurrent({ createOnly: true });
    vault.isLocked = false;
  } catch (error) {
    vault.seal();
    throw error;
  }
};

export const seal = (vault: VaultAuthHost): void => {
  if (vault.saveTimeout) {
    clearTimeout(vault.saveTimeout);
  }
  vault.saveTimeout = null;
  vault.data = SEALED_DATA;
  vault._projectIncarnations.clear();
  vault._environmentIncarnations.clear();
  vault._pendingLegacyRecoveryFingerprint = null;
  if (Buffer.isBuffer(vault.key)) {
    vault.key.fill(0);
  }
  vault.key = SEALED_KEY;
  vault._diskContentHash = null;
  vault._syncBaseline = null;
  vault._reconciliation.clearPlan();
  vault.sessionRevision = 0;
  vault.currentRevision = 0;
  vault.persistedRevision = 0;
  vault.vaultInstanceId = null;
  vault.isLocked = true;
};

export const loadVaultData = (
  vault: VaultAuthHost,
  key: Buffer | Uint8Array,
  errorMessage: string
): void => {
  try {
    const stats = fs.statSync(vault.vaultPath);
    // Extract POSIX permission bits without file-type bits.
    // eslint-disable-next-line no-bitwise
    const mode = stats.mode & 0o777;
    if (mode !== 0o600) {
      fs.chmodSync(vault.vaultPath, 0o600);
    }
  } catch {
    // Best-effort cleanup or recovery probing must preserve the primary result.
  }

  const unlockedKey = Buffer.from(key);
  vault.key = unlockedKey;

  try {
    const encryptedData = fs.readFileSync(vault.vaultPath);
    vault._setDiskHashFromCiphertext(encryptedData);
    const decryptedData = CryptoUtil.decryptJson(encryptedData, unlockedKey);
    if (!isObjectRecord(decryptedData)) {
      throw new Error("Invalid vault data");
    }
    const normalized = normalizeVaultDataValue(decryptedData);
    vault.data = normalized.data;
    vault._needsFormatMigration ||= normalized.needsFormatMigration;
    vault.vaultInstanceId = vault.data.vaultInstanceId || null;
    vault.isLocked = false;
    vault._resetProjectIncarnations();
    vault._refreshSyncBaseline();
    vault.sessionRevision += 1;
    vault.currentRevision = 0;
    vault.persistedRevision = 0;
  } catch (error) {
    if (Buffer.isBuffer(vault.key)) {
      vault.key.fill(0);
    }
    vault.key = SEALED_KEY;
    vault.data = SEALED_DATA;
    vault._diskContentHash = null;
    vault._syncBaseline = null;
    vault.sessionRevision = 0;
    vault.currentRevision = 0;
    vault.persistedRevision = 0;
    vault.vaultInstanceId = null;
    vault._reconciliation.clearPlan();
    // SAFETY: Catch error is checked as an object record before examining known error codes.
    const err = error as VaultBoundaryValue;
    if (
      isObjectRecord(err) &&
      (err.code === "VAULT_FORMAT_UNSUPPORTED" ||
        (isString(err.message) &&
          (err.message.includes("Mixed") ||
            err.message.includes("Invalid vault") ||
            err.message.includes("Invalid Vault"))))
    ) {
      throw error;
    }
    throw new Error(errorMessage, { cause: error });
  }
};

export const unlock = async (
  vault: VaultAuthHost,
  password: string
): Promise<void> => {
  vault.vaultPath = vault.versionedVaultPath;
  vault.saltPath = vault.versionedSaltPath;
  if (!vault.exists()) {
    throw new Error("Vault does not exist");
  }

  const hasV2Vault = fs.existsSync(vault.vaultPath);
  const hasV2Salt = fs.existsSync(vault.saltPath);
  if (hasV2Vault !== hasV2Salt) {
    throw new Error(
      "Versioned Vault files are incomplete; restore the encrypted backup before retrying"
    );
  }
  const usingLegacy = !hasV2Vault && fs.existsSync(vault.legacyVaultPath);
  if (usingLegacy) {
    vault.vaultPath = vault.legacyVaultPath;
    vault.saltPath = vault.legacySaltPath;
  }
  try {
    const stats = fs.statSync(vault.saltPath);
    // Extract POSIX permission bits without file-type bits.
    // eslint-disable-next-line no-bitwise
    const mode = stats.mode & 0o777;
    if (mode !== 0o600) {
      fs.chmodSync(vault.saltPath, 0o600);
    }
  } catch {
    // Best-effort cleanup or recovery probing must preserve the primary result.
  }

  const saltBytes = fs.readFileSync(vault.saltPath);
  if (usingLegacy) {
    vault._legacySaltLoadedFingerprint = sha256Hex(saltBytes);
  }
  const saltHex = saltBytes.toString("utf-8");
  const salt = Buffer.from(saltHex, "hex");
  const key = CryptoUtil.deriveKey(password, salt);
  try {
    try {
      loadVaultData(vault, key, "Invalid password");
      if (usingLegacy) {
        await vault._migrateLegacyFiles();
      } else {
        vault._assertLegacyInputsUnchanged();
      }
      await vault._persistLegacyIdentity();
    } catch (error) {
      if (!vault.isLocked) {
        vault.seal();
      }
      vault.vaultPath = vault.versionedVaultPath;
      vault.saltPath = vault.versionedSaltPath;
      throw error;
    }
  } finally {
    key.fill(0);
  }
};

export const unlockWithKey = async (
  vault: VaultAuthHost,
  key: Buffer | Uint8Array
): Promise<void> => {
  vault.vaultPath = vault.versionedVaultPath;
  vault.saltPath = vault.versionedSaltPath;
  if (!vault.exists()) {
    throw new Error("Vault does not exist");
  }
  const hasV2Vault = fs.existsSync(vault.vaultPath);
  const hasV2Salt = fs.existsSync(vault.saltPath);
  if (hasV2Vault !== hasV2Salt) {
    throw new Error(
      "Versioned Vault files are incomplete; restore the encrypted backup before retrying"
    );
  }
  const usingLegacy = !hasV2Vault && fs.existsSync(vault.legacyVaultPath);
  if (usingLegacy) {
    vault.vaultPath = vault.legacyVaultPath;
    vault.saltPath = vault.legacySaltPath;
  }
  try {
    loadVaultData(vault, key, "Invalid key");
    if (usingLegacy) {
      await vault._migrateLegacyFiles();
    } else {
      vault._assertLegacyInputsUnchanged();
    }
    await vault._persistLegacyIdentity();
  } catch (error) {
    if (!vault.isLocked) {
      vault.seal();
    }
    vault.vaultPath = vault.versionedVaultPath;
    vault.saltPath = vault.versionedSaltPath;
    throw error;
  }
};

export const verifyPassword = (
  vault: VaultAuthHost,
  password: string
): boolean => {
  vault._ensureUnlocked();
  if (!password) {
    throw new Error("Password is required");
  }

  const saltHex = fs.readFileSync(vault.saltPath, "utf-8");
  const salt = Buffer.from(saltHex, "hex");
  const derived = CryptoUtil.deriveKey(password, salt);
  // SAFETY: vault.key is non-null when vault is unlocked.
  const activeKey = vault.key as Buffer;
  return derived.length === activeKey.length && derived.equals(activeKey);
};

export const changePassword = async (
  vault: VaultAuthHost,
  currentPassword: string,
  newPassword: string
): Promise<void> => {
  vault._ensureUnlocked();
  if (!currentPassword || !newPassword) {
    throw new Error("Current and new password are required");
  }

  const saltHex = fs.readFileSync(vault.saltPath, "utf-8");
  const salt = Buffer.from(saltHex, "hex");
  const currentKey = CryptoUtil.deriveKey(currentPassword, salt);
  // SAFETY: vault.key is non-null when vault is unlocked.
  const activeKey = vault.key as Buffer;
  if (currentKey.length !== activeKey.length || !currentKey.equals(activeKey)) {
    throw new Error("Invalid current password");
  }

  if (vault._isDiskStale()) {
    const result = await vault.reconcileExternalChange({ origin: "save" });
    if (result.status === "needs_resolution") {
      const error = new Error("Vault reconciliation required");
      error.code = "VAULT_RECONCILIATION_REQUIRED";
      throw error;
    }
  }

  const newSalt = CryptoUtil.generateSalt();
  const newKey = CryptoUtil.deriveKey(newPassword, newSalt);
  const previousKey = vault.key;
  const previousVaultBytes = fs.readFileSync(vault.vaultPath);
  const previousSaltHex = saltHex;
  const saltTemporaryPath = `${vault.saltPath}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
  let vaultReencrypted = false;
  let reencryptedVaultFingerprint: string | null = null;
  let saltReplaced = false;

  vault.key = newKey;
  try {
    await vault._atomicWriteCurrent();
    vaultReencrypted = true;
    reencryptedVaultFingerprint = vault._diskContentHash;
    await fs.promises.writeFile(saltTemporaryPath, newSalt.toString("hex"), {
      encoding: "utf-8",
      mode: 0o600,
    });
    await fs.promises.chmod(saltTemporaryPath, 0o600);
    await fs.promises.rename(saltTemporaryPath, vault.saltPath);
    saltReplaced = true;
  } catch (error) {
    vault.key = previousKey;
    try {
      await fs.promises.unlink(saltTemporaryPath);
    } catch {
      // Best-effort cleanup or recovery probing must preserve the primary result.
    }
    try {
      if (
        vaultReencrypted &&
        vault._currentDiskFingerprint() === reencryptedVaultFingerprint
      ) {
        const vaultRollbackPath = `${vault.vaultPath}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.rollback`;
        await fs.promises.writeFile(vaultRollbackPath, previousVaultBytes, {
          mode: 0o600,
        });
        await fs.promises.rename(vaultRollbackPath, vault.vaultPath);
        vault._setDiskHashFromCiphertext(previousVaultBytes);
        vault._refreshSyncBaseline();
      }
      if (saltReplaced) {
        await fs.promises.writeFile(vault.saltPath, previousSaltHex, {
          encoding: "utf-8",
          mode: 0o600,
        });
      }
    } catch (rollbackError) {
      // SAFETY: Catch error is checked as an object record before extracting message.
      const err = rollbackError as VaultBoundaryValue;
      const msg =
        isObjectRecord(err) && isString(err.message)
          ? err.message
          : String(rollbackError);
      // eslint-disable-next-line no-console
      console.error("Failed to roll back the vault password change:", msg);
    }
    throw error;
  }
};
