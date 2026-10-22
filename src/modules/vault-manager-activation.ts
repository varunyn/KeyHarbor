import {
  loadVaultsConfig,
  markConfigDirty,
  saveConfig,
} from "./vault-manager-config.js";
import {
  CLOSED_CONFIG,
  CLOSED_SYSTEM_VAULT,
  SYSTEM_VAULT_ID,
} from "./vault-manager-helpers.js";
import { wireVaultConflict } from "./vault-manager-registry.js";
import type { VaultManagerHost } from "./vault-manager-types.js";
import Vault = require("./vault");

const ensureSystemVaultInstance = (manager: VaultManagerHost): void => {
  if (!manager.systemVault) {
    manager.systemVault = new Vault(manager.keyharborDir);
    manager.systemVault.setVaultId(SYSTEM_VAULT_ID);
    wireVaultConflict(manager, manager.systemVault);
    manager.vaults.set(SYSTEM_VAULT_ID, manager.systemVault);
  }
};

const resetVaultState = (manager: VaultManagerHost): void => {
  manager.vaults.clear();
  manager.systemVault = CLOSED_SYSTEM_VAULT;
  manager.vaultsConfig = CLOSED_CONFIG;
  manager.activeVaultId = SYSTEM_VAULT_ID;
  manager.configCurrentRevision = 0;
  manager.configPersistedRevision = 0;
  manager._configDiskHash = null;
  manager._activationFailures.clear();
};

const sealAllVaults = (manager: VaultManagerHost): void => {
  for (const vault of manager.vaults.values()) {
    vault.seal();
  }
  resetVaultState(manager);
};

const finishUnlock = async (manager: VaultManagerHost): Promise<void> => {
  manager.vaults.set(SYSTEM_VAULT_ID, manager.systemVault);
  manager._activationFailures.clear();

  loadVaultsConfig(manager, manager.systemVault.key);

  let identityMigrationNeeded = false;
  const systemInstanceId = manager.systemVault.getVaultInstanceId();
  if (
    manager.vaultsConfig.systemVaultInstanceId &&
    manager.vaultsConfig.systemVaultInstanceId !== systemInstanceId
  ) {
    const error = new Error(
      "System Vault identity does not match configuration"
    );
    error.code = "VAULT_IDENTITY_MISMATCH";
    throw error;
  }
  if (!manager.vaultsConfig.systemVaultInstanceId) {
    manager.vaultsConfig.systemVaultInstanceId = systemInstanceId;
    identityMigrationNeeded = true;
  }
  await Promise.all(
    manager.vaultsConfig.otherVaults
      .filter((v) => v.encryptionKey)
      .map(async (vaultEntry) => {
        let keyBuffer;
        try {
          const vault = new Vault(vaultEntry.path, {
            vaultId: vaultEntry.id,
          });
          if (!vault.exists()) {
            return;
          }
          keyBuffer = Buffer.from(vaultEntry.encryptionKey, "hex");
          await vault.unlockWithKey(keyBuffer);
          if (
            vaultEntry.vaultInstanceId &&
            vaultEntry.vaultInstanceId !== vault.getVaultInstanceId()
          ) {
            const error = new Error(
              "Vault identity does not match configuration"
            );
            error.code = "VAULT_IDENTITY_MISMATCH";
            throw error;
          }
          if (!vaultEntry.vaultInstanceId) {
            vaultEntry.vaultInstanceId = vault.getVaultInstanceId();
            identityMigrationNeeded = true;
          }
          vault.setVaultId(vaultEntry.id);
          wireVaultConflict(manager, vault);
          manager.vaults.set(vaultEntry.id, vault);
        } catch (error) {
          manager._activationFailures.set(
            vaultEntry.id,
            error.code || "VAULT_SECONDARY_OPEN_FAILED"
          );
          console.error(
            `Failed to auto-unlock vault "${vaultEntry.name}":`,
            error.message
          );
        } finally {
          if (keyBuffer) {
            keyBuffer.fill(0);
          }
        }
      })
  );
  if (identityMigrationNeeded) {
    markConfigDirty(manager);
    saveConfig(manager);
  }
};

export {
  ensureSystemVaultInstance,
  finishUnlock,
  resetVaultState,
  sealAllVaults,
};
