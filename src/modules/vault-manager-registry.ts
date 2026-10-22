import fs from "node:fs";
import path from "node:path";

import { markConfigDirty, saveConfig } from "./vault-manager-config.js";
import {
  SYSTEM_VAULT_ID,
  SYSTEM_VAULT_NAME,
  validateVaultName,
} from "./vault-manager-helpers.js";
import type {
  ConflictNotifier,
  RegisteredVaultEntry,
  VaultFacade,
  VaultListEntry,
  VaultManagerHost,
  VaultSyncResult,
} from "./vault-manager-types.js";
import Vault = require("./vault");

const setConflictNotifier = (
  manager: VaultManagerHost,
  fn: ConflictNotifier | null
): void => {
  manager._conflictNotifier = typeof fn === "function" ? fn : null;
};

const wireVaultConflict = (
  manager: VaultManagerHost,
  vault: Vault | null
): void => {
  if (!vault) {
    return;
  }
  vault.setConflictNotifier((payload) => {
    if (manager._conflictNotifier) {
      manager._conflictNotifier({
        ...payload,
        vaultId: vault.getVaultId(),
      });
    }
  });
};

const checkVaultAvailability = (
  manager: VaultManagerHost,
  vaultId: string
): boolean => {
  if (vaultId === SYSTEM_VAULT_ID) {
    try {
      return fs.existsSync(manager.keyharborDir);
    } catch {
      return false;
    }
  }

  if (!manager.vaultsConfig) {
    return false;
  }

  const vaultConfig = manager.vaultsConfig.otherVaults.find(
    (v) => v.id === vaultId
  );
  if (!vaultConfig) {
    return false;
  }

  try {
    return fs.existsSync(vaultConfig.path);
  } catch {
    return false;
  }
};

const getVaultStatus = (manager: VaultManagerHost, vaultId: string): string => {
  if (!checkVaultAvailability(manager, vaultId)) {
    return "offline";
  }

  const vault = manager.vaults.get(vaultId);
  if (!vault) {
    return "locked";
  }

  return vault.isLocked ? "locked" : "unlocked";
};

const getVaultList = (manager: VaultManagerHost): VaultListEntry[] => {
  const list: VaultListEntry[] = [
    {
      id: SYSTEM_VAULT_ID,
      isActive: manager.activeVaultId === SYSTEM_VAULT_ID,
      isSystem: true,
      name: SYSTEM_VAULT_NAME,
      path: manager.keyharborDir,
      status: getVaultStatus(manager, SYSTEM_VAULT_ID),
    },
  ];

  if (manager.vaultsConfig) {
    for (const v of manager.vaultsConfig.otherVaults) {
      list.push({
        id: v.id,
        isActive: v.id === manager.activeVaultId,
        isSystem: false,
        name: v.name,
        path: v.path,
        status: getVaultStatus(manager, v.id),
      });
    }
  }

  return list;
};

const getActiveVault = (manager: VaultManagerHost): Vault | null => {
  if (manager.activeVaultId === SYSTEM_VAULT_ID) {
    return manager.systemVault;
  }
  return (
    manager.vaults.get(manager.activeVaultId) || manager.systemVault || null
  );
};

const getActiveVaultId = (manager: VaultManagerHost): string =>
  manager.activeVaultId;

const getVaultInstance = (
  manager: VaultManagerHost,
  vaultId: string
): Vault | null => manager.vaults.get(vaultId) || null;

