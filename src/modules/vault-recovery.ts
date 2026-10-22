import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  cloneVaultData,
  copyJsonData,
  isObjectRecord,
  isSafeInteger,
  sha256Hex,
} from "./vault-helpers";
import { VAULT_FORMAT_VERSION } from "./vault-normalization";
import type {
  RecoverySnapshot,
  StoredConfigurationBaseline,
  VaultBoundaryRecord,
  VaultBoundaryValue,
  VaultData,
  VaultSyncBaseline,
} from "./vault-types";

export interface VaultRecoveryHost {
  data: VaultData;
  key: Buffer | null;
  vaultPath: string;
  saltPath: string;
  legacyVaultPath: string;
  legacySaltPath: string;
  versionedVaultPath: string;
  versionedSaltPath: string;
  dataDir: string;
  vaultInstanceId: string | null;
  _vaultId: string | null;
  _diskContentHash: string | null;
  _legacySaltLoadedFingerprint: string | null;
  legacyVaultFingerprint: string | null;
  legacySaltFingerprint: string | null;
  _needsFormatMigration: boolean;
  _pendingLegacyRecoveryFingerprint: { vault: string; salt: string } | null;
  currentRevision: number;
  persistedRevision: number;
  sessionRevision: number;
  isLocked: boolean;
  _syncBaseline: VaultSyncBaseline | null;
  _ensureUnlocked: () => void;
  _currentDiskFingerprint: () => string;
  _publishImmutableBackup: (targetPath: string, content: Buffer) => void;
  _atomicWriteCurrent: (options?: { createOnly?: boolean }) => Promise<void>;
  _getNormalizedCopyWhileLocked: (incoming: VaultBoundaryValue) => VaultData;
  _resetProjectIncarnations: () => void;
  seal: () => void;
}

export const fingerprintPath = (filePath: string): string => {
  try {
    return sha256Hex(fs.readFileSync(filePath));
  } catch (error) {
    // SAFETY: Catch error is checked as an object record for ENOENT code before returning fallback.
    const err = error as VaultBoundaryValue;
    if (isObjectRecord(err) && err.code === "ENOENT") {
      return "missing";
    }
    return "unreadable";
  }
};

export const assertLegacyInputsUnchanged = (vault: VaultRecoveryHost): void => {
  const expected = vault.data?.legacySourceFingerprint;
  if (!expected) {
    return;
  }
  const actualVault = fingerprintPath(vault.legacyVaultPath);
  const actualSalt = fingerprintPath(vault.legacySaltPath);
  if (actualVault !== expected.vault || actualSalt !== expected.salt) {
    const error = new Error(
      "Legacy Vault files changed after Environment migration; resolve legacy divergence before continuing"
    );
    error.code = "VAULT_LEGACY_DIVERGENCE";
    throw error;
  }
};

export const persistLegacyIdentity = async (
  vault: VaultRecoveryHost
): Promise<boolean> => {
  if (vault.vaultInstanceId) {
    return false;
  }
  vault.vaultInstanceId = crypto.randomBytes(32).toString("hex");
  vault.data.vaultInstanceId = vault.vaultInstanceId;
  vault.currentRevision += 1;
  vault.sessionRevision += 1;
  await vault._atomicWriteCurrent();
  return true;
};

