import fs from "node:fs";
import path from "node:path";

import {
  finishUnlock,
  ensureSystemVaultInstance,
  sealAllVaults,
} from "./vault-manager-activation.js";
import {
  currentConfigHash,
  defaultVaultsConfig,
  markConfigDirty,
  saveConfig,
} from "./vault-manager-config.js";
import {
  CLOSED_CONFIG,
  CLOSED_SYSTEM_VAULT,
  SYSTEM_VAULT_ID,
  SYSTEM_VAULT_NAME,
  VAULTS_CONFIG_FILE,
} from "./vault-manager-helpers.js";
import {
  collectPendingRecovery,
  createRecoverySnapshots,
  destroySession,
  getRecoveryRecord,
  openSystemFromRecovery,
  resolveRecovery,
} from "./vault-manager-recovery.js";
import {
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
  removeVault,
  renameVault,
  setConflictNotifier,
  switchVault,
  syncAllVaults,
} from "./vault-manager-registry.js";
import type {
  ConfigCloseStatus,
  ConfigSaveResult,
  ConflictNotifier,
  ManagerConfig,
  OpenSessionOptions,
  OpenSessionResult,
  RecoveryStore,
  RegisteredVaultEntry,
  SessionContext,
  VaultCloseResult,
  VaultListEntry,
  VaultSyncResult,
} from "./vault-manager-types.js";
import type { WriteCapsuleRequest } from "./vault-recovery-store-types.js";
import type { RecoverySnapshot } from "./vault-types.js";
import type Vault = require("./vault");

class VaultManager {
  keyharborDir: string;
  configPath: string;
  legacyConfigPath: string;
  systemVault: Vault;
  vaultsConfig: ManagerConfig;
  vaults = new Map<string, Vault>();
  activeVaultId = SYSTEM_VAULT_ID;
  configCurrentRevision = 0;
  configPersistedRevision = 0;
  _configDiskHash: string | null = null;
  recoveryStore: RecoveryStore | null;
  _recoveryGeneration = new Map<string, number>();
  _activationFailures = new Map<string, string>();
  _conflictNotifier: ConflictNotifier | null = null;

  constructor(
    keyharborDir: string,
    options: { recoveryStore?: RecoveryStore } = {}
  ) {
    this.keyharborDir = keyharborDir;
    this.configPath = path.join(keyharborDir, "vaults-v2.enc");
    this.legacyConfigPath = path.join(keyharborDir, VAULTS_CONFIG_FILE);

    this.systemVault = CLOSED_SYSTEM_VAULT;
    this.vaultsConfig = CLOSED_CONFIG;
    // Vault ID to unlocked instance.
    this.vaults = new Map();
    this.activeVaultId = SYSTEM_VAULT_ID;
    this.configCurrentRevision = 0;
    this.configPersistedRevision = 0;
    this._configDiskHash = null;
    this.recoveryStore = options.recoveryStore || null;
    this._recoveryGeneration = new Map();
    this._activationFailures = new Map();
    this._conflictNotifier = null;
  }

  init(): void {
    ensureSystemVaultInstance(this);
  }

  async openSession({
    method,
    credential,
    recoveryHeaders = [],
    signal,
  }: OpenSessionOptions): Promise<OpenSessionResult> {
    if (signal?.aborted) {
      throw signal.reason || new Error("Open cancelled");
    }
    let provisioned = false;
    try {
      if (method === "setup") {
        await this.setupSystemVault(credential);
        provisioned = true;
      } else if (method === "password") {
        await this.unlockAll(credential);
      } else if (method === "key") {
        await this.unlockAllWithKey(credential);
      } else {
        throw new TypeError("Invalid Vault open method");
      }
    } catch (error) {
      if (method === "setup" || !this.recoveryStore) {
        throw error;
      }
      const restored = await openSystemFromRecovery(
        this,
        method,
        credential,
        recoveryHeaders
      );
      if (!restored) {
        throw error;
      }
    }
    if (signal?.aborted) {
      throw signal.reason || new Error("Open cancelled");
    }
    const recovery = collectPendingRecovery(this, recoveryHeaders);
    return {
      createContext: (contextSignal) =>
        this.createSessionContext(contextSignal),
      loggerKey: this.systemVault?.key
        ? Buffer.from(this.systemVault.key)
        : null,
      provisioned,
      recovery,
      state: recovery.length > 0 ? "recovering" : "active",
      vaults: this.getVaultList().map((entry) => {
        const failure = this._activationFailures.get(entry.id);
        const activeStatus =
          entry.status === "unlocked" ? "active" : entry.status;
        return {
          status: failure ? "failed" : activeStatus,
          vaultId: entry.id,
          ...(failure ? { code: failure } : {}),
        };
      }),
    };
  }

