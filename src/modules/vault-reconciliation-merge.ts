import { enrichEnvironmentConflicts } from "./vault-reconciliation-conflicts";
import {
  clone,
  equal,
  projectState,
  sortedValues,
} from "./vault-reconciliation-data";
import {
  filterFavorites,
  mergeFavorites,
  projectFavoriteState,
} from "./vault-reconciliation-favorites";
import { mergeProject } from "./vault-reconciliation-secrets";

const environmentState = (environment) => {
  const project = {
    defaultEnvironmentId: environment.id,
    environments: { [environment.id]: environment },
  };
  const state = projectState(project);
  return state ? state.environments[environment.id] : null;
};

const environmentFavorites = (favorites, projectName, environmentId) =>
  favorites?.secrets?.[projectName]?.[environmentId] || [];
const recordDeletedEnvironmentConflict = (
  projectName,
  environmentId,
  present,
  left,
  base,
  local,
  remote,
  baseline,
  conflicts
) => {
  const deletedSideFavorites = left
    ? environmentFavorites(remote.favorites, projectName, environmentId)
    : environmentFavorites(local.favorites, projectName, environmentId);
  const presentSideFavorites = left
    ? environmentFavorites(local.favorites, projectName, environmentId)
    : environmentFavorites(remote.favorites, projectName, environmentId);
  const baselineFavorites = environmentFavorites(
    baseline?.favorites,
    projectName,
    environmentId
  );
  const deletedReason = left
    ? "remote_deleted_environment_local_changed"
    : "local_deleted_environment_remote_changed";
  const favoriteChanged = !equal(presentSideFavorites, baselineFavorites);
  const environmentChanged = !equal(environmentState(present), base);
  if (
    environmentChanged ||
    favoriteChanged ||
    deletedSideFavorites.length > 0
  ) {
    // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
    conflicts.push({
      kind:
        favoriteChanged && !environmentChanged ? "favorites" : "environment",
      project: projectName,
      environmentId,
      reason:
        favoriteChanged && !environmentChanged
          ? "environment_deleted_favorite_changed"
          : deletedReason,
    });
  }
};

const mergeVaultEnvironment = (
  projectName,
  environmentId,
  localEnvironments,
  remoteEnvironments,
  baselineEnvironments,
  local,
  remote,
  baseline,
  maxHistoryVersions,
  conflicts
) => {
  const left = localEnvironments[environmentId];
  const right = remoteEnvironments[environmentId];
  const base = baselineEnvironments[environmentId];
  if (!left && !right) {
    return null;
  }
  if (!left || !right) {
    const present = left || right;
    if (!base) {
      return clone(present);
    }
    recordDeletedEnvironmentConflict(
      projectName,
      environmentId,
      present,
      left,
      base,
      local,
      remote,
      baseline,
      conflicts
    );
    return null;
  }
  const envOutput = mergeProject(
    projectName,
    left,
    right,
    base,
    maxHistoryVersions,
    conflicts,
    environmentId
  );
  if (left.name === right.name) {
    envOutput.name = left.name;
  } else if (!base || left.name === base.name) {
    envOutput.name = right.name;
  } else if (right.name === base.name) {
    envOutput.name = left.name;
  } else {
    // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
    conflicts.push({
      kind: "environment",
      project: projectName,
      environmentId,
      reason: "environment_rename_divergent",
    });
  }
  envOutput.id = environmentId;
  return envOutput;
};

const mergeProjectDefault = (
  projectName,
  project,
  localProject,
  remoteProject,
  baselineProject,
  conflicts
) => {
  const localDefaultChanged =
    localProject.defaultEnvironmentId !== baselineProject?.defaultEnvironmentId;
  const remoteDefaultChanged =
    remoteProject.defaultEnvironmentId !==
    baselineProject?.defaultEnvironmentId;
  if (
    localProject.defaultEnvironmentId === remoteProject.defaultEnvironmentId
  ) {
    project.defaultEnvironmentId = localProject.defaultEnvironmentId;
  } else if (localDefaultChanged && remoteDefaultChanged) {
    conflicts.push({
      kind: "environment_default",
      project: projectName,
      reason: "default_environment_divergent",
    });
  } else {
    project.defaultEnvironmentId = localDefaultChanged
      ? localProject.defaultEnvironmentId
      : remoteProject.defaultEnvironmentId;
  }
};

