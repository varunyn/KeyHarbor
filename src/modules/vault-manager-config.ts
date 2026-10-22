import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import CryptoUtil = require("./crypto");
import { hashBytes, publishImmutableBackup } from "./vault-manager-helpers.js";
import type {
  ConfigSaveResult,
  ManagerConfig,
  RecoveryPayload,
  VaultManagerHost,
} from "./vault-manager-types.js";

const markConfigDirty = (manager: VaultManagerHost): void => {
  manager.configCurrentRevision += 1;
};

const currentConfigHash = (configPath: string): string => {
  try {
    return hashBytes(fs.readFileSync(configPath));
  } catch (error) {
    return error?.code === "ENOENT" ? "missing" : "unreadable";
  }
};

const fingerprintPath = (filePath: string): string => {
  try {
    return hashBytes(fs.readFileSync(filePath));
  } catch (error) {
    return error?.code === "ENOENT" ? "missing" : "unreadable";
  }
};

const assertLegacyConfigUnchanged = (
  manager: VaultManagerHost,
  config: ManagerConfig = manager.vaultsConfig
): void => {
  if (
    fingerprintPath(manager.legacyConfigPath) !== config.legacySourceFingerprint
  ) {
    const error = new Error(
      "Legacy Vault configuration changed after Environment migration; resolve legacy divergence before continuing"
    );
    error.code = "VAULT_CONFIG_LEGACY_DIVERGENCE";
    throw error;
  }
};

const isConfigRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === "string";

type LegacyManagerConfig = Omit<
  ManagerConfig,
  "managerFormatVersion" | "legacySourceFingerprint"
>;

function validateVaultsConfig(
  config: unknown,
  legacy: true
): asserts config is LegacyManagerConfig;
function validateVaultsConfig(
  config: unknown,
  legacy?: false
): asserts config is ManagerConfig;
function validateVaultsConfig(config: unknown, legacy = false): void {
  if (
    !isConfigRecord(config) ||
    config.version !== 1 ||
    !Array.isArray(config.otherVaults)
  ) {
    throw new Error("Invalid Vault configuration");
  }
  if (
    !legacy &&
    (config.managerFormatVersion !== 2 ||
      !isString(config.legacySourceFingerprint))
  ) {
    throw new Error("Invalid Vault configuration format");
  }
  const allowedConfigFields = legacy
    ? new Set(["version", "systemVaultInstanceId", "otherVaults"])
    : new Set([
        "version",
        "managerFormatVersion",
        "systemVaultInstanceId",
        "otherVaults",
        "legacySourceFingerprint",
      ]);
  if (Object.keys(config).some((field) => !allowedConfigFields.has(field))) {
    throw new Error("Invalid Vault configuration fields");
  }
  if (
    config.systemVaultInstanceId !== undefined &&
    config.systemVaultInstanceId !== null &&
    (!isString(config.systemVaultInstanceId) ||
      !/^[a-f0-9]{64}$/iu.test(config.systemVaultInstanceId))
  ) {
    throw new Error("Invalid system Vault instance identity");
  }
  const ids = new Set();
  const paths = new Set();
  const validateVaultEntry = (entry: unknown): void => {
    if (
      !isConfigRecord(entry) ||
      !isString(entry.id) ||
      !isString(entry.name) ||
      !isString(entry.path)
    ) {
      throw new Error("Invalid Vault configuration entry");
    }
    const allowedEntryFields = new Set([
      "id",
      "name",
      "path",
      "encryptionKey",
      "vaultInstanceId",
      "createdAt",
    ]);
    if (Object.keys(entry).some((field) => !allowedEntryFields.has(field))) {
      throw new Error("Invalid Vault configuration entry fields");
    }
    if (!/^[a-f0-9]{64}$/iu.test(String(entry.encryptionKey || ""))) {
      throw new Error("Invalid Vault configuration key");
    }
    if (
      entry.vaultInstanceId !== undefined &&
      !/^[a-f0-9]{64}$/iu.test(String(entry.vaultInstanceId || ""))
    ) {
      throw new Error("Invalid Vault instance identity");
    }
    if (ids.has(entry.id) || paths.has(entry.path)) {
      throw new Error("Duplicate Vault configuration entry");
    }
    ids.add(entry.id);
    paths.add(entry.path);
  };
  for (const entry of config.otherVaults) {
    validateVaultEntry(entry);
  }
}

const defaultVaultsConfig = (manager: VaultManagerHost): ManagerConfig =>
  // Preserve field order in existing serialized, fingerprinted, or encrypted records.
  // eslint-disable-next-line sort-keys
  ({
    version: 1 as const,
    managerFormatVersion: 2,
    systemVaultInstanceId: manager.systemVault?.getVaultInstanceId?.() || null,
    otherVaults: [],
    legacySourceFingerprint: fingerprintPath(manager.legacyConfigPath),
  });

