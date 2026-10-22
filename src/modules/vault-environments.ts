import crypto from "node:crypto";

import { deleteRecordKey, isObjectRecord, isString } from "./vault-helpers";
import type {
  DeleteEnvironmentResult,
  EnvironmentResolution,
  EnvironmentSummary,
  EnvironmentTarget,
  EnvironmentTargetIdentity,
  ExternalTargetSelector,
  TargetSelector,
  VaultBoundaryValue,
  VaultData,
} from "./vault-types";

export interface VaultEnvironmentHost {
  data: VaultData;
  _ensureUnlocked: () => void;
  _scheduleAutoSave: () => void;
  _projectIncarnations: Map<string, string>;
  _environmentIncarnations: Map<string, string>;
}

export const environmentIncarnationKey = (
  projectName: string,
  environmentId: string
): string => JSON.stringify([projectName, environmentId]);

export const getEnvironmentIncarnation = (
  vault: VaultEnvironmentHost,
  projectName: string,
  environmentId: string
): string | null =>
  vault._environmentIncarnations.get(
    environmentIncarnationKey(projectName, environmentId)
  ) || null;

export const setEnvironmentIncarnation = (
  vault: VaultEnvironmentHost,
  projectName: string,
  environmentId: string
): void => {
  vault._environmentIncarnations.set(
    environmentIncarnationKey(projectName, environmentId),
    crypto.randomBytes(16).toString("hex")
  );
};

export const deleteEnvironmentIncarnation = (
  vault: VaultEnvironmentHost,
  projectName: string,
  environmentId: string
): void => {
  vault._environmentIncarnations.delete(
    environmentIncarnationKey(projectName, environmentId)
  );
};

export const normalizeEnvironmentName = (name: VaultBoundaryValue): string => {
  if (!isString(name)) {
    throw new TypeError("Environment name must be a string");
  }
  const normalized = name.trim();
  if (!/^[a-z][a-z0-9_-]{0,63}$/u.test(normalized)) {
    throw new Error(
      "Environment name must start with a letter and contain only lowercase letters, digits, hyphens, or underscores"
    );
  }
  return normalized;
};

