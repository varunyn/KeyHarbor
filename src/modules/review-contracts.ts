/** Vault operations used by import and configuration reviews. */
export interface ReviewBaseline {
  requiredKeys: string[];
  revision: string;
}

export interface ReviewProjectSnapshot {
  exists: boolean;
  incarnation: string | null;
  environmentIncarnation: string | null;
  secrets: Record<string, unknown>;
}

export interface ReviewBaselineSnapshot {
  exists: boolean;
  incarnation: string | null;
  environmentIncarnation: string | null;
  configurationBaseline: ReviewBaseline | null;
}

export interface ReviewExpectedBaseline {
  incarnation: string | null;
  environmentIncarnation: string | null;
  baseline: { exists: boolean; revision: string | null };
  validateTarget: () => void;
}

export interface ReviewVault {
  isLocked: boolean;
  getImportProjectSnapshot: (
    selector: unknown,
    keys: string[]
  ) => ReviewProjectSnapshot;
  getProjectConfigurationBaseline: (
    selector: unknown
  ) => ReviewBaselineSnapshot;
  getEnvironmentTargetIdentity: (selector: unknown) => {
    projectName: string;
    environmentId: string;
    environmentName: string;
    environmentIncarnation: string | null;
  };
  getVaultId: () => string | null;
  getVaultInstanceId: () => string | null;
  applySecretImportBatch: (
    selector: unknown,
    entries: { key: string; value: string; action: "add" | "replace" }[],
    expected: {
      incarnation: string | null;
      environmentIncarnation: string | null;
      secrets: Record<string, unknown>;
      validateTarget: () => void;
    }
  ) => Promise<unknown>;
  clearProjectConfigurationBaseline: (
    selector: unknown,
    expected: ReviewExpectedBaseline
  ) => Promise<{ changed: boolean }>;
  replaceProjectConfigurationBaseline: (
    selector: unknown,
    keys: string[],
    expected: ReviewExpectedBaseline
  ) => Promise<{ changed: boolean }>;
}

export interface ReviewSession {
  withActiveSession: <T>(
    operation: (context: { activeVault: ReviewVault | null }) => T | Promise<T>
  ) => Promise<T>;
  snapshot: () => {
    state: string;
    transitionId: number | string;
    activeVaultId: string | null;
  };
  vaultManager?: { getVaultList?: () => { id: string; name: string }[] };
}
