import ProjectConfigurationBaseline = require("./project-configuration-baseline");
import {
  cloneVaultData,
  copyJsonData,
  isFunction,
  isString,
} from "./vault-helpers";
import type {
  BaselineMutationResult,
  EnvironmentResolution,
  EnvironmentTargetIdentity,
  ImportProjectSnapshot,
  ProjectConfigurationBaselineResult,
  SecretImportChange,
  SecretRecord,
  TargetExpectation,
  TargetSelector,
  VaultData,
} from "./vault-types";

export interface VaultBaselineHost {
  data: VaultData;
  maxHistoryVersions: number;
  _ensureUnlocked: () => void;
  _scheduleAutoSave: () => void;
  _projectIncarnations: Map<string, string>;
  _environmentForSelector: (selector: TargetSelector) => EnvironmentResolution;
  getEnvironmentTargetIdentity: (
    selector: TargetSelector
  ) => EnvironmentTargetIdentity;
  _installData: (nextData: VaultData) => void;
  _enqueuePersistenceOperation: <T>(
    operation: () => Promise<T> | T
  ) => Promise<T>;
}

export const getImportProjectSnapshot = (
  vault: VaultBaselineHost,
  selector: TargetSelector,
  keys: string[] = []
): ImportProjectSnapshot => {
  vault._ensureUnlocked();
  const { projectName } = selector;
  const project = vault.data.projects[projectName];
  if (!project) {
    return { exists: false, incarnation: null, secrets: Object.create(null) };
  }
  const { environment, target } = vault._environmentForSelector(selector);
  const secrets: Record<string, SecretRecord | string | null> =
    Object.create(null);
  for (const key of keys) {
    const ownSecret = Object.hasOwn(environment.secrets, key);
    const secret = ownSecret ? environment.secrets[key] : null;
    secrets[key] = ownSecret ? copyJsonData(secret) : null;
  }
  return {
    exists: true,
    incarnation: vault._projectIncarnations.get(projectName) || null,
    ...vault.getEnvironmentTargetIdentity(target),
    secrets,
  };
};

export const getProjectConfigurationBaseline = (
  vault: VaultBaselineHost,
  selector: TargetSelector
): ProjectConfigurationBaselineResult => {
  vault._ensureUnlocked();
  const { projectName } = selector;
  const exists = Object.hasOwn(vault.data.projects, projectName);
  const project = exists ? vault.data.projects[projectName] : null;
  if (!project) {
    return {
      configurationBaseline: null,
      exists: false,
      incarnation: null,
    };
  }
  const { environment, target } = vault._environmentForSelector(selector);
  return {
    exists,
    incarnation: project
      ? vault._projectIncarnations.get(projectName) || null
      : null,
    ...vault.getEnvironmentTargetIdentity(target),
    configurationBaseline: environment.configurationBaseline
      ? copyJsonData(environment.configurationBaseline)
      : null,
  };
};