const reactivateVault = async (
  manager: VaultManagerHost,
  vaultId: string
): Promise<Vault | null> => {
  if (!manager.vaultsConfig) {
    return null;
  }
  const vaultEntry = manager.vaultsConfig.otherVaults.find(
    (v) => v.id === vaultId
  );
  if (!vaultEntry || !vaultEntry.encryptionKey) {
    return null;
  }
  if (!checkVaultAvailability(manager, vaultId)) {
    return null;
  }
  let keyBuffer;
  try {
    const vault = new Vault(vaultEntry.path, { vaultId: vaultEntry.id });
    keyBuffer = Buffer.from(vaultEntry.encryptionKey, "hex");
    await vault.unlockWithKey(keyBuffer);
    vault.setVaultId(vaultEntry.id);
    wireVaultConflict(manager, vault);
    manager.vaults.set(vaultId, vault);
    return vault;
  } catch {
    return null;
  } finally {
    if (keyBuffer) {
      keyBuffer.fill(0);
    }
  }
};

const switchVault = async (
  manager: VaultManagerHost,
  vaultId: string
): Promise<Vault | undefined> => {
  if (vaultId === SYSTEM_VAULT_ID) {
    manager.activeVaultId = SYSTEM_VAULT_ID;
    return manager.vaults.get(SYSTEM_VAULT_ID);
  }

  if (!manager.vaultsConfig) {
    throw new Error("Vault config not loaded");
  }

  const vaultEntry = manager.vaultsConfig.otherVaults.find(
    (v) => v.id === vaultId
  );
  if (!vaultEntry) {
    throw new Error(`Vault '${vaultId}' not found`);
  }

  if (!checkVaultAvailability(manager, vaultId)) {
    throw new Error(`Vault '${vaultEntry.name}' is offline`);
  }

  let vault = manager.vaults.get(vaultId);
  if (!vault || vault.isLocked) {
    const reactivated = await reactivateVault(manager, vaultId);
    if (!reactivated) {
      throw new Error(`Vault '${vaultEntry.name}' is not unlocked`);
    }
    vault = reactivated;
  }
  if (!vault || vault.isLocked) {
    throw new Error(`Vault '${vaultEntry.name}' is not unlocked`);
  }

  manager.activeVaultId = vaultId;
  return vault;
};

const getVaultByName = async (
  manager: VaultManagerHost,
  name: string
): Promise<Vault | null> => {
  if (name === SYSTEM_VAULT_NAME) {
    return manager.vaults.get(SYSTEM_VAULT_ID) || null;
  }
  if (!manager.vaultsConfig) {
    return null;
  }
  const entry = manager.vaultsConfig.otherVaults.find((v) => v.name === name);
  if (!entry) {
    return null;
  }
  const vault = manager.vaults.get(entry.id);
  if (!vault || vault.isLocked) {
    return await reactivateVault(manager, entry.id);
  }
  return vault;
};

const registerVaultEntry = (
  manager: VaultManagerHost,
  name: string,
  lkvPath: string,
  vault: Vault
): RegisteredVaultEntry => {
  const id = `vault_${Date.now()}`;
  vault.setVaultId(id);
  wireVaultConflict(manager, vault);
  // Preserve field order in existing serialized, fingerprinted, or encrypted records.
  // eslint-disable-next-line sort-keys
  const vaultEntry = {
    id,
    name,
    path: lkvPath,
    encryptionKey: vault.key.toString("hex"),
    vaultInstanceId: vault.getVaultInstanceId(),
    createdAt: new Date().toISOString(),
  };
  manager.vaultsConfig.otherVaults.push(vaultEntry);
  manager.vaults.set(id, vault);
  markConfigDirty(manager);
  try {
    saveConfig(manager);
  } catch (error) {
    manager.vaultsConfig.otherVaults.pop();
    manager.vaults.delete(id);
    manager.configCurrentRevision = manager.configPersistedRevision;
    vault.seal();
    throw error;
  }
  const { encryptionKey: _key, ...publicEntry } = vaultEntry;
  return publicEntry;
};

