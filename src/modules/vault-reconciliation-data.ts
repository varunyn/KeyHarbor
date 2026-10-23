import type Vault = require("./vault");
import type { VaultFavorites } from "./vault-types";
import ProjectConfigurationBaseline = require("./project-configuration-baseline");

export const sortedValues = <T>(
  values: readonly T[],
  compare?: (left: T, right: T) => number
): T[] => {
  const sorted = [...values];
  sorted.sort(compare);
  return sorted;
};

// eslint-disable-next-line unicorn/prefer-structured-clone -- JSON normalization intentionally removes unsupported values before equality, persistence, or IPC.
export const clone = (value) => JSON.parse(JSON.stringify(value));

export const equal = (left, right) =>
  JSON.stringify(left) === JSON.stringify(right);

const invalidVaultData = (message) => {
  const error = new Error(message);
  error.code = "INVALID_VAULT_DATA";
  return error;
};

const normalizeTags = (tags) =>
  Array.isArray(tags) ? tags.filter((tag) => typeof tag === "string") : [];

export const normalizeHistoryEntry = (entry) => {
  const source = entry && typeof entry === "object" ? entry : {};
  // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
  return {
    value: source.value,
    expiresAt: source.expiresAt ?? null,
    description:
      typeof source.description === "string" ? source.description : "",
    tags: normalizeTags(source.tags),
    changedAt: typeof source.changedAt === "string" ? source.changedAt : null,
  };
};

export const normalizeSecret = (secret) => {
  if (typeof secret === "string") {
    // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
    return {
      value: secret,
      expiresAt: null,
      description: "",
      tags: [],
      history: [],
    };
  }
  if (
    !secret ||
    typeof secret !== "object" ||
    Array.isArray(secret) ||
    typeof secret.value !== "string"
  ) {
    throw invalidVaultData("Invalid vault secret");
  }
  // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
  return {
    value: secret.value,
    expiresAt: secret.expiresAt ?? null,
    description:
      typeof secret.description === "string" ? secret.description : "",
    tags: normalizeTags(secret.tags),
    history: Array.isArray(secret.history)
      ? secret.history.map(normalizeHistoryEntry)
      : [],
  };
};

export const secretCore = (secret) => {
  const normalized = normalizeSecret(secret);
  // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
  return {
    value: normalized.value,
    expiresAt: normalized.expiresAt,
    description: normalized.description,
    tags: normalized.tags,
  };
};

export const normalizeFavorites = (favorites): VaultFavorites => {
  const source =
    favorites && typeof favorites === "object" && !Array.isArray(favorites)
      ? favorites
      : {};
  const projects: string[] = [];
  if (Array.isArray(source.projects)) {
    for (const name of source.projects) {
      if (typeof name === "string" && !projects.includes(name)) {
        projects.push(name);
      }
    }
    projects.sort();
  }
  const secrets = Object.create(null);
  for (const projectName of sortedValues(Object.keys(source.secrets || {}))) {
    const environments = source.secrets[projectName];
    if (
      !environments ||
      typeof environments !== "object" ||
      Array.isArray(environments)
    ) {
      continue;
    }
    secrets[projectName] = Object.create(null);
    for (const environmentId of sortedValues(Object.keys(environments))) {
      const keys = environments[environmentId];
      if (Array.isArray(keys)) {
        secrets[projectName][environmentId] = sortedValues([
          ...new Set(keys.filter((key) => typeof key === "string")),
        ]);
      }
    }
  }
  return { projects, secrets };
};

const validateAndCloneEnvironment = (id: string, environment) => {
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
    throw invalidVaultData("Invalid vault environment");
  }
  if (!/^[a-z][a-z0-9_-]{0,63}$/u.test(environment.name)) {
    throw invalidVaultData("Invalid vault environment name");
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
    Object.keys(environment).some((key) => !allowedEnvironmentFields.has(key))
  ) {
    throw invalidVaultData("Invalid vault environment fields");
  }
  const nextEnvironment = {
    ...clone(environment),
    secrets: Object.create(null),
  };
  if (Object.hasOwn(environment, "configurationBaseline")) {
    nextEnvironment.configurationBaseline =
      ProjectConfigurationBaseline.validateStoredBaseline(
        environment.configurationBaseline
      );
  }
  for (const key of sortedValues(Object.keys(environment.secrets))) {
    normalizeSecret(environment.secrets[key]);
    nextEnvironment.secrets[key] = clone(environment.secrets[key]);
  }
  return nextEnvironment;
};

