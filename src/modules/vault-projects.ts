import crypto from "node:crypto";

import { deleteRecordKey, isObjectRecord } from "./vault-helpers";
import type { ProjectSummary, VaultData } from "./vault-types";

export interface VaultProjectsHost {
  data: VaultData;
  _projectIncarnations: Map<string, string>;
  _environmentIncarnations: Map<string, string>;
  _ensureUnlocked: () => void;
  _scheduleAutoSave: () => void;
  _setEnvironmentIncarnation: (
    projectName: string,
    environmentId: string
  ) => void;
}

export const getProjects = (vault: VaultProjectsHost): ProjectSummary[] => {
  vault._ensureUnlocked();
  return Object.keys(vault.data.projects).map((name) => ({
    createdAt: vault.data.projects[name].createdAt,
    defaultEnvironmentId: vault.data.projects[name].defaultEnvironmentId,
    environmentCount: Object.keys(vault.data.projects[name].environments)
      .length,
    name,
    secretCount: Object.values(vault.data.projects[name].environments).reduce(
      (count, environment) =>
        count + Object.keys(environment.secrets || {}).length,
      0
    ),
    updatedAt: vault.data.projects[name].updatedAt,
  }));
};

export const createProject = (vault: VaultProjectsHost, name: string): void => {
  vault._ensureUnlocked();

  if (vault.data.projects[name]) {
    throw new Error(`Project '${name}' already exists`);
  }

  const now = new Date().toISOString();
  const environmentId = crypto.randomBytes(16).toString("hex");
  // Preserve field order in existing serialized, fingerprinted, or encrypted records.
  // eslint-disable-next-line sort-keys
  vault.data.projects[name] = {
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
  vault._projectIncarnations.set(name, crypto.randomBytes(16).toString("hex"));
  vault._setEnvironmentIncarnation(name, environmentId);

  vault.data.updatedAt = new Date().toISOString();
  vault._scheduleAutoSave();
};

export const deleteProject = (vault: VaultProjectsHost, name: string): void => {
  vault._ensureUnlocked();

  if (!vault.data.projects[name]) {
    throw new Error(`Project '${name}' does not exist`);
  }

  deleteRecordKey(vault.data.projects, name);
  vault._projectIncarnations.delete(name);
  for (const key of vault._environmentIncarnations.keys()) {
    // SAFETY: Incarnation map keys are serialized [projectName, environmentId] JSON tuples.
    if ((JSON.parse(key) as [string, string])[0] === name) {
      vault._environmentIncarnations.delete(key);
    }
  }

  if (vault.data.favorites) {
    if (Array.isArray(vault.data.favorites.projects)) {
      vault.data.favorites.projects = vault.data.favorites.projects.filter(
        (p) => p !== name
      );
    }
    if (
      vault.data.favorites.secrets &&
      isObjectRecord(vault.data.favorites.secrets)
    ) {
      deleteRecordKey(vault.data.favorites.secrets, name);
    }
  }

  vault.data.updatedAt = new Date().toISOString();
  vault._scheduleAutoSave();
};