const createVault = async (
  manager: VaultManagerHost,
  name: string,
  folderPath: string,
  vaultPassword: string
): Promise<RegisteredVaultEntry> => {
  validateVaultName(name);
  if (!manager.vaultsConfig) {
    throw new Error("Vault config not loaded");
  }
  if (manager.vaultsConfig.otherVaults.some((v) => v.name === name)) {
    throw new Error(`Vault name '${name}' already exists`);
  }

  const lkvPath = path.join(folderPath, "lkv");
  if (manager.vaultsConfig.otherVaults.some((v) => v.path === lkvPath)) {
    throw new Error("A vault already exists at this path");
  }

  fs.mkdirSync(lkvPath, { recursive: true });
  const newVault = new Vault(lkvPath);
  await newVault.setup(vaultPassword);

  return registerVaultEntry(manager, name, lkvPath, newVault);
};

const importVault = async (
  manager: VaultManagerHost,
  name: string,
  lkvPath: string,
  vaultPassword: string
): Promise<RegisteredVaultEntry> => {
  validateVaultName(name);
  if (!manager.vaultsConfig) {
    throw new Error("Vault config not loaded");
  }
  if (manager.vaultsConfig.otherVaults.some((v) => v.name === name)) {
    throw new Error(`Vault name '${name}' already exists`);
  }
  if (manager.vaultsConfig.otherVaults.some((v) => v.path === lkvPath)) {
    throw new Error("This vault path is already added");
  }

  const testVault = new Vault(lkvPath);
  if (!testVault.exists()) {
    throw new Error("No valid vault found at the specified path");
  }

  await testVault.unlock(vaultPassword);

  return registerVaultEntry(manager, name, lkvPath, testVault);
};

const renameVault = (
  manager: VaultManagerHost,
  vaultId: string,
  newName: string
): void => {
  if (vaultId === SYSTEM_VAULT_ID) {
    throw new Error("Cannot rename the System vault");
  }
  if (!manager.vaultsConfig) {
    throw new Error("Vault config not loaded");
  }

  const vaultEntry = manager.vaultsConfig.otherVaults.find(
    (v) => v.id === vaultId
  );
  if (!vaultEntry) {
    throw new Error(`Vault '${vaultId}' not found`);
  }

  validateVaultName(newName);

  if (
    manager.vaultsConfig.otherVaults.some(
      (v) => v.id !== vaultId && v.name === newName
    )
  ) {
    throw new Error(`Vault name '${newName}' already exists`);
  }

  const previousName = vaultEntry.name;
  vaultEntry.name = newName;
  markConfigDirty(manager);
  try {
    saveConfig(manager);
  } catch (error) {
    vaultEntry.name = previousName;
    manager.configCurrentRevision = manager.configPersistedRevision;
    throw error;
  }
};

const removeVault = (manager: VaultManagerHost, vaultId: string): void => {
  if (vaultId === SYSTEM_VAULT_ID) {
    throw new Error("Cannot remove the System vault");
  }
  if (!manager.vaultsConfig) {
    throw new Error("Vault config not loaded");
  }

  const vaultEntry = manager.vaultsConfig.otherVaults.find(
    (v) => v.id === vaultId
  );
  if (!vaultEntry) {
    throw new Error(`Vault '${vaultId}' not found`);
  }

  if (manager.activeVaultId === vaultId) {
    manager.activeVaultId = SYSTEM_VAULT_ID;
  }

  const vault = manager.vaults.get(vaultId);
  if (vault && !vault.isLocked && vault.isDirty()) {
    const error = new Error("Vault must be prepared before removal");
    error.code = "VAULT_REMOVE_REQUIRES_PREPARE";
    throw error;
  }

  const previousConfig = manager.vaultsConfig.otherVaults;
  manager.vaultsConfig.otherVaults = previousConfig.filter(
    (v) => v.id !== vaultId
  );
  markConfigDirty(manager);
  try {
    saveConfig(manager);
  } catch (error) {
    manager.vaultsConfig.otherVaults = previousConfig;
    manager.configCurrentRevision = manager.configPersistedRevision;
    throw error;
  }
  manager.vaults.delete(vaultId);
  if (vault && !vault.isLocked) {
    vault.seal();
  }
};

