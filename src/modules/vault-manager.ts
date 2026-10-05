import crypto = require("node:crypto");
import fs = require("node:fs");
import path = require("node:path");
import Vault = require("./vault");
import CryptoUtil = require("./crypto");

// Copy through the persisted JSON format: retain its omission and coercion behavior.
const copyJsonData = <T>(value: T): T =>
  // eslint-disable-next-line unicorn/prefer-structured-clone
  JSON.parse(JSON.stringify(value));

const VAULTS_CONFIG_FILE = "vaults.enc";
const INVALID_NAME_CHARS = /[/\\*?"<>|]/u;
const SYSTEM_VAULT_ID = "system";
const SYSTEM_VAULT_NAME = "System";

interface VaultEntry {
  id: string;
  name: string;
  path: string;
  encryptionKey: string;
  vaultInstanceId?: string | null;
  createdAt: string;
}
interface ManagerConfig {
  version: 1;
  managerFormatVersion: 2;
  systemVaultInstanceId: string | null;
  otherVaults: VaultEntry[];
  legacySourceFingerprint: string;
}
interface RecoveryPayload {
  sessionData?: unknown;
  baseline?: unknown;
  config?: unknown;
  [key: string]: unknown;
}
interface RecoveryStore {
  enumerate?: () => Promise<RecoveryHeader[]>;
  listHeaders?: () => RecoveryHeader[];
  readCapsule: (id: string, key: Buffer) => { payload: RecoveryPayload };
  deleteCapsule: (id: string) => void;
  beginDestruction?: () => void;
  hasDestructionTombstone?: () => boolean;
  finishDestruction?: () => void;
}
interface RecoveryHeader {
  kind?: "vault" | "manager_config";
  artifactId?: string;
  vaultId?: string;
  capsuleId: string;
}
interface SessionRecovery {
  kind: "vault" | "manager_config";
  artifactId: string;
  capsuleId: string;
  reason: "pending_recovery";
  allowedDecisions: ("keep_recovered" | "use_current" | "discard" | "defer")[];
}
interface VaultCloseResult {
  vaultId: string | null;
  status: string;
  code?: string;
  revision?: number;
}
interface VaultSyncResult {
  vaultId: string;
  didSync: boolean;
  conflict?: boolean;
  reconciliation?: unknown;
  error?: string;
}
interface OpenSessionOptions {
  method: "setup" | "password" | "key";
  credential: Buffer | string;
  recoveryHeaders?: RecoveryHeader[];
  signal?: AbortSignal;
}
type VaultFacade = Pick<
  Vault,
  | "getVaultId"
  | "getVaultInstanceId"
  | "resolveEnvironmentTarget"
  | "getEnvironmentTargetIdentity"
  | "captureProjectBackupSnapshot"
  | "getEnvironments"
  | "createEnvironment"
  | "renameEnvironment"
  | "deleteEnvironment"
  | "setDefaultEnvironment"
  | "getImportProjectSnapshot"
  | "applySecretImportBatch"
  | "getProjectConfigurationBaseline"
  | "replaceProjectConfigurationBaseline"
  | "clearProjectConfigurationBaseline"
  | "getProjects"
  | "createProject"
  | "deleteProject"
  | "getSecrets"
  | "getSecret"
  | "setSecret"
  | "renameSecret"
  | "deleteSecret"
  | "getSecretHistory"
  | "restoreSecretVersion"
  | "getFavorites"
  | "toggleProjectFavorite"
  | "toggleSecretFavorite"
  | "getStatistics"
  | "verifyPassword"
  | "saveNow"
  | "reconcileExternalChange"
  | "resolveReconciliation"
  | "createEncryptedProjectBackup"
  | "restoreEncryptedProjectBackup"
> & { readonly isLocked: boolean };

// Preserve null construction/closed-session fields while the active facade retains its existing types.
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const CLOSED_SYSTEM_VAULT: Vault = null!;
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const CLOSED_CONFIG: ManagerConfig = null!;

class VaultManager {
  keyharborDir: string;
  configPath: string;
  legacyConfigPath: string;
  systemVault: Vault = CLOSED_SYSTEM_VAULT;
  vaultsConfig: ManagerConfig = CLOSED_CONFIG;
  vaults = new Map<string, Vault>();
  activeVaultId = SYSTEM_VAULT_ID;
  configCurrentRevision = 0;
  configPersistedRevision = 0;
  _configDiskHash: string | null = null;
  recoveryStore: RecoveryStore | null;
  _recoveryGeneration = new Map<string, number>();
  _activationFailures = new Map<string, string>();
  _conflictNotifier:
    | ((payload: { vaultId: string | null; reason?: string }) => void)
    | null = null;
  _legacyConfigFingerprint: string | null = null;

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
    /** @type {((payload: { vaultId: string | null; reason?: string }) => void) | null} */
    this._conflictNotifier = null;
  }

  init() {
    this._ensureSystemVaultInstance();
  }

  async openSession({
    method,
    credential,
    recoveryHeaders = [],
    signal,
  }: OpenSessionOptions) {
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
      const restored = await this._openSystemFromRecovery(
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
    const knownIds = new Set(this.vaults.keys());
    const recovery: SessionRecovery[] = [];
    const collectRecovery = (header) => {
      if (
        header.kind !== "manager_config" &&
        !(header.artifactId && knownIds.has(header.artifactId)) &&
        !(header.vaultId && knownIds.has(header.vaultId))
      ) {
        return;
      }
      const vault =
        header.kind === "manager_config"
          ? this.systemVault
          : this.vaults.get(
              header.artifactId || header.vaultId || SYSTEM_VAULT_ID
            );
      if (!this.recoveryStore || !vault?.key) {
        return;
      }
      try {
        this.recoveryStore.readCapsule(header.capsuleId, vault.key);
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

  // Keep the async API: synchronous validation failures must remain rejected promises.
  // eslint-disable-next-line require-await
  async _openSystemFromRecovery(
    method: string,
    credential: Buffer | string,
    recoveryHeaders: RecoveryHeader[]
  ) {
    const headers = recoveryHeaders.filter(
      (header) =>
        (header.artifactId || header.vaultId) === SYSTEM_VAULT_ID &&
        header.kind !== "manager_config"
    );
    if (headers.length === 0) {
      return false;
    }
    const { recoveryStore } = this;
    if (!recoveryStore) {
      return false;
    }
    // Preserve field order in existing serialized, fingerprinted, or encrypted records.
    // eslint-disable-next-line sort-keys
    let legacyRecoveryFingerprint = {
      vault: this._fingerprintPath(path.join(this.keyharborDir, "vault.enc")),
      salt: this._fingerprintPath(path.join(this.keyharborDir, "salt.txt")),
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
          path.join(this.keyharborDir, "vault-v2.enc")
        );
        const hasVersionedSalt = fs.existsSync(
          path.join(this.keyharborDir, "salt-v2.txt")
        );
        if (hasVersionedVault && !hasVersionedSalt) {
          return false;
        }
        const saltPath = hasVersionedSalt
          ? path.join(this.keyharborDir, "salt-v2.txt")
          : path.join(this.keyharborDir, "salt.txt");
        if (!fs.existsSync(saltPath)) {
          return false;
        }
        const saltText = fs.readFileSync(saltPath, "utf-8");
        if (!/^[a-f0-9]{64}$/iu.test(saltText)) {
          return false;
        }
        if (saltPath === path.join(this.keyharborDir, "salt.txt")) {
          legacyRecoveryFingerprint = {
            ...legacyRecoveryFingerprint,
            salt: this._hash(Buffer.from(saltText)),
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
          this._ensureSystemVaultInstance();
          const snapshotData = record.payload as {
            sessionData?: { vaultFormatVersion?: number };
          };
          const isLegacySnapshot =
            snapshotData.sessionData?.vaultFormatVersion === undefined;
          this.systemVault.loadRecoverySnapshot(
            record.payload,
            candidateKey,
            isLegacySnapshot
              ? { legacySourceFingerprint: legacyRecoveryFingerprint }
              : {}
          );
          this.vaults.set(SYSTEM_VAULT_ID, this.systemVault);
          try {
            this._loadVaultsConfig(this.systemVault.key);
          } catch (error) {
            const hasConfigRecovery = recoveryHeaders.some(
              (item) => item.kind === "manager_config"
            );
            if (!hasConfigRecovery) {
              throw error;
            }
            this.vaultsConfig = this._defaultVaultsConfig();
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
  }

  setConflictNotifier(fn) {
    this._conflictNotifier = typeof fn === "function" ? fn : null;
  }

  _wireVaultConflict(vault: Vault | null) {
    if (!vault) {
      return;
    }
    vault.setConflictNotifier((payload) => {
      if (this._conflictNotifier) {
        this._conflictNotifier({
          ...payload,
          vaultId: vault.getVaultId(),
        });
      }
    });
  }

  async setupSystemVault(password) {
    this._ensureSystemVaultInstance();
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
    this.vaultsConfig = this._defaultVaultsConfig();
    this._markConfigDirty();
    this.saveConfig();
  }

  async unlockAll(password) {
    this._ensureSystemVaultInstance();
    await this.systemVault.unlock(password);

    await this._finishUnlock();
  }

  async unlockAllWithKey(key) {
    this._ensureSystemVaultInstance();
    await this.systemVault.unlockWithKey(key);

    await this._finishUnlock();
  }

  async _finishUnlock() {
    this.vaults.set(SYSTEM_VAULT_ID, this.systemVault);
    this._activationFailures.clear();

    this._loadVaultsConfig(this.systemVault.key);

    let identityMigrationNeeded = false;
    const systemInstanceId = this.systemVault.getVaultInstanceId();
    if (
      this.vaultsConfig.systemVaultInstanceId &&
      this.vaultsConfig.systemVaultInstanceId !== systemInstanceId
    ) {
      const error = new Error(
        "System Vault identity does not match configuration"
      );
      error.code = "VAULT_IDENTITY_MISMATCH";
      throw error;
    }
    if (!this.vaultsConfig.systemVaultInstanceId) {
      this.vaultsConfig.systemVaultInstanceId = systemInstanceId;
      identityMigrationNeeded = true;
    }
    await Promise.all(
      this.vaultsConfig.otherVaults
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
            this._wireVaultConflict(vault);
            this.vaults.set(vaultEntry.id, vault);
          } catch (error) {
            this._activationFailures.set(
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
      this._markConfigDirty();
      this.saveConfig();
    }
  }

  getVaultList() {
    const list = [
      {
        id: SYSTEM_VAULT_ID,
        isActive: this.activeVaultId === SYSTEM_VAULT_ID,
        isSystem: true,
        name: SYSTEM_VAULT_NAME,
        path: this.keyharborDir,
        status: this.getVaultStatus(SYSTEM_VAULT_ID),
      },
    ];

    if (this.vaultsConfig) {
      for (const v of this.vaultsConfig.otherVaults) {
        list.push({
          id: v.id,
          isActive: v.id === this.activeVaultId,
          isSystem: false,
          name: v.name,
          path: v.path,
          status: this.getVaultStatus(v.id),
        });
      }
    }

    return list;
  }

  getActiveVault() {
    if (this.activeVaultId === SYSTEM_VAULT_ID) {
      return this.systemVault;
    }
    return this.vaults.get(this.activeVaultId) || this.systemVault || null;
  }

  getActiveVaultId() {
    return this.activeVaultId;
  }

  async switchVault(vaultId) {
    if (vaultId === SYSTEM_VAULT_ID) {
      this.activeVaultId = SYSTEM_VAULT_ID;
      return this.vaults.get(SYSTEM_VAULT_ID);
    }

    if (!this.vaultsConfig) {
      throw new Error("Vault config not loaded");
    }

    const vaultEntry = this.vaultsConfig.otherVaults.find(
      (v) => v.id === vaultId
    );
    if (!vaultEntry) {
      throw new Error(`Vault '${vaultId}' not found`);
    }

    if (!this.checkVaultAvailability(vaultId)) {
      throw new Error(`Vault '${vaultEntry.name}' is offline`);
    }

    let vault = this.vaults.get(vaultId);
    if (!vault || vault.isLocked) {
      const reactivated = await this._reactivateVault(vaultId);
      if (!reactivated) {
        throw new Error(`Vault '${vaultEntry.name}' is not unlocked`);
      }
      vault = reactivated;
    }
    if (!vault || vault.isLocked) {
      throw new Error(`Vault '${vaultEntry.name}' is not unlocked`);
    }

    this.activeVaultId = vaultId;
    return vault;
  }

  async createVault(name: string, folderPath: string, vaultPassword: string) {
    this._validateVaultName(name);
    if (!this.vaultsConfig) {
      throw new Error("Vault config not loaded");
    }
    if (this.vaultsConfig.otherVaults.some((v) => v.name === name)) {
      throw new Error(`Vault name '${name}' already exists`);
    }

    const lkvPath = path.join(folderPath, "lkv");
    if (this.vaultsConfig.otherVaults.some((v) => v.path === lkvPath)) {
      throw new Error("A vault already exists at this path");
    }

    fs.mkdirSync(lkvPath, { recursive: true });
    const newVault = new Vault(lkvPath);
    await newVault.setup(vaultPassword);

    return this._registerVaultEntry(name, lkvPath, newVault);
  }

  async importVault(name: string, lkvPath: string, vaultPassword: string) {
    this._validateVaultName(name);
    if (!this.vaultsConfig) {
      throw new Error("Vault config not loaded");
    }
    if (this.vaultsConfig.otherVaults.some((v) => v.name === name)) {
      throw new Error(`Vault name '${name}' already exists`);
    }
    if (this.vaultsConfig.otherVaults.some((v) => v.path === lkvPath)) {
      throw new Error("This vault path is already added");
    }

    const testVault = new Vault(lkvPath);
    if (!testVault.exists()) {
      throw new Error("No valid vault found at the specified path");
    }

    await testVault.unlock(vaultPassword);

    return this._registerVaultEntry(name, lkvPath, testVault);
  }

  renameVault(vaultId, newName) {
    if (vaultId === SYSTEM_VAULT_ID) {
      throw new Error("Cannot rename the System vault");
    }
    if (!this.vaultsConfig) {
      throw new Error("Vault config not loaded");
    }

    const vaultEntry = this.vaultsConfig.otherVaults.find(
      (v) => v.id === vaultId
    );
    if (!vaultEntry) {
      throw new Error(`Vault '${vaultId}' not found`);
    }

    this._validateVaultName(newName);

    if (
      this.vaultsConfig.otherVaults.some(
        (v) => v.id !== vaultId && v.name === newName
      )
    ) {
      throw new Error(`Vault name '${newName}' already exists`);
    }

    const previousName = vaultEntry.name;
    vaultEntry.name = newName;
    this._markConfigDirty();
    try {
      this.saveConfig();
    } catch (error) {
      vaultEntry.name = previousName;
      this.configCurrentRevision = this.configPersistedRevision;
      throw error;
    }
  }

  removeVault(vaultId) {
    if (vaultId === SYSTEM_VAULT_ID) {
      throw new Error("Cannot remove the System vault");
    }
    if (!this.vaultsConfig) {
      throw new Error("Vault config not loaded");
    }

    const vaultEntry = this.vaultsConfig.otherVaults.find(
      (v) => v.id === vaultId
    );
    if (!vaultEntry) {
      throw new Error(`Vault '${vaultId}' not found`);
    }

    if (this.activeVaultId === vaultId) {
      this.activeVaultId = SYSTEM_VAULT_ID;
    }

    const vault = this.vaults.get(vaultId);
    if (vault && !vault.isLocked && vault.isDirty()) {
      const error = new Error("Vault must be prepared before removal");
      error.code = "VAULT_REMOVE_REQUIRES_PREPARE";
      throw error;
    }

    const previousConfig = this.vaultsConfig.otherVaults;
    this.vaultsConfig.otherVaults = previousConfig.filter(
      (v) => v.id !== vaultId
    );
    this._markConfigDirty();
    try {
      this.saveConfig();
    } catch (error) {
      this.vaultsConfig.otherVaults = previousConfig;
      this.configCurrentRevision = this.configPersistedRevision;
      throw error;
    }
    this.vaults.delete(vaultId);
    if (vault && !vault.isLocked) {
      vault.seal();
    }
  }

  getVaultStatus(vaultId) {
    if (!this.checkVaultAvailability(vaultId)) {
      return "offline";
    }

    const vault = this.vaults.get(vaultId);
    if (!vault) {
      return "locked";
    }

    return vault.isLocked ? "locked" : "unlocked";
  }

  checkVaultAvailability(vaultId) {
    if (vaultId === SYSTEM_VAULT_ID) {
      try {
        return fs.existsSync(this.keyharborDir);
      } catch {
        return false;
      }
    }

    if (!this.vaultsConfig) {
      return false;
    }

    const vaultConfig = this.vaultsConfig.otherVaults.find(
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
  }

  async getVaultByName(name) {
    if (name === SYSTEM_VAULT_NAME) {
      return this.vaults.get(SYSTEM_VAULT_ID) || null;
    }
    if (!this.vaultsConfig) {
      return null;
    }
    const entry = this.vaultsConfig.otherVaults.find((v) => v.name === name);
    if (!entry) {
      return null;
    }
    const vault = this.vaults.get(entry.id);
    if (!vault || vault.isLocked) {
      return await this._reactivateVault(entry.id);
    }
    return vault;
  }

  getVaultInstance(vaultId) {
    return this.vaults.get(vaultId) || null;
  }

  saveConfig() {
    if (
      !this.systemVault ||
      this.systemVault.isLocked ||
      !this.systemVault.key
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

    if (!this.vaultsConfig) {
      this.vaultsConfig = this._defaultVaultsConfig();
    }

    this._validateVaultsConfig(this.vaultsConfig);
    this._assertLegacyConfigUnchanged();
    fs.mkdirSync(this.keyharborDir, { recursive: true });
    const currentConfigHash = this._currentConfigHash();
    if (
      (this._configDiskHash !== null &&
        currentConfigHash !== this._configDiskHash) ||
      (this._configDiskHash === null && currentConfigHash !== "missing")
    ) {
      const error = new Error("Vault configuration changed externally");
      error.code = "VAULT_CONFIG_EXTERNAL_CHANGE";
      throw error;
    }
    const encrypted = CryptoUtil.encryptJson(
      this.vaultsConfig,
      this.systemVault.key
    );
    const temporaryPath = `${this.configPath}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
    let fd;
    try {
      fd = fs.openSync(temporaryPath, "wx", 0o600);
      fs.writeFileSync(fd, encrypted);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      if (this._configDiskHash === null) {
        fs.linkSync(temporaryPath, this.configPath);
        fs.unlinkSync(temporaryPath);
      } else {
        fs.renameSync(temporaryPath, this.configPath);
      }
      try {
        const directoryFd = fs.openSync(this.keyharborDir, "r");
        fs.fsyncSync(directoryFd);
        fs.closeSync(directoryFd);
      } catch {
        // Best-effort cleanup or recovery probing must preserve the primary result.
      }
      this._configDiskHash = this._hash(encrypted);
      this.configPersistedRevision = this.configCurrentRevision;
      return { revision: this.configPersistedRevision, status: "persisted" };
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
  }

  async prepareClose(_options = {}) {
    let config;
    try {
      config =
        this.configCurrentRevision === this.configPersistedRevision &&
        this._currentConfigHash() === this._configDiskHash
          ? { revision: this.configPersistedRevision, status: "clean" }
          : this.saveConfig();
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
  async prepareForClose(options = {}) {
    return this.prepareClose(options);
  }

  createRecoverySnapshots() {
    return [...this.vaults.values()]
      .filter((vault) => !vault.isLocked)
      .map((vault) => vault.createRecoverySnapshot());
  }

  sealAllVaults() {
    for (const vault of this.vaults.values()) {
      vault.seal();
    }
    this._resetVaultState();
  }

  // Keep the async API: synchronous validation failures must remain rejected promises.
  // eslint-disable-next-line require-await
  async sealSession() {
    this.sealAllVaults();
  }

  // Keep the async API: synchronous validation failures must remain rejected promises.
  // eslint-disable-next-line require-await
  async rollbackOpen() {
    this.sealAllVaults();
  }

  createSessionContext(signal): {
    signal: AbortSignal;
    activeVault: VaultFacade;
    vaults: unknown;
    security: unknown;
  } {
    const context = {
      security: Object.freeze({
        verifyPassword: (password) =>
          this.systemVault?.verifyPassword(password) === true,
      }),
      signal,
      vaults: Object.freeze({
        create: (name: string, folderPath: string, password: string) =>
          this.createVault(name, folderPath, password),
        getByName: async (name) =>
          this._createVaultFacade(
            await this.getVaultByName(name || SYSTEM_VAULT_NAME)
          ),
        import: (name: string, archivePath: string, password: string) =>
          this.importVault(name, archivePath, password),
        list: () => this.getVaultList(),
        remove: (vaultId: string) => this.removeVault(vaultId),
        rename: (vaultId: string, name: string) =>
          this.renameVault(vaultId, name),
        switch: (vaultId) => this.switchVault(vaultId),
        syncAll: () => this.syncAllVaults(),
      }),
    };
    Object.defineProperty(context, "activeVault", {
      enumerable: true,
      get: () => this._createVaultFacade(this.getActiveVault()),
    });
    return Object.freeze(context) as ReturnType<
      VaultManager["createSessionContext"]
    >;
  }

  async changeSystemPassword(currentPassword, newPassword) {
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
    this.saveConfig();
    return { rotated: true };
  }

  copySystemKey() {
    if (!this.systemVault?.key || this.systemVault.isLocked) {
      throw new Error("System Vault is locked");
    }
    return Buffer.from(this.systemVault.key);
  }

  // Keep this helper on the existing overridable instance API.
  // eslint-disable-next-line class-methods-use-this
  _createVaultFacade(vault: Vault | null): VaultFacade | null {
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
  }

  async syncAllVaults() {
    const results: VaultSyncResult[] = [];
    for (const [vaultId, vault] of this.vaults) {
      if (vault.isLocked) {
        continue;
      }
      // Serialize disk reconciliation to preserve Vault ordering and limit concurrent writes.
      // eslint-disable-next-line no-await-in-loop
      const result = await vault.tickPeriodicDiskSync();
      results.push({ vaultId, ...result });
    }
    return results;
  }

  getRecoveryRecord(vaultId) {
    if (vaultId === "manager_config") {
      if (!this.systemVault?.key || !this.vaultsConfig) {
        const error = new Error(
          "Manager configuration is unavailable for recovery"
        );
        error.code = "VAULT_RECOVERY_UNAVAILABLE";
        throw error;
      }
      const generation = (this._recoveryGeneration.get(vaultId) || 0) + 1;
      this._recoveryGeneration.set(vaultId, generation);
      // Preserve field order in existing serialized, fingerprinted, or encrypted records.
      // eslint-disable-next-line sort-keys
      return {
        key: Buffer.from(this.systemVault.key),
        kind: "manager_config",
        artifactId: "manager_config",
        vaultId: "manager_config",
        vaultInstanceId: this.systemVault.getVaultInstanceId(),
        vaultPath: this.configPath,
        generation,
        // Preserve field order in existing serialized, fingerprinted, or encrypted records.
        // eslint-disable-next-line sort-keys
        payload: {
          config: copyJsonData(this.vaultsConfig),
          currentRevision: this.configCurrentRevision,
          persistedRevision: this.configPersistedRevision,
          diskFingerprint: this._currentConfigHash(),
        },
      };
    }
    const vault = this.vaults.get(vaultId);
    if (!vault || vault.isLocked || !vault.key) {
      const error = new Error("Vault is unavailable for recovery");
      error.code = "VAULT_RECOVERY_UNAVAILABLE";
      throw error;
    }
    const generation = (this._recoveryGeneration.get(vaultId) || 0) + 1;
    this._recoveryGeneration.set(vaultId, generation);
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
  }

  async resolveRecovery({
    kind,
    artifactId,
    capsuleId,
    decision,
  }: {
    kind?: string;
    artifactId?: string;
    capsuleId?: string;
    decision?: string;
  } = {}) {
    const { recoveryStore } = this;
    if (!recoveryStore) {
      const error = new Error("Recovery store is unavailable");
      error.code = "VAULT_RECOVERY_UNAVAILABLE";
      throw error;
    }
    const key = this.systemVault?.key;
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
        this.vaultsConfig = this._normalizeRecoveredVaultsConfig(
          record.payload.config
        );
        this._markConfigDirty();
        this.saveConfig();
        await this._finishUnlock();
      }
      recoveryStore.deleteCapsule(capsuleId);
      return {
        recovery: [],
        state: "active",
        vaults: this.getVaultList().map((entry) => ({
          status: entry.status,
          vaultId: entry.id,
        })),
      };
    }
    if (typeof artifactId !== "string" || !artifactId) {
      throw new Error("Recovery Vault ID is required");
    }
    const vault = this.vaults.get(artifactId);
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
      vaults: this.getVaultList().map((entry) => ({
        status: entry.status,
        vaultId: entry.id,
      })),
    };
  }

  // Keep the async API: synchronous validation failures must remain rejected promises.
  // eslint-disable-next-line require-await
  async destroySession() {
    this.sealAllVaults();
    const artifacts: { kind: string; status: string; code?: string }[] = [];
    for (const [kind, target] of [
      ["vault", path.join(this.keyharborDir, "vault.enc")],
      ["salt", path.join(this.keyharborDir, "salt.txt")],
      ["vault_v2", path.join(this.keyharborDir, "vault-v2.enc")],
      ["salt_v2", path.join(this.keyharborDir, "salt-v2.txt")],
      [
        "vault_migration_backup",
        path.join(this.keyharborDir, "vault-v1-pre-environments.enc"),
      ],
      [
        "salt_migration_backup",
        path.join(this.keyharborDir, "salt-v1-pre-environments.txt"),
      ],
      [
        "config_migration_backup",
        path.join(this.keyharborDir, "vaults-v1-pre-environments.enc"),
      ],
      ["config", this.configPath],
      ["legacy_config", this.legacyConfigPath],
      ["logs", path.join(this.keyharborDir, "logs.enc")],
      ["touch_id", path.join(this.keyharborDir, "touch-id-key.enc")],
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
  }

  // --- private helpers ---

  async _reactivateVault(vaultId) {
    if (!this.vaultsConfig) {
      return null;
    }
    const vaultEntry = this.vaultsConfig.otherVaults.find(
      (v) => v.id === vaultId
    );
    if (!vaultEntry || !vaultEntry.encryptionKey) {
      return null;
    }
    if (!this.checkVaultAvailability(vaultId)) {
      return null;
    }
    let keyBuffer;
    try {
      const vault = new Vault(vaultEntry.path, { vaultId: vaultEntry.id });
      keyBuffer = Buffer.from(vaultEntry.encryptionKey, "hex");
      await vault.unlockWithKey(keyBuffer);
      vault.setVaultId(vaultEntry.id);
      this._wireVaultConflict(vault);
      this.vaults.set(vaultId, vault);
      return vault;
    } catch {
      return null;
    } finally {
      if (keyBuffer) {
        keyBuffer.fill(0);
      }
    }
  }

  _ensureSystemVaultInstance() {
    if (!this.systemVault) {
      this.systemVault = new Vault(this.keyharborDir);
      this.systemVault.setVaultId(SYSTEM_VAULT_ID);
      this._wireVaultConflict(this.systemVault);
      this.vaults.set(SYSTEM_VAULT_ID, this.systemVault);
    }
  }

  _loadVaultsConfig(key: Buffer) {
    if (!fs.existsSync(this.configPath)) {
      if (fs.existsSync(this.legacyConfigPath)) {
        const legacyBytes = fs.readFileSync(this.legacyConfigPath);
        try {
          const parsed = CryptoUtil.decryptJson(legacyBytes, key);
          this._validateVaultsConfig(parsed, true);
          this._publishImmutableBackup(
            path.join(this.keyharborDir, "vaults-v1-pre-environments.enc"),
            legacyBytes
          );
          // Preserve field order in existing serialized, fingerprinted, or encrypted records.
          // eslint-disable-next-line sort-keys
          this.vaultsConfig = {
            ...parsed,
            managerFormatVersion: 2,
            legacySourceFingerprint: this._hash(legacyBytes),
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
        this.vaultsConfig = this._defaultVaultsConfig();
      }
      this._configDiskHash = null;
      this.configCurrentRevision = 1;
      this.configPersistedRevision = 0;
      this.saveConfig();
      return;
    }
    try {
      const data = fs.readFileSync(this.configPath);
      const parsed = CryptoUtil.decryptJson(data, key);
      this._validateVaultsConfig(parsed);
      this._assertLegacyConfigUnchanged(parsed);
      this.vaultsConfig = parsed;
      this._configDiskHash = this._hash(data);
      this.configCurrentRevision = 0;
      this.configPersistedRevision = 0;
    } catch (error) {
      const configError = new Error(
        "Vault configuration is corrupt or unreadable"
      );
      configError.code = "VAULT_SESSION_CONFIG_INVALID";
      configError.cause = error;
      throw configError;
    }
  }

  _defaultVaultsConfig(): ManagerConfig {
    // Preserve field order in existing serialized, fingerprinted, or encrypted records.
    // eslint-disable-next-line sort-keys
    return {
      version: 1 as const,
      managerFormatVersion: 2,
      systemVaultInstanceId: this.systemVault?.getVaultInstanceId?.() || null,
      otherVaults: [] as VaultEntry[],
      legacySourceFingerprint: this._fingerprintPath(this.legacyConfigPath),
    };
  }

  _registerVaultEntry(name, lkvPath, vault) {
    const id = `vault_${Date.now()}`;
    vault.setVaultId(id);
    this._wireVaultConflict(vault);
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
    this.vaultsConfig.otherVaults.push(vaultEntry);
    this.vaults.set(id, vault);
    this._markConfigDirty();
    try {
      this.saveConfig();
    } catch (error) {
      this.vaultsConfig.otherVaults.pop();
      this.vaults.delete(id);
      this.configCurrentRevision = this.configPersistedRevision;
      vault.seal();
      throw error;
    }
    const { encryptionKey: _key, ...publicEntry } = vaultEntry;
    return publicEntry;
  }

  _resetVaultState() {
    this.vaults.clear();
    this.systemVault = CLOSED_SYSTEM_VAULT;
    this.vaultsConfig = CLOSED_CONFIG;
    this.activeVaultId = SYSTEM_VAULT_ID;
    this.configCurrentRevision = 0;
    this.configPersistedRevision = 0;
    this._configDiskHash = null;
    this._activationFailures.clear();
  }

  _markConfigDirty() {
    this.configCurrentRevision += 1;
  }

  // Keep this helper on the existing overridable instance API.
  // eslint-disable-next-line class-methods-use-this
  _hash(bytes) {
    return crypto.createHash("sha256").update(bytes).digest("hex");
  }

  _currentConfigHash() {
    try {
      return this._hash(fs.readFileSync(this.configPath));
    } catch (error) {
      return error?.code === "ENOENT" ? "missing" : "unreadable";
    }
  }

  _fingerprintPath(filePath: string): string {
    try {
      return this._hash(fs.readFileSync(filePath));
    } catch (error) {
      return error?.code === "ENOENT" ? "missing" : "unreadable";
    }
  }

  // Keep this helper on the existing overridable instance API.
  // eslint-disable-next-line class-methods-use-this
  _publishImmutableBackup(targetPath: string, bytes: Buffer) {
    if (fs.existsSync(targetPath)) {
      return false;
    }
    const temporaryPath = `${targetPath}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
    fs.writeFileSync(temporaryPath, bytes, { flag: "wx", mode: 0o600 });
    try {
      fs.linkSync(temporaryPath, targetPath);
      return true;
    } finally {
      fs.unlinkSync(temporaryPath);
    }
  }

  _normalizeRecoveredVaultsConfig(config): ManagerConfig {
    if (config?.managerFormatVersion === 2) {
      this._validateVaultsConfig(config);
      return config;
    }
    this._validateVaultsConfig(config, true);
    const legacyBytes = fs.existsSync(this.legacyConfigPath)
      ? fs.readFileSync(this.legacyConfigPath)
      : null;
    if (legacyBytes) {
      this._publishImmutableBackup(
        path.join(this.keyharborDir, "vaults-v1-pre-environments.enc"),
        legacyBytes
      );
    }
    // Preserve field order in existing serialized, fingerprinted, or encrypted records.
    // eslint-disable-next-line sort-keys
    const normalized = {
      ...config,
      managerFormatVersion: 2,
      legacySourceFingerprint: legacyBytes
        ? this._hash(legacyBytes)
        : "missing",
    };
    this._validateVaultsConfig(normalized);
    return normalized;
  }

  _assertLegacyConfigUnchanged(config: ManagerConfig = this.vaultsConfig) {
    if (
      this._fingerprintPath(this.legacyConfigPath) !==
      config.legacySourceFingerprint
    ) {
      const error = new Error(
        "Legacy Vault configuration changed after Environment migration; resolve legacy divergence before continuing"
      );
      error.code = "VAULT_CONFIG_LEGACY_DIVERGENCE";
      throw error;
    }
  }

  // Keep this helper on the existing overridable instance API.
  // eslint-disable-next-line class-methods-use-this
  _validateVaultsConfig(config, legacy = false) {
    if (
      !config ||
      typeof config !== "object" ||
      Array.isArray(config) ||
      config.version !== 1 ||
      !Array.isArray(config.otherVaults)
    ) {
      throw new Error("Invalid Vault configuration");
    }
    if (
      !legacy &&
      (config.managerFormatVersion !== 2 ||
        typeof config.legacySourceFingerprint !== "string")
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
      !/^[a-f0-9]{64}$/iu.test(config.systemVaultInstanceId)
    ) {
      throw new Error("Invalid system Vault instance identity");
    }
    const ids = new Set();
    const paths = new Set();
    const validateVaultEntry = (entry) => {
      if (
        !entry ||
        typeof entry !== "object" ||
        typeof entry.id !== "string" ||
        typeof entry.name !== "string" ||
        typeof entry.path !== "string"
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
      if (!/^[a-f0-9]{64}$/iu.test(entry.encryptionKey || "")) {
        throw new Error("Invalid Vault configuration key");
      }
      if (
        entry.vaultInstanceId !== undefined &&
        !/^[a-f0-9]{64}$/iu.test(entry.vaultInstanceId || "")
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

  // Keep this helper on the existing overridable instance API.
  // eslint-disable-next-line class-methods-use-this
  _validateVaultName(name) {
    if (!name || typeof name !== "string" || !name.trim()) {
      throw new Error("Vault name cannot be empty");
    }
    if (INVALID_NAME_CHARS.test(name)) {
      throw new Error(
        'Vault name contains invalid characters (/, \\, *, ?, ", <, >, |)'
      );
    }
    if (name.trim().length > 100) {
      throw new Error("Vault name is too long (max 100 characters)");
    }
  }
}

export = VaultManager;
