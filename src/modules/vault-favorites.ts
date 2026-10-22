import {
  deleteRecordKey,
  isObjectRecord,
  isString,
  readStringOrNull,
} from "./vault-helpers";
import type {
  EnvironmentResolution,
  EnvironmentTarget,
  TargetSelector,
  VaultData,
  VaultFavorites,
  VaultStatisticsResult,
} from "./vault-types";

export interface VaultFavoritesHost {
  data: VaultData;
  _ensureUnlocked: () => void;
  _scheduleAutoSave: () => void;
  _environmentForSelector: (selector: TargetSelector) => EnvironmentResolution;
}

export const toggleProjectFavorite = (
  vault: VaultFavoritesHost,
  projectName: string
): boolean => {
  vault._ensureUnlocked();

  if (!vault.data.projects[projectName]) {
    throw new Error(`Project '${projectName}' does not exist`);
  }

  const current = Array.isArray(vault.data.favorites.projects)
    ? vault.data.favorites.projects
    : [];
  const isFavorite = current.includes(projectName);
  if (isFavorite) {
    vault.data.favorites.projects = current.filter((p) => p !== projectName);
  } else {
    const next = current.filter((p) => p !== projectName);
    next.push(projectName);
    vault.data.favorites.projects = next;
  }

  vault.data.updatedAt = new Date().toISOString();
  vault._scheduleAutoSave();

  return !isFavorite;
};

export const toggleSecretFavorite = (
  vault: VaultFavoritesHost,
  selector: TargetSelector,
  secretKey: string
): boolean => {
  vault._ensureUnlocked();
  const { environment, target } = vault._environmentForSelector(selector);
  if (environment.secrets[secretKey] === undefined) {
    throw new Error(
      `Secret '${secretKey}' does not exist in the selected Environment`
    );
  }
  vault.data.favorites.secrets[target.projectName] ||= Object.create(null);
  const projectFavorites = vault.data.favorites.secrets[target.projectName];
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
        deleteRecordKey(vault.data.favorites.secrets, target.projectName);
      }
    }
  } else {
    next.push(secretKey);
    projectFavorites[target.environmentId] = next;
  }

  vault.data.updatedAt = new Date().toISOString();
  vault._scheduleAutoSave();

  return !isFavorite;
};

export const getFavorites = (vault: VaultFavoritesHost): VaultFavorites => {
  vault._ensureUnlocked();

  const secrets: Record<string, Record<string, string[]>> = Object.create(null);
  const favoriteSecrets = vault.data.favorites?.secrets;
  if (favoriteSecrets && isObjectRecord(favoriteSecrets)) {
    for (const [projectName, environments] of Object.entries(favoriteSecrets)) {
      secrets[projectName] = Object.create(null);
      for (const [environmentId, secretKeys] of Object.entries(
        environments || {}
      )) {
        if (!Array.isArray(secretKeys)) {
          continue;
        }
        secrets[projectName][environmentId] = secretKeys.filter(isString);
      }
    }
  }

  return {
    projects: Array.isArray(vault.data.favorites?.projects)
      ? [...vault.data.favorites.projects]
      : [],
    secrets,
  } satisfies VaultFavorites;
};

export const getStatistics = (
  vault: VaultFavoritesHost,
  selector: EnvironmentTarget | null = null
): VaultStatisticsResult => {
  vault._ensureUnlocked();

  const totalProjects = Object.keys(vault.data.projects).length;
  let totalSecrets = 0;
  let expiringSecrets = 0;
  let hasExpired = false;

  const now = new Date();
  const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const environments =
    selector === null
      ? Object.values(vault.data.projects).flatMap((project) =>
          Object.values(project.environments)
        )
      : [vault._environmentForSelector(selector).environment];
  for (const environment of environments) {
    const secrets = environment.secrets || {};
    totalSecrets += Object.keys(secrets).length;

    for (const secret of Object.values(secrets)) {
      const expiresAt = isObjectRecord(secret)
        ? readStringOrNull(secret.expiresAt)
        : null;
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
};
