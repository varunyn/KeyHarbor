import crypto from "node:crypto";
import ProjectConfigurationBaseline = require("./project-configuration-baseline");
import { normalizeEnvironmentName } from "./vault-environments";
import {
  isObjectRecord,
  isSafeInteger,
  isString,
  readStringOrNull,
  unsupportedVaultFormat,
  validateEnvironmentSecrets,
} from "./vault-helpers";
import type {
  EnvironmentRecord,
  ProjectRecord,
  SecretRecord,
  StoredConfigurationBaseline,
  VaultBoundaryRecord,
  VaultBoundaryValue,
  VaultData,
  VaultDictionary,
} from "./vault-types";

export const VAULT_FORMAT_VERSION = 2;

export interface VaultNormalizationHost {
  data: VaultData;
  _needsFormatMigration: boolean;
}

export interface NormalizedVaultData {
  data: VaultData;
  needsFormatMigration: boolean;
}

const buildNormalizedVaultData = (
  rawData: VaultBoundaryRecord | VaultData,
  projects: Record<string, ProjectRecord>,
  favorites: VaultData["favorites"],
  legacy: boolean
): VaultData => {
  // SAFETY: This ordinary output record is populated only with normalized project and favorite
  // records, and optional metadata is copied only after its runtime type is checked.
  const normalizedData: Partial<VaultData> = {};
  for (const [key, value] of Object.entries(rawData)) {
    switch (key) {
      case "vaultFormatVersion": {
        normalizedData.vaultFormatVersion = VAULT_FORMAT_VERSION;
        break;
      }
      case "projects": {
        normalizedData.projects = projects;
        break;
      }
      case "favorites": {
        normalizedData.favorites = favorites;
        break;
      }
      case "version":
      case "vaultInstanceId":
      case "createdAt":
      case "updatedAt": {
        if (
          key === "version"
            ? !isString(value) && !isSafeInteger(value)
            : !isString(value)
        ) {
          throw new Error("Invalid Vault metadata");
        }
        normalizedData[key] = value;
        break;
      }
      case "legacySourceFingerprint": {
        if (
          !isObjectRecord(value) ||
          !isString(value.vault) ||
          !isString(value.salt) ||
          Object.keys(value).some(
            (field) => field !== "vault" && field !== "salt"
          )
        ) {
          throw new Error("Invalid Vault metadata");
        }
        // Preserve the established serialized field order.
        // eslint-disable-next-line sort-keys
        normalizedData.legacySourceFingerprint = {
          vault: value.vault,
          salt: value.salt,
        };
        break;
      }
      default: {
        break;
      }
    }
  }
  if (legacy) {
    normalizedData.vaultFormatVersion = VAULT_FORMAT_VERSION;
  }
  if (!Object.hasOwn(rawData, "favorites")) {
    normalizedData.favorites = favorites;
  }
  // SAFETY: Required VaultData fields are present and all copied optional fields were validated.
  return normalizedData as VaultData;
};