const normalizeRecoveredVaultsConfig = (
  manager: VaultManagerHost,
  config: RecoveryPayload | undefined
): ManagerConfig => {
  if (config?.managerFormatVersion === 2) {
    validateVaultsConfig(config);
    return config;
  }
  validateVaultsConfig(config, true);
  const legacyBytes = fs.existsSync(manager.legacyConfigPath)
    ? fs.readFileSync(manager.legacyConfigPath)
    : null;
  if (legacyBytes) {
    publishImmutableBackup(
      path.join(manager.keyharborDir, "vaults-v1-pre-environments.enc"),
      legacyBytes
    );
  }
  // Preserve field order in existing serialized, fingerprinted, or encrypted records.
  // eslint-disable-next-line sort-keys
  const normalized = {
    ...config,
    managerFormatVersion: 2,
    legacySourceFingerprint: legacyBytes ? hashBytes(legacyBytes) : "missing",
  };
  validateVaultsConfig(normalized);
  return normalized;
};

const saveConfig = (manager: VaultManagerHost): ConfigSaveResult => {
  if (
    !manager.systemVault ||
    manager.systemVault.isLocked ||
    !manager.systemVault.key
  ) {
    console.error(
      "VaultManager: cannot save config while the system vault is locked"
    );
    const error = new Error(
      "VaultManager: cannot save config while the system vault is locked"
    );
    error.code = "VAULT_CONFIG_LOCKED";
    throw error;
  }

  if (!manager.vaultsConfig) {
    manager.vaultsConfig = defaultVaultsConfig(manager);
  }

  validateVaultsConfig(manager.vaultsConfig);
  assertLegacyConfigUnchanged(manager);
  fs.mkdirSync(manager.keyharborDir, { recursive: true });
  const currentConfigHashValue = currentConfigHash(manager.configPath);
  if (
    (manager._configDiskHash !== null &&
      currentConfigHashValue !== manager._configDiskHash) ||
    (manager._configDiskHash === null && currentConfigHashValue !== "missing")
  ) {
    const error = new Error("Vault configuration changed externally");
    error.code = "VAULT_CONFIG_EXTERNAL_CHANGE";
    throw error;
  }
  const encrypted = CryptoUtil.encryptJson(
    manager.vaultsConfig,
    manager.systemVault.key
  );
  const temporaryPath = `${manager.configPath}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temporaryPath, "wx", 0o600);
    fs.writeFileSync(fd, encrypted);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    if (manager._configDiskHash === null) {
      fs.linkSync(temporaryPath, manager.configPath);
      fs.unlinkSync(temporaryPath);
    } else {
      fs.renameSync(temporaryPath, manager.configPath);
    }
    try {
      const directoryFd = fs.openSync(manager.keyharborDir, "r");
      fs.fsyncSync(directoryFd);
      fs.closeSync(directoryFd);
    } catch {
      // Best-effort cleanup or recovery probing must preserve the primary result.
    }
    manager._configDiskHash = hashBytes(encrypted);
    manager.configPersistedRevision = manager.configCurrentRevision;
    return {
      revision: manager.configPersistedRevision,
      status: "persisted",
    };
  } catch (error) {
    if (fd !== undefined) {
      fs.closeSync(fd);
    }
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
      // Best-effort cleanup or recovery probing must preserve the primary result.
    }
    throw error;
  }
};

const loadVaultsConfig = (manager: VaultManagerHost, key: Buffer): void => {
  if (!fs.existsSync(manager.configPath)) {
    if (fs.existsSync(manager.legacyConfigPath)) {
      const legacyBytes = fs.readFileSync(manager.legacyConfigPath);
      try {
        const parsed = CryptoUtil.decryptJson(legacyBytes, key);
        validateVaultsConfig(parsed, true);
        publishImmutableBackup(
          path.join(manager.keyharborDir, "vaults-v1-pre-environments.enc"),
          legacyBytes
        );
        // Preserve field order in existing serialized, fingerprinted, or encrypted records.
        // eslint-disable-next-line sort-keys
        manager.vaultsConfig = {
          ...parsed,
          managerFormatVersion: 2,
          legacySourceFingerprint: hashBytes(legacyBytes),
        };
      } catch (error) {
        const configError = new Error(
          "Legacy Vault configuration is corrupt or unreadable"
        );
        configError.code = "VAULT_SESSION_CONFIG_INVALID";
        configError.cause = error;
        throw configError;
      }
    } else {
      manager.vaultsConfig = defaultVaultsConfig(manager);
    }
    manager._configDiskHash = null;
    manager.configCurrentRevision = 1;
    manager.configPersistedRevision = 0;
    saveConfig(manager);
    return;
  }
  try {
    const data = fs.readFileSync(manager.configPath);
    const parsed = CryptoUtil.decryptJson(data, key);
    validateVaultsConfig(parsed);
    assertLegacyConfigUnchanged(manager, parsed);
    manager.vaultsConfig = parsed;
    manager._configDiskHash = hashBytes(data);
    manager.configCurrentRevision = 0;
    manager.configPersistedRevision = 0;
  } catch (error) {
    const configError = new Error(
      "Vault configuration is corrupt or unreadable"
    );
    configError.code = "VAULT_SESSION_CONFIG_INVALID";
    configError.cause = error;
    throw configError;
  }
};

export {
  assertLegacyConfigUnchanged,
  currentConfigHash,
  defaultVaultsConfig,
  fingerprintPath,
  loadVaultsConfig,
  markConfigDirty,
  normalizeRecoveredVaultsConfig,
  saveConfig,
  validateVaultsConfig,
};
