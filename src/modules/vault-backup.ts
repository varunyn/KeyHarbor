import crypto from "node:crypto";
import fs from "node:fs";
import CryptoUtil = require("./crypto");
import ProjectConfigurationBaseline = require("./project-configuration-baseline");
import {
  cloneVaultData,
  isObjectRecord,
  isString,
  sha256Hex,
  validateEnvironmentSecrets,
} from "./vault-helpers";
import { VAULT_FORMAT_VERSION } from "./vault-normalization";
import type {
  EnvironmentRecord,
  ProjectBackupSnapshot,
  ProjectRecord,
  RestoreBackupResult,
  SecretRecord,
  VaultBoundaryRecord,
  VaultBoundaryValue,
  VaultData,
} from "./vault-types";

export interface VaultBackupHost {
  data: VaultData;
  key: Buffer | null;
  vaultInstanceId: string | null;
  _projectIncarnations: Map<string, string>;
  _ensureUnlocked: () => void;
  _scheduleAutoSave: () => void;
  getVaultId: () => string | null;
  createEncryptedProjectBackup: (projectName: string) => Buffer;
  _getNormalizedCopyOfData: (data: VaultData) => VaultData;
  _installData: (data: VaultData) => void;
  _setEnvironmentIncarnation: (
    projectName: string,
    environmentId: string
  ) => void;
}

export const publishImmutableBackup = (
  targetPath: string,
  bytes: Buffer
): boolean => {
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
};

export const captureProjectBackupSnapshot = (
  vault: VaultBackupHost,
  projectName: string
): ProjectBackupSnapshot => {
  vault._ensureUnlocked();
  const project = vault.data.projects[projectName];
  if (!project) {
    throw new Error(`Project '${projectName}' does not exist`);
  }
  const favorites =
    vault.data.favorites.secrets[projectName] || Object.create(null);
  const fingerprint = sha256Hex(
    // Preserve field order in existing serialized, fingerprinted, or encrypted records.
    // eslint-disable-next-line sort-keys
    Buffer.from(JSON.stringify({ project, favorites }))
  );
  const encryptedBackup = vault.createEncryptedProjectBackup(projectName);
  return Object.freeze({
    defaultEnvironmentId: project.defaultEnvironmentId,
    encryptedBackup,
    fingerprint,
    projectIncarnation: vault._projectIncarnations.get(projectName) || null,
    projectName,
    vaultId: vault.getVaultId(),
    vaultInstanceId: vault.vaultInstanceId,
  });
};

export const createEncryptedProjectBackup = (
  vault: VaultBackupHost,
  projectName: string
): Buffer => {
  vault._ensureUnlocked();
  const project = vault.data.projects[projectName];
  if (!project) {
    throw new Error(`Project '${projectName}' does not exist`);
  }
  const favorites =
    vault.data.favorites.secrets[projectName] || Object.create(null);
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
    vault.key
  );
};

export const restoreEncryptedProjectBackup = (
  vault: VaultBackupHost,
  encryptedBackup: Buffer,
  projectName?: string
): RestoreBackupResult => {
  vault._ensureUnlocked();
  if (!Buffer.isBuffer(encryptedBackup) || encryptedBackup.length === 0) {
    throw new TypeError("Encrypted Project backup is required");
  }
  const backup = CryptoUtil.decryptJson(encryptedBackup, vault.key);
  if (
    !backup ||
    backup.format !== "localkeys-backup" ||
    (backup.version !== 1 && backup.version !== 2) ||
    !isString(backup.project)
  ) {
    throw new Error("Unsupported Project backup format");
  }
  const name = projectName || backup.project;
  if (Object.hasOwn(vault.data.projects, name)) {
    throw new Error(`Project '${name}' already exists`);
  }
  let restoredProject: ProjectRecord;
  let favoriteSecrets: VaultBoundaryRecord = Object.create(null);
  if (backup.version === 1) {
    const restoreLegacyProject = (): ProjectRecord => {
      if (!backup.secrets || !isObjectRecord(backup.secrets)) {
        throw new Error("Invalid legacy Project backup");
      }
      validateEnvironmentSecrets(backup.secrets);
      const environmentId = crypto.randomBytes(16).toString("hex");
      const now = new Date().toISOString();
      // Preserve field order in existing serialized, fingerprinted, or encrypted records.
      // eslint-disable-next-line sort-keys
      const legacyEnv: EnvironmentRecord = {
        id: environmentId,
        name: "default",
        createdAt: now,
        updatedAt: now,
        // SAFETY: backup.secrets was validated by validateEnvironmentSecrets.
        secrets: backup.secrets as Record<string, SecretRecord | string>,
      };
      if (backup.configurationBaseline) {
        legacyEnv.configurationBaseline =
          ProjectConfigurationBaseline.validateStoredBaseline(
            backup.configurationBaseline
          );
      }
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
          [environmentId]: legacyEnv,
        },
      };
    };
    restoredProject = restoreLegacyProject();
  } else {
    if (
      !backup.projectRecord ||
      !isObjectRecord(backup.projectRecord) ||
      backup.projectRecord.name !== backup.project
    ) {
      throw new Error("Invalid Project backup");
    }
    // SAFETY: Cast backup object to VaultData for normalization and validation check.
    // Preserve field order in existing serialized, fingerprinted, or encrypted records.
    // eslint-disable-next-line sort-keys
    const backupData = {
      vaultFormatVersion: VAULT_FORMAT_VERSION,
      favorites: { projects: [], secrets: Object.create(null) },
      projects: { [name]: { ...backup.projectRecord, name } },
    } as VaultData;
    const validated = vault._getNormalizedCopyOfData(backupData);
    ({ [name]: restoredProject } = validated.projects);
  }
  if (backup.favoriteSecrets !== undefined) {
    const restoreFavoriteRecord = () => {
      if (!backup.favoriteSecrets || !isObjectRecord(backup.favoriteSecrets)) {
        throw new Error("Invalid Project favorite backup");
      }
      ({ favoriteSecrets } = backup);
    };
    restoreFavoriteRecord();
  }
  const nextData = cloneVaultData(vault.data);
  nextData.projects[name] = restoredProject;
  const restoreFavoriteKeys = (
    environmentId: string,
    keys: VaultBoundaryValue
  ) => {
    const environment = restoredProject.environments[environmentId];
    if (
      !environment ||
      !Array.isArray(keys) ||
      keys.some(
        (key) => !isString(key) || environment.secrets[key] === undefined
      )
    ) {
      throw new Error("Invalid Project favorite backup");
    }
    if (keys.length) {
      // SAFETY: keys was validated to be an array of valid secret strings above.
      (nextData.favorites.secrets[name] ||= Object.create(null))[
        environmentId
      ] = [...new Set(keys as string[])];
    }
  };
  for (const [environmentId, keys] of Object.entries(favoriteSecrets)) {
    restoreFavoriteKeys(environmentId, keys);
  }
  nextData.updatedAt = new Date().toISOString();
  const validatedData = vault._getNormalizedCopyOfData(nextData);
  vault._installData(validatedData);
  for (const id of Object.keys(restoredProject.environments)) {
    vault._setEnvironmentIncarnation(name, id);
  }
  vault._scheduleAutoSave();
  return {
    environmentCount: Object.keys(restoredProject.environments).length,
    projectName: name,
  };
};