const validateAndCloneProject = (project) => {
  if (!project || typeof project !== "object" || Array.isArray(project)) {
    throw invalidVaultData("Invalid vault project");
  }
  const allowedProjectFields = new Set([
    "name",
    "createdAt",
    "updatedAt",
    "defaultEnvironmentId",
    "environments",
  ]);
  if (Object.keys(project).some((key) => !allowedProjectFields.has(key))) {
    throw invalidVaultData("Invalid vault project fields");
  }
  if (
    !project.environments ||
    typeof project.environments !== "object" ||
    Array.isArray(project.environments) ||
    typeof project.defaultEnvironmentId !== "string" ||
    !Object.hasOwn(project.environments, project.defaultEnvironmentId)
  ) {
    throw invalidVaultData("Invalid vault project environments");
  }
  const environments: Record<string, Vault.Environment> = Object.create(null);
  for (const id of sortedValues(Object.keys(project.environments))) {
    environments[id] = validateAndCloneEnvironment(
      id,
      project.environments[id]
    );
  }
  if (
    new Set(Object.values(environments).map((environment) => environment.name))
      .size !== Object.keys(environments).length
  ) {
    throw invalidVaultData("Duplicate vault environment name");
  }
  const nextProject = { ...clone(project), environments };
  return nextProject;
};

export const validateAndCloneVaultData = (data) => {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw invalidVaultData("Invalid vault data");
  }
  if (data.vaultFormatVersion !== 2) {
    throw invalidVaultData("Unsupported or mixed vault format");
  }
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
  if (Object.keys(data).some((key) => !allowedRootFields.has(key))) {
    throw invalidVaultData("Invalid vault fields");
  }
  if (
    !data.projects ||
    typeof data.projects !== "object" ||
    Array.isArray(data.projects)
  ) {
    throw invalidVaultData("Invalid vault projects");
  }
  if (
    data.favorites !== undefined &&
    (!data.favorites ||
      typeof data.favorites !== "object" ||
      Array.isArray(data.favorites))
  ) {
    throw invalidVaultData("Invalid vault favorites");
  }

  const output = clone(data);
  output.projects = Object.create(null);
  for (const projectName of sortedValues(Object.keys(data.projects))) {
    output.projects[projectName] = validateAndCloneProject(
      data.projects[projectName]
    );
  }
  output.favorites = normalizeFavorites(data.favorites);
  return output;
};

export const createBaseline = (data) => {
  // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
  const baseline = {
    projects: Object.create(null),
    favorites: normalizeFavorites(data?.favorites),
  };
  for (const projectName of sortedValues(Object.keys(data?.projects || {}))) {
    const project = data.projects[projectName];
    baseline.projects[projectName] = {
      defaultEnvironmentId: project?.defaultEnvironmentId ?? null,
      environments: Object.fromEntries(
        sortedValues(Object.keys(project?.environments || {})).map((id) => {
          const environment = project.environments[id];
          const secrets = Object.create(null);
          for (const key of sortedValues(
            Object.keys(environment?.secrets || {})
          )) {
            secrets[key] = normalizeSecret(environment.secrets[key]);
          }
          return [
            id,
            // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
            {
              id,
              name: environment?.name,
              secrets,
              configurationBaseline:
                environment?.configurationBaseline?.requiredKeys ?? null,
            },
          ];
        })
      ),
    };
  }
  return baseline;
};

export const baselineKeys = (baseline) => {
  if (Array.isArray(baseline)) {
    return baseline;
  }
  return baseline?.requiredKeys ?? null;
};

export const projectState = (project) => {
  if (!project) {
    return null;
  }
  const environments = Object.create(null);
  for (const id of sortedValues(Object.keys(project.environments || {}))) {
    const environment = project.environments[id];
    const secrets = Object.create(null);
    for (const key of sortedValues(Object.keys(environment.secrets || {}))) {
      secrets[key] = normalizeSecret(environment.secrets[key]);
    }
    // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
    environments[id] = {
      id,
      name: environment.name,
      secrets,
      configurationBaseline: baselineKeys(environment.configurationBaseline),
    };
  }
  return { defaultEnvironmentId: project.defaultEnvironmentId, environments };
};