export const environmentForSelector = (
  vault: VaultEnvironmentHost,
  selector: TargetSelector
): EnvironmentResolution => {
  vault._ensureUnlocked();
  const target = selector;
  if (!target || !isObjectRecord(target) || !isString(target.projectName)) {
    throw new TypeError("Environment target requires projectName");
  }
  const project = vault.data.projects[target.projectName];
  if (!project) {
    throw new Error(`Project '${target.projectName}' does not exist`);
  }
  if (!isString(target.environmentId) || target.environmentId.length === 0) {
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
};

export const resolveEnvironmentTarget = (
  vault: VaultEnvironmentHost,
  selector: ExternalTargetSelector
): EnvironmentTarget => {
  vault._ensureUnlocked();
  if (
    !selector ||
    !isObjectRecord(selector) ||
    !isString(selector.projectName)
  ) {
    throw new TypeError("Environment target requires projectName");
  }
  const project = vault.data.projects[selector.projectName];
  if (!project) {
    throw new Error(`Project '${selector.projectName}' does not exist`);
  }
  const hasId = Object.hasOwn(selector, "environmentId");
  const hasName = Object.hasOwn(selector, "environmentName");
  const validateEnvironmentId = () => {
    if (
      hasId &&
      (!isString(selector.environmentId) || selector.environmentId.length === 0)
    ) {
      throw new TypeError("Environment ID must be a non-empty string");
    }
  };
  validateEnvironmentId();
  if (
    hasName &&
    (!isString(selector.environmentName) ||
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
  // SAFETY: When hasId is true, selector.environmentId was validated as a non-empty string above.
  const environmentId = hasId
    ? (selector.environmentId as string)
    : (named?.id ?? project.defaultEnvironmentId);
  const target = {
    environmentId,
    projectName: selector.projectName,
  };
  environmentForSelector(vault, target);
  return Object.freeze(target);
};

export const getEnvironmentTargetIdentity = (
  vault: VaultEnvironmentHost,
  selector: TargetSelector
): EnvironmentTargetIdentity => {
  const { environment, target } = environmentForSelector(vault, selector);
  return Object.freeze({
    ...target,
    environmentIncarnation: getEnvironmentIncarnation(
      vault,
      target.projectName,
      target.environmentId
    ),
    environmentName: environment.name,
    projectIncarnation:
      vault._projectIncarnations.get(target.projectName) || null,
  });
};

export const getEnvironments = (
  vault: VaultEnvironmentHost,
  projectName: string
): EnvironmentSummary[] => {
  vault._ensureUnlocked();
  const project = vault.data.projects[projectName];
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
};

export const createEnvironment = (
  vault: VaultEnvironmentHost,
  projectName: string,
  name: string
): EnvironmentSummary => {
  vault._ensureUnlocked();
  const project = vault.data.projects[projectName];
  if (!project) {
    throw new Error(`Project '${projectName}' does not exist`);
  }
  const normalizedName = normalizeEnvironmentName(name);
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
  setEnvironmentIncarnation(vault, projectName, id);
  project.updatedAt = now;
  vault.data.updatedAt = now;
  vault._scheduleAutoSave();
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
};

export const renameEnvironment = (
  vault: VaultEnvironmentHost,
  projectName: string,
  environmentId: string,
  name: string
): EnvironmentTargetIdentity => {
  vault._ensureUnlocked();
  const project = vault.data.projects[projectName];
  const environment = project?.environments?.[environmentId];
  if (!environment) {
    throw new Error("Environment target no longer exists");
  }
  const normalizedName = normalizeEnvironmentName(name);
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
  vault.data.updatedAt = now;
  setEnvironmentIncarnation(vault, projectName, environmentId);
  vault._scheduleAutoSave();
  return getEnvironmentTargetIdentity(vault, {
    environmentId,
    projectName,
  });
};

export const setDefaultEnvironment = (
  vault: VaultEnvironmentHost,
  projectName: string,
  environmentId: string
): boolean => {
  vault._ensureUnlocked();
  const project = vault.data.projects[projectName];
  if (!project?.environments?.[environmentId]) {
    throw new Error("Environment target no longer exists");
  }
  if (project.defaultEnvironmentId === environmentId) {
    return false;
  }
  project.defaultEnvironmentId = environmentId;
  const updatedAt = new Date().toISOString();
  vault.data.updatedAt = updatedAt;
  project.updatedAt = updatedAt;
  vault._scheduleAutoSave();
  return true;
};

export const deleteEnvironment = (
  vault: VaultEnvironmentHost,
  projectName: string,
  environmentId: string,
  options: { replacementDefaultEnvironmentId?: string } = {}
): DeleteEnvironmentResult => {
  vault._ensureUnlocked();
  const project = vault.data.projects[projectName];
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
  deleteEnvironmentIncarnation(vault, projectName, environmentId);
  const favorites = vault.data.favorites.secrets?.[projectName];
  if (favorites) {
    deleteRecordKey(favorites, environmentId);
  }
  const updatedAt = new Date().toISOString();
  vault.data.updatedAt = updatedAt;
  project.updatedAt = updatedAt;
  vault._scheduleAutoSave();
  return {
    affectedSecretCount,
    defaultEnvironmentId: project.defaultEnvironmentId,
    deletedEnvironmentId: environmentId,
  };
};

export const resetProjectIncarnations = (vault: VaultEnvironmentHost): void => {
  vault._projectIncarnations = new Map(
    Object.keys(vault.data?.projects || {}).map((name) => [
      name,
      crypto.randomBytes(16).toString("hex"),
    ])
  );
  vault._environmentIncarnations = new Map();
  for (const [projectName, project] of Object.entries(
    vault.data?.projects || {}
  )) {
    for (const id of Object.keys(project.environments || {})) {
      setEnvironmentIncarnation(vault, projectName, id);
    }
  }
};

export const reconcileProjectIncarnations = (
  vault: VaultEnvironmentHost,
  nextData: VaultData
): void => {
  const nextProjects = nextData?.projects || Object.create(null);
  for (const [name] of vault._projectIncarnations) {
    const previous = vault.data?.projects?.[name];
    const next = nextProjects[name];
    if (
      !next ||
      (previous?.createdAt &&
        next.createdAt &&
        previous.createdAt !== next.createdAt)
    ) {
      vault._projectIncarnations.delete(name);
    }
  }
  for (const name of Object.keys(nextProjects)) {
    if (!vault._projectIncarnations.has(name)) {
      vault._projectIncarnations.set(
        name,
        crypto.randomBytes(16).toString("hex")
      );
    }
  }
};

export const reconcileEnvironmentIncarnations = (
  vault: VaultEnvironmentHost,
  nextData: VaultData
): void => {
  const reconcileExistingEnvironment = (key: string) => {
    // SAFETY: Incarnation map keys are serialized [projectName, environmentId] JSON tuples.
    const [projectName, environmentId] = JSON.parse(key) as [string, string];
    const previous =
      vault.data?.projects?.[projectName]?.environments?.[environmentId];
    const next =
      nextData?.projects?.[projectName]?.environments?.[environmentId];
    if (
      !next ||
      (previous?.createdAt &&
        next.createdAt &&
        previous.createdAt !== next.createdAt) ||
      previous?.name !== next.name
    ) {
      vault._environmentIncarnations.delete(key);
    }
  };
  for (const [key] of vault._environmentIncarnations) {
    reconcileExistingEnvironment(key);
  }
  for (const [projectName, project] of Object.entries(
    nextData?.projects || {}
  )) {
    for (const id of Object.keys(project.environments || {})) {
      const key = environmentIncarnationKey(projectName, id);
      if (!vault._environmentIncarnations.has(key)) {
        vault._environmentIncarnations.set(
          key,
          crypto.randomBytes(16).toString("hex")
        );
      }
    }
  }
};
