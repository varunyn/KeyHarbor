import crypto = require("node:crypto");
import fs = require("node:fs");
import path = require("node:path");
import CryptoUtil = require("./crypto");
import VaultReconciliation = require("./vault-reconciliation");
import ProjectConfigurationBaseline = require("./project-configuration-baseline");

declare global {
  interface Error {
    code?: string;
  }
}

// Copy through the persisted JSON format: retain its omission and coercion behavior.
const copyJsonData = <T>(value: T): T =>
  // eslint-disable-next-line unicorn/prefer-structured-clone
  JSON.parse(JSON.stringify(value));

// Vault dictionaries use user-selected keys; strict deletion must still throw on frozen records.
const deleteRecordKey = (record: object, key: string): boolean =>
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete (record as Record<string, unknown>)[key];

const VAULT_EXTERNAL_CHANGE = "VAULT_EXTERNAL_CHANGE";
const VAULT_FORMAT_VERSION = 2;

type EnvironmentTarget = Readonly<{
  projectName: string;
  environmentId: string;
}>;
interface SecretRecord {
  value: string;
  expiresAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  description?: string;
  tags?: string[];
  history?: Record<string, unknown>[];
}
interface SecretReadView {
  value: string;
  expiresAt: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  description: string;
  tags: string[];
}
interface ImportProjectSnapshot {
  exists: boolean;
  incarnation: string | null;
  secrets: Record<string, SecretRecord | string | null>;
  environmentId?: string;
  environmentName?: string;
  projectIncarnation?: string | null;
  environmentIncarnation?: string | null;
}
interface EnvironmentRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  secrets: Record<string, SecretRecord | string>;
  configurationBaseline?: Record<string, unknown>;
}
type EnvironmentSummary = Readonly<{
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  secretCount: number;
  isDefault: boolean;
}>;
type EnvironmentTargetIdentity = EnvironmentTarget &
  Readonly<{
    environmentName: string;
    projectIncarnation: string | null;
    environmentIncarnation: string | null;
  }>;
interface ProjectRecord {
  name: string;
  createdAt: string;
  updatedAt: string;
  defaultEnvironmentId: string;
  environments: Record<string, EnvironmentRecord>;
  secrets?: Record<string, SecretRecord | string>;
  configurationBaseline?: Record<string, unknown>;
}
interface VaultData {
  vaultFormatVersion: number;
  version?: string;
  vaultInstanceId?: string;
  createdAt?: string;
  updatedAt?: string;
  legacySourceFingerprint?: { vault: string; salt: string };
  favorites: {
    projects: string[];
    secrets: Record<string, Record<string, string[]>>;
  };
  projects: Record<string, ProjectRecord>;
}
type TargetSelector = EnvironmentTarget;
interface ExternalTargetSelector {
  projectName: string;
  environmentId?: string;
  environmentName?: string;
}
interface SecretImportChange {
  key: string;
  value: string;
  action: "add" | "replace";
}
interface TargetExpectation {
  validateTarget?: () => void;
  incarnation?: string;
  environmentIncarnation?: string;
  baseline?: { exists: boolean; revision?: string };
  secrets?: Record<string, SecretRecord | null>;
}

// Closed Vaults retain the existing null public fields; active callers are guarded by _ensureUnlocked.
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const SEALED_DATA: VaultData = null!;
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const SEALED_KEY: Buffer = null!;

const sha256Hex = (buffer) =>
  crypto.createHash("sha256").update(buffer).digest("hex");