const syncAllVaults = async (
  manager: VaultManagerHost
): Promise<VaultSyncResult[]> => {
  const results: VaultSyncResult[] = [];
  for (const [vaultId, vault] of manager.vaults) {
    if (vault.isLocked) {
      continue;
    }
    // Serialize disk reconciliation to preserve Vault ordering and limit concurrent writes.
    // eslint-disable-next-line no-await-in-loop
    const result = await vault.tickPeriodicDiskSync();
    results.push({ vaultId, ...result });
  }
  return results;
};

const createVaultFacade = (vault: Vault | null): VaultFacade | null => {
  if (!vault) {
    return null;
  }
  return Object.freeze({
    applySecretImportBatch: vault.applySecretImportBatch.bind(vault),
    captureProjectBackupSnapshot:
      vault.captureProjectBackupSnapshot.bind(vault),
    clearProjectConfigurationBaseline:
      vault.clearProjectConfigurationBaseline.bind(vault),
    createEncryptedProjectBackup:
      vault.createEncryptedProjectBackup.bind(vault),
    createEnvironment: vault.createEnvironment.bind(vault),
    createProject: vault.createProject.bind(vault),
    deleteEnvironment: vault.deleteEnvironment.bind(vault),
    deleteProject: vault.deleteProject.bind(vault),
    deleteSecret: vault.deleteSecret.bind(vault),
    getEnvironmentTargetIdentity:
      vault.getEnvironmentTargetIdentity.bind(vault),
    getEnvironments: vault.getEnvironments.bind(vault),
    getFavorites: vault.getFavorites.bind(vault),
    getImportProjectSnapshot: vault.getImportProjectSnapshot.bind(vault),
    getProjectConfigurationBaseline:
      vault.getProjectConfigurationBaseline.bind(vault),
    getProjects: vault.getProjects.bind(vault),
    getSecret: vault.getSecret.bind(vault),
    getSecretHistory: vault.getSecretHistory.bind(vault),
    getSecrets: vault.getSecrets.bind(vault),
    getStatistics: vault.getStatistics.bind(vault),
    getVaultId: () => vault.getVaultId(),
    getVaultInstanceId: () => vault.getVaultInstanceId(),
    get isLocked() {
      return vault.isLocked;
    },
    reconcileExternalChange: vault.reconcileExternalChange.bind(vault),
    renameEnvironment: vault.renameEnvironment.bind(vault),
    renameSecret: vault.renameSecret.bind(vault),
    replaceProjectConfigurationBaseline:
      vault.replaceProjectConfigurationBaseline.bind(vault),
    resolveEnvironmentTarget: vault.resolveEnvironmentTarget.bind(vault),
    resolveReconciliation: vault.resolveReconciliation.bind(vault),
    restoreEncryptedProjectBackup:
      vault.restoreEncryptedProjectBackup.bind(vault),
    restoreSecretVersion: vault.restoreSecretVersion.bind(vault),
    saveNow: vault.saveNow.bind(vault),
    setDefaultEnvironment: vault.setDefaultEnvironment.bind(vault),
    setSecret: vault.setSecret.bind(vault),
    toggleProjectFavorite: vault.toggleProjectFavorite.bind(vault),
    toggleSecretFavorite: vault.toggleSecretFavorite.bind(vault),
    verifyPassword: vault.verifyPassword.bind(vault),
  });
};

export {
  checkVaultAvailability,
  createVault,
  createVaultFacade,
  getActiveVault,
  getActiveVaultId,
  getVaultByName,
  getVaultInstance,
  getVaultList,
  getVaultStatus,
  importVault,
  reactivateVault,
  registerVaultEntry,
  removeVault,
  renameVault,
  setConflictNotifier,
  switchVault,
  syncAllVaults,
  wireVaultConflict,
};