  async setupSystemVault(password: string): Promise<void> {
    ensureSystemVaultInstance(this);
    if (this.systemVault.exists()) {
      throw new Error("System vault already exists");
    }
    if (
      fs.existsSync(this.legacyConfigPath) ||
      fs.existsSync(this.configPath)
    ) {
      throw new Error(
        "Vault configuration files exist; open the existing setup before creating a new Vault"
      );
    }
    await this.systemVault.setup(password);
    this.vaultsConfig = defaultVaultsConfig(this);
    markConfigDirty(this);
    saveConfig(this);
  }

  async unlockAll(password: string): Promise<void> {
    ensureSystemVaultInstance(this);
    await this.systemVault.unlock(password);

    await finishUnlock(this);
  }

  async unlockAllWithKey(key: Buffer): Promise<void> {
    ensureSystemVaultInstance(this);
    await this.systemVault.unlockWithKey(key);

    await finishUnlock(this);
  }

  getVaultList(): VaultListEntry[] {
    return getVaultList(this);
  }

  getActiveVault(): Vault | null {
    return getActiveVault(this);
  }

  getActiveVaultId(): string {
    return getActiveVaultId(this);
  }

  async switchVault(vaultId: string): Promise<Vault | undefined> {
    return await switchVault(this, vaultId);
  }

  async createVault(
    name: string,
    folderPath: string,
    vaultPassword: string
  ): Promise<RegisteredVaultEntry> {
    return await createVault(this, name, folderPath, vaultPassword);
  }

  async importVault(
    name: string,
    lkvPath: string,
    vaultPassword: string
  ): Promise<RegisteredVaultEntry> {
    return await importVault(this, name, lkvPath, vaultPassword);
  }

  renameVault(vaultId: string, newName: string): void {
    renameVault(this, vaultId, newName);
  }

  removeVault(vaultId: string): void {
    removeVault(this, vaultId);
  }

  getVaultStatus(vaultId: string): string {
    return getVaultStatus(this, vaultId);
  }

  checkVaultAvailability(vaultId: string): boolean {
    return checkVaultAvailability(this, vaultId);
  }

  async getVaultByName(name: string): Promise<Vault | null> {
    return await getVaultByName(this, name);
  }

  getVaultInstance(vaultId: string): Vault | null {
    return getVaultInstance(this, vaultId);
  }

  saveConfig(): ConfigSaveResult {
    return saveConfig(this);
  }

  async prepareClose(_options = {}): Promise<{
    config: ConfigCloseStatus;
    vaults: VaultCloseResult[];
  }> {
    let config: ConfigCloseStatus;
    try {
      config =
        this.configCurrentRevision === this.configPersistedRevision &&
        currentConfigHash(this.configPath) === this._configDiskHash
          ? { revision: this.configPersistedRevision, status: "clean" }
          : saveConfig(this);
    } catch (error) {
      config = {
        code: error.code || "VAULT_CONFIG_PERSIST_FAILED",
        status: "failed",
      };
    }
    const vaults: VaultCloseResult[] = [];
    if (config.status === "failed") {
      vaults.push({
        code: config.code,
        status: "failed",
        vaultId: "manager_config",
      });
    }
    for (const vault of this.vaults.values()) {
      if (!vault.isLocked) {
        // Drain each Vault in order so close results preserve manager ordering.
        // eslint-disable-next-line no-await-in-loop
        vaults.push(await vault.prepareForClose());
      }
    }
    return { config, vaults };
  }

