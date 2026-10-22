import fs from "node:fs";
import path from "node:path";

import CryptoUtil = require("./crypto");
import {
  ensureSystemVaultInstance,
  finishUnlock,
  sealAllVaults,
} from "./vault-manager-activation.js";
import {
  currentConfigHash,
  defaultVaultsConfig,
  fingerprintPath,
  loadVaultsConfig,
  markConfigDirty,
  normalizeRecoveredVaultsConfig,
  saveConfig,
} from "./vault-manager-config.js";
import {
  copyJsonData,
  hashBytes,
  SYSTEM_VAULT_ID,
} from "./vault-manager-helpers.js";
import { getVaultList } from "./vault-manager-registry.js";
import type {
  RecoveryHeader,
  SessionRecovery,
  VaultManagerHost,
} from "./vault-manager-types.js";
import type { WriteCapsuleRequest } from "./vault-recovery-store-types.js";
import type { RecoverySnapshot } from "./vault-types.js";

const collectPendingRecovery = (
  manager: VaultManagerHost,
  recoveryHeaders: RecoveryHeader[]
): SessionRecovery[] => {
  const knownIds = new Set(manager.vaults.keys());
  const recovery: SessionRecovery[] = [];
  const collectRecovery = (header: RecoveryHeader) => {
    if (
      header.kind !== "manager_config" &&
      !(header.artifactId && knownIds.has(header.artifactId)) &&
      !(header.vaultId && knownIds.has(header.vaultId))
    ) {
      return;
    }
    const vault =
      header.kind === "manager_config"
        ? manager.systemVault
        : manager.vaults.get(
            header.artifactId || header.vaultId || SYSTEM_VAULT_ID
          );
    if (!manager.recoveryStore || !vault?.key) {
      return;
    }
    try {
      manager.recoveryStore.readCapsule(header.capsuleId, vault.key);
    } catch {
      return;
    }
    recovery.push({
      allowedDecisions:
        header.kind === "manager_config"
          ? ["keep_recovered", "use_current", "discard"]
          : ["keep_recovered", "use_current", "discard", "defer"],
      artifactId: header.artifactId || header.vaultId || SYSTEM_VAULT_ID,
      capsuleId: header.capsuleId,
      kind: header.kind || "vault",
      reason: "pending_recovery",
    });
  };
  for (const header of recoveryHeaders) {
    collectRecovery(header);
  }
  return recovery;
};

