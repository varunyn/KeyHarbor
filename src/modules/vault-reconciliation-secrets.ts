import {
  baselineKeys,
  clone,
  equal,
  normalizeHistoryEntry,
  normalizeSecret,
  secretCore,
  sortedValues,
} from "./vault-reconciliation-data";

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

export const mergeProject = (
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