export const normalizeVaultDataValue = (
  input: VaultBoundaryRecord | VaultData
): NormalizedVaultData => {
  if (!isObjectRecord(input)) {
    throw new Error("Invalid vault data");
  }
  const rawData = input;
  if (
    !Object.hasOwn(rawData, "projects") ||
    !rawData.projects ||
    !isObjectRecord(rawData.projects)
  ) {
    throw new Error("Invalid vault projects");
  }
  const formatVersion = rawData.vaultFormatVersion;
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
  if (Object.keys(rawData).some((key) => !allowedRootFields.has(key))) {
    throw legacy
      ? unsupportedVaultFormat("Unsupported legacy Vault fields")
      : new Error("Invalid Vault v2 fields");
  }
  const legacyFavoritesRecord = rawData.favorites;
  if (
    legacy &&
    legacyFavoritesRecord &&
    Object.keys(legacyFavoritesRecord).some(
      (key) => key !== "projects" && key !== "secrets"
    )
  ) {
    throw unsupportedVaultFormat("Unsupported legacy Vault favorite fields");
  }
  const normalizedProjects: Record<string, ProjectRecord> = Object.create(null);
  const rawFavorites = isObjectRecord(rawData.favorites)
    ? rawData.favorites
    : Object.create(null);
  const legacyFavorites = isObjectRecord(rawFavorites.secrets)
    ? rawFavorites.secrets
    : Object.create(null);
  const normalizeProject = (name: string, project: VaultBoundaryValue) => {
    if (!project || !isObjectRecord(project)) {
      throw new Error("Invalid vault project");
    }
    // SAFETY: project was verified as an object record before its entries are copied.
    const normalizedProject: VaultDictionary = Object.create(null);
    for (const [key, value] of Object.entries(project)) {
      normalizedProject[key] = value;
    }
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
          !isObjectRecord(project.secrets) ||
          project.environments
        ) {
          throw new Error("Ambiguous legacy Vault project format");
        }
        const environmentId = crypto.randomBytes(16).toString("hex");
        normalizedProject.defaultEnvironmentId = environmentId;
        // Preserve field order in existing serialized, fingerprinted, or encrypted records.
        // eslint-disable-next-line sort-keys
        const legacyEnvRecord: EnvironmentRecord = {
          id: environmentId,
          name: "default",
          createdAt:
            readStringOrNull(project.createdAt) || new Date().toISOString(),
          updatedAt:
            readStringOrNull(project.updatedAt) || new Date().toISOString(),
          // SAFETY: Legacy project secrets was validated as an object record above.
          secrets: project.secrets as Record<string, SecretRecord | string>,
        };
        if (project.configurationBaseline) {
          // SAFETY: Validated legacy configuration baseline matches StoredConfigurationBaseline shape.
          legacyEnvRecord.configurationBaseline =
            project.configurationBaseline as StoredConfigurationBaseline;
        }
        const legacyEnvironments: Record<string, EnvironmentRecord> =
          Object.create(null);
        legacyEnvironments[environmentId] = legacyEnvRecord;
        normalizedProject.environments = legacyEnvironments;
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
      if (Object.keys(project).some((key) => !allowedProjectFields.has(key))) {
        throw new Error("Mixed or invalid Vault project fields");
      }
      if (
        Object.hasOwn(project, "secrets") ||
        Object.hasOwn(project, "configurationBaseline") ||
        !project.environments ||
        !isObjectRecord(project.environments)
      ) {
        throw new Error("Mixed or invalid Vault format");
      }
    }
    const environments: Record<string, EnvironmentRecord> = Object.create(null);
    const projectEnvironments = isObjectRecord(normalizedProject.environments)
      ? normalizedProject.environments
      : Object.create(null);
    const normalizeEnvironment = (
      id: string,
      environment: VaultBoundaryValue
    ) => {
      if (
        !environment ||
        !isObjectRecord(environment) ||
        environment.id !== id ||
        !isString(environment.name) ||
        !isString(environment.createdAt) ||
        !isString(environment.updatedAt) ||
        !environment.secrets ||
        !isObjectRecord(environment.secrets)
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
      if (normalizeEnvironmentName(environment.name) !== environment.name) {
        throw new Error("Invalid Vault environment name");
      }
      validateEnvironmentSecrets(environment.secrets);
      const secrets: Record<string, SecretRecord | string> =
        Object.create(null);
      // SAFETY: Environment secret values were validated by validateEnvironmentSecrets.
      for (const [key, secret] of Object.entries(environment.secrets) as [
        string,
        SecretRecord | string,
      ][]) {
        secrets[key] = secret;
      }
      // Preserve field order in existing serialized, fingerprinted, or encrypted records.
      // eslint-disable-next-line sort-keys
      const normalizedEnvironment: EnvironmentRecord = {
        id,
        name: environment.name,
        createdAt: environment.createdAt,
        updatedAt: environment.updatedAt,
        secrets,
      };
      if (Object.hasOwn(environment, "configurationBaseline")) {
        normalizedEnvironment.configurationBaseline =
          ProjectConfigurationBaseline.validateStoredBaseline(
            environment.configurationBaseline
          );
      }
      environments[id] = normalizedEnvironment;
    };
    for (const id of Object.keys(projectEnvironments)) {
      normalizeEnvironment(id, projectEnvironments[id]);
    }
    const defaultEnvId = isString(normalizedProject.defaultEnvironmentId)
      ? normalizedProject.defaultEnvironmentId
      : "";
    if (
      Object.keys(environments).length === 0 ||
      !Object.hasOwn(environments, defaultEnvId)
    ) {
      throw new Error("Vault project has no valid default Environment");
    }
    normalizedProject.environments = environments;
    // SAFETY: All entries in environments were normalized to EnvironmentRecord instances.
    const environmentNames = (
      Object.values(environments) as EnvironmentRecord[]
    ).map((environment) => environment.name);
    if (new Set(environmentNames).size !== environmentNames.length) {
      throw new Error("Duplicate Vault environment name");
    }
    // Preserve field order in existing serialized, fingerprinted, or encrypted records.
    // eslint-disable-next-line sort-keys
    normalizedProjects[name] = {
      name: isString(normalizedProject.name) ? normalizedProject.name : name,
      createdAt: isString(normalizedProject.createdAt)
        ? normalizedProject.createdAt
        : new Date().toISOString(),
      updatedAt: isString(normalizedProject.updatedAt)
        ? normalizedProject.updatedAt
        : new Date().toISOString(),
      defaultEnvironmentId: defaultEnvId,
      environments,
    };
  };
  for (const [name, project] of Object.entries(rawData.projects)) {
    normalizeProject(name, project);
  }

  const normalizeFavorites = (): VaultData["favorites"] => {
    const normalizedFavorites: VaultData["favorites"] = {
      projects: [],
      secrets: Object.create(null),
    };
    const favorites = rawFavorites;
    if (
      !legacy &&
      Object.keys(favorites).some(
        (key) => key !== "projects" && key !== "secrets"
      )
    ) {
      throw new Error("Invalid Vault favorites fields");
    }
    if (Array.isArray(favorites.projects)) {
      const projectFavorites = favorites.projects.filter(
        (name: unknown): name is string =>
          typeof name === "string" && Boolean(normalizedProjects[name])
      );
      normalizedFavorites.projects = [...new Set<string>(projectFavorites)];
    }
    const normalizeProjectFavorites = (
      projectName: string,
      project: ProjectRecord
    ) => {
      const incoming = legacy
        ? legacyFavorites[projectName]
        : favorites.secrets?.[projectName];
      const perEnvironment: VaultDictionary = Object.create(null);
      if (legacy) {
        const id = project.defaultEnvironmentId;
        if (Array.isArray(incoming)) {
          perEnvironment[id] = incoming;
        }
      } else if (incoming && isObjectRecord(incoming)) {
        if (
          !legacy &&
          Object.keys(incoming).some((id) => !project.environments[id])
        ) {
          throw new Error("Invalid Vault favorite Environment");
        }
        for (const id of Object.keys(incoming)) {
          perEnvironment[id] = incoming[id];
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
                isString(key) && env.secrets[key] !== undefined
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
    // SAFETY: normalizedProjects was populated with valid ProjectRecord instances above.
    for (const [projectName, project] of Object.entries(normalizedProjects) as [
      string,
      ProjectRecord,
    ][]) {
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
    return normalizedFavorites;
  };
  const normalizedFavorites = normalizeFavorites();

  const data = buildNormalizedVaultData(
    rawData,
    normalizedProjects,
    normalizedFavorites,
    legacy
  );
  return { data, needsFormatMigration: legacy };
};

export const normalizeVaultData = (vault: VaultNormalizationHost): void => {
  const normalized = normalizeVaultDataValue(vault.data);
  vault.data = normalized.data;
  if (normalized.needsFormatMigration) {
    vault._needsFormatMigration = true;
  }
};
