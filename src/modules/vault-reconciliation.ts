import crypto = require("node:crypto");
import fs = require("node:fs");
import CryptoUtil = require("./crypto");
import ProjectConfigurationBaseline = require("./project-configuration-baseline");
import type Vault = require("./vault");

const DISK_MISSING = "missing";
const DISK_UNREADABLE = "unreadable";
interface PendingPlan {
  id: string;
  sessionRevision: number;
  diskFingerprint: string;
  sessionData: ReturnType<Vault["_getNormalizedCopyOfData"]>;
  diskData: ReturnType<Vault["_getNormalizedCopyOfData"]> | null;
  diskBytes: Buffer | null;
  reason: string;
  conflicts: Record<string, unknown>[];
  allowedDecisions: readonly ("use_disk" | "keep_session")[];
}

const sortedValues = <T>(
  values: readonly T[],
  compare?: (left: T, right: T) => number
): T[] => {
  const sorted = [...values];
  sorted.sort(compare);
  return sorted;
};

// eslint-disable-next-line unicorn/prefer-structured-clone -- JSON normalization intentionally removes unsupported values before equality, persistence, or IPC.
const clone = (value) => JSON.parse(JSON.stringify(value));

const fingerprint = (bytes) =>
  crypto.createHash("sha256").update(bytes).digest("hex");

const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const invalidVaultData = (message) => {
  const error = new Error(message);
  error.code = "INVALID_VAULT_DATA";
  return error;
};

const normalizeTags = (tags) =>
  Array.isArray(tags) ? tags.filter((tag) => typeof tag === "string") : [];

