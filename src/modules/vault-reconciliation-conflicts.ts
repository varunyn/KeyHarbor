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
  sessionEnvironments: Record<string, { id: string; name: string }>,
  diskEnvironments: Record<string, { id: string; name: string }>
) => {
  let sessionCandidate = session;
  let diskCandidate = disk;
  if (conflict.reason === "environment_name_collision") {
    const name =
      session?.name || disk?.name || baselineEnvironments[environmentId]?.name;
    if (name) {
      sessionCandidate =
        Object.values(sessionEnvironments).find(
          (entry) => entry.name === name
        ) || session;
      diskCandidate =
        Object.values(diskEnvironments).find((entry) => entry.name === name) ||
        disk;
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

export const enrichEnvironmentConflicts = (
  conflicts,
  local,
  remote,
  baseline
) =>
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