// Keep the async API: synchronous validation failures must remain rejected promises.
// eslint-disable-next-line require-await
const openSystemFromRecovery = async (
  manager: VaultManagerHost,
  method: string,
  credential: Buffer | string,
  recoveryHeaders: RecoveryHeader[]
): Promise<boolean> => {
  const headers = recoveryHeaders.filter(
    (header) =>
      (header.artifactId || header.vaultId) === SYSTEM_VAULT_ID &&
      header.kind !== "manager_config"
  );
  if (headers.length === 0) {
    return false;
  }
  const { recoveryStore } = manager;
  if (!recoveryStore) {
    return false;
  }
  // Preserve field order in existing serialized, fingerprinted, or encrypted records.
  // eslint-disable-next-line sort-keys
  let legacyRecoveryFingerprint = {
    vault: fingerprintPath(path.join(manager.keyharborDir, "vault.enc")),
    salt: fingerprintPath(path.join(manager.keyharborDir, "salt.txt")),
  };
  let candidateKey;
  try {
    if (method === "key") {
      if (!Buffer.isBuffer(credential) || credential.length !== 32) {
        return false;
      }
      candidateKey = Buffer.from(credential);
    } else {
      const hasVersionedVault = fs.existsSync(
        path.join(manager.keyharborDir, "vault-v2.enc")
      );
      const hasVersionedSalt = fs.existsSync(
        path.join(manager.keyharborDir, "salt-v2.txt")
      );
      if (hasVersionedVault && !hasVersionedSalt) {
        return false;
      }
      const saltPath = hasVersionedSalt
        ? path.join(manager.keyharborDir, "salt-v2.txt")
        : path.join(manager.keyharborDir, "salt.txt");
      if (!fs.existsSync(saltPath)) {
        return false;
      }
      const saltText = fs.readFileSync(saltPath, "utf-8");
      if (!/^[a-f0-9]{64}$/iu.test(saltText)) {
        return false;
      }
      if (saltPath === path.join(manager.keyharborDir, "salt.txt")) {
        legacyRecoveryFingerprint = {
          ...legacyRecoveryFingerprint,
          salt: hashBytes(Buffer.from(saltText)),
        };
      }
      candidateKey = CryptoUtil.deriveKey(
        credential,
        Buffer.from(saltText, "hex")
      );
    }
    for (const header of headers) {
      try {
        const record = recoveryStore.readCapsule(
          header.capsuleId,
          candidateKey
        );
        ensureSystemVaultInstance(manager);
        // SAFETY: readCapsule authenticated and parsed this payload; vault
        // snapshots are JSON records whose sessionData is inspected here only
        // to detect pre-format snapshots.
        const snapshotData = record.payload as {
          sessionData?: { vaultFormatVersion?: number };
        };
        const isLegacySnapshot =
          snapshotData.sessionData?.vaultFormatVersion === undefined;
        manager.systemVault.loadRecoverySnapshot(
          record.payload,
          candidateKey,
          isLegacySnapshot
            ? { legacySourceFingerprint: legacyRecoveryFingerprint }
            : {}
        );
        manager.vaults.set(SYSTEM_VAULT_ID, manager.systemVault);
        try {
          loadVaultsConfig(manager, manager.systemVault.key);
        } catch (error) {
          const hasConfigRecovery = recoveryHeaders.some(
            (item) => item.kind === "manager_config"
          );
          if (!hasConfigRecovery) {
            throw error;
          }
          manager.vaultsConfig = defaultVaultsConfig(manager);
        }
        return true;
      } catch {
        // Best-effort cleanup or recovery probing must preserve the primary result.
      }
    }
    return false;
  } finally {
    if (candidateKey) {
      candidateKey.fill(0);
    }
  }
};

const getRecoveryRecord = (
  manager: VaultManagerHost,
  vaultId: string
): WriteCapsuleRequest<object> => {
  if (vaultId === "manager_config") {
    if (!manager.systemVault?.key || !manager.vaultsConfig) {
      const error = new Error(
        "Manager configuration is unavailable for recovery"
      );
      error.code = "VAULT_RECOVERY_UNAVAILABLE";
      throw error;
    }
    const generation = (manager._recoveryGeneration.get(vaultId) || 0) + 1;
    manager._recoveryGeneration.set(vaultId, generation);
    // Preserve field order in existing serialized, fingerprinted, or encrypted records.
    // eslint-disable-next-line sort-keys
    return {
      key: Buffer.from(manager.systemVault.key),
      kind: "manager_config",
      artifactId: "manager_config",
      vaultId: "manager_config",
      vaultInstanceId: manager.systemVault.getVaultInstanceId(),
      vaultPath: manager.configPath,
      generation,
      // Preserve field order in existing serialized, fingerprinted, or encrypted records.
      // eslint-disable-next-line sort-keys
      payload: {
        config: copyJsonData(manager.vaultsConfig),
        currentRevision: manager.configCurrentRevision,
        persistedRevision: manager.configPersistedRevision,
        diskFingerprint: currentConfigHash(manager.configPath),
      },
    };
  }
  const vault = manager.vaults.get(vaultId);
  if (!vault || vault.isLocked || !vault.key) {
    const error = new Error("Vault is unavailable for recovery");
    error.code = "VAULT_RECOVERY_UNAVAILABLE";
    throw error;
  }
  const generation = (manager._recoveryGeneration.get(vaultId) || 0) + 1;
  manager._recoveryGeneration.set(vaultId, generation);
  // Preserve field order in existing serialized, fingerprinted, or encrypted records.
  // eslint-disable-next-line sort-keys
  return {
    key: Buffer.from(vault.key),
    kind: "vault",
    artifactId: vaultId,
    vaultId,
    vaultInstanceId: vault.getVaultInstanceId(),
    vaultPath: vault.vaultPath,
    generation,
    payload: vault.createRecoverySnapshot(),
  };
};