  // Keep the async API: synchronous validation failures must remain rejected promises.
  // eslint-disable-next-line require-await
  async prepareForClose(
    options = {}
  ): Promise<Awaited<ReturnType<VaultManager["prepareClose"]>>> {
    return this.prepareClose(options);
  }

  createRecoverySnapshots(): RecoverySnapshot[] {
    return createRecoverySnapshots(this);
  }

  sealAllVaults(): void {
    sealAllVaults(this);
  }

  // Keep the async API: synchronous validation failures must remain rejected promises.
  // eslint-disable-next-line require-await
  async sealSession(): Promise<void> {
    this.sealAllVaults();
  }

  // Keep the async API: synchronous validation failures must remain rejected promises.
  // eslint-disable-next-line require-await
  async rollbackOpen(): Promise<void> {
    this.sealAllVaults();
  }

  createSessionContext(signal: AbortSignal): SessionContext {
    const context = {
      security: Object.freeze({
        verifyPassword: (password: string) =>
          this.systemVault?.verifyPassword(password) === true,
      }),
      signal,
      vaults: Object.freeze({
        create: (name: string, folderPath: string, password: string) =>
          this.createVault(name, folderPath, password),
        getByName: async (name: string) =>
          createVaultFacade(
            await this.getVaultByName(name || SYSTEM_VAULT_NAME)
          ),
        import: (name: string, archivePath: string, password: string) =>
          this.importVault(name, archivePath, password),
        list: () => this.getVaultList(),
        remove: (vaultId: string) => this.removeVault(vaultId),
        rename: (vaultId: string, name: string) =>
          this.renameVault(vaultId, name),
        switch: (vaultId: string) => this.switchVault(vaultId),
        syncAll: () => this.syncAllVaults(),
      }),
    };
    Object.defineProperty(context, "activeVault", {
      enumerable: true,
      get: () => createVaultFacade(this.getActiveVault()),
    });
    // SAFETY: the frozen context exposes activeVault through the enumerable
    // accessor installed above; the remaining members were checked directly.
    return Object.freeze(context) as SessionContext;
  }

  async changeSystemPassword(
    currentPassword: string,
    newPassword: string
  ): Promise<{ rotated: boolean }> {
    if (!this.systemVault || this.systemVault.isLocked) {
      throw new Error("System Vault is locked");
    }
    if (this.recoveryStore) {
      const headers = this.recoveryStore.enumerate
        ? await this.recoveryStore.enumerate()
        : this.recoveryStore.listHeaders?.() || [];
      const pending = headers.some(
        (header) =>
          header?.kind === "manager_config" ||
          (header?.artifactId || header?.vaultId) === SYSTEM_VAULT_ID
      );
      if (pending) {
        const error = new Error(
          "Resolve pending Vault recovery before changing the password"
        );
        error.code = "VAULT_RECOVERY_PENDING";
        throw error;
      }
    }
    await this.systemVault.changePassword(currentPassword, newPassword);
    saveConfig(this);
    return { rotated: true };
  }

  copySystemKey(): Buffer {
    if (!this.systemVault?.key || this.systemVault.isLocked) {
      throw new Error("System Vault is locked");
    }
    return Buffer.from(this.systemVault.key);
  }

  async syncAllVaults(): Promise<VaultSyncResult[]> {
    return await syncAllVaults(this);
  }

  getRecoveryRecord(vaultId: string): WriteCapsuleRequest<object> {
    return getRecoveryRecord(this, vaultId);
  }

  async resolveRecovery(
    request: {
      kind?: string;
      artifactId?: string;
      capsuleId?: string;
      decision?: string;
    } = {}
  ): Promise<unknown> {
    return await resolveRecovery(this, request);
  }

  // Keep the async API: synchronous validation failures must remain rejected promises.
  // eslint-disable-next-line require-await
  async destroySession(): Promise<{
    alreadyAbsent: boolean;
    artifacts: { kind: string; status: string; code?: string }[];
  }> {
    return destroySession(this);
  }

  setConflictNotifier(fn: ConflictNotifier | null): void {
    setConflictNotifier(this, fn);
  }
}

export = VaultManager;