export const migrateLegacyFiles = async (
  vault: VaultRecoveryHost
): Promise<boolean> => {
  if (!vault._needsFormatMigration) {
    return false;
  }
  const legacyVault = fs.readFileSync(vault.legacyVaultPath);
  const legacySalt = fs.readFileSync(vault.legacySaltPath);
  vault.legacyVaultFingerprint = sha256Hex(legacyVault);
  vault.legacySaltFingerprint = sha256Hex(legacySalt);
  const targetVaultPath = path.join(vault.dataDir, "vault-v2.enc");
  const targetSaltPath = path.join(vault.dataDir, "salt-v2.txt");
  if (fs.existsSync(targetVaultPath) || fs.existsSync(targetSaltPath)) {
    throw new Error(
      "Versioned Vault files already exist; migration was interrupted and needs recovery"
    );
  }
  if (
    sha256Hex(legacyVault) !== vault._diskContentHash ||
    sha256Hex(legacySalt) !== vault._legacySaltLoadedFingerprint
  ) {
    const error = new Error(
      "Legacy Vault files changed while they were being opened"
    );
    error.code = "VAULT_LEGACY_DIVERGENCE";
    throw error;
  }
  vault.legacyVaultFingerprint = sha256Hex(legacyVault);
  vault.legacySaltFingerprint = sha256Hex(legacySalt);
  vault._publishImmutableBackup(
    path.join(vault.dataDir, "vault-v1-pre-environments.enc"),
    legacyVault
  );
  vault._publishImmutableBackup(
    path.join(vault.dataDir, "salt-v1-pre-environments.txt"),
    legacySalt
  );
  vault.vaultPath = targetVaultPath;
  vault.saltPath = targetSaltPath;
  // Preserve field order in existing serialized, fingerprinted, or encrypted records.
  // eslint-disable-next-line sort-keys
  vault.data.legacySourceFingerprint = {
    vault: vault.legacyVaultFingerprint,
    salt: vault.legacySaltFingerprint,
  };
  vault._diskContentHash = null;
  if (!fs.existsSync(vault.saltPath)) {
    const saltTemporaryPath = `${vault.saltPath}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
    fs.writeFileSync(saltTemporaryPath, legacySalt, {
      flag: "wx",
      mode: 0o600,
    });
    try {
      fs.linkSync(saltTemporaryPath, vault.saltPath);
    } finally {
      fs.unlinkSync(saltTemporaryPath);
    }
  }
  vault.data.vaultFormatVersion = VAULT_FORMAT_VERSION;
  vault.currentRevision += 1;
  try {
    if (
      sha256Hex(fs.readFileSync(vault.legacyVaultPath)) !==
        vault.legacyVaultFingerprint ||
      sha256Hex(fs.readFileSync(vault.legacySaltPath)) !==
        vault.legacySaltFingerprint
    ) {
      const error = new Error("Legacy Vault files changed during migration");
      error.code = "VAULT_LEGACY_DIVERGENCE";
      throw error;
    }
    await vault._atomicWriteCurrent({ createOnly: true });
    vault._needsFormatMigration = false;
    return true;
  } catch (error) {
    vault.vaultPath = vault.versionedVaultPath;
    vault.saltPath = vault.versionedSaltPath;
    throw error;
  }
};

export const normalizeRecoveryBaseline = (
  baseline: VaultBoundaryValue,
  normalizedData: VaultData
): VaultSyncBaseline => {
  if (
    !baseline ||
    !isObjectRecord(baseline) ||
    !baseline.projects ||
    !isObjectRecord(baseline.projects)
  ) {
    const error = new Error("Invalid Vault recovery baseline");
    error.code = "VAULT_RECOVERY_INVALID";
    throw error;
  }
  const projects: VaultBoundaryRecord = Object.create(null);
  const environmentIds = new Map<string, string>();
  const normalizeProjectBaseline = (
    projectName: string,
    rawProjectBaseline: VaultBoundaryValue
  ) => {
    // SAFETY: Raw project baseline from validated baseline.projects dictionary.
    const projectBaseline = rawProjectBaseline as VaultBoundaryRecord;
    const projectBaselineEnvironments = projectBaseline?.environments;
    const currentProject = normalizedData.projects[projectName];
    if (
      projectBaselineEnvironments &&
      isObjectRecord(projectBaselineEnvironments)
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
      projectBaselineSecrets && isObjectRecord(projectBaselineSecrets)
        ? cloneVaultData(projectBaselineSecrets)
        : Object.create(null);
    const configurationBaseline = projectBaseline?.configurationBaseline;
    let configuration: StoredConfigurationBaseline | string[] | null = null;
    if (Array.isArray(configurationBaseline)) {
      // SAFETY: Cloned baseline array of required keys.
      configuration = cloneVaultData(configurationBaseline) as string[];
    } else if (configurationBaseline && isObjectRecord(configurationBaseline)) {
      // SAFETY: Required keys extracted from stored configuration baseline.
      configuration = Array.isArray(configurationBaseline.requiredKeys)
        ? (configurationBaseline.requiredKeys as string[])
        : null;
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
  // SAFETY: Validated baseline favorites structure extracted safely.
  const baselineFavorites = (
    isObjectRecord(baseline.favorites) ? baseline.favorites : {}
  ) as {
    projects?: string[];
    secrets?: VaultBoundaryRecord;
  };
  const secrets: Record<string, Record<string, string[]>> = Object.create(null);
  const normalizeBaselineFavorites = (
    projectName: string,
    favoriteValue: VaultBoundaryValue
  ) => {
    if (Array.isArray(favoriteValue)) {
      const environmentId =
        environmentIds.get(projectName) ||
        normalizedData.projects[projectName]?.defaultEnvironmentId;
      if (environmentId) {
        (secrets[projectName] ||= Object.create(null))[environmentId] = [
          // SAFETY: Array of string keys from baseline favorite payload.
          ...(favoriteValue as string[]),
        ];
      }
    } else if (favoriteValue && isObjectRecord(favoriteValue)) {
      // SAFETY: Cloned map of environment favorites.
      secrets[projectName] = cloneVaultData(favoriteValue) as Record<
        string,
        string[]
      >;
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
};

export const createRecoverySnapshot = (
  vault: VaultRecoveryHost
): RecoverySnapshot => {
  vault._ensureUnlocked();
  // Preserve field order in existing serialized, fingerprinted, or encrypted records.
  // eslint-disable-next-line sort-keys
  return {
    vaultId: vault._vaultId ?? null,
    vaultInstanceId: vault.vaultInstanceId ?? null,
    vaultPath: vault.vaultPath,
    sessionData: copyJsonData(vault.data),
    baseline: copyJsonData(vault._syncBaseline),
    diskFingerprint: vault._currentDiskFingerprint(),
    currentRevision: vault.currentRevision ?? 0,
    persistedRevision: vault.persistedRevision ?? 0,
  };
};

export const loadRecoverySnapshot = (
  vault: VaultRecoveryHost,
  snapshot: RecoverySnapshot,
  key: Buffer | Uint8Array,
  options: { legacySourceFingerprint?: { vault: string; salt: string } } = {}
): void => {
  if (
    !snapshot ||
    (snapshot.vaultInstanceId !== vault.vaultInstanceId &&
      vault.vaultInstanceId !== null)
  ) {
    const error = new Error("Recovery snapshot identity mismatch");
    error.code = "VAULT_RECOVERY_IDENTITY_MISMATCH";
    throw error;
  }
  vault.key = Buffer.from(key);
  try {
    const { baseline, currentRevision, persistedRevision, sessionData } =
      snapshot;
    // SAFETY: Raw sessionData payload from recovery snapshot is verified by getNormalizedCopyWhileLocked.
    const incoming = vault._getNormalizedCopyWhileLocked(
      sessionData as VaultBoundaryValue
    );
    // SAFETY: Recovery sessionData payload is inspected as a boundary value before normalization.
    const rawSessionData = sessionData as VaultBoundaryValue;
    const legacySnapshot = isObjectRecord(rawSessionData)
      ? rawSessionData.vaultFormatVersion === undefined
      : true;
    if (legacySnapshot) {
      const fingerprint =
        options.legacySourceFingerprint ||
        vault._pendingLegacyRecoveryFingerprint;
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
      vault._pendingLegacyRecoveryFingerprint = { ...fingerprint };
    }
    vault.data = incoming;
    vault._resetProjectIncarnations();
    vault.vaultInstanceId = snapshot.vaultInstanceId ?? null;
    // SAFETY: Raw baseline payload from recovery snapshot is normalized by normalizeRecoveryBaseline.
    const baselinePayload = (baseline ?? null) as VaultBoundaryValue;
    vault._syncBaseline = normalizeRecoveryBaseline(baselinePayload, incoming);
    const safeCurrentRevision = isSafeInteger(currentRevision)
      ? currentRevision
      : 1;
    vault.currentRevision = safeCurrentRevision;
    const safePersistedRevision = isSafeInteger(persistedRevision)
      ? persistedRevision
      : 0;
    vault.persistedRevision = safePersistedRevision;
    vault.sessionRevision += 1;
    vault._diskContentHash = null;
    vault.isLocked = false;
  } catch (error) {
    vault.seal();
    throw error;
  }
};

export const approveRecoveredLegacySource = async (
  vault: VaultRecoveryHost
): Promise<boolean> => {
  if (
    !vault.data ||
    vault.data.legacySourceFingerprint?.vault !== "recovery-unbound"
  ) {
    return false;
  }
  const captured = vault._pendingLegacyRecoveryFingerprint;
  if (!captured) {
    throw new Error("Legacy recovery source fingerprint is unavailable");
  }
  if (
    fs.existsSync(vault.versionedVaultPath) ||
    fs.existsSync(vault.versionedSaltPath)
  ) {
    throw new Error(
      "Cannot resolve legacy recovery while versioned Vault files exist"
    );
  }
  const legacyVault = fingerprintPath(vault.legacyVaultPath);
  const legacySalt = fingerprintPath(vault.legacySaltPath);
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
  const saltBytes = fs.readFileSync(vault.legacySaltPath);
  if (!/^[a-f0-9]{64}$/iu.test(saltBytes.toString("utf-8"))) {
    throw new Error("Legacy recovery salt is invalid");
  }
  if (legacyVault !== "missing" && legacyVault !== "unreadable") {
    vault._publishImmutableBackup(
      path.join(vault.dataDir, "vault-v1-pre-environments.enc"),
      fs.readFileSync(vault.legacyVaultPath)
    );
  }
  vault._publishImmutableBackup(
    path.join(vault.dataDir, "salt-v1-pre-environments.txt"),
    saltBytes
  );
  const temporaryPath = `${vault.versionedSaltPath}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
  fs.writeFileSync(temporaryPath, saltBytes, { flag: "wx", mode: 0o600 });
  try {
    fs.linkSync(temporaryPath, vault.versionedSaltPath);
  } finally {
    fs.unlinkSync(temporaryPath);
  }
  // Preserve field order in existing serialized, fingerprinted, or encrypted records.
  // eslint-disable-next-line sort-keys
  vault.data.legacySourceFingerprint = {
    vault: legacyVault,
    salt: legacySalt,
  };
  vault.currentRevision += 1;
  await vault._atomicWriteCurrent({ createOnly: true });
  vault._pendingLegacyRecoveryFingerprint = null;
  return true;
};
