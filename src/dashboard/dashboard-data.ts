import type {
  BridgeResult,
  ProjectRecord,
  VaultListEntry,
} from "../project/bridge";
import type { AccessTimes } from "./dashboard-types";

export const isBridgeSuccess = <T extends object>(
  value: BridgeResult<T>
): value is Extract<BridgeResult<T>, { success: true }> => value.success;

export const openProject = (name: string) => {
  window.location.href = `project.html?name=${encodeURIComponent(name)}`;
};

export const selectActiveVault = (
  vaults: VaultListEntry[],
  activeVaultId: string | null
) =>
  vaults.find((vault) => vault.id === activeVaultId) ??
  vaults.find((vault) => vault.isActive) ??
  vaults[0] ??
  null;

export const collectAccessTimes = (
  nextProjects: ProjectRecord[],
  logResult: BridgeResult<{
    data: { timestamp: string; category: string; message: string }[];
  }>
) => {
  // SAFETY: This null-prototype map starts empty; only finite timestamps are assigned below.
  const nextAccess: AccessTimes = Object.create(null) as AccessTimes;
  if (
    isBridgeSuccess<{
      data: { timestamp: string; category: string; message: string }[];
    }>(logResult)
  ) {
    for (const log of logResult.data) {
      if (log.category !== "access") {
        continue;
      }
      const timestamp = Date.parse(log.timestamp);
      if (!Number.isFinite(timestamp)) {
        continue;
      }
      for (const project of nextProjects) {
        const previousAccess = nextAccess[project.name];
        if (
          log.message.includes(`Project: ${project.name}`) &&
          (previousAccess === undefined || timestamp > previousAccess)
        ) {
          nextAccess[project.name] = timestamp;
        }
      }
    }
  }
  return nextAccess;
};

export const requireProjectData = (
  result: BridgeResult<{ data: ProjectRecord[] }>
): ProjectRecord[] => {
  if (!isBridgeSuccess<{ data: ProjectRecord[] }>(result)) {
    throw new Error(result.error || "Unable to load projects");
  }
  return result.data;
};
