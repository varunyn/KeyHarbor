import {
  deleteRecordKey,
  isObjectRecord,
  isSecretHistoryEntry,
  isString,
  readStringOrNull,
} from "./vault-helpers";
import type {
  EnvironmentResolution,
  SecretHistoryEntry,
  SecretHistoryResult,
  SecretMetadata,
  SecretReadView,
  TargetSelector,
  VaultBoundaryValue,
  VaultData,
} from "./vault-types";

export interface VaultSecretsHost {
  data: VaultData;
  maxHistoryVersions: number;
  _ensureUnlocked: () => void;
  _scheduleAutoSave: () => void;
  _environmentForSelector: (selector: TargetSelector) => EnvironmentResolution;
  setSecret: (
    selector: TargetSelector,
    key: string,
    value: string,
    expiresAt?: string | null,
    meta?: { description?: string; tags?: string[] }
  ) => void;
}

export const normalizeSecretMeta = (
  meta: VaultBoundaryValue
): SecretMetadata => {
  const source = isObjectRecord(meta) ? meta : {};
  const description = isString(source.description)
    ? source.description.slice(0, 500)
    : "";
  const tags: string[] = [];
  if (Array.isArray(source.tags)) {
    for (const entry of source.tags) {
      if (!isString(entry)) {
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
};

export const secretMetaChanged = (
  a: SecretMetadata,
  b: SecretMetadata
): boolean => {
  if (a.description !== b.description) {
    return true;
  }
  if (a.tags.length !== b.tags.length) {
    return true;
  }
  return a.tags.some((t, i) => t !== b.tags[i]);
};

export const getSecrets = (
  vault: VaultSecretsHost,
  selector: TargetSelector
): Record<string, SecretReadView> => {
  vault._ensureUnlocked();
  const { environment } = vault._environmentForSelector(selector);
  const { secrets } = environment;
  const result: Record<string, SecretReadView> = Object.create(null);
  for (const [key, secret] of Object.entries(secrets)) {
    result[key] = isString(secret)
      ? {
          description: "",
          expiresAt: null,
          tags: [],
          value: secret,
        }
      : {
          createdAt: secret.createdAt ?? null,
          description: isString(secret.description) ? secret.description : "",
          expiresAt: secret.expiresAt ?? null,
          tags: Array.isArray(secret.tags) ? secret.tags.filter(isString) : [],
          updatedAt: secret.updatedAt ?? null,
          value: secret.value,
        };
  }
  return result;
};

export const getSecret = (
  vault: VaultSecretsHost,
  selector: TargetSelector,
  key: string
): SecretReadView => {
  vault._ensureUnlocked();
  const { environment, target } = vault._environmentForSelector(selector);
  const secret = environment.secrets[key];
  if (secret === undefined) {
    throw new Error(
      `Secret '${key}' does not exist in Environment '${environment.name}' of project '${target.projectName}'`
    );
  }
  if (isString(secret)) {
    return { description: "", expiresAt: null, tags: [], value: secret };
  }
  return {
    createdAt: secret.createdAt ?? null,
    description: isString(secret.description) ? secret.description : "",
    expiresAt: secret.expiresAt ?? null,
    tags: Array.isArray(secret.tags) ? secret.tags.filter(isString) : [],
    updatedAt: secret.updatedAt ?? null,
    value: secret.value,
  };
};

export const setSecret = (
  vault: VaultSecretsHost,
  selector: TargetSelector,
  key: string,
  value: string,
  expiresAt: string | null = null,
  meta: { description?: string; tags?: string[] } = {}
): void => {
  vault._ensureUnlocked();
  const { project, environment } = vault._environmentForSelector(selector);

  const now = new Date().toISOString();
  const existingSecret = environment.secrets[key];
  const nextMeta = normalizeSecretMeta(meta);

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
    const oldValue = isString(existingSecret)
      ? existingSecret
      : existingSecret.value;
    const oldExpiresAt = isObjectRecord(existingSecret)
      ? readStringOrNull(existingSecret.expiresAt)
      : null;
    const oldCreatedAt = isObjectRecord(existingSecret)
      ? readStringOrNull(existingSecret.createdAt)
      : null;
    const readOldHistory = (): SecretHistoryEntry[] =>
      isObjectRecord(existingSecret) && Array.isArray(existingSecret.history)
        ? existingSecret.history.filter(isSecretHistoryEntry)
        : [];
    const oldHistory = readOldHistory();
    const oldMeta = normalizeSecretMeta(
      isObjectRecord(existingSecret) ? existingSecret : {}
    );
    const mergedMeta = {
      description:
        nextMeta.description === ""
          ? oldMeta.description
          : nextMeta.description,
      tags:
        meta && isObjectRecord(meta) && "tags" in meta
          ? nextMeta.tags
          : oldMeta.tags,
    };

    if (
      oldValue !== value ||
      oldExpiresAt !== expiresAt ||
      secretMetaChanged(oldMeta, mergedMeta)
    ) {
      // Preserve field order in existing serialized, fingerprinted, or encrypted records.
      // eslint-disable-next-line sort-keys
      const historyEntry: SecretHistoryEntry = {
        value: oldValue,
        expiresAt: oldExpiresAt,
        description: oldMeta.description,
        tags: oldMeta.tags,
        changedAt: isString(existingSecret)
          ? now
          : existingSecret.updatedAt || now,
      };

      const newHistory: SecretHistoryEntry[] = [historyEntry, ...oldHistory];

      if (newHistory.length > vault.maxHistoryVersions) {
        newHistory.splice(vault.maxHistoryVersions);
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
  vault.data.updatedAt = now;
  vault._scheduleAutoSave();
};

export const setSecrets = (
  vault: VaultSecretsHost,
  selector: TargetSelector,
  secrets: Record<string, string>
): void => {
  vault._ensureUnlocked();
  const { environment } = vault._environmentForSelector(selector);
  for (const [key, value] of Object.entries(secrets)) {
    const existing = environment.secrets[key];

    const existingValue = isString(existing) ? existing : existing?.value;
    const existingExpiresAt = isObjectRecord(existing)
      ? (existing?.expiresAt ?? null)
      : null;
    if (existingValue !== value || existingExpiresAt !== null) {
      vault.setSecret(selector, key, value, null);
    }
  }
};

export const renameSecret = (
  vault: VaultSecretsHost,
  selector: TargetSelector,
  fromKey: string,
  toKey: string
): void => {
  vault._ensureUnlocked();
  const { project, environment, target } =
    vault._environmentForSelector(selector);

  if (!isString(fromKey) || !isString(toKey)) {
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
    vault.data.favorites?.secrets?.[target.projectName]?.[target.environmentId];
  if (Array.isArray(favoriteKeys)) {
    const nextKeys: string[] = [];
    const seen = new Set<string>();
    for (const k of favoriteKeys) {
      const next = k === fromKey ? toKey : k;
      if (!isString(next)) {
        continue;
      }
      if (seen.has(next)) {
        continue;
      }
      seen.add(next);
      nextKeys.push(next);
    }

    if (nextKeys.length > 0) {
      vault.data.favorites.secrets[target.projectName][target.environmentId] =
        nextKeys;
    } else {
      deleteRecordKey(
        vault.data.favorites.secrets[target.projectName],
        target.environmentId
      );
    }
  }

  const now = new Date().toISOString();
  project.updatedAt = now;
  vault.data.updatedAt = now;
  vault._scheduleAutoSave();
};

export const deleteSecret = (
  vault: VaultSecretsHost,
  selector: TargetSelector,
  key: string
): void => {
  vault._ensureUnlocked();
  const { project, environment, target } =
    vault._environmentForSelector(selector);
  if (environment.secrets[key] === undefined) {
    throw new Error(
      `Secret '${key}' does not exist in Environment '${environment.name}' of project '${target.projectName}'`
    );
  }

  deleteRecordKey(environment.secrets, key);

  const favoriteKeys =
    vault.data.favorites?.secrets?.[target.projectName]?.[target.environmentId];
  if (Array.isArray(favoriteKeys)) {
    const nextKeys = favoriteKeys.filter((k) => k !== key);
    if (nextKeys.length > 0) {
      vault.data.favorites.secrets[target.projectName][target.environmentId] =
        nextKeys;
    } else {
      deleteRecordKey(
        vault.data.favorites.secrets[target.projectName],
        target.environmentId
      );
    }
  }

  const now = new Date().toISOString();
  project.updatedAt = now;
  environment.updatedAt = now;
  vault.data.updatedAt = now;
  vault._scheduleAutoSave();
};

export const getSecretHistory = (
  vault: VaultSecretsHost,
  selector: TargetSelector,
  key: string
): SecretHistoryResult => {
  vault._ensureUnlocked();
  const { environment, target } = vault._environmentForSelector(selector);
  const secret = environment.secrets[key];
  if (secret === undefined) {
    throw new Error(
      `Secret '${key}' does not exist in Environment '${environment.name}' of project '${target.projectName}'`
    );
  }

  const currentVersion: SecretHistoryEntry & { isCurrent: boolean } = {
    changedAt: isObjectRecord(secret)
      ? readStringOrNull(secret.updatedAt)
      : null,
    description:
      isObjectRecord(secret) && isString(secret.description)
        ? secret.description
        : "",
    expiresAt: isObjectRecord(secret)
      ? readStringOrNull(secret.expiresAt)
      : null,
    isCurrent: true,
    tags:
      isObjectRecord(secret) && Array.isArray(secret.tags)
        ? secret.tags.filter(isString)
        : [],
    value: isString(secret) ? secret : secret.value,
  };

  const history: SecretHistoryEntry[] =
    isObjectRecord(secret) && Array.isArray(secret.history)
      ? secret.history.filter(isSecretHistoryEntry)
      : [];

  return {
    current: currentVersion,
    history: history.map((entry) => ({
      ...entry,
      isCurrent: false,
    })),
    totalVersions: history.length + 1,
  };
};

export const restoreSecretVersion = (
  vault: VaultSecretsHost,
  selector: TargetSelector,
  key: string,
  versionIndex: number
): void => {
  vault._ensureUnlocked();
  const { environment } = vault._environmentForSelector(selector);
  const secret = environment.secrets[key];
  if (secret === undefined) {
    throw new Error(
      `Secret '${key}' does not exist in the selected Environment`
    );
  }

  const history: SecretHistoryEntry[] =
    isObjectRecord(secret) && Array.isArray(secret.history)
      ? secret.history.filter(isSecretHistoryEntry)
      : [];

  if (versionIndex < 0 || versionIndex >= history.length) {
    throw new Error(`Invalid version index: ${versionIndex}`);
  }

  const versionToRestore = history[versionIndex];
  if (!isString(versionToRestore.value)) {
    // Preserve the established validation Error class exposed by the Vault API.
    // eslint-disable-next-line unicorn/prefer-type-error
    throw new Error("Invalid secret history version");
  }

  const restoredMeta = normalizeSecretMeta(versionToRestore);
  vault.setSecret(
    selector,
    key,
    versionToRestore.value,
    isString(versionToRestore.expiresAt) ? versionToRestore.expiresAt : null,
    restoredMeta
  );
};