export const setProjectConfigurationBaselineNow = (
  vault: VaultBaselineHost,
  selector: TargetSelector,
  requiredKeys: string[] | null,
  expected: TargetExpectation
): BaselineMutationResult => {
  vault._ensureUnlocked();
  if (isFunction(expected.validateTarget)) {
    expected.validateTarget();
  }
  const { projectName } = selector;
  const project = vault.data.projects[projectName];
  if (
    !project ||
    (expected.incarnation &&
      vault._projectIncarnations.get(projectName) !== expected.incarnation)
  ) {
    const error = new Error("Project configuration baseline target changed");
    error.code = "CONFIGURATION_BASELINE_STALE";
    throw error;
  }
  let resolved: EnvironmentResolution;
  try {
    resolved = vault._environmentForSelector(selector);
  } catch {
    const error = new Error("Project configuration baseline target changed");
    error.code = "CONFIGURATION_BASELINE_STALE";
    throw error;
  }
  const { environment } = resolved;
  if (
    expected.environmentIncarnation &&
    vault.getEnvironmentTargetIdentity(resolved.target)
      .environmentIncarnation !== expected.environmentIncarnation
  ) {
    const error = new Error("Project configuration baseline target changed");
    error.code = "CONFIGURATION_BASELINE_STALE";
    throw error;
  }
  if (
    expected.baseline &&
    (expected.baseline.exists !== Boolean(environment.configurationBaseline) ||
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
  const nextData = cloneVaultData(vault.data);
  const nextEnvironment =
    nextData.projects[projectName].environments[resolved.target.environmentId];
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
  vault._installData(nextData);
  vault._scheduleAutoSave();
  return { changed: true };
};

export const replaceProjectConfigurationBaseline = (
  vault: VaultBaselineHost,
  selector: TargetSelector,
  requiredKeys: string[],
  expected: TargetExpectation = {}
): Promise<BaselineMutationResult> =>
  vault._enqueuePersistenceOperation(() =>
    setProjectConfigurationBaselineNow(vault, selector, requiredKeys, expected)
  );

export const clearProjectConfigurationBaseline = (
  vault: VaultBaselineHost,
  selector: TargetSelector,
  expected: TargetExpectation = {}
): Promise<BaselineMutationResult> =>
  vault._enqueuePersistenceOperation(() =>
    setProjectConfigurationBaselineNow(vault, selector, null, expected)
  );

export const applySecretImportBatchNow = (
  vault: VaultBaselineHost,
  selector: TargetSelector,
  changes: SecretImportChange[],
  expected: TargetExpectation = {}
): void => {
  vault._ensureUnlocked();
  if (isFunction(expected.validateTarget)) {
    expected.validateTarget();
  }
  const { projectName } = selector;
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new TypeError("Import batch must contain changes");
  }
  const keys = changes.map((change) => change?.key);
  if (
    keys.some(
      (key) => !isString(key) || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)
    ) ||
    new Set(keys).size !== keys.length
  ) {
    throw new TypeError("Import batch contains an invalid key");
  }
  if (
    changes.some(
      (change) =>
        (change.action !== "add" && change.action !== "replace") ||
        !isString(change.value)
    )
  ) {
    throw new TypeError("Import batch contains an invalid change");
  }

  const project = Object.hasOwn(vault.data.projects, projectName)
    ? vault.data.projects[projectName]
    : null;
  if (
    !project ||
    (expected.incarnation &&
      vault._projectIncarnations.get(projectName) !== expected.incarnation)
  ) {
    const error = new Error("Import target changed");
    error.code = "IMPORT_STALE";
    throw error;
  }
  let resolved: EnvironmentResolution;
  try {
    resolved = vault._environmentForSelector(selector);
  } catch {
    const error = new Error("Import target changed");
    error.code = "IMPORT_STALE";
    throw error;
  }
  if (
    expected.environmentIncarnation &&
    vault.getEnvironmentTargetIdentity(resolved.target)
      .environmentIncarnation !== expected.environmentIncarnation
  ) {
    const error = new Error("Import target changed");
    error.code = "IMPORT_STALE";
    throw error;
  }
  const validateExpectedChange = (change: SecretImportChange) => {
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
  const nextData = cloneVaultData(vault.data);
  const nextProject = nextData.projects[projectName];
  const nextEnvironment =
    nextProject.environments[resolved.target.environmentId];
  const applyImportChange = (change: SecretImportChange) => {
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
      const old = isString(current)
        ? { value: current }
        : current || { value: "" };
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
          description: isString(old.description) ? old.description : "",
          tags: Array.isArray(old.tags) ? [...old.tags] : [],
          history: [
            // Preserve field order in existing serialized, fingerprinted, or encrypted records.
            // eslint-disable-next-line sort-keys
            {
              value: old.value,
              expiresAt: old.expiresAt ?? null,
              description: isString(old.description) ? old.description : "",
              tags: Array.isArray(old.tags) ? [...old.tags] : [],
              changedAt: old.updatedAt || now,
            },
            ...(Array.isArray(old.history) ? old.history : []),
          ].slice(0, vault.maxHistoryVersions),
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

  vault._installData(nextData);
  vault._scheduleAutoSave();
};

export const applySecretImportBatch = (
  vault: VaultBaselineHost,
  selector: TargetSelector,
  changes: SecretImportChange[],
  expected: TargetExpectation = {}
): Promise<void> =>
  vault._enqueuePersistenceOperation(() =>
    applySecretImportBatchNow(vault, selector, changes, expected)
  );