const resolveRecovery = async (
  manager: VaultManagerHost,
  {
    kind,
    artifactId,
    capsuleId,
    decision,
  }: {
    kind?: string;
    artifactId?: string;
    capsuleId?: string;
    decision?: string;
  } = {}
): Promise<unknown> => {
  const { recoveryStore } = manager;
  if (!recoveryStore) {
    const error = new Error("Recovery store is unavailable");
    error.code = "VAULT_RECOVERY_UNAVAILABLE";
    throw error;
  }
  const key = manager.systemVault?.key;
  if (!key) {
    throw new Error("System Vault is locked");
  }
  if (typeof capsuleId !== "string" || !capsuleId) {
    throw new Error("Recovery capsule ID is required");
  }
  if (decision === "defer") {
    return { recovery: [], state: "active" };
  }
  if (kind === "manager_config") {
    if (decision === "keep_recovered") {
      const record = recoveryStore.readCapsule(capsuleId, key);
      manager.vaultsConfig = normalizeRecoveredVaultsConfig(
        manager,
        record.payload.config
      );
      markConfigDirty(manager);
      saveConfig(manager);
      await finishUnlock(manager);
    }
    recoveryStore.deleteCapsule(capsuleId);
    return {
      recovery: [],
      state: "active",
      vaults: getVaultList(manager).map((entry) => ({
        status: entry.status,
        vaultId: entry.id,
      })),
    };
  }
  if (typeof artifactId !== "string" || !artifactId) {
    throw new Error("Recovery Vault ID is required");
  }
  const vault = manager.vaults.get(artifactId);
  if (!vault) {
    throw new Error("Recovery Vault is unavailable");
  }
  if (decision === "keep_recovered") {
    const record = recoveryStore.readCapsule(capsuleId, vault.key || key);
    vault.loadRecoverySnapshot(record.payload, vault.key || key);
    await vault.approveRecoveredLegacySource();
    await vault.saveNow();
  }
  recoveryStore.deleteCapsule(capsuleId);
  return {
    recovery: [],
    state: "active",
    vaults: getVaultList(manager).map((entry) => ({
      status: entry.status,
      vaultId: entry.id,
    })),
  };
};

const createRecoverySnapshots = (
  manager: VaultManagerHost
): RecoverySnapshot[] =>
  [...manager.vaults.values()]
    .filter((vault) => !vault.isLocked)
    .map((vault) => vault.createRecoverySnapshot());

// Keep the async API: synchronous validation failures must remain rejected promises.
// eslint-disable-next-line require-await
const destroySession = async (
  manager: VaultManagerHost
): Promise<{
  alreadyAbsent: boolean;
  artifacts: { kind: string; status: string; code?: string }[];
}> => {
  sealAllVaults(manager);
  const artifacts: { kind: string; status: string; code?: string }[] = [];
  for (const [kind, target] of [
    ["vault", path.join(manager.keyharborDir, "vault.enc")],
    ["salt", path.join(manager.keyharborDir, "salt.txt")],
    ["vault_v2", path.join(manager.keyharborDir, "vault-v2.enc")],
    ["salt_v2", path.join(manager.keyharborDir, "salt-v2.txt")],
    [
      "vault_migration_backup",
      path.join(manager.keyharborDir, "vault-v1-pre-environments.enc"),
    ],
    [
      "salt_migration_backup",
      path.join(manager.keyharborDir, "salt-v1-pre-environments.txt"),
    ],
    [
      "config_migration_backup",
      path.join(manager.keyharborDir, "vaults-v1-pre-environments.enc"),
    ],
    ["config", manager.configPath],
    ["legacy_config", manager.legacyConfigPath],
    ["logs", path.join(manager.keyharborDir, "logs.enc")],
    ["touch_id", path.join(manager.keyharborDir, "touch-id-key.enc")],
  ]) {
    try {
      fs.unlinkSync(target);
      artifacts.push({ kind, status: "deleted" });
    } catch (error) {
      artifacts.push({
        kind,
        status: error.code === "ENOENT" ? "absent" : "failed",
        ...(error.code ? { code: error.code } : {}),
      });
    }
  }
  return {
    alreadyAbsent: artifacts.every((entry) => entry.status === "absent"),
    artifacts,
  };
};

export {
  collectPendingRecovery,
  createRecoverySnapshots,
  destroySession,
  getRecoveryRecord,
  openSystemFromRecovery,
  resolveRecovery,
};