const cloneVaultData = (value) => {
  if (Array.isArray(value)) {
    return value.map(cloneVaultData);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const copy = Object.create(
    Object.getPrototypeOf(value) === null ? null : Object.prototype
  );
  for (const [key, entry] of Object.entries(value)) {
    Object.defineProperty(copy, key, {
      configurable: true,
      enumerable: true,
      value: cloneVaultData(entry),
      writable: true,
    });
  }
  return copy;
};

const unsupportedVaultFormat = (message: string) => {
  const error = new Error(message);
  error.code = "VAULT_FORMAT_UNSUPPORTED";
  return error;
};

const validateEnvironmentSecrets = (secrets: Record<string, unknown>) => {
  for (const [secretKey, secret] of Object.entries(secrets)) {
    if (!secretKey) {
      throw new Error("Invalid Vault secret key");
    }
    if (typeof secret === "string") {
      continue;
    }
    if (
      !secret ||
      typeof secret !== "object" ||
      Array.isArray(secret) ||
      typeof (secret as Record<string, unknown>).value !== "string"
    ) {
      throw new Error("Invalid Vault secret record");
    }
    const record = secret as Record<string, unknown>;
    if (
      record.expiresAt !== undefined &&
      record.expiresAt !== null &&
      typeof record.expiresAt !== "string"
    ) {
      throw new Error("Invalid Vault secret expiration");
    }
    if (
      record.description !== undefined &&
      typeof record.description !== "string"
    ) {
      throw new Error("Invalid Vault secret description");
    }
    if (
      record.tags !== undefined &&
      (!Array.isArray(record.tags) ||
        record.tags.some((tag) => typeof tag !== "string"))
    ) {
      throw new Error("Invalid Vault secret tags");
    }
    if (
      record.history !== undefined &&
      (!Array.isArray(record.history) ||
        record.history.some((rawEntry) => {
          if (
            !rawEntry ||
            typeof rawEntry !== "object" ||
            Array.isArray(rawEntry)
          ) {
            return true;
          }
          const entry = rawEntry as Record<string, unknown>;
          return (
            typeof entry.value !== "string" ||
            (entry.expiresAt !== undefined &&
              entry.expiresAt !== null &&
              typeof entry.expiresAt !== "string") ||
            (entry.description !== undefined &&
              typeof entry.description !== "string") ||
            (entry.tags !== undefined &&
              (!Array.isArray(entry.tags) ||
                entry.tags.some((tag) => typeof tag !== "string")))
          );
        }))
    ) {
      throw new Error("Invalid Vault secret history");
    }
  }
};

// The constructor merges with the exported type-only namespace at the end of this module.
// eslint-disable-next-line no-redeclare
class Vault {
  static VAULT_EXTERNAL_CHANGE: string;
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
  _onConflictNotify: ((payload: unknown) => void) | null;
  _diskContentHash: string | null = null;
  _syncBaseline: unknown = null;
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
      onConflict?: (payload: unknown) => void;
    } = {}
  ) {
    this.dataDir = dataDir;
    this.legacyVaultPath = path.join(dataDir, "vault.enc");
    this.legacySaltPath = path.join(dataDir, "salt.txt");
    this.versionedVaultPath = path.join(dataDir, "vault-v2.enc");
    this.versionedSaltPath = path.join(dataDir, "salt-v2.txt");
    this.vaultPath = this.versionedVaultPath;
    this.saltPath = this.versionedSaltPath;
    this.legacyVaultFingerprint = null;
    this.legacySaltFingerprint = null;
    this._needsFormatMigration = false;

    this.isLocked = true;
    this.data = SEALED_DATA;
    this.key = SEALED_KEY;
    this.saveTimeout = null;
    this.maxHistoryVersions = 50;

    this._vaultId = options.vaultId ?? null;
    this._onConflictNotify =
      typeof options.onConflict === "function" ? options.onConflict : null;
    this._diskContentHash = null;
    this._syncBaseline = null;
    this._periodicSyncInProgress = false;
    this.sessionRevision = 0;
    this.currentRevision = 0;
    this.persistedRevision = 0;
    this.vaultInstanceId = null;
    this._projectIncarnations = new Map();
    this._environmentIncarnations = new Map();
    this._persistenceQueue = null;
    this._reconciliation = new VaultReconciliation(this);
  }

  _refreshSyncBaseline() {
    this._syncBaseline = this._reconciliation.createBaseline(this.data);
  }

  async tickPeriodicDiskSync() {
    if (
      this.isLocked ||
      this._diskContentHash === null ||
      this._diskContentHash === undefined
    ) {
      return { didSync: false };
    }
    if (!this._isDiskStale()) {
      return { didSync: false };
    }
    if (this._periodicSyncInProgress) {
      return { didSync: false };
    }
    this._periodicSyncInProgress = true;
    try {
      if (this.saveTimeout) {
        clearTimeout(this.saveTimeout);
        this.saveTimeout = null;
      }
      const result = await this.reconcileExternalChange({ origin: "periodic" });
      if (result.status === "needs_resolution") {
        return { conflict: true, didSync: false, reconciliation: result };
      }
      return { didSync: result.status === "merged" };
    } catch (error) {
      return { didSync: false, error: error.message || String(error) };
    } finally {
      this._periodicSyncInProgress = false;
    }
  }

  setVaultId(vaultId) {
    this._vaultId = vaultId;
  }

  getVaultId() {
    return this._vaultId;
  }

  setConflictNotifier(fn) {
    this._onConflictNotify = typeof fn === "function" ? fn : null;
  }

  _notifyConflict(payload) {
    try {
      this._onConflictNotify?.({
        ...payload,
        vaultId: this._vaultId,
      });
    } catch (error) {
      console.error("Vault conflict notifier failed:", error?.message || error);
    }
  }

  _setDiskHashFromCiphertext(encryptedBuffer) {
    this._diskContentHash = sha256Hex(encryptedBuffer);
  }

  exists() {
    return (
      (fs.existsSync(this.vaultPath) && fs.existsSync(this.saltPath)) ||
      (fs.existsSync(this.legacyVaultPath) &&
        fs.existsSync(this.legacySaltPath))
    );
  }

  async setup(password) {
    this.vaultPath = this.versionedVaultPath;
    this.saltPath = this.versionedSaltPath;
    if (this.exists()) {
      throw new Error("Vault already exists");
    }

    if (
      fs.existsSync(this.legacyVaultPath) ||
      fs.existsSync(this.legacySaltPath)
    ) {
      throw new Error(
        "Legacy Vault files exist; open the existing Vault to migrate it safely"
      );
    }
    if (fs.existsSync(this.vaultPath) || fs.existsSync(this.saltPath)) {
      throw new Error("Versioned Vault files already exist");
    }
    const salt = CryptoUtil.generateSalt();
    const saltTemporaryPath = `${this.saltPath}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
    fs.writeFileSync(saltTemporaryPath, salt.toString("hex"), {
      flag: "wx",
      mode: 0o600,
    });
    try {
      fs.linkSync(saltTemporaryPath, this.saltPath);
    } finally {
      fs.unlinkSync(saltTemporaryPath);
    }

    try {
      fs.chmodSync(this.saltPath, 0o600);
    } catch (error) {
      console.error("Failed to set salt file permissions:", error.message);
    }

    this.key = CryptoUtil.deriveKey(password, salt);

    // Preserve field order in existing serialized, fingerprinted, or encrypted records.
    // eslint-disable-next-line sort-keys
    this.data = {
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

    this.vaultInstanceId = this.data.vaultInstanceId ?? null;
    this._resetProjectIncarnations();
    this.currentRevision = 1;
    try {
      await this._atomicWriteCurrent({ createOnly: true });
      this.isLocked = false;
    } catch (error) {
      this.seal();
      throw error;
    }
  }

  async unlock(password) {
    this.vaultPath = this.versionedVaultPath;
    this.saltPath = this.versionedSaltPath;
    if (!this.exists()) {
      throw new Error("Vault does not exist");
    }

    const hasV2Vault = fs.existsSync(this.vaultPath);
    const hasV2Salt = fs.existsSync(this.saltPath);
    if (hasV2Vault !== hasV2Salt) {
      throw new Error(
        "Versioned Vault files are incomplete; restore the encrypted backup before retrying"
      );
    }
    const usingLegacy = !hasV2Vault && fs.existsSync(this.legacyVaultPath);
    if (usingLegacy) {
      this.vaultPath = this.legacyVaultPath;
      this.saltPath = this.legacySaltPath;
    }
    try {
      const stats = fs.statSync(this.saltPath);
      // Extract POSIX permission bits without file-type bits.
      // eslint-disable-next-line no-bitwise
      const mode = stats.mode & 0o777;
      if (mode !== 0o600) {
        fs.chmodSync(this.saltPath, 0o600);
      }
    } catch {
      // Best-effort cleanup or recovery probing must preserve the primary result.
    }

    const saltBytes = fs.readFileSync(this.saltPath);
    if (usingLegacy) {
      this._legacySaltLoadedFingerprint = sha256Hex(saltBytes);
    }
    const saltHex = saltBytes.toString("utf-8");
    const salt = Buffer.from(saltHex, "hex");
    const key = CryptoUtil.deriveKey(password, salt);
    try {
      try {
        this._loadVaultData(key, "Invalid password");
        if (usingLegacy) {
          await this._migrateLegacyFiles();
        } else {
          this._assertLegacyInputsUnchanged();
        }
        await this._persistLegacyIdentity();
      } catch (error) {
        if (!this.isLocked) {
          this.seal();
        }
        this.vaultPath = this.versionedVaultPath;
        this.saltPath = this.versionedSaltPath;
        throw error;
      }
    } finally {
      key.fill(0);
    }
  }

  async unlockWithKey(key) {
    this.vaultPath = this.versionedVaultPath;
    this.saltPath = this.versionedSaltPath;
    if (!this.exists()) {
      throw new Error("Vault does not exist");
    }
    const hasV2Vault = fs.existsSync(this.vaultPath);
    const hasV2Salt = fs.existsSync(this.saltPath);
    if (hasV2Vault !== hasV2Salt) {
      throw new Error(
        "Versioned Vault files are incomplete; restore the encrypted backup before retrying"
      );
    }
    const usingLegacy = !hasV2Vault && fs.existsSync(this.legacyVaultPath);
    if (usingLegacy) {
      this.vaultPath = this.legacyVaultPath;
      this.saltPath = this.legacySaltPath;
    }
    try {
      this._loadVaultData(key, "Invalid key");
      if (usingLegacy) {
        await this._migrateLegacyFiles();
      } else {
        this._assertLegacyInputsUnchanged();
      }
      await this._persistLegacyIdentity();
    } catch (error) {
      if (!this.isLocked) {
        this.seal();
      }
      this.vaultPath = this.versionedVaultPath;
      this.saltPath = this.versionedSaltPath;
      throw error;
    }
  }

  async _migrateLegacyFiles() {
    if (!this._needsFormatMigration) {
      return false;
    }
    const legacyVault = fs.readFileSync(this.legacyVaultPath);
    const legacySalt = fs.readFileSync(this.legacySaltPath);
    this.legacyVaultFingerprint = sha256Hex(legacyVault);
    this.legacySaltFingerprint = sha256Hex(legacySalt);
    const targetVaultPath = path.join(this.dataDir, "vault-v2.enc");
    const targetSaltPath = path.join(this.dataDir, "salt-v2.txt");
    if (fs.existsSync(targetVaultPath) || fs.existsSync(targetSaltPath)) {
      throw new Error(
        "Versioned Vault files already exist; migration was interrupted and needs recovery"
      );
    }
    if (
      sha256Hex(legacyVault) !== this._diskContentHash ||
      sha256Hex(legacySalt) !== this._legacySaltLoadedFingerprint
    ) {
      const error = new Error(
        "Legacy Vault files changed while they were being opened"
      );
      error.code = "VAULT_LEGACY_DIVERGENCE";
      throw error;
    }
    this.legacyVaultFingerprint = sha256Hex(legacyVault);
    this.legacySaltFingerprint = sha256Hex(legacySalt);
    this._publishImmutableBackup(
      path.join(this.dataDir, "vault-v1-pre-environments.enc"),
      legacyVault
    );
    this._publishImmutableBackup(
      path.join(this.dataDir, "salt-v1-pre-environments.txt"),
      legacySalt
    );
    this.vaultPath = targetVaultPath;
    this.saltPath = targetSaltPath;
    // Preserve field order in existing serialized, fingerprinted, or encrypted records.
    // eslint-disable-next-line sort-keys
    this.data.legacySourceFingerprint = {
      vault: this.legacyVaultFingerprint,
      salt: this.legacySaltFingerprint,
    };
    this._diskContentHash = null;
    if (!fs.existsSync(this.saltPath)) {
      const saltTemporaryPath = `${this.saltPath}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
      fs.writeFileSync(saltTemporaryPath, legacySalt, {
        flag: "wx",
        mode: 0o600,
      });
      try {
        fs.linkSync(saltTemporaryPath, this.saltPath);
      } finally {
        fs.unlinkSync(saltTemporaryPath);
      }
    }
    this.data.vaultFormatVersion = VAULT_FORMAT_VERSION;
    this.currentRevision += 1;
    try {
      if (
        sha256Hex(fs.readFileSync(this.legacyVaultPath)) !==
          this.legacyVaultFingerprint ||
        sha256Hex(fs.readFileSync(this.legacySaltPath)) !==
          this.legacySaltFingerprint
      ) {
        const error = new Error("Legacy Vault files changed during migration");
        error.code = "VAULT_LEGACY_DIVERGENCE";
        throw error;
      }
      await this._atomicWriteCurrent({ createOnly: true });
      this._needsFormatMigration = false;
      return true;
    } catch (error) {
      this.vaultPath = this.versionedVaultPath;
      this.saltPath = this.versionedSaltPath;
      throw error;
    }
  }

  _loadVaultData(key, errorMessage) {
    try {
      const stats = fs.statSync(this.vaultPath);
      // Extract POSIX permission bits without file-type bits.
      // eslint-disable-next-line no-bitwise
      const mode = stats.mode & 0o777;
      if (mode !== 0o600) {
        fs.chmodSync(this.vaultPath, 0o600);
      }
    } catch {
      // Best-effort cleanup or recovery probing must preserve the primary result.
    }

    this.key = Buffer.from(key);

    try {
      const encryptedData = fs.readFileSync(this.vaultPath);
      this._setDiskHashFromCiphertext(encryptedData);
      this.data = CryptoUtil.decryptJson(encryptedData, this.key);
      this._normalizeData();
      this.vaultInstanceId = this.data.vaultInstanceId || null;
      this.isLocked = false;
      this._resetProjectIncarnations();
      this._refreshSyncBaseline();
      this.sessionRevision += 1;
      this.currentRevision = 0;
      this.persistedRevision = 0;
    } catch (error) {
      if (Buffer.isBuffer(this.key)) {
        this.key.fill(0);
      }
      this.key = SEALED_KEY;
      this.data = SEALED_DATA;
      this._diskContentHash = null;
      this._syncBaseline = null;
      this.sessionRevision = 0;
      this.currentRevision = 0;
      this.persistedRevision = 0;
      this.vaultInstanceId = null;
      this._reconciliation.clearPlan();
      if (
        error.code === "VAULT_FORMAT_UNSUPPORTED" ||
        error.message.includes("Mixed") ||
        error.message.includes("Invalid vault") ||
        error.message.includes("Invalid Vault")
      ) {
        throw error;
      }
      throw new Error(errorMessage, { cause: error });
    }
  }

  _assertLegacyInputsUnchanged() {
    const expected = this.data?.legacySourceFingerprint;
    if (!expected) {
      return;
    }
    const actualVault = this._fingerprintPath(this.legacyVaultPath);
    const actualSalt = this._fingerprintPath(this.legacySaltPath);
    if (actualVault !== expected.vault || actualSalt !== expected.salt) {
      const error = new Error(
        "Legacy Vault files changed after Environment migration; resolve legacy divergence before continuing"
      );
      error.code = "VAULT_LEGACY_DIVERGENCE";
      throw error;
    }
  }

  // Keep this helper on the existing overridable instance API.
  // eslint-disable-next-line class-methods-use-this
  _fingerprintPath(filePath) {
    try {
      return sha256Hex(fs.readFileSync(filePath));
    } catch (error) {
      return error?.code === "ENOENT" ? "missing" : "unreadable";
    }
  }

  async _persistLegacyIdentity() {
    if (this.vaultInstanceId) {
      return false;
    }
    this.vaultInstanceId = crypto.randomBytes(32).toString("hex");
    this.data.vaultInstanceId = this.vaultInstanceId;
    this.currentRevision += 1;
    this.sessionRevision += 1;
    await this._atomicWriteCurrent();
    return true;
  }

  getVaultInstanceId() {
    return this.vaultInstanceId;
  }

  captureProjectBackupSnapshot(projectName: string) {
    this._ensureUnlocked();
    const project = this.data.projects[projectName];
    if (!project) {
      throw new Error(`Project '${projectName}' does not exist`);
    }
    const favorites =
      this.data.favorites.secrets[projectName] || Object.create(null);
    const fingerprint = sha256Hex(
      // Preserve field order in existing serialized, fingerprinted, or encrypted records.
      // eslint-disable-next-line sort-keys
      Buffer.from(JSON.stringify({ project, favorites }))
    );
    const encryptedBackup = this.createEncryptedProjectBackup(projectName);
    return Object.freeze({
      defaultEnvironmentId: project.defaultEnvironmentId,
      encryptedBackup,
      fingerprint,
      projectIncarnation: this._projectIncarnations.get(projectName) || null,
      projectName,
      vaultId: this.getVaultId(),
      vaultInstanceId: this.vaultInstanceId,
    });
  }

  _environmentForSelector(selector: TargetSelector): {
    project: ProjectRecord;
    environment: EnvironmentRecord;
    target: EnvironmentTarget;
  } {
    this._ensureUnlocked();
    const target = selector;
    if (
      !target ||
      typeof target !== "object" ||
      typeof target.projectName !== "string"
    ) {
      throw new TypeError("Environment target requires projectName");
    }
    const project = this.data.projects[target.projectName];
    if (!project) {
      throw new Error(`Project '${target.projectName}' does not exist`);
    }
    if (
      typeof target.environmentId !== "string" ||
      target.environmentId.length === 0
    ) {
      throw new TypeError("Environment ID must be a non-empty string");
    }
    const environment = project.environments[target.environmentId];
    if (!environment) {
      const error = new Error("Environment target no longer exists");
      error.code = "ENVIRONMENT_NOT_FOUND";
      throw error;
    }
    return {
      environment,
      project,
      target: {
        environmentId: target.environmentId,
        projectName: target.projectName,
      },
    };
  }

  resolveEnvironmentTarget(
    selector: ExternalTargetSelector
  ): EnvironmentTarget {
    this._ensureUnlocked();
    if (
      !selector ||
      typeof selector !== "object" ||
      typeof selector.projectName !== "string"
    ) {
      throw new TypeError("Environment target requires projectName");
    }
    const project = this.data.projects[selector.projectName];
    if (!project) {
      throw new Error(`Project '${selector.projectName}' does not exist`);
    }
    const hasId = Object.hasOwn(selector, "environmentId");
    const hasName = Object.hasOwn(selector, "environmentName");
    const validateEnvironmentId = () => {
      if (
        hasId &&
        (typeof selector.environmentId !== "string" ||
          selector.environmentId.length === 0)
      ) {
        throw new TypeError("Environment ID must be a non-empty string");
      }
    };
    validateEnvironmentId();
    if (
      hasName &&
      (typeof selector.environmentName !== "string" ||
        selector.environmentName.length === 0)
    ) {
      throw new TypeError("Environment name must be a non-empty string");
    }
    const named = hasName
      ? Object.values(project.environments).find(
          (environment) => environment.name === selector.environmentName
        )
      : undefined;
    if (hasName && !named) {
      const error = new Error(
        `Environment '${selector.environmentName}' does not exist in project '${selector.projectName}'`
      );
      error.code = "ENVIRONMENT_NOT_FOUND";
      throw error;
    }
    if (hasId && hasName && named?.id !== selector.environmentId) {
      const error = new Error(
        "Environment ID and name identify different Environments"
      );
      error.code = "ENVIRONMENT_TARGET_MISMATCH";
      throw error;
    }
    const target = {
      environmentId: hasId
        ? (selector.environmentId as string)
        : (named?.id ?? project.defaultEnvironmentId),
      projectName: selector.projectName,
    };
    this._environmentForSelector(target);
    return Object.freeze(target);
  }

  getEnvironmentTargetIdentity(
    selector: TargetSelector
  ): EnvironmentTargetIdentity {
    const { environment, target } = this._environmentForSelector(selector);
    return Object.freeze({
      ...target,
      environmentIncarnation: this._getEnvironmentIncarnation(
        target.projectName,
        target.environmentId
      ),
      environmentName: environment.name,
      projectIncarnation:
        this._projectIncarnations.get(target.projectName) || null,
    });
  }

  // Keep this helper on the existing overridable instance API.
  // eslint-disable-next-line class-methods-use-this
  _environmentIncarnationKey(projectName: string, environmentId: string) {
    return JSON.stringify([projectName, environmentId]);
  }

  _getEnvironmentIncarnation(projectName: string, environmentId: string) {
    return (
      this._environmentIncarnations.get(
        this._environmentIncarnationKey(projectName, environmentId)
      ) || null
    );
  }

  _setEnvironmentIncarnation(projectName: string, environmentId: string) {
    this._environmentIncarnations.set(
      this._environmentIncarnationKey(projectName, environmentId),
      crypto.randomBytes(16).toString("hex")
    );
  }

  _deleteEnvironmentIncarnation(projectName: string, environmentId: string) {
    this._environmentIncarnations.delete(
      this._environmentIncarnationKey(projectName, environmentId)
    );
  }

  getEnvironments(projectName: string): EnvironmentSummary[] {
    this._ensureUnlocked();
    const project = this.data.projects[projectName];
    if (!project) {
      throw new Error(`Project '${projectName}' does not exist`);
    }
    return Object.values(project.environments).map((environment) => ({
      createdAt: environment.createdAt,
      id: environment.id,
      isDefault: project.defaultEnvironmentId === environment.id,
      name: environment.name,
      secretCount: Object.keys(environment.secrets).length,
      updatedAt: environment.updatedAt,
    }));
  }

  createEnvironment(projectName: string, name: string): EnvironmentSummary {
    this._ensureUnlocked();
    const project = this.data.projects[projectName];
    if (!project) {
      throw new Error(`Project '${projectName}' does not exist`);
    }
    const normalizedName = Vault._normalizeEnvironmentName(name);
    if (
      Object.values(project.environments).some(
        (environment) => environment.name === normalizedName
      )
    ) {
      throw new Error(`Environment '${normalizedName}' already exists`);
    }
    const now = new Date().toISOString();
    const id = crypto.randomBytes(16).toString("hex");
    // Preserve field order in existing serialized, fingerprinted, or encrypted records.
    // eslint-disable-next-line sort-keys
    project.environments[id] = {
      id,
      name: normalizedName,
      createdAt: now,
      updatedAt: now,
      secrets: Object.create(null),
    };
    this._setEnvironmentIncarnation(projectName, id);
    project.updatedAt = now;
    this.data.updatedAt = now;
    this._scheduleAutoSave();
    // Preserve field order in existing serialized, fingerprinted, or encrypted records.
    // eslint-disable-next-line sort-keys
    return {
      id,
      name: normalizedName,
      createdAt: now,
      updatedAt: now,
      secretCount: 0,
      isDefault: false,
    };
  }

  renameEnvironment(
    projectName: string,
    environmentId: string,
    name: string
  ): EnvironmentTargetIdentity {
    this._ensureUnlocked();
    const project = this.data.projects[projectName];
    const environment = project?.environments?.[environmentId];
    if (!environment) {
      throw new Error("Environment target no longer exists");
    }
    const normalizedName = Vault._normalizeEnvironmentName(name);
    if (
      Object.values(project.environments).some(
        (entry) => entry.id !== environmentId && entry.name === normalizedName
      )
    ) {
      throw new Error(`Environment '${normalizedName}' already exists`);
    }
    const now = new Date().toISOString();
    environment.name = normalizedName;
    environment.updatedAt = now;
    project.updatedAt = now;
    this.data.updatedAt = now;
    this._setEnvironmentIncarnation(projectName, environmentId);
    this._scheduleAutoSave();
    return this.getEnvironmentTargetIdentity({ environmentId, projectName });
  }

  setDefaultEnvironment(projectName: string, environmentId: string): boolean {
    this._ensureUnlocked();
    const project = this.data.projects[projectName];
    if (!project?.environments?.[environmentId]) {
      throw new Error("Environment target no longer exists");
    }
    if (project.defaultEnvironmentId === environmentId) {
      return false;
    }
    project.defaultEnvironmentId = environmentId;
    const updatedAt = new Date().toISOString();
    this.data.updatedAt = updatedAt;
    project.updatedAt = updatedAt;
    this._scheduleAutoSave();
    return true;
  }

  deleteEnvironment(
    projectName: string,
    environmentId: string,
    options: { replacementDefaultEnvironmentId?: string } = {}
  ) {
    this._ensureUnlocked();
    const project = this.data.projects[projectName];
    const environment = project?.environments?.[environmentId];
    if (!environment) {
      throw new Error("Environment target no longer exists");
    }
    if (Object.keys(project.environments).length < 2) {
      throw new Error("A Project must keep at least one Environment");
    }
    const replacement = options.replacementDefaultEnvironmentId;
    if (project.defaultEnvironmentId === environmentId) {
      if (
        !replacement ||
        replacement === environmentId ||
        !project.environments[replacement]
      ) {
        throw new Error(
          "Deleting the default Environment requires a valid replacement default"
        );
      }
      project.defaultEnvironmentId = replacement;
    } else if (replacement !== undefined) {
      throw new Error(
        "A replacement default is only valid when deleting the default Environment"
      );
    }
    const affectedSecretCount = Object.keys(environment.secrets).length;
    deleteRecordKey(project.environments, environmentId);
    this._deleteEnvironmentIncarnation(projectName, environmentId);
    const favorites = this.data.favorites.secrets?.[projectName];
    if (favorites) {
      deleteRecordKey(favorites, environmentId);
    }
    const updatedAt = new Date().toISOString();
    this.data.updatedAt = updatedAt;
    project.updatedAt = updatedAt;
    this._scheduleAutoSave();
    return {
      affectedSecretCount,
      defaultEnvironmentId: project.defaultEnvironmentId,
      deletedEnvironmentId: environmentId,
    };
  }

  static _normalizeEnvironmentName(name) {
    if (typeof name !== "string") {
      throw new TypeError("Environment name must be a string");
    }
    const normalized = name.trim();
    if (!/^[a-z][a-z0-9_-]{0,63}$/u.test(normalized)) {
      throw new Error(
        "Environment name must start with a letter and contain only lowercase letters, digits, hyphens, or underscores"
      );
    }
    return normalized;
  }

  _resetProjectIncarnations() {
    this._projectIncarnations = new Map(
      Object.keys(this.data?.projects || {}).map((name) => [
        name,
        crypto.randomBytes(16).toString("hex"),
      ])
    );
    this._environmentIncarnations = new Map();
    for (const [projectName, project] of Object.entries(
      this.data?.projects || {}
    )) {
      for (const id of Object.keys(project.environments || {})) {
        this._setEnvironmentIncarnation(projectName, id);
      }
    }
  }

  _reconcileProjectIncarnations(nextData) {
    const nextProjects = nextData?.projects || Object.create(null);
    for (const [name] of this._projectIncarnations) {
      const previous = this.data?.projects?.[name];
      const next = nextProjects[name];
      if (
        !next ||
        (previous?.createdAt &&
          next.createdAt &&
          previous.createdAt !== next.createdAt)
      ) {
        this._projectIncarnations.delete(name);
      }
    }
    for (const name of Object.keys(nextProjects)) {
      if (!this._projectIncarnations.has(name)) {
        this._projectIncarnations.set(
          name,
          crypto.randomBytes(16).toString("hex")
        );
      }
    }
  }

  _installData(nextData) {
    this._reconcileProjectIncarnations(nextData);
    this._reconcileEnvironmentIncarnations(nextData);
    this.data = nextData;
  }

  _reconcileEnvironmentIncarnations(nextData: VaultData) {
    const reconcileExistingEnvironment = (key) => {
      const [projectName, environmentId] = JSON.parse(key) as [string, string];
      const previous =
        this.data?.projects?.[projectName]?.environments?.[environmentId];
      const next =
        nextData?.projects?.[projectName]?.environments?.[environmentId];
      if (
        !next ||
        (previous?.createdAt &&
          next.createdAt &&
          previous.createdAt !== next.createdAt) ||
        previous?.name !== next.name
      ) {
        this._environmentIncarnations.delete(key);
      }
    };
    for (const [key] of this._environmentIncarnations) {
      reconcileExistingEnvironment(key);
    }
    for (const [projectName, project] of Object.entries(
      nextData?.projects || {}
    )) {
      for (const id of Object.keys(project.environments || {})) {
        const key = this._environmentIncarnationKey(projectName, id);
        if (!this._environmentIncarnations.has(key)) {
          this._environmentIncarnations.set(
            key,
            crypto.randomBytes(16).toString("hex")
          );
        }
      }
    }
  }

  getImportProjectSnapshot(
    selector: TargetSelector,
    keys: string[] = []
  ): ImportProjectSnapshot {
    this._ensureUnlocked();
    const { projectName } = selector;
    const project = this.data.projects[projectName];
    if (!project) {
      return { exists: false, incarnation: null, secrets: Object.create(null) };
    }
    const { environment, target } = this._environmentForSelector(selector);
    const secrets: Record<string, SecretRecord | string | null> =
      Object.create(null);
    for (const key of keys) {
      const ownSecret = Object.hasOwn(environment.secrets, key);
      const secret = ownSecret ? environment.secrets[key] : null;
      secrets[key] = ownSecret ? copyJsonData(secret) : null;
    }
    return {
      exists: true,
      incarnation: this._projectIncarnations.get(projectName) || null,
      ...this.getEnvironmentTargetIdentity(target),
      secrets,
    };
  }

  getProjectConfigurationBaseline(selector: TargetSelector) {
    this._ensureUnlocked();
    const { projectName } = selector;
    const exists = Object.hasOwn(this.data.projects, projectName);
    const project = exists ? this.data.projects[projectName] : null;
    if (!project) {
      return { configurationBaseline: null, exists: false, incarnation: null };
    }
    const { environment, target } = this._environmentForSelector(selector);
    return {
      exists,
      incarnation: project
        ? this._projectIncarnations.get(projectName) || null
        : null,
      ...this.getEnvironmentTargetIdentity(target),
      configurationBaseline: environment.configurationBaseline
        ? copyJsonData(environment.configurationBaseline)
        : null,
    };
  }

  replaceProjectConfigurationBaseline(
    selector: TargetSelector,
    requiredKeys: string[],
    expected: TargetExpectation = {}
  ) {
    return this._enqueuePersistenceOperation(() =>
      this._setProjectConfigurationBaselineNow(selector, requiredKeys, expected)
    );
  }

  clearProjectConfigurationBaseline(
    selector: TargetSelector,
    expected: TargetExpectation = {}
  ) {
    return this._enqueuePersistenceOperation(() =>
      this._setProjectConfigurationBaselineNow(selector, null, expected)
    );
  }

  _setProjectConfigurationBaselineNow(
    selector: TargetSelector,
    requiredKeys: string[] | null,
    expected: TargetExpectation
  ) {
    this._ensureUnlocked();
    if (typeof expected.validateTarget === "function") {
      expected.validateTarget();
    }
    const { projectName } = selector;
    const project = this.data.projects[projectName];
    if (
      !project ||
      (expected.incarnation &&
        this._projectIncarnations.get(projectName) !== expected.incarnation)
    ) {
      const error = new Error("Project configuration baseline target changed");
      error.code = "CONFIGURATION_BASELINE_STALE";
      throw error;
    }
    let resolved;
    try {
      resolved = this._environmentForSelector(selector);
    } catch {
      const error = new Error("Project configuration baseline target changed");
      error.code = "CONFIGURATION_BASELINE_STALE";
      throw error;
    }
    const { environment } = resolved;
    if (
      expected.environmentIncarnation &&
      this.getEnvironmentTargetIdentity(resolved.target)
        .environmentIncarnation !== expected.environmentIncarnation
    ) {
      const error = new Error("Project configuration baseline target changed");
      error.code = "CONFIGURATION_BASELINE_STALE";
      throw error;
    }
    if (
      expected.baseline &&
      (expected.baseline.exists !==
        Boolean(environment.configurationBaseline) ||
        (expected.baseline.exists &&
          expected.baseline.revision !==
            environment.configurationBaseline?.revision))
    ) {
      const error = new Error("Project configuration baseline changed");
      error.code = "CONFIGURATION_BASELINE_STALE";
      throw error;
    }

    const nextBaseline =
      requiredKeys === null
        ? null
        : ProjectConfigurationBaseline.createBaseline(requiredKeys);
    if (
      nextBaseline &&
      environment.configurationBaseline &&
      JSON.stringify(nextBaseline.requiredKeys) ===
        JSON.stringify(environment.configurationBaseline.requiredKeys)
    ) {
      return { changed: false };
    }
    if (requiredKeys === null && !environment.configurationBaseline) {
      return { changed: false };
    }

    const now = new Date().toISOString();
    const nextData = cloneVaultData(this.data);
    const nextEnvironment =
      nextData.projects[projectName].environments[
        resolved.target.environmentId
      ];
    if (nextBaseline) {
      nextEnvironment.configurationBaseline = {
        ...nextBaseline,
        updatedAt: now,
      };
    } else {
      delete nextEnvironment.configurationBaseline;
    }
    nextEnvironment.updatedAt = now;
    const nextProject = nextData.projects[projectName];
    nextProject.updatedAt = now;
    nextData.updatedAt = now;
    this._installData(nextData);
    this._scheduleAutoSave();
    return { changed: true };
  }

  applySecretImportBatch(
    selector: TargetSelector,
    changes: SecretImportChange[],
    expected: TargetExpectation = {}
  ) {
    return this._enqueuePersistenceOperation(() =>
      this._applySecretImportBatchNow(selector, changes, expected)
    );
  }

  _applySecretImportBatchNow(
    selector: TargetSelector,
    changes: SecretImportChange[],
    expected: TargetExpectation = {}
  ) {
    this._ensureUnlocked();
    if (typeof expected.validateTarget === "function") {
      expected.validateTarget();
    }
    const { projectName } = selector;
    if (!Array.isArray(changes) || changes.length === 0) {
      throw new TypeError("Import batch must contain changes");
    }
    const keys = changes.map((change) => change?.key);
    if (
      keys.some(
        (key) =>
          typeof key !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)
      ) ||
      new Set(keys).size !== keys.length
    ) {
      throw new TypeError("Import batch contains an invalid key");
    }
    if (
      changes.some(
        (change) =>
          (change.action !== "add" && change.action !== "replace") ||
          typeof change.value !== "string"
      )
    ) {
      throw new TypeError("Import batch contains an invalid change");
    }

    const project = Object.hasOwn(this.data.projects, projectName)
      ? this.data.projects[projectName]
      : null;
    if (
      !project ||
      (expected.incarnation &&
        this._projectIncarnations.get(projectName) !== expected.incarnation)
    ) {
      const error = new Error("Import target changed");
      error.code = "IMPORT_STALE";
      throw error;
    }
    let resolved;
    try {
      resolved = this._environmentForSelector(selector);
    } catch {
      const error = new Error("Import target changed");
      error.code = "IMPORT_STALE";
      throw error;
    }
    if (
      expected.environmentIncarnation &&
      this.getEnvironmentTargetIdentity(resolved.target)
        .environmentIncarnation !== expected.environmentIncarnation
    ) {
      const error = new Error("Import target changed");
      error.code = "IMPORT_STALE";
      throw error;
    }
    const validateExpectedChange = (change) => {
      const current = Object.hasOwn(resolved.environment.secrets, change.key)
        ? resolved.environment.secrets[change.key]
        : undefined;
      const expectedSecret = expected.secrets?.[change.key];
      if (
        JSON.stringify(current === undefined ? null : current) !==
        JSON.stringify(expectedSecret ?? null)
      ) {
        const error = new Error("Import target changed");
        error.code = "IMPORT_STALE";
        throw error;
      }
      if (
        (change.action === "add" && current !== undefined) ||
        (change.action === "replace" && current === undefined)
      ) {
        const error = new Error("Import target changed");
        error.code = "IMPORT_STALE";
        throw error;
      }
    };
    for (const change of changes) {
      validateExpectedChange(change);
    }

    const now = new Date().toISOString();
    const nextData = cloneVaultData(this.data);
    const nextProject = nextData.projects[projectName];
    const nextEnvironment =
      nextProject.environments[resolved.target.environmentId];
    const applyImportChange = (change) => {
      const current = Object.hasOwn(nextEnvironment.secrets, change.key)
        ? nextEnvironment.secrets[change.key]
        : undefined;
      if (change.action === "add") {
        Object.defineProperty(nextEnvironment.secrets, change.key, {
          configurable: true,
          enumerable: true,
          // Preserve field order in existing serialized, fingerprinted, or encrypted records.
          // eslint-disable-next-line sort-keys
          value: {
            value: change.value,
            expiresAt: null,
            createdAt: now,
            updatedAt: now,
            description: "",
            tags: [],
            history: [],
          },
          writable: true,
        });
      } else {
        const old = typeof current === "string" ? { value: current } : current;
        Object.defineProperty(nextEnvironment.secrets, change.key, {
          configurable: true,
          enumerable: true,
          // Preserve field order in existing serialized, fingerprinted, or encrypted records.
          // eslint-disable-next-line sort-keys
          value: {
            ...old,
            value: change.value,
            expiresAt: old.expiresAt ?? null,
            createdAt: old.createdAt || now,
            updatedAt: now,
            description:
              typeof old.description === "string" ? old.description : "",
            tags: Array.isArray(old.tags) ? [...old.tags] : [],
            history: [
              // Preserve field order in existing serialized, fingerprinted, or encrypted records.
              // eslint-disable-next-line sort-keys
              {
                value: old.value,
                expiresAt: old.expiresAt ?? null,
                description:
                  typeof old.description === "string" ? old.description : "",
                tags: Array.isArray(old.tags) ? [...old.tags] : [],
                changedAt: old.updatedAt || now,
              },
              ...(Array.isArray(old.history) ? old.history : []),
            ].slice(0, this.maxHistoryVersions),
          },
          writable: true,
        });
      }
    };
    for (const change of changes) {
      applyImportChange(change);
    }
    nextProject.updatedAt = now;
    nextEnvironment.updatedAt = now;
    nextData.updatedAt = now;

    this._installData(nextData);
    this._scheduleAutoSave();
  }

  isDirty() {
    return this.currentRevision !== this.persistedRevision;
  }

  async prepareForClose() {
    this._ensureUnlocked();
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    const revision = this.currentRevision;
    try {
      if (!this.isDirty() && !this._isDiskStale()) {
        return { revision, status: "clean", vaultId: this._vaultId };
      }
      const result = await this._save();
      if (
        result &&
        typeof result === "object" &&
        "status" in result &&
        result.status === "needs_resolution"
      ) {
        return {
          code: "VAULT_RECONCILIATION_REQUIRED",
          status: "needs_resolution",
          vaultId: this._vaultId,
        };
      }
      if (
        this.currentRevision !== revision &&
        this.currentRevision !== this.persistedRevision
      ) {
        return {
          code: "VAULT_REVISION_CHANGED",
          status: "failed",
          vaultId: this._vaultId,
        };
      }
      return {
        revision: this.persistedRevision,
        status: "persisted",
        vaultId: this._vaultId,
      };
    } catch (error) {
      if (
        error.code === "VAULT_RECONCILIATION_REQUIRED" ||
        error.code === VAULT_EXTERNAL_CHANGE
      ) {
        return {
          code: error.code,
          status: "needs_resolution",
          vaultId: this._vaultId,
        };
      }
      return {
        code: error.code || "VAULT_PERSIST_FAILED",
        status: "failed",
        vaultId: this._vaultId,
      };
    }
  }

  createRecoverySnapshot() {
    this._ensureUnlocked();
    // Preserve field order in existing serialized, fingerprinted, or encrypted records.
    // eslint-disable-next-line sort-keys
    return {
      vaultId: this._vaultId,
      vaultInstanceId: this.vaultInstanceId,
      vaultPath: this.vaultPath,
      sessionData: copyJsonData(this.data),
      baseline: copyJsonData(this._syncBaseline),
      diskFingerprint: this._currentDiskFingerprint(),
      currentRevision: this.currentRevision,
      persistedRevision: this.persistedRevision,
    };
  }

  loadRecoverySnapshot(
    snapshot,
    key,
    options: { legacySourceFingerprint?: { vault: string; salt: string } } = {}
  ) {
    if (
      !snapshot ||
      (snapshot.vaultInstanceId !== this.vaultInstanceId &&
        this.vaultInstanceId !== null)
    ) {
      const error = new Error("Recovery snapshot identity mismatch");
      error.code = "VAULT_RECOVERY_IDENTITY_MISMATCH";
      throw error;
    }
    this.key = Buffer.from(key);
    try {
      const legacySnapshot =
        snapshot.sessionData?.vaultFormatVersion === undefined;
      const incoming = this._getNormalizedCopyWhileLocked(snapshot.sessionData);
      if (legacySnapshot) {
        const fingerprint =
          options.legacySourceFingerprint ||
          this._pendingLegacyRecoveryFingerprint;
        if (!fingerprint) {
          throw new Error(
            "Legacy recovery source is not bound to captured input files"
          );
        }
        // Preserve field order in existing serialized, fingerprinted, or encrypted records.
        // eslint-disable-next-line sort-keys
        incoming.legacySourceFingerprint = {
          vault: "recovery-unbound",
          salt: "recovery-unbound",
        };
        this._pendingLegacyRecoveryFingerprint = { ...fingerprint };
      }
      this.data = incoming;
      this._resetProjectIncarnations();
      this.vaultInstanceId = snapshot.vaultInstanceId;
      this._syncBaseline = this._normalizeRecoveryBaseline(
        snapshot.baseline,
        incoming
      );
      this.currentRevision = Number.isSafeInteger(snapshot.currentRevision)
        ? snapshot.currentRevision
        : 1;
      this.persistedRevision = Number.isSafeInteger(snapshot.persistedRevision)
        ? snapshot.persistedRevision
        : 0;
      this.sessionRevision += 1;
      this._diskContentHash = null;
      this.isLocked = false;
    } catch (error) {
      this.seal();
      throw error;
    }
  }

  // Keep this helper on the existing overridable instance API.
  // eslint-disable-next-line class-methods-use-this
  _normalizeRecoveryBaseline(baseline, normalizedData) {
    if (
      !baseline ||
      typeof baseline !== "object" ||
      !baseline.projects ||
      typeof baseline.projects !== "object"
    ) {
      const error = new Error("Invalid Vault recovery baseline");
      error.code = "VAULT_RECOVERY_INVALID";
      throw error;
    }
    const projects: Record<string, unknown> = Object.create(null);
    const environmentIds = new Map<string, string>();
    const normalizeProjectBaseline = (projectName, rawProjectBaseline) => {
      const projectBaseline = rawProjectBaseline as Record<string, unknown>;
      const projectBaselineEnvironments = projectBaseline?.environments;
      const currentProject = normalizedData.projects[projectName];
      if (
        projectBaselineEnvironments &&
        typeof projectBaselineEnvironments === "object" &&
        !Array.isArray(projectBaselineEnvironments)
      ) {
        projects[projectName] = cloneVaultData(projectBaseline);
        return;
      }
      const environmentId =
        currentProject?.defaultEnvironmentId ||
        crypto
          .createHash("sha256")
          .update(
            `${normalizedData.vaultInstanceId || "recovery"}:${projectName}`
          )
          .digest("hex")
          .slice(0, 32);
      environmentIds.set(projectName, environmentId);
      const projectBaselineSecrets = projectBaseline?.secrets;
      const secrets =
        projectBaselineSecrets &&
        typeof projectBaselineSecrets === "object" &&
        !Array.isArray(projectBaselineSecrets)
          ? cloneVaultData(projectBaselineSecrets)
          : Object.create(null);
      const configurationBaseline = projectBaseline?.configurationBaseline;
      let configuration: unknown = null;
      if (Array.isArray(configurationBaseline)) {
        configuration = cloneVaultData(configurationBaseline);
      } else if (
        configurationBaseline &&
        typeof configurationBaseline === "object"
      ) {
        configuration =
          (configurationBaseline as Record<string, unknown>).requiredKeys ??
          null;
      }
      projects[projectName] = {
        defaultEnvironmentId: environmentId,
        environments: {
          // Preserve field order in existing serialized, fingerprinted, or encrypted records.
          // eslint-disable-next-line sort-keys
          [environmentId]: {
            id: environmentId,
            name: "default",
            secrets,
            configurationBaseline: configuration,
          },
        },
      };
    };
    for (const [projectName, rawProjectBaseline] of Object.entries(
      baseline.projects
    )) {
      normalizeProjectBaseline(projectName, rawProjectBaseline);
    }
    const baselineFavorites = (baseline.favorites || {}) as {
      projects?: unknown;
      secrets?: Record<string, unknown>;
    };
    const secrets: Record<string, Record<string, string[]>> = Object.create(
      null
    );
    const normalizeBaselineFavorites = (projectName, favoriteValue) => {
      if (Array.isArray(favoriteValue)) {
        const environmentId =
          environmentIds.get(projectName) ||
          normalizedData.projects[projectName]?.defaultEnvironmentId;
        if (environmentId) {
          (secrets[projectName] ||= Object.create(null))[environmentId] = [
            ...favoriteValue,
          ];
        }
      } else if (
        favoriteValue &&
        typeof favoriteValue === "object" &&
        !Array.isArray(favoriteValue)
      ) {
        secrets[projectName] = cloneVaultData(favoriteValue);
      }
    };
    for (const [projectName, favoriteValue] of Object.entries(
      baselineFavorites.secrets || {}
    )) {
      normalizeBaselineFavorites(projectName, favoriteValue);
    }
    // Preserve field order in existing serialized, fingerprinted, or encrypted records.
    // eslint-disable-next-line sort-keys
    return {
      projects,
      favorites: {
        projects: Array.isArray(baselineFavorites.projects)
          ? [...baselineFavorites.projects]
          : [],
        secrets,
      },
    };
  }

  async approveRecoveredLegacySource() {
    if (
      !this.data ||
      this.data.legacySourceFingerprint?.vault !== "recovery-unbound"
    ) {
      return false;
    }
    const captured = this._pendingLegacyRecoveryFingerprint;
    if (!captured) {
      throw new Error("Legacy recovery source fingerprint is unavailable");
    }
    if (
      fs.existsSync(this.versionedVaultPath) ||
      fs.existsSync(this.versionedSaltPath)
    ) {
      throw new Error(
        "Cannot resolve legacy recovery while versioned Vault files exist"
      );
    }
    const legacyVault = this._fingerprintPath(this.legacyVaultPath);
    const legacySalt = this._fingerprintPath(this.legacySaltPath);
    if (legacyVault !== captured.vault || legacySalt !== captured.salt) {
      const error = new Error(
        "Legacy recovery inputs changed while recovery was pending"
      );
      error.code = "VAULT_LEGACY_DIVERGENCE";
      throw error;
    }
    if (legacySalt === "missing" || legacySalt === "unreadable") {
      throw new Error("Legacy recovery salt is unavailable");
    }
    const saltBytes = fs.readFileSync(this.legacySaltPath);
    if (!/^[a-f0-9]{64}$/iu.test(saltBytes.toString("utf-8"))) {
      throw new Error("Legacy recovery salt is invalid");
    }
    if (legacyVault !== "missing" && legacyVault !== "unreadable") {
      this._publishImmutableBackup(
        path.join(this.dataDir, "vault-v1-pre-environments.enc"),
        fs.readFileSync(this.legacyVaultPath)
      );
    }
    this._publishImmutableBackup(
      path.join(this.dataDir, "salt-v1-pre-environments.txt"),
      saltBytes
    );
    const temporaryPath = `${this.versionedSaltPath}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
    fs.writeFileSync(temporaryPath, saltBytes, { flag: "wx", mode: 0o600 });
    try {
      fs.linkSync(temporaryPath, this.versionedSaltPath);
    } finally {
      fs.unlinkSync(temporaryPath);
    }
    // Preserve field order in existing serialized, fingerprinted, or encrypted records.
    // eslint-disable-next-line sort-keys
    this.data.legacySourceFingerprint = {
      vault: legacyVault,
      salt: legacySalt,
    };
    this.currentRevision += 1;
    await this._atomicWriteCurrent({ createOnly: true });
    this._pendingLegacyRecoveryFingerprint = null;
    return true;
  }

  _getNormalizedCopyWhileLocked(incoming) {
    const wasLocked = this.isLocked;
    const priorData = this.data;
    this.isLocked = false;
    this.data = SEALED_DATA;
    try {
      return this._getNormalizedCopyOfData(incoming);
    } finally {
      this.data = priorData;
      this.isLocked = wasLocked;
    }
  }

  seal() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = null;
    this.data = SEALED_DATA;
    this._projectIncarnations.clear();
    this._environmentIncarnations.clear();
    this._pendingLegacyRecoveryFingerprint = null;
    if (Buffer.isBuffer(this.key)) {
      this.key.fill(0);
    }
    this.key = SEALED_KEY;
    this._diskContentHash = null;
    this._syncBaseline = null;
    this._reconciliation.clearPlan();
    this.sessionRevision = 0;
    this.currentRevision = 0;
    this.persistedRevision = 0;
    this.vaultInstanceId = null;
    this.isLocked = true;
  }

  /**
   * Change the vault password. Must be called when unlocked.
   * Verifies currentPassword, then re-encrypts vault with newPassword (new salt).
   */
  async changePassword(currentPassword, newPassword) {
    this._ensureUnlocked();
    if (!currentPassword || !newPassword) {
      throw new Error("Current and new password are required");
    }

    const saltHex = fs.readFileSync(this.saltPath, "utf-8");
    const salt = Buffer.from(saltHex, "hex");
    const currentKey = CryptoUtil.deriveKey(currentPassword, salt);
    if (currentKey.length !== this.key.length || !currentKey.equals(this.key)) {
      throw new Error("Invalid current password");
    }

    if (this._isDiskStale()) {
      const result = await this.reconcileExternalChange({ origin: "save" });
      if (result.status === "needs_resolution") {
        const error = new Error("Vault reconciliation required");
        error.code = "VAULT_RECONCILIATION_REQUIRED";
        throw error;
      }
    }

    const newSalt = CryptoUtil.generateSalt();
    const newKey = CryptoUtil.deriveKey(newPassword, newSalt);
    const previousKey = this.key;
    const previousVaultBytes = fs.readFileSync(this.vaultPath);
    const previousSaltHex = saltHex;
    const saltTemporaryPath = `${this.saltPath}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
    let vaultReencrypted = false;
    let reencryptedVaultFingerprint: string | null = null;
    let saltReplaced = false;

    this.key = newKey;
    try {
      await this._atomicWriteCurrent();
      vaultReencrypted = true;
      reencryptedVaultFingerprint = this._diskContentHash;
      await fs.promises.writeFile(saltTemporaryPath, newSalt.toString("hex"), {
        encoding: "utf-8",
        mode: 0o600,
      });
      await fs.promises.chmod(saltTemporaryPath, 0o600);
      await fs.promises.rename(saltTemporaryPath, this.saltPath);
      saltReplaced = true;
    } catch (error) {
      this.key = previousKey;
      try {
        await fs.promises.unlink(saltTemporaryPath);
      } catch {
        // Best-effort cleanup or recovery probing must preserve the primary result.
      }
      try {
        if (
          vaultReencrypted &&
          this._currentDiskFingerprint() === reencryptedVaultFingerprint
        ) {
          const vaultRollbackPath = `${this.vaultPath}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.rollback`;
          await fs.promises.writeFile(vaultRollbackPath, previousVaultBytes, {
            mode: 0o600,
          });
          await fs.promises.rename(vaultRollbackPath, this.vaultPath);
          this._setDiskHashFromCiphertext(previousVaultBytes);
          this._refreshSyncBaseline();
        }
        if (saltReplaced) {
          await fs.promises.writeFile(this.saltPath, previousSaltHex, {
            encoding: "utf-8",
            mode: 0o600,
          });
        }
      } catch (rollbackError) {
        console.error(
          "Failed to roll back the vault password change:",
          rollbackError.message
        );
      }
      throw error;
    }
  }

  /**
   * Verify the master password without changing vault state.
   * Used for step-up re-authentication before high-risk actions.
   */
  verifyPassword(password) {
    this._ensureUnlocked();
    if (!password) {
      throw new Error("Password is required");
    }

    const saltHex = fs.readFileSync(this.saltPath, "utf-8");
    const salt = Buffer.from(saltHex, "hex");
    const derived = CryptoUtil.deriveKey(password, salt);
    return derived.length === this.key.length && derived.equals(this.key);
  }

  getProjects() {
    this._ensureUnlocked();
    return Object.keys(this.data.projects).map((name) => ({
      createdAt: this.data.projects[name].createdAt,
      defaultEnvironmentId: this.data.projects[name].defaultEnvironmentId,
      environmentCount: Object.keys(this.data.projects[name].environments)
        .length,
      name,
      secretCount: Object.values(this.data.projects[name].environments).reduce(
        (count, environment) =>
          count + Object.keys(environment.secrets || {}).length,
        0
      ),
      updatedAt: this.data.projects[name].updatedAt,
    }));
  }

  createProject(name) {
    this._ensureUnlocked();

    if (this.data.projects[name]) {
      throw new Error(`Project '${name}' already exists`);
    }

    const now = new Date().toISOString();
    const environmentId = crypto.randomBytes(16).toString("hex");
    // Preserve field order in existing serialized, fingerprinted, or encrypted records.
    // eslint-disable-next-line sort-keys
    this.data.projects[name] = {
      name,
      createdAt: now,
      updatedAt: now,
      defaultEnvironmentId: environmentId,
      environments: {
        // Preserve field order in existing serialized, fingerprinted, or encrypted records.
        // eslint-disable-next-line sort-keys
        [environmentId]: {
          id: environmentId,
          name: "default",
          createdAt: now,
          updatedAt: now,
          secrets: Object.create(null),
        },
      },
    };
    this._projectIncarnations.set(name, crypto.randomBytes(16).toString("hex"));
    this._setEnvironmentIncarnation(name, environmentId);

    this.data.updatedAt = new Date().toISOString();
    this._scheduleAutoSave();
  }

  deleteProject(name) {
    this._ensureUnlocked();

    if (!this.data.projects[name]) {
      throw new Error(`Project '${name}' does not exist`);
    }

    deleteRecordKey(this.data.projects, name);
    this._projectIncarnations.delete(name);
    for (const key of this._environmentIncarnations.keys()) {
      if ((JSON.parse(key) as [string, string])[0] === name) {
        this._environmentIncarnations.delete(key);
      }
    }

    if (this.data.favorites) {
      if (Array.isArray(this.data.favorites.projects)) {
        this.data.favorites.projects = this.data.favorites.projects.filter(
          (p) => p !== name
        );
      }
      if (
        this.data.favorites.secrets &&
        typeof this.data.favorites.secrets === "object"
      ) {
        deleteRecordKey(this.data.favorites.secrets, name);
      }
    }

    this.data.updatedAt = new Date().toISOString();
    this._scheduleAutoSave();
  }

  getSecrets(selector: TargetSelector): Record<string, SecretReadView> {
    this._ensureUnlocked();
    const { environment } = this._environmentForSelector(selector);
    const { secrets } = environment;
    const result: Record<string, SecretReadView> = Object.create(null);
    for (const [key, secret] of Object.entries(secrets)) {
      result[key] =
        typeof secret === "string"
          ? {
              description: "",
              expiresAt: null,
              tags: [],
              value: secret,
            }
          : {
              createdAt: secret.createdAt ?? null,
              description:
                typeof secret.description === "string"
                  ? secret.description
                  : "",
              expiresAt: secret.expiresAt ?? null,
              tags: Array.isArray(secret.tags)
                ? secret.tags.filter((t): t is string => typeof t === "string")
                : [],
              updatedAt: secret.updatedAt ?? null,
              value: secret.value,
            };
    }
    return result;
  }

  getSecret(selector: TargetSelector, key: string) {
    this._ensureUnlocked();
    const { environment, target } = this._environmentForSelector(selector);
    const secret = environment.secrets[key];
    if (secret === undefined) {
      throw new Error(
        `Secret '${key}' does not exist in Environment '${environment.name}' of project '${target.projectName}'`
      );
    }

    if (typeof secret === "string") {
      return { description: "", expiresAt: null, tags: [], value: secret };
    }
    return {
      createdAt: secret.createdAt ?? null,
      description:
        typeof secret.description === "string" ? secret.description : "",
      expiresAt: secret.expiresAt ?? null,
      tags: Array.isArray(secret.tags)
        ? secret.tags.filter((t) => typeof t === "string")
        : [],
      updatedAt: secret.updatedAt ?? null,
      value: secret.value,
    };
  }

  setSecret(
    selector: TargetSelector,
    key: string,
    value: string,
    expiresAt: string | null = null,
    meta: { description?: string; tags?: string[] } = {}
  ) {
    this._ensureUnlocked();
    const { project, environment } = this._environmentForSelector(selector);

    const now = new Date().toISOString();
    const existingSecret = environment.secrets[key];
    const nextMeta = Vault._normalizeSecretMeta(meta);

    if (existingSecret === undefined) {
      // Preserve field order in existing serialized, fingerprinted, or encrypted records.
      // eslint-disable-next-line sort-keys
      environment.secrets[key] = {
        value,
        expiresAt,
        createdAt: now,
        updatedAt: now,
        description: nextMeta.description,
        tags: nextMeta.tags,
        history: [],
      };
    } else {
      const oldValue =
        typeof existingSecret === "string"
          ? existingSecret
          : existingSecret.value;
      const oldExpiresAt =
        typeof existingSecret === "object" ? existingSecret.expiresAt : null;
      const oldCreatedAt =
        typeof existingSecret === "object" ? existingSecret.createdAt : null;
      const readOldHistory = () =>
        typeof existingSecret === "object" &&
        Array.isArray(existingSecret.history)
          ? existingSecret.history
          : [];
      const oldHistory = readOldHistory();
      const oldMeta = Vault._normalizeSecretMeta(
        typeof existingSecret === "object" ? existingSecret : {}
      );
      const mergedMeta = {
        description:
          nextMeta.description === ""
            ? oldMeta.description
            : nextMeta.description,
        tags:
          meta && typeof meta === "object" && "tags" in meta
            ? nextMeta.tags
            : oldMeta.tags,
      };

      if (
        oldValue !== value ||
        oldExpiresAt !== expiresAt ||
        Vault._secretMetaChanged(oldMeta, mergedMeta)
      ) {
        // Preserve field order in existing serialized, fingerprinted, or encrypted records.
        // eslint-disable-next-line sort-keys
        const historyEntry = {
          value: oldValue,
          expiresAt: oldExpiresAt,
          description: oldMeta.description,
          tags: oldMeta.tags,
          changedAt:
            typeof existingSecret === "string"
              ? now
              : existingSecret.updatedAt || now,
        };

        const newHistory: Record<string, unknown>[] = [
          historyEntry,
          ...oldHistory,
        ];

        if (newHistory.length > this.maxHistoryVersions) {
          newHistory.splice(this.maxHistoryVersions);
        }

        // Preserve field order in existing serialized, fingerprinted, or encrypted records.
        // eslint-disable-next-line sort-keys
        environment.secrets[key] = {
          value,
          expiresAt,
          createdAt: oldCreatedAt || now,
          updatedAt: now,
          description: mergedMeta.description,
          tags: mergedMeta.tags,
          history: newHistory,
        };
      }
    }

    project.updatedAt = now;
    environment.updatedAt = now;
    this.data.updatedAt = now;
    this._scheduleAutoSave();
  }

  static _normalizeSecretMeta(meta): { description: string; tags: string[] } {
    const source = meta && typeof meta === "object" ? meta : {};
    const description =
      typeof source.description === "string"
        ? source.description.slice(0, 500)
        : "";
    const tags: string[] = [];
    if (Array.isArray(source.tags)) {
      for (const entry of source.tags as unknown[]) {
        if (typeof entry !== "string") {
          continue;
        }
        const tag = entry.trim();
        if (tag && !tags.includes(tag)) {
          tags.push(tag);
        }
        if (tags.length === 20) {
          break;
        }
      }
    }
    return { description, tags };
  }

  static _secretMetaChanged(a, b) {
    if (a.description !== b.description) {
      return true;
    }
    if (a.tags.length !== b.tags.length) {
      return true;
    }
    return a.tags.some((t, i) => t !== b.tags[i]);
  }

  setSecrets(selector: TargetSelector, secrets: Record<string, string>) {
    this._ensureUnlocked();
    const { environment } = this._environmentForSelector(selector);
    for (const [key, value] of Object.entries(secrets)) {
      const existing = environment.secrets[key];

      const existingValue =
        typeof existing === "string" ? existing : existing?.value;
      const existingExpiresAt =
        typeof existing === "object" ? (existing?.expiresAt ?? null) : null;
      if (existingValue !== value || existingExpiresAt !== null) {
        this.setSecret(selector, key, value, null);
      }
    }
  }

  renameSecret(selector: TargetSelector, fromKey: string, toKey: string) {
    this._ensureUnlocked();
    const { project, environment, target } =
      this._environmentForSelector(selector);

    if (typeof fromKey !== "string" || typeof toKey !== "string") {
      // Preserve the established validation Error class exposed by the Vault API.
      // eslint-disable-next-line unicorn/prefer-type-error
      throw new Error("Invalid secret key");
    }

    if (!fromKey.trim() || !toKey.trim()) {
      throw new Error("Secret key cannot be empty");
    }

    if (fromKey === toKey) {
      return;
    }

    const { secrets } = environment;

    if (secrets[fromKey] === undefined) {
      throw new Error(
        `Secret '${fromKey}' does not exist in Environment '${environment.name}' of project '${target.projectName}'`
      );
    }

    if (secrets[toKey] !== undefined) {
      throw new Error(
        `Secret '${toKey}' already exists in project '${target.projectName}'`
      );
    }

    secrets[toKey] = secrets[fromKey];
    deleteRecordKey(secrets, fromKey);

    const favoriteKeys =
      this.data.favorites?.secrets?.[target.projectName]?.[
        target.environmentId
      ];
    if (Array.isArray(favoriteKeys)) {
      const nextKeys: string[] = [];
      const seen = new Set<string>();
      for (const k of favoriteKeys) {
        const next = k === fromKey ? toKey : k;
        if (typeof next !== "string") {
          continue;
        }
        if (seen.has(next)) {
          continue;
        }
        seen.add(next);
        nextKeys.push(next);
      }

      if (nextKeys.length > 0) {
        this.data.favorites.secrets[target.projectName][target.environmentId] =
          nextKeys;
      } else {
        deleteRecordKey(
          this.data.favorites.secrets[target.projectName],
          target.environmentId
        );
      }
    }

    const now = new Date().toISOString();
    project.updatedAt = now;
    this.data.updatedAt = now;
    this._scheduleAutoSave();
  }

  deleteSecret(selector: TargetSelector, key: string) {
    this._ensureUnlocked();
    const { project, environment, target } =
      this._environmentForSelector(selector);
    if (environment.secrets[key] === undefined) {
      throw new Error(
        `Secret '${key}' does not exist in Environment '${environment.name}' of project '${target.projectName}'`
      );
    }

    deleteRecordKey(environment.secrets, key);

    const favoriteKeys =
      this.data.favorites?.secrets?.[target.projectName]?.[
        target.environmentId
      ];
    if (Array.isArray(favoriteKeys)) {
      const nextKeys = favoriteKeys.filter((k) => k !== key);
      if (nextKeys.length > 0) {
        this.data.favorites.secrets[target.projectName][target.environmentId] =
          nextKeys;
      } else {
        deleteRecordKey(
          this.data.favorites.secrets[target.projectName],
          target.environmentId
        );
      }
    }

    const now = new Date().toISOString();
    project.updatedAt = now;
    environment.updatedAt = now;
    this.data.updatedAt = now;
    this._scheduleAutoSave();
  }

  getSecretHistory(selector: TargetSelector, key: string) {
    this._ensureUnlocked();
    const { environment, target } = this._environmentForSelector(selector);
    const secret = environment.secrets[key];
    if (secret === undefined) {
      throw new Error(
        `Secret '${key}' does not exist in Environment '${environment.name}' of project '${target.projectName}'`
      );
    }

    const currentVersion = {
      changedAt: typeof secret === "object" ? secret.updatedAt : null,
      description:
        typeof secret === "object" && typeof secret.description === "string"
          ? secret.description
          : "",
      expiresAt: typeof secret === "object" ? secret.expiresAt : null,
      isCurrent: true,
      tags:
        typeof secret === "object" && Array.isArray(secret.tags)
          ? secret.tags.filter((t) => typeof t === "string")
          : [],
      value: typeof secret === "string" ? secret : secret.value,
    };

    const history =
      typeof secret === "object" && Array.isArray(secret.history)
        ? secret.history
        : [];

    return {
      current: currentVersion,
      history: history.map((entry) => ({
        ...entry,
        isCurrent: false,
      })),
      totalVersions: history.length + 1,
    };
  }

  restoreSecretVersion(
    selector: TargetSelector,
    key: string,
    versionIndex: number
  ) {
    this._ensureUnlocked();
    const { environment } = this._environmentForSelector(selector);
    const secret = environment.secrets[key];
    if (secret === undefined) {
      throw new Error(
        `Secret '${key}' does not exist in the selected Environment`
      );
    }

    const history =
      typeof secret === "object" && Array.isArray(secret.history)
        ? secret.history
        : [];

    if (versionIndex < 0 || versionIndex >= history.length) {
      throw new Error(`Invalid version index: ${versionIndex}`);
    }

    const versionToRestore = history[versionIndex];
    if (typeof versionToRestore.value !== "string") {
      // Preserve the established validation Error class exposed by the Vault API.
      // eslint-disable-next-line unicorn/prefer-type-error
      throw new Error("Invalid secret history version");
    }

    const restoredMeta = Vault._normalizeSecretMeta(versionToRestore);
    this.setSecret(
      selector,
      key,
      versionToRestore.value,
      typeof versionToRestore.expiresAt === "string"
        ? versionToRestore.expiresAt
        : null,
      restoredMeta
    );
  }

  _ensureUnlocked() {
    if (this.isLocked) {
      throw new Error("Vault is locked");
    }
    this._assertLegacyInputsUnchanged();
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

  _normalizeData() {
    if (!this.data || typeof this.data !== "object") {
      throw new Error("Invalid vault data");
    }
    if (
      !this.data.projects ||
      typeof this.data.projects !== "object" ||
      Array.isArray(this.data.projects)
    ) {
      throw new Error("Invalid vault projects");
    }
    const formatVersion = this.data.vaultFormatVersion;
    if (formatVersion !== undefined && formatVersion !== VAULT_FORMAT_VERSION) {
      const error = new Error(
        `Unsupported Vault format version: ${formatVersion}`
      );
      error.code = "VAULT_FORMAT_UNSUPPORTED";
      throw error;
    }
    const legacy = formatVersion === undefined;
    const allowedRootFields = new Set([
      "vaultFormatVersion",
      "version",
      "vaultInstanceId",
      "createdAt",
      "updatedAt",
      "legacySourceFingerprint",
      "favorites",
      "projects",
    ]);
    if (Object.keys(this.data).some((key) => !allowedRootFields.has(key))) {
      throw legacy
        ? unsupportedVaultFormat("Unsupported legacy Vault fields")
        : new Error("Invalid Vault v2 fields");
    }
    const legacyFavoritesRecord = this.data.favorites;
    if (
      legacy &&
      legacyFavoritesRecord &&
      Object.keys(legacyFavoritesRecord).some(
        (key) => key !== "projects" && key !== "secrets"
      )
    ) {
      throw unsupportedVaultFormat("Unsupported legacy Vault favorite fields");
    }
    const normalizedProjects: Record<string, ProjectRecord> =
      Object.create(null);
    const legacyFavorites = this.data.favorites?.secrets || Object.create(null);
    const normalizeProject = (name, project) => {
      if (!project || typeof project !== "object" || Array.isArray(project)) {
        throw new Error("Invalid vault project");
      }
      const normalizedProject = { ...project };
      if (legacy) {
        const migrateLegacyProject = () => {
          const allowedLegacyProjectFields = new Set([
            "name",
            "createdAt",
            "updatedAt",
            "secrets",
            "configurationBaseline",
          ]);
          if (
            Object.keys(project).some(
              (key) => !allowedLegacyProjectFields.has(key)
            )
          ) {
            throw unsupportedVaultFormat(
              "Unsupported legacy Vault Project fields"
            );
          }
          if (
            !project.secrets ||
            typeof project.secrets !== "object" ||
            Array.isArray(project.secrets) ||
            project.environments
          ) {
            throw new Error("Ambiguous legacy Vault project format");
          }
          const environmentId = crypto.randomBytes(16).toString("hex");
          normalizedProject.environments = Object.create(null);
          normalizedProject.defaultEnvironmentId = environmentId;
          // Preserve field order in existing serialized, fingerprinted, or encrypted records.
          // eslint-disable-next-line sort-keys
          normalizedProject.environments[environmentId] = {
            id: environmentId,
            name: "default",
            createdAt: project.createdAt || new Date().toISOString(),
            updatedAt: project.updatedAt || new Date().toISOString(),
            secrets: project.secrets,
            ...(project.configurationBaseline
              ? { configurationBaseline: project.configurationBaseline }
              : {}),
          };
          delete normalizedProject.secrets;
          delete normalizedProject.configurationBaseline;
        };
        migrateLegacyProject();
      } else {
        const allowedProjectFields = new Set([
          "name",
          "createdAt",
          "updatedAt",
          "defaultEnvironmentId",
          "environments",
        ]);
        if (
          Object.keys(project).some((key) => !allowedProjectFields.has(key))
        ) {
          throw new Error("Mixed or invalid Vault project fields");
        }
        if (
          Object.hasOwn(project, "secrets") ||
          Object.hasOwn(project, "configurationBaseline") ||
          !project.environments ||
          typeof project.environments !== "object" ||
          Array.isArray(project.environments)
        ) {
          throw new Error("Mixed or invalid Vault format");
        }
      }
      const environments = Object.create(null);
      const normalizeEnvironment = (id, environment) => {
        if (
          !environment ||
          typeof environment !== "object" ||
          Array.isArray(environment) ||
          environment.id !== id ||
          typeof environment.name !== "string" ||
          !environment.secrets ||
          typeof environment.secrets !== "object" ||
          Array.isArray(environment.secrets)
        ) {
          throw new Error("Invalid Vault environment");
        }
        const allowedEnvironmentFields = new Set([
          "id",
          "name",
          "createdAt",
          "updatedAt",
          "secrets",
          "configurationBaseline",
        ]);
        if (
          Object.keys(environment).some(
            (key) => !allowedEnvironmentFields.has(key)
          )
        ) {
          throw new Error("Invalid Vault environment fields");
        }
        if (
          Vault._normalizeEnvironmentName(environment.name) !== environment.name
        ) {
          throw new Error("Invalid Vault environment name");
        }
        validateEnvironmentSecrets(environment.secrets);
        const secrets = Object.create(null);
        for (const [key, secret] of Object.entries(environment.secrets) as [
          string,
          SecretRecord | string,
        ][]) {
          secrets[key] = secret;
        }
        const normalizedEnvironment = { ...environment, secrets };
        if (Object.hasOwn(environment, "configurationBaseline")) {
          normalizedEnvironment.configurationBaseline =
            ProjectConfigurationBaseline.validateStoredBaseline(
              environment.configurationBaseline
            );
        }
        environments[id] = normalizedEnvironment;
      };
      for (const [id, environment] of Object.entries(
        normalizedProject.environments
      )) {
        normalizeEnvironment(id, environment);
      }
      if (
        Object.keys(environments).length === 0 ||
        !Object.hasOwn(environments, normalizedProject.defaultEnvironmentId)
      ) {
        throw new Error("Vault project has no valid default Environment");
      }
      normalizedProject.environments = environments;
      const environmentNames = (
        Object.values(environments) as EnvironmentRecord[]
      ).map((environment) => environment.name);
      if (new Set(environmentNames).size !== environmentNames.length) {
        throw new Error("Duplicate Vault environment name");
      }
      normalizedProjects[name] = normalizedProject;
    };
    for (const [name, project] of Object.entries(this.data.projects)) {
      normalizeProject(name, project);
    }
    if (legacy) {
      this._needsFormatMigration = true;
      this.data.vaultFormatVersion = VAULT_FORMAT_VERSION;
    }
    this.data.projects = normalizedProjects;

    const normalizeFavorites = () => {
      const normalizedFavorites: VaultData["favorites"] = {
        projects: [],
        secrets: Object.create(null),
      };
      const favorites = this.data.favorites || {};
      if (
        !legacy &&
        Object.keys(favorites).some(
          (key) => key !== "projects" && key !== "secrets"
        )
      ) {
        throw new Error("Invalid Vault favorites fields");
      }
      if (Array.isArray(favorites.projects)) {
        normalizedFavorites.projects = [
          ...new Set(
            favorites.projects.filter(
              (name: unknown): name is string =>
                typeof name === "string" && Boolean(normalizedProjects[name])
            )
          ),
        ];
      }
      const normalizeProjectFavorites = (projectName, project) => {
        const incoming = legacy
          ? legacyFavorites[projectName]
          : favorites.secrets?.[projectName];
        const perEnvironment: Record<string, unknown> = Object.create(null);
        if (legacy) {
          const id = project.defaultEnvironmentId;
          if (Array.isArray(incoming)) {
            perEnvironment[id] = incoming;
          }
        } else if (
          incoming &&
          typeof incoming === "object" &&
          !Array.isArray(incoming)
        ) {
          if (
            !legacy &&
            Object.keys(incoming).some((id) => !project.environments[id])
          ) {
            throw new Error("Invalid Vault favorite Environment");
          }
          for (const [id, keys] of Object.entries(incoming)) {
            perEnvironment[id] = keys;
          }
        } else if (Array.isArray(incoming)) {
          // Preserve the established validation Error class exposed by the Vault API.
          // eslint-disable-next-line unicorn/prefer-type-error
          throw new Error("Mixed Vault favorite format");
        }
        for (const [id, keys] of Object.entries(perEnvironment)) {
          if (!legacy && !project.environments[id]) {
            throw new Error("Invalid Vault favorite Environment");
          }
          const env = project.environments[id];
          if (!env) {
            continue;
          }
          const filtered: string[] = [
            ...new Set(
              (Array.isArray(keys) ? keys : []).filter(
                (key): key is string =>
                  typeof key === "string" && env.secrets[key] !== undefined
              )
            ),
          ];
          if (filtered.length) {
            (normalizedFavorites.secrets[projectName] ||= Object.create(null))[
              id
            ] = filtered;
          }
        }
      };
      for (const [projectName, project] of Object.entries(
        normalizedProjects
      ) as [string, ProjectRecord][]) {
        normalizeProjectFavorites(projectName, project);
      }
      if (
        !legacy &&
        Object.keys(favorites.secrets || {}).some(
          (projectName) => !normalizedProjects[projectName]
        )
      ) {
        throw new Error("Invalid Vault favorite Project");
      }
      this.data.favorites = normalizedFavorites;
    };
    normalizeFavorites();
  }

  async _save(): Promise<unknown> {
    if (!this.data || !this.key) {
      return;
    }

    if (this._isDiskStale()) {
      const result = await this.reconcileExternalChange({ origin: "save" });
      if (result.status === "needs_resolution") {
        const error = new Error("Vault reconciliation required");
        error.code = "VAULT_RECONCILIATION_REQUIRED";
        throw error;
      }
      return result;
    }
    try {
      return await this._atomicWriteCurrent();
    } catch (error) {
      if (error.code !== VAULT_EXTERNAL_CHANGE) {
        throw error;
      }
      const result = await this.reconcileExternalChange({ origin: "save" });
      if (result.status === "needs_resolution") {
        const reconciliationError = new Error("Vault reconciliation required");
        reconciliationError.code = "VAULT_RECONCILIATION_REQUIRED";
        throw reconciliationError;
      }
      return result;
    }
  }

  // Keep the async API: synchronous validation failures must remain rejected promises.
  // eslint-disable-next-line require-await
  async _atomicWriteCurrent(options: { createOnly?: boolean } = {}) {
    return this._enqueuePersistenceOperation(() =>
      this._writeData(this.data, options)
    );
  }

  _enqueuePersistenceOperation(operation) {
    const previous = this._persistenceQueue || Promise.resolve();
    const current = previous
      // Retain persistence-queue settlement and cleanup ordering without adding await boundaries.
      // eslint-disable-next-line promise/prefer-await-to-then
      .catch(() => {
        // A rejected save must not block subsequent queued persistence operations.
      })
      // Retain persistence-queue settlement and cleanup ordering without adding await boundaries.
      // eslint-disable-next-line promise/prefer-await-to-then
      .then(operation);
    this._persistenceQueue = current;
    current
      // Retain persistence-queue settlement and cleanup ordering without adding await boundaries.
      // eslint-disable-next-line promise/prefer-await-to-then
      .finally(() => {
        if (this._persistenceQueue === current) {
          this._persistenceQueue = null;
        }
      })
      // Retain persistence-queue settlement and cleanup ordering without adding await boundaries.
      // eslint-disable-next-line promise/prefer-await-to-then
      .catch(() => {
        // A rejected save must not block subsequent queued persistence operations.
      });
    return current;
  }

  _atomicWriteData(
    nextData: VaultData,
    options: {
      incrementRevision?: boolean;
      expectedDiskFingerprint?: string;
      expectedSessionRevision?: number;
    } = {}
  ) {
    return this._enqueuePersistenceOperation(() =>
      this._writeData(nextData, options)
    );
  }

  async _writeData(
    nextData: VaultData,
    options: {
      incrementRevision?: boolean;
      expectedDiskFingerprint?: string;
      expectedSessionRevision?: number;
      createOnly?: boolean;
    } = {}
  ) {
    this._assertLegacyInputsUnchanged();
    const startingRevision = this.currentRevision;
    const startingSessionRevision = this.sessionRevision;
    if (
      options.expectedSessionRevision !== undefined &&
      options.expectedSessionRevision !== this.sessionRevision
    ) {
      const error = new Error(
        "Vault changed after reconciliation was prepared"
      );
      error.code = "VAULT_RECONCILIATION_SUPERSEDED";
      throw error;
    }
    const normalizedData = copyJsonData(nextData);
    const encryptedData = CryptoUtil.encryptJson(normalizedData, this.key);
    const temporaryPath = `${this.vaultPath}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
    const expectedDiskFingerprint =
      options.expectedDiskFingerprint ?? this._diskContentHash;
    try {
      await fs.promises.writeFile(temporaryPath, encryptedData, {
        mode: 0o600,
      });
      await fs.promises.chmod(temporaryPath, 0o600);
      if (
        this.currentRevision !== startingRevision ||
        this.sessionRevision !== startingSessionRevision
      ) {
        const error = new Error("Vault changed while preparing the save");
        error.code = "VAULT_REVISION_CHANGED";
        throw error;
      }
      if (
        expectedDiskFingerprint !== null &&
        this._currentDiskFingerprint() !== expectedDiskFingerprint
      ) {
        const error = new Error(
          "Vault file changed before it could be replaced"
        );
        error.code = VAULT_EXTERNAL_CHANGE;
        throw error;
      }
      if (options.createOnly || expectedDiskFingerprint === null) {
        await fs.promises.link(temporaryPath, this.vaultPath);
        await fs.promises.unlink(temporaryPath);
      } else {
        await fs.promises.rename(temporaryPath, this.vaultPath);
      }
      this._setDiskHashFromCiphertext(encryptedData);
      if (
        this.currentRevision !== startingRevision ||
        this.sessionRevision !== startingSessionRevision
      ) {
        const error = new Error("Vault changed while writing the save");
        error.code = "VAULT_REVISION_CHANGED";
        throw error;
      }
      this._installData(normalizedData);
      if (options.incrementRevision === true) {
        this.sessionRevision += 1;
        this.currentRevision += 1;
      }
      this._refreshSyncBaseline();
      this.persistedRevision = this.currentRevision;
    } catch (error) {
      try {
        await fs.promises.unlink(temporaryPath);
      } catch {
        // Best-effort cleanup or recovery probing must preserve the primary result.
      }
      throw error;
    }
  }

  _scheduleAutoSave() {
    this.sessionRevision += 1;
    this.currentRevision += 1;
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = setTimeout(async () => {
      try {
        await this._save();
      } catch (error) {
        if (error.code !== "VAULT_RECONCILIATION_REQUIRED") {
          console.error("Auto-save failed:", error);
        }
      }
    }, 1000);
  }

  // Keep the async API: synchronous validation failures must remain rejected promises.
  // eslint-disable-next-line require-await
  async saveNow(_options = {}) {
    if (this.isLocked) {
      throw new Error("Vault is locked");
    }

    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }

    return this._save();
  }

  // Keep the async API: synchronous validation failures must remain rejected promises.
  // eslint-disable-next-line require-await
  async reconcileExternalChange(options = {}) {
    this._ensureUnlocked();
    return this._reconciliation.reconcileExternalChange(options);
  }

  // Keep the async API: synchronous validation failures must remain rejected promises.
  // eslint-disable-next-line require-await
  async resolveReconciliation(options = {}) {
    this._ensureUnlocked();
    return this._reconciliation.resolveReconciliation(options);
  }

  _isDiskStale() {
    if (
      this.isLocked ||
      this._diskContentHash === null ||
      this._diskContentHash === undefined
    ) {
      return false;
    }
    if (!fs.existsSync(this.vaultPath)) {
      return true;
    }
    try {
      const current = fs.readFileSync(this.vaultPath);
      return sha256Hex(current) !== this._diskContentHash;
    } catch {
      return true;
    }
  }

  _currentDiskFingerprint() {
    try {
      return sha256Hex(fs.readFileSync(this.vaultPath));
    } catch (error) {
      return error?.code === "ENOENT" ? "missing" : "unreadable";
    }
  }

  _getNormalizedCopyOfData(incoming) {
    this._ensureUnlocked();
    const prev = this.data;
    this.data = copyJsonData(incoming);
    try {
      this._normalizeData();
      return copyJsonData(this.data);
    } finally {
      this.data = prev;
    }
  }

  toggleProjectFavorite(projectName) {
    this._ensureUnlocked();

    if (!this.data.projects[projectName]) {
      throw new Error(`Project '${projectName}' does not exist`);
    }

    const current = Array.isArray(this.data.favorites.projects)
      ? this.data.favorites.projects
      : [];
    const isFavorite = current.includes(projectName);
    if (isFavorite) {
      this.data.favorites.projects = current.filter((p) => p !== projectName);
    } else {
      const next = current.filter((p) => p !== projectName);
      next.push(projectName);
      this.data.favorites.projects = next;
    }

    this.data.updatedAt = new Date().toISOString();
    this._scheduleAutoSave();

    return !isFavorite;
  }

  toggleSecretFavorite(selector: TargetSelector, secretKey: string) {
    this._ensureUnlocked();
    const { environment, target } = this._environmentForSelector(selector);
    if (environment.secrets[secretKey] === undefined) {
      throw new Error(
        `Secret '${secretKey}' does not exist in the selected Environment`
      );
    }
    this.data.favorites.secrets[target.projectName] ||= Object.create(null);
    const projectFavorites = this.data.favorites.secrets[target.projectName];
    const current = Array.isArray(projectFavorites[target.environmentId])
      ? projectFavorites[target.environmentId]
      : [];
    const isFavorite = current.includes(secretKey);
    const next = current.filter((k) => k !== secretKey);
    if (isFavorite) {
      if (next.length > 0) {
        projectFavorites[target.environmentId] = next;
      } else {
        deleteRecordKey(projectFavorites, target.environmentId);
        if (Object.keys(projectFavorites).length === 0) {
          deleteRecordKey(this.data.favorites.secrets, target.projectName);
        }
      }
    } else {
      next.push(secretKey);
      projectFavorites[target.environmentId] = next;
    }

    this.data.updatedAt = new Date().toISOString();
    this._scheduleAutoSave();

    return !isFavorite;
  }

  getFavorites(): {
    projects: string[];
    secrets: Record<string, Record<string, string[]>>;
  } {
    this._ensureUnlocked();

    const secrets: Record<string, Record<string, string[]>> = Object.create(
      null
    );
    const favoriteSecrets = this.data.favorites?.secrets;
    if (favoriteSecrets && typeof favoriteSecrets === "object") {
      for (const [projectName, environments] of Object.entries(
        favoriteSecrets
      )) {
        secrets[projectName] = Object.create(null);
        for (const [environmentId, secretKeys] of Object.entries(
          environments || {}
        )) {
          if (!Array.isArray(secretKeys)) {
            continue;
          }
          secrets[projectName][environmentId] = secretKeys.filter(
            (k) => typeof k === "string"
          );
        }
      }
    }

    return {
      projects: Array.isArray(this.data.favorites?.projects)
        ? [...this.data.favorites.projects]
        : [],
      secrets,
    };
  }

  getStatistics(selector: EnvironmentTarget | null = null) {
    this._ensureUnlocked();

    const totalProjects = Object.keys(this.data.projects).length;
    let totalSecrets = 0;
    let expiringSecrets = 0;
    let hasExpired = false;

    const now = new Date();
    const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const environments =
      selector === null
        ? Object.values(this.data.projects).flatMap((project) =>
            Object.values(project.environments)
          )
        : [this._environmentForSelector(selector).environment];
    for (const environment of environments) {
      const secrets = environment.secrets || {};
      totalSecrets += Object.keys(secrets).length;

      for (const secret of Object.values(secrets)) {
        const expiresAt = typeof secret === "object" ? secret.expiresAt : null;
        if (expiresAt) {
          const expiryDate = new Date(expiresAt);
          if (expiryDate <= sevenDaysLater) {
            expiringSecrets += 1;
            if (expiryDate < now) {
              hasExpired = true;
            }
          }
        }
      }
    }

    return {
      expiringSecrets,
      hasExpired,
      totalProjects,
      totalSecrets,
    };
  }

  createEncryptedProjectBackup(projectName: string): Buffer {
    this._ensureUnlocked();
    const project = this.data.projects[projectName];
    if (!project) {
      throw new Error(`Project '${projectName}' does not exist`);
    }
    const favorites =
      this.data.favorites.secrets[projectName] || Object.create(null);
    return CryptoUtil.encryptJson(
      // Preserve field order in existing serialized, fingerprinted, or encrypted records.
      // eslint-disable-next-line sort-keys
      {
        format: "localkeys-backup",
        version: 2,
        project: projectName,
        exportedAt: new Date().toISOString(),
        projectRecord: project,
        favoriteSecrets: favorites,
      },
      this.key
    );
  }

  restoreEncryptedProjectBackup(encryptedBackup: Buffer, projectName?: string) {
    this._ensureUnlocked();
    if (!Buffer.isBuffer(encryptedBackup) || encryptedBackup.length === 0) {
      throw new TypeError("Encrypted Project backup is required");
    }
    const backup = CryptoUtil.decryptJson(encryptedBackup, this.key);
    if (
      !backup ||
      backup.format !== "localkeys-backup" ||
      (backup.version !== 1 && backup.version !== 2) ||
      typeof backup.project !== "string"
    ) {
      throw new Error("Unsupported Project backup format");
    }
    const name = projectName || backup.project;
    if (Object.hasOwn(this.data.projects, name)) {
      throw new Error(`Project '${name}' already exists`);
    }
    let restoredProject: ProjectRecord;
    let favoriteSecrets: Record<string, unknown> = Object.create(null);
    if (backup.version === 1) {
      const restoreLegacyProject = (): ProjectRecord => {
        if (
          !backup.secrets ||
          typeof backup.secrets !== "object" ||
          Array.isArray(backup.secrets)
        ) {
          throw new Error("Invalid legacy Project backup");
        }
        validateEnvironmentSecrets(backup.secrets);
        const environmentId = crypto.randomBytes(16).toString("hex");
        const now = new Date().toISOString();
        // Preserve field order in existing serialized, fingerprinted, or encrypted records.
        // eslint-disable-next-line sort-keys
        return {
          name,
          createdAt: now,
          updatedAt: now,
          defaultEnvironmentId: environmentId,
          environments: {
            // Preserve field order in existing serialized, fingerprinted, or encrypted records.
            // eslint-disable-next-line sort-keys
            [environmentId]: {
              id: environmentId,
              name: "default",
              createdAt: now,
              updatedAt: now,
              secrets: backup.secrets,
              ...(backup.configurationBaseline
                ? {
                    configurationBaseline:
                      ProjectConfigurationBaseline.validateStoredBaseline(
                        backup.configurationBaseline
                      ),
                  }
                : {}),
            },
          },
        };
      };
      restoredProject = restoreLegacyProject();
    } else {
      if (
        !backup.projectRecord ||
        typeof backup.projectRecord !== "object" ||
        backup.projectRecord.name !== backup.project
      ) {
        throw new Error("Invalid Project backup");
      }
      // Preserve field order in existing serialized, fingerprinted, or encrypted records.
      // eslint-disable-next-line sort-keys
      const backupData = {
        vaultFormatVersion: VAULT_FORMAT_VERSION,
        favorites: { projects: [], secrets: Object.create(null) },
        projects: { [name]: { ...backup.projectRecord, name } },
      } as VaultData;
      const validated = this._getNormalizedCopyOfData(backupData);
      ({ [name]: restoredProject } = validated.projects);
    }
    if (backup.favoriteSecrets !== undefined) {
      const restoreFavoriteRecord = () => {
        if (
          !backup.favoriteSecrets ||
          typeof backup.favoriteSecrets !== "object" ||
          Array.isArray(backup.favoriteSecrets)
        ) {
          throw new Error("Invalid Project favorite backup");
        }
        ({ favoriteSecrets } = backup);
      };
      restoreFavoriteRecord();
    }
    const nextData = cloneVaultData(this.data);
    nextData.projects[name] = restoredProject;
    const restoreFavoriteKeys = (environmentId, keys) => {
      const environment = restoredProject.environments[environmentId];
      if (
        !environment ||
        !Array.isArray(keys) ||
        keys.some(
          (key) =>
            typeof key !== "string" || environment.secrets[key] === undefined
        )
      ) {
        throw new Error("Invalid Project favorite backup");
      }
      if (keys.length) {
        (nextData.favorites.secrets[name] ||= Object.create(null))[
          environmentId
        ] = [...new Set(keys as string[])];
      }
    };
    for (const [environmentId, keys] of Object.entries(favoriteSecrets)) {
      restoreFavoriteKeys(environmentId, keys);
    }
    nextData.updatedAt = new Date().toISOString();
    const validatedData = this._getNormalizedCopyOfData(nextData);
    this._installData(validatedData);
    for (const id of Object.keys(restoredProject.environments)) {
      this._setEnvironmentIncarnation(name, id);
    }
    this._scheduleAutoSave();
    return {
      environmentCount: Object.keys(restoredProject.environments).length,
      projectName: name,
    };
  }
}

Vault.VAULT_EXTERNAL_CHANGE = VAULT_EXTERNAL_CHANGE;

// TypeScript declaration merging keeps the existing CommonJS constructor and exported type aliases.
// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace Vault {
  export type Target = EnvironmentTarget;
  export type Selector = TargetSelector;
  export type Environment = EnvironmentRecord;
  export type Secret = SecretRecord;
}

export = Vault;