const validateMergedEnvironments = (projectName, project, conflicts) => {
  const namesByEnvironment = new Map();
  for (const environment of Object.values(project.environments) as {
    id: string;
    name: string;
  }[]) {
    const existing = namesByEnvironment.get(environment.name);
    if (existing && existing !== environment.id) {
      // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
      conflicts.push({
        kind: "environment",
        project: projectName,
        environmentId: environment.id,
        reason: "environment_name_collision",
      });
    } else {
      namesByEnvironment.set(environment.name, environment.id);
    }
  }
  if (Object.keys(project.environments).length === 0) {
    conflicts.push({
      kind: "environment",
      project: projectName,
      reason: "last_environment_deleted",
    });
  } else if (!project.environments[project.defaultEnvironmentId]) {
    conflicts.push({
      kind: "environment_default",
      project: projectName,
      reason: "default_environment_deleted",
    });
  }
};

const deletedProjectChanged = (
  present,
  baselineProject,
  projectName,
  local,
  remote,
  baseline,
  localProject,
  remoteProject
) =>
  !equal(projectState(present), projectState(baselineProject)) ||
  (!equal(
    projectFavoriteState(local.favorites, projectName),
    projectFavoriteState(baseline?.favorites, projectName)
  ) &&
    !!localProject) ||
  (!equal(
    projectFavoriteState(remote.favorites, projectName),
    projectFavoriteState(baseline?.favorites, projectName)
  ) &&
    !!remoteProject);

const mergeVaultProject = (
  projectName,
  localProjects,
  remoteProjects,
  baselineProjects,
  local,
  remote,
  baseline,
  maxHistoryVersions,
  conflicts
) => {
  const localProject = localProjects[projectName];
  const remoteProject = remoteProjects[projectName];
  const baselineProject = baselineProjects[projectName];
  if (!localProject && !remoteProject) {
    return null;
  }

  if (!localProject || !remoteProject) {
    const present = localProject || remoteProject;
    if (!baselineProject) {
      return clone(present);
    } else if (
      deletedProjectChanged(
        present,
        baselineProject,
        projectName,
        local,
        remote,
        baseline,
        localProject,
        remoteProject
      )
    ) {
      conflicts.push({
        kind: "project",
        project: projectName,
        reason: localProject
          ? "remote_deleted_project_local_changed"
          : "local_deleted_project_remote_changed",
      });
    }
    return null;
  }

  const project = {
    ...clone(localProject),
    environments: Object.create(null),
  };
  mergeProjectDefault(
    projectName,
    project,
    localProject,
    remoteProject,
    baselineProject,
    conflicts
  );
  const localEnvironments = localProject.environments || {};
  const remoteEnvironments = remoteProject.environments || {};
  const baselineEnvironments = baselineProject?.environments || {};
  const environmentIds = new Set([
    ...Object.keys(localEnvironments),
    ...Object.keys(remoteEnvironments),
    ...Object.keys(baselineEnvironments),
  ]);
  for (const environmentId of sortedValues([...environmentIds])) {
    const environment = mergeVaultEnvironment(
      projectName,
      environmentId,
      localEnvironments,
      remoteEnvironments,
      baselineEnvironments,
      local,
      remote,
      baseline,
      maxHistoryVersions,
      conflicts
    );
    if (environment) {
      project.environments[environmentId] = environment;
    }
  }
  validateMergedEnvironments(projectName, project, conflicts);
  return project;
};

export const mergeVaultData = (local, remote, baseline, maxHistoryVersions) => {
  const conflicts: Record<string, unknown>[] = [];
  const projects = Object.create(null);
  const localProjects = local.projects || {};
  const remoteProjects = remote.projects || {};
  const baselineProjects = baseline?.projects || {};
  const names = new Set([
    ...Object.keys(localProjects),
    ...Object.keys(remoteProjects),
    ...Object.keys(baselineProjects),
  ]);

  for (const projectName of sortedValues([...names])) {
    const project = mergeVaultProject(
      projectName,
      localProjects,
      remoteProjects,
      baselineProjects,
      local,
      remote,
      baseline,
      maxHistoryVersions,
      conflicts
    );
    if (project) {
      projects[projectName] = project;
    }
  }

  const favorites = mergeFavorites(
    local.favorites,
    remote.favorites,
    baseline?.favorites,
    conflicts
  );
  const labeledConflicts = enrichEnvironmentConflicts(
    conflicts,
    local,
    remote,
    baseline
  );
  if (labeledConflicts.length > 0) {
    // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
    return { merged: null, conflicts: labeledConflicts };
  }

  const merged = clone(local);
  merged.projects = projects;
  merged.favorites = filterFavorites(favorites, projects);
  merged.updatedAt = new Date().toISOString();
  // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
  return { merged, conflicts: [] };
};
