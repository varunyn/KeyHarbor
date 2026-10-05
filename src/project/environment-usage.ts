import type { ActivityLog, EnvironmentTarget } from "./bridge";

export interface EnvironmentUsageEntry {
  action: string;
  timestamp: string;
}

/** Only completed, structured events for this exact Vault/Project/Environment/key count as usage. */
export const environmentUsageFor = (
  logs: ActivityLog[],
  target: EnvironmentTarget | null,
  key: string | null,
  vaultInstanceId: string | null
): EnvironmentUsageEntry[] => {
  if (!target || !key || !vaultInstanceId) {
    return [];
  }
  return logs
    .filter(
      (log) =>
        log.category === "access" &&
        log.target?.vaultInstanceId === vaultInstanceId &&
        log.target.projectName === target.projectName &&
        log.target.environmentId === target.environmentId &&
        log.target.key === key &&
        log.target.outcome === "approved"
    )
    .slice(0, 3)
    .map((log) => ({
      action: log.target?.action || log.message.split(" - ")[0] || log.message,
      timestamp: log.timestamp,
    }));
};
