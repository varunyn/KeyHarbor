import {
  equal,
  normalizeFavorites,
  sortedValues,
} from "./vault-reconciliation-data";

export const projectFavoriteState = (favorites, projectName) => {
  const secretFavorites = favorites?.secrets?.[projectName] || {};
  return {
    project: (favorites?.projects || []).includes(projectName),
    secrets: Object.fromEntries(
      sortedValues(Object.keys(secretFavorites)).map((environmentId) => [
        environmentId,
        sortedValues([...(secretFavorites[environmentId] || [])]),
      ])
    ),
  };
};

const favoritesContain = (
  container: ReturnType<typeof normalizeFavorites>,
  candidate: ReturnType<typeof normalizeFavorites>
) => {
  const projectSet = new Set(container.projects);
  if (candidate.projects.some((project) => !projectSet.has(project))) {
    return false;
  }
  for (const [projectName, environments] of Object.entries(candidate.secrets)) {
    for (const [environmentId, keys] of Object.entries(environments)) {
      const keySet = new Set(
        container.secrets[projectName]?.[environmentId] || []
      );
      if (keys.some((key) => !keySet.has(key))) {
        return false;
      }
    }
  }
  return true;
};

const mergeFavoriteProjects = (
  localFavorites,
  remoteFavorites,
  baselineFavorites,
  conflicts
) => {
  let projects;
  if (equal(localFavorites.projects, remoteFavorites.projects)) {
    ({ projects } = localFavorites);
  } else if (equal(localFavorites.projects, baselineFavorites.projects)) {
    ({ projects } = remoteFavorites);
  } else if (equal(remoteFavorites.projects, baselineFavorites.projects)) {
    ({ projects } = localFavorites);
  } else if (
    favoritesContain(
      { projects: localFavorites.projects, secrets: {} },
      { projects: remoteFavorites.projects, secrets: {} }
    )
  ) {
    ({ projects } = localFavorites);
  } else if (
    favoritesContain(
      { projects: remoteFavorites.projects, secrets: {} },
      { projects: localFavorites.projects, secrets: {} }
    )
  ) {
    ({ projects } = remoteFavorites);
  } else {
    conflicts.push({ kind: "favorites", reason: "favorites_divergent" });
    ({ projects } = localFavorites);
  }

  return projects;
};

export const mergeFavorites = (local, remote, baseline, conflicts) => {
  const localFavorites = normalizeFavorites(local);
  const remoteFavorites = normalizeFavorites(remote);
  const baselineFavorites = normalizeFavorites(baseline);
  const projects = mergeFavoriteProjects(
    localFavorites,
    remoteFavorites,
    baselineFavorites,
    conflicts
  );
  const secrets = Object.create(null);
  const projectNames = new Set([
    ...Object.keys(localFavorites.secrets),
    ...Object.keys(remoteFavorites.secrets),
    ...Object.keys(baselineFavorites.secrets),
  ]);
  for (const projectName of projectNames) {
    const environmentIds = new Set([
      ...Object.keys(localFavorites.secrets[projectName] || {}),
      ...Object.keys(remoteFavorites.secrets[projectName] || {}),
      ...Object.keys(baselineFavorites.secrets[projectName] || {}),
    ]);
    for (const environmentId of environmentIds) {
      const left = new Set(
        localFavorites.secrets[projectName]?.[environmentId] || []
      );
      const right = new Set(
        remoteFavorites.secrets[projectName]?.[environmentId] || []
      );
      const base = new Set(
        baselineFavorites.secrets[projectName]?.[environmentId] || []
      );
      const merged = new Set();
      for (const key of new Set([...left, ...right, ...base])) {
        const inLeft = left.has(key);
        const inRight = right.has(key);
        const inBase = base.has(key);
        const changedMembership = inLeft === inBase ? inRight : inLeft;
        const included = inLeft === inRight ? inLeft : changedMembership;
        if (included) {
          merged.add(key);
        }
      }
      if (merged.size) {
        (secrets[projectName] ||= Object.create(null))[environmentId] =
          sortedValues([...merged]);
      }
    }
  }
  return { projects, secrets };
};

export const filterFavorites = (favorites, projects) => {
  const normalized = normalizeFavorites(favorites);
  const projectNames = new Set(Object.keys(projects));
  const output = {
    projects: normalized.projects.filter((projectName: string) =>
      projectNames.has(projectName)
    ),
    secrets: Object.create(null),
  };
  for (const [projectName, environments] of Object.entries(
    normalized.secrets
  )) {
    for (const [environmentId, keys] of Object.entries(environments)) {
      const environmentSecrets =
        projects[projectName]?.environments?.[environmentId]?.secrets || {};
      const validKeys = keys.filter(
        (key) => environmentSecrets[key] !== undefined
      );
      if (validKeys.length > 0) {
        (output.secrets[projectName] ||= Object.create(null))[environmentId] =
          validKeys;
      }
    }
  }
  return output;
};