const normalizeHistoryEntry = (entry) => {
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

const normalizeSecret = (secret) => {
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

const secretCore = (secret) => {
  const normalized = normalizeSecret(secret);
  // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
  return {
    value: normalized.value,
    expiresAt: normalized.expiresAt,
    description: normalized.description,
    tags: normalized.tags,
  };
};

const normalizeFavorites = (
  favorites
): {
  projects: string[];
  secrets: Record<string, Record<string, string[]>>;
} => {
  const source =
    favorites && typeof favorites === "object" && !Array.isArray(favorites)
      ? favorites
      : {};
  const projects: string[] = [];
  if (Array.isArray(source.projects)) {
    for (const name of source.projects as unknown[]) {
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
  const environments = Object.create(null);
  for (const id of sortedValues(Object.keys(project.environments))) {
    environments[id] = validateAndCloneEnvironment(
      id,
      project.environments[id]
    );
  }
  if (
    new Set(
      (Object.values(environments) as { name: string }[]).map(
        (environment) => environment.name
      )
    ).size !== Object.keys(environments).length
  ) {
    throw invalidVaultData("Duplicate vault environment name");
  }
  const nextProject = { ...clone(project), environments };
  return nextProject;
};

const validateAndCloneVaultData = (data) => {
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

const createBaseline = (data) => {
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

const baselineKeys = (baseline) => {
  if (Array.isArray(baseline)) {
    return baseline;
  }
  return baseline?.requiredKeys ?? null;
};

const projectState = (project) => {
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

const projectFavoriteState = (favorites, projectName) => {
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

const mergeConfigurationBaseline = (
  projectName,
  local,
  remote,
  baseline,
  output,
  conflicts,
  environmentId
) => {
  const localKeys = baselineKeys(local.configurationBaseline);
  const remoteKeys = baselineKeys(remote.configurationBaseline);
  const baselineKeysValue = baselineKeys(baseline?.configurationBaseline);
  if (equal(localKeys, remoteKeys)) {
    if (local.configurationBaseline) {
      output.configurationBaseline = clone(local.configurationBaseline);
    } else {
      delete output.configurationBaseline;
    }
    return;
  }

  const localChanged = !equal(localKeys, baselineKeysValue);
  const remoteChanged = !equal(remoteKeys, baselineKeysValue);
  if (localChanged && remoteChanged) {
    // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
    conflicts.push({
      kind: "configurationBaseline",
      project: projectName,
      ...(environmentId ? { environmentId } : {}),
      reason: "configuration_baseline_divergent",
      sessionRequiredKeys: localKeys === null ? null : clone(localKeys),
      diskRequiredKeys: remoteKeys === null ? null : clone(remoteKeys),
    });
    return;
  }

  const selected = localChanged
    ? local.configurationBaseline
    : remote.configurationBaseline;
  if (selected) {
    output.configurationBaseline = clone(selected);
  } else {
    delete output.configurationBaseline;
  }
};

const mergeHistory = (maxHistoryVersions, ...records) => {
  const entries = records.flatMap((record) =>
    record && typeof record === "object" && Array.isArray(record.history)
      ? record.history
      : []
  );
  const seen = new Set();
  return sortedValues(
    entries.map(normalizeHistoryEntry).filter((entry) => {
      const identity = JSON.stringify(entry);
      if (seen.has(identity)) {
        return false;
      }
      seen.add(identity);
      return true;
    }),
    (left, right) =>
      String(right.changedAt || "").localeCompare(String(left.changedAt || ""))
  ).slice(0, maxHistoryVersions);
};

const earliestTimestamp = (...values) => {
  const valid = sortedValues(
    values.filter(
      (value) => typeof value === "string" && !Number.isNaN(Date.parse(value))
    )
  );
  return valid[0] || null;
};

const mergeSecretRecord = (
  selected,
  local,
  remote,
  baseline,
  maxHistoryVersions
) => {
  const history = mergeHistory(maxHistoryVersions, local, remote, baseline);
  if (typeof selected === "string" && history.length === 0) {
    return selected;
  }

  const normalized = normalizeSecret(selected);
  const output =
    typeof selected === "object" ? clone(selected) : { ...normalized };
  output.history = history;
  const createdAt = earliestTimestamp(
    local?.createdAt,
    remote?.createdAt,
    baseline?.createdAt
  );
  if (createdAt) {
    output.createdAt = createdAt;
  }
  return output;
};

const preview = (secret) => {
  if (secret === undefined) {
    return "—";
  }
  const value = String(
    typeof secret === "string" ? secret : (secret?.value ?? "")
  );
  if (!value) {
    return "—";
  }
  const suffix = value.length > 4 ? value.slice(-2) : "";
  return `••••${suffix} (${value.length} chars)`;
};

const secretConflict = (
  project,
  key,
  reason,
  local,
  remote,
  environmentId
  // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
) => ({
  kind: "secret",
  project,
  ...(environmentId ? { environmentId } : {}),
  key,
  reason,
  sessionPreview: preview(local),
  diskPreview: preview(remote),
});

const mergeDeletedSecret = (
  projectName,
  key,
  localSecret,
  remoteSecret,
  baselineSecret,
  output,
  conflicts,
  environmentId
) => {
  const present = localSecret ?? remoteSecret;
  if (baselineSecret === undefined) {
    output.secrets[key] = clone(present);
  } else if (
    !equal(normalizeSecret(present), normalizeSecret(baselineSecret))
  ) {
    conflicts.push(
      secretConflict(
        projectName,
        key,
        localSecret === undefined
          ? "local_deleted_remote_edited"
          : "remote_deleted_local_edited",
        localSecret,
        remoteSecret,
        environmentId
      )
    );
  }
};

const mergeProjectSecret = (
  projectName,
  key,
  local,
  remote,
  baseline,
  maxHistoryVersions,
  conflicts,
  environmentId,
  output
) => {
  const localSecret = local.secrets?.[key];
  const remoteSecret = remote.secrets?.[key];
  const baselineSecret = baseline?.secrets?.[key];
  if (localSecret === undefined && remoteSecret === undefined) {
    return;
  }

  if (localSecret === undefined || remoteSecret === undefined) {
    mergeDeletedSecret(
      projectName,
      key,
      localSecret,
      remoteSecret,
      baselineSecret,
      output,
      conflicts,
      environmentId
    );
    return;
  }

  const localCore = secretCore(localSecret);
  const remoteCore = secretCore(remoteSecret);
  const baselineCore =
    baselineSecret === undefined ? undefined : secretCore(baselineSecret);
  if (equal(localCore, remoteCore)) {
    output.secrets[key] = mergeSecretRecord(
      localSecret,
      localSecret,
      remoteSecret,
      baselineSecret,
      maxHistoryVersions
    );
  } else if (baselineSecret === undefined) {
    conflicts.push(
      secretConflict(
        projectName,
        key,
        "simultaneous_add_divergent",
        localSecret,
        remoteSecret,
        environmentId
      )
    );
  } else {
    const localChanged = !equal(localCore, baselineCore);
    const remoteChanged = !equal(remoteCore, baselineCore);
    if (localChanged && remoteChanged) {
      conflicts.push(
        secretConflict(
          projectName,
          key,
          "divergent_edit",
          localSecret,
          remoteSecret,
          environmentId
        )
      );
    } else {
      const selected = localChanged ? localSecret : remoteSecret;
      output.secrets[key] = mergeSecretRecord(
        selected,
        localSecret,
        remoteSecret,
        baselineSecret,
        maxHistoryVersions
      );
    }
  }
};

const mergeProject = (
  projectName,
  local,
  remote,
  baseline,
  maxHistoryVersions,
  conflicts,
  environmentId
) => {
  const output = { ...clone(local), secrets: Object.create(null) };
  mergeConfigurationBaseline(
    projectName,
    local,
    remote,
    baseline,
    output,
    conflicts,
    environmentId
  );
  const keys = new Set([
    ...Object.keys(local.secrets || {}),
    ...Object.keys(remote.secrets || {}),
    ...Object.keys(baseline?.secrets || {}),
  ]);

  for (const key of sortedValues([...keys])) {
    mergeProjectSecret(
      projectName,
      key,
      local,
      remote,
      baseline,
      maxHistoryVersions,
      conflicts,
      environmentId,
      output
    );
  }

  const createdAt = earliestTimestamp(local.createdAt, remote.createdAt);
  if (createdAt) {
    output.createdAt = createdAt;
  }
  output.updatedAt = new Date().toISOString();
  return output;
};

const favoritesContain = (container, candidate) => {
  const projectSet = new Set(container.projects);
  if (candidate.projects.some((project) => !projectSet.has(project))) {
    return false;
  }
  for (const [projectName, environments] of Object.entries(
    candidate.secrets
  ) as [string, Record<string, string[]>][]) {
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

const mergeFavorites = (local, remote, baseline, conflicts) => {
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

const environmentState = (environment) => {
  const project = {
    defaultEnvironmentId: environment.id,
    environments: { [environment.id]: environment },
  };
  const state = projectState(project);
  return state ? state.environments[environment.id] : null;
};

const filterFavorites = (favorites, projects) => {
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
  ) as [string, Record<string, string[]>][]) {
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

const environmentConflictContext = (projectName, local, remote, baseline) => {
  const sessionProject = local.projects?.[projectName];
  const diskProject = remote.projects?.[projectName];
  const baselineProject = baseline?.projects?.[projectName];
  const sessionEnvironments = sessionProject?.environments || {};
  const diskEnvironments = diskProject?.environments || {};
  const baselineEnvironments = baselineProject?.environments || {};
  // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
  return {
    sessionProject,
    diskProject,
    sessionEnvironments,
    diskEnvironments,
    baselineEnvironments,
  };
};

const labelDefaultEnvironmentConflict = (
  conflict,
  sessionProject,
  diskProject,
  sessionEnvironments,
  diskEnvironments,
  baselineEnvironments
) => {
  const sessionId = sessionProject?.defaultEnvironmentId;
  const diskId = diskProject?.defaultEnvironmentId;
  const session = sessionId
    ? sessionEnvironments[sessionId] || baselineEnvironments[sessionId]
    : null;
  const disk = diskId
    ? diskEnvironments[diskId] || baselineEnvironments[diskId]
    : null;
  // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
  return {
    ...conflict,
    sessionEnvironmentId: sessionId || undefined,
    sessionEnvironmentName: session?.name,
    diskEnvironmentId: diskId || undefined,
    diskEnvironmentName: disk?.name,
    sessionPreview: session?.name || "No default Environment",
    diskPreview: disk?.name || "No default Environment",
  };
};

const environmentConflictCandidates = (
  conflict,
  session,
  disk,
  baselineEnvironments,
  environmentId,
  sessionEnvironments,
  diskEnvironments
) => {
  let sessionCandidate = session;
  let diskCandidate = disk;
  if (conflict.reason === "environment_name_collision") {
    const name =
      session?.name || disk?.name || baselineEnvironments[environmentId]?.name;
    if (name) {
      sessionCandidate =
        (
          Object.values(sessionEnvironments) as {
            id: string;
            name: string;
          }[]
        ).find((entry) => entry.name === name) || session;
      diskCandidate =
        (
          Object.values(diskEnvironments) as {
            id: string;
            name: string;
          }[]
        ).find((entry) => entry.name === name) || disk;
    }
  }
  // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
  return { sessionCandidate, diskCandidate };
};

const labelEnvironmentConflict = (
  conflict,
  environmentId,
  sessionCandidate,
  diskCandidate,
  baselineEnvironments
) => {
  const sessionName = sessionCandidate?.name;
  const diskName = diskCandidate?.name;
  const selectedName =
    sessionName && diskName && sessionName !== diskName
      ? `${sessionName} / ${diskName}`
      : sessionName || diskName || baselineEnvironments[environmentId]?.name;
  // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
  return {
    ...conflict,
    environmentName: selectedName,
    sessionEnvironmentId:
      sessionCandidate?.id || (sessionCandidate ? environmentId : undefined),
    sessionEnvironmentName: sessionName,
    diskEnvironmentId:
      diskCandidate?.id || (diskCandidate ? environmentId : undefined),
    diskEnvironmentName: diskName,
  };
};

const enrichEnvironmentConflicts = (conflicts, local, remote, baseline) =>
  conflicts.map((conflict) => {
    const projectName =
      typeof conflict.project === "string" ? conflict.project : null;
    if (!projectName) {
      return conflict;
    }
    const {
      sessionProject,
      diskProject,
      sessionEnvironments,
      diskEnvironments,
      baselineEnvironments,
    } = environmentConflictContext(projectName, local, remote, baseline);
    if (conflict.kind === "environment_default") {
      return labelDefaultEnvironmentConflict(
        conflict,
        sessionProject,
        diskProject,
        sessionEnvironments,
        diskEnvironments,
        baselineEnvironments
      );
    }
    if (typeof conflict.environmentId !== "string") {
      return conflict;
    }
    const { environmentId } = conflict;
    const session =
      sessionEnvironments[environmentId] || baselineEnvironments[environmentId];
    const disk =
      diskEnvironments[environmentId] || baselineEnvironments[environmentId];
    const { sessionCandidate, diskCandidate } = environmentConflictCandidates(
      conflict,
      session,
      disk,
      baselineEnvironments,
      environmentId,
      sessionEnvironments,
      diskEnvironments
    );
    return labelEnvironmentConflict(
      conflict,
      environmentId,
      sessionCandidate,
      diskCandidate,
      baselineEnvironments
    );
  });

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

const mergeVaultData = (local, remote, baseline, maxHistoryVersions) => {
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

const diskMarker = (vaultPath) => {
  try {
    return fingerprint(fs.readFileSync(vaultPath));
  } catch (error) {
    return error?.code === "ENOENT" ? DISK_MISSING : DISK_UNREADABLE;
  }
};

class VaultReconciliation {
  vault: Vault;
  pendingPlan: PendingPlan | null = null;

  constructor(vault) {
    this.vault = vault;
    this.pendingPlan = null;
  }

  // eslint-disable-next-line class-methods-use-this -- Retain the established instance-method API used by callers.
  createBaseline(data) {
    // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
    return createBaseline(data || { projects: {}, favorites: {} });
  }

  clearPlan() {
    this.pendingPlan = null;
  }

  _readDisk() {
    let bytes;
    try {
      bytes = fs.readFileSync(this.vault.vaultPath);
    } catch (error) {
      // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
      return {
        ok: false,
        reason: error?.code === "ENOENT" ? "disk_missing" : "disk_unreadable",
        diskFingerprint:
          error?.code === "ENOENT" ? DISK_MISSING : DISK_UNREADABLE,
      };
    }

    const diskFingerprint = fingerprint(bytes);
    try {
      const decrypted = CryptoUtil.decryptJson(bytes, this.vault.key);
      const validated = validateAndCloneVaultData(decrypted);
      const data = this.vault._getNormalizedCopyOfData(validated);
      // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
      return { ok: true, bytes, diskFingerprint, data };
    } catch (error) {
      // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
      return {
        ok: false,
        reason:
          error?.code === "INVALID_VAULT_DATA"
            ? "invalid_vault"
            : "disk_unreadable",
        diskFingerprint,
      };
    }
  }

  _createPlan(reason, diskResult, conflicts: Record<string, unknown>[] = []) {
    // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
    const plan = {
      id: crypto.randomBytes(16).toString("hex"),
      sessionRevision: this.vault.sessionRevision,
      diskFingerprint: diskResult.diskFingerprint,
      sessionData: clone(this.vault.data),
      diskData: diskResult.ok ? clone(diskResult.data) : null,
      diskBytes: diskResult.ok ? Buffer.from(diskResult.bytes) : null,
      reason,
      conflicts: clone(conflicts),
      allowedDecisions: diskResult.ok
        ? (["use_disk", "keep_session"] as const)
        : (["keep_session"] as const),
    };
    this.pendingPlan = plan;
    const outcome = this._outcomeForPlan(plan);
    this.vault._notifyConflict(outcome);
    return outcome;
  }

  // eslint-disable-next-line class-methods-use-this -- Retain the established instance-method API used by callers.
  _outcomeForPlan(plan) {
    // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
    return {
      status: "needs_resolution",
      reconciliationId: plan.id,
      reason: plan.reason,
      ...(plan.conflicts.length > 0
        ? { conflicts: clone(plan.conflicts) }
        : {}),
      allowedDecisions: [...plan.allowedDecisions],
    };
  }

  async reconcileExternalChange(_options = {}) {
    this.vault._ensureUnlocked();
    const diskResult = this._readDisk();
    if (
      this.pendingPlan &&
      this.pendingPlan.sessionRevision === this.vault.sessionRevision &&
      this.pendingPlan.diskFingerprint === diskResult.diskFingerprint
    ) {
      return this._outcomeForPlan(this.pendingPlan);
    }
    if (!diskResult.ok) {
      return this._createPlan(diskResult.reason, diskResult);
    }
    if (diskResult.diskFingerprint === this.vault._diskContentHash) {
      this.clearPlan();
      return { status: "unchanged" };
    }

    const result = mergeVaultData(
      this.vault.data,
      diskResult.data,
      this.vault._syncBaseline || this.createBaseline(this.vault.data),
      this.vault.maxHistoryVersions
    );
    if (result.conflicts.length > 0) {
      return this._createPlan("conflict", diskResult, result.conflicts);
    }

    const merged = this.vault._getNormalizedCopyOfData(result.merged);
    if (
      equal(this.createBaseline(merged), this.createBaseline(diskResult.data))
    ) {
      this.vault._installData(diskResult.data);
      this.vault.sessionRevision += 1;
      this.vault._setDiskHashFromCiphertext(diskResult.bytes);
      this.vault._refreshSyncBaseline();
    } else {
      // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
      await this.vault._atomicWriteData(merged, {
        incrementRevision: true,
        expectedDiskFingerprint: diskResult.diskFingerprint,
        expectedSessionRevision: this.vault.sessionRevision,
      });
    }
    this.clearPlan();
    // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
    return { status: "merged", changed: true };
  }

  async resolveReconciliation({
    reconciliationId,
    decision,
  }: { reconciliationId?: string; decision?: string } = {}) {
    this.vault._ensureUnlocked();
    const plan = this.pendingPlan;
    if (!plan || plan.id !== reconciliationId) {
      const error = new Error("Invalid reconciliation plan");
      error.code = "VAULT_INVALID_RECONCILIATION_PLAN";
      throw error;
    }
    if (
      !plan.allowedDecisions.includes(decision as "use_disk" | "keep_session")
    ) {
      const error = new Error("Invalid reconciliation decision");
      error.code = "VAULT_INVALID_RECONCILIATION_DECISION";
      throw error;
    }

    const currentDiskFingerprint = diskMarker(this.vault.vaultPath);
    if (
      plan.sessionRevision !== this.vault.sessionRevision ||
      plan.diskFingerprint !== currentDiskFingerprint
    ) {
      this.clearPlan();
      return { status: "superseded" };
    }

    if (decision === "use_disk") {
      if (!plan.diskData) {
        const error = new Error("Invalid reconciliation plan");
        error.code = "VAULT_INVALID_RECONCILIATION_PLAN";
        throw error;
      }
      this.vault._installData(
        this.vault._getNormalizedCopyOfData(plan.diskData)
      );
      this.vault.sessionRevision += 1;
      this.vault._setDiskHashFromCiphertext(plan.diskBytes);
      this.vault._refreshSyncBaseline();
    } else {
      // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
      await this.vault._atomicWriteData(plan.sessionData, {
        incrementRevision: true,
        expectedDiskFingerprint: plan.diskFingerprint,
        expectedSessionRevision: plan.sessionRevision,
      });
    }
    this.clearPlan();
    // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
    return { status: "resolved", decision };
  }
}

export = VaultReconciliation;
