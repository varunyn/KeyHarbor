import type { BoundaryValue, CodedError } from "./env-text-import-types";
import { isRecordValue, isStringValue } from "./env-text-import-validation";
import type {
  BaselineIdentity,
  ConfigCoordinatorState,
  ConfigTargetInput,
  ConfigurationFailure,
  ConfigurationReview,
  ReviewBinding,
  ReviewTarget,
} from "./project-configuration-types";
import { validConfigTarget } from "./project-configuration-validation";
import type {
  ReviewBaseline,
  ReviewVault,
  ReviewSession,
} from "./review-contracts";

const crypto = require("node:crypto");

export const MAX_TRACKED_REVIEWS = 8;

export const randomHandle = (): string =>
  crypto.randomBytes(32).toString("base64url");

export const safeError = (code: string): CodedError => {
  // SAFETY: Error.code is an established Node/CommonJS extension used as a machine-readable failure key.
  const error = new Error(code) as CodedError;
  error.code = code;
  return error;
};

interface ConfigErrorMessages {
  CONFIGURATION_COMMIT_FAILED: string;
  CONFIGURATION_EVALUATION_FAILED: string;
  CONFIGURATION_FILE_READ_FAILED: string;
  CONFIGURATION_INPUT_TOO_LARGE: string;
  CONFIGURATION_INVALID_FILE: string;
  CONFIGURATION_INVALID_INPUT: string;
  CONFIGURATION_INVALID_TARGET: string;
  CONFIGURATION_INVALID_UTF8: string;
  CONFIGURATION_NOT_CONFIGURED: string;
  CONFIGURATION_PREVIEW_INVALID: string;
  CONFIGURATION_STALE: string;
  CONFIGURATION_TARGET_UNAVAILABLE: string;
  VAULT_SESSION_CLOSING: string;
  VAULT_SESSION_LOCKED: string;
}

const CONFIG_ERROR_MESSAGES: ConfigErrorMessages = {
  CONFIGURATION_COMMIT_FAILED: "Required keys could not be saved.",
  CONFIGURATION_EVALUATION_FAILED:
    "Configuration status could not be evaluated safely.",
  CONFIGURATION_FILE_READ_FAILED: "The selected template could not be read.",
  CONFIGURATION_INPUT_TOO_LARGE: "Template exceeds the 1 MiB limit.",
  CONFIGURATION_INVALID_FILE: "Choose a regular file.",
  CONFIGURATION_INVALID_INPUT: "Choose text or a valid template file.",
  CONFIGURATION_INVALID_TARGET: "Choose a valid Project.",
  CONFIGURATION_INVALID_UTF8: "Template file must contain valid UTF-8 text.",
  CONFIGURATION_NOT_CONFIGURED:
    "This Project has no required-key baseline to clear.",
  CONFIGURATION_PREVIEW_INVALID: "Review is no longer available.",
  CONFIGURATION_STALE:
    "The Project or its requirements changed. Review them again.",
  CONFIGURATION_TARGET_UNAVAILABLE: "The selected Project is unavailable.",
  VAULT_SESSION_CLOSING: "The Vault is closing.",
  VAULT_SESSION_LOCKED: "Unlock the Vault to continue.",
};

export const safeMessage = (
  error: { code?: string } | null | undefined
): string =>
  CONFIG_ERROR_MESSAGES[
    // SAFETY: code is validated against the known message table; unknown codes fall back below.
    (error?.code ?? "") as keyof ConfigErrorMessages
  ] || "Configuration operation could not be completed.";

export const failure = (code: string, error: string): ConfigurationFailure => ({
  code,
  error,
  success: false,
});

export const remember = <T>(map: Map<string, T>, key: string, value: T) => {
  map.set(key, value);
  while (map.size > MAX_TRACKED_REVIEWS) {
    const oldest = map.keys().next();
    if (!oldest.done) {
      map.delete(oldest.value);
    }
  }
};

export const canonical = (value: BoundaryValue): string => {
  if (value === null) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (!isRecordValue(value)) {
    return JSON.stringify(value);
  }
  const keys = Object.keys(value);
  keys.sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
};

export const sameTarget = (
  left: ReviewBinding,
  right: ReviewBinding
): boolean =>
  left.transitionId === right.transitionId &&
  left.activeVaultId === right.activeVaultId &&
  left.vaultId === right.vaultId &&
  left.vaultInstanceId === right.vaultInstanceId &&
  left.projectName === right.projectName &&
  left.projectIncarnation === right.projectIncarnation &&
  left.environmentId === right.environmentId &&
  left.environmentName === right.environmentName &&
  left.environmentIncarnation === right.environmentIncarnation;

export const publicTarget = (target: ReviewBinding): ReviewTarget => ({
  environmentId: target.environmentId,
  environmentName: target.environmentName,
  projectName: target.projectName,
  vaultName: target.vaultName,
});

export const baselineIdentity = (
  baseline: ReviewBaseline | null
): BaselineIdentity => ({
  exists: Boolean(baseline),
  revision: baseline?.revision ?? null,
});

export const sameBaselineIdentity = (
  left: BaselineIdentity,
  right: BaselineIdentity
): boolean =>
  Boolean(left && right) &&
  left.exists === right.exists &&
  left.revision === right.revision;

export const describeTarget = (
  session: ReviewSession,
  activeVault: ReviewVault,
  selector: BoundaryValue,
  project: { incarnation: string | null }
): ReviewBinding => {
  const state = session.snapshot();
  const vaultName =
    session.vaultManager
      ?.getVaultList?.()
      // SAFETY: vault list entries carry string ids; find the active Vault name.
      .find(({ id }: { id: string }) => id === state.activeVaultId)?.name ||
    "System";
  const identity = activeVault.getEnvironmentTargetIdentity(selector);
  return {
    activeVaultId: state.activeVaultId,
    environmentId: identity.environmentId,
    environmentIncarnation: identity.environmentIncarnation,
    environmentName: identity.environmentName,
    projectIncarnation: project.incarnation,
    projectName: identity.projectName,
    transitionId: state.transitionId,
    vaultId: activeVault.getVaultId(),
    vaultInstanceId: activeVault.getVaultInstanceId(),
    vaultName,
  };
};

export const describeTargetOrNull = (
  session: ReviewSession,
  activeVault: ReviewVault | null,
  selector: BoundaryValue
): ReviewBinding | null => {
  if (!activeVault) {
    return null;
  }
  try {
    const snapshot = activeVault.getProjectConfigurationBaseline(selector);
    if (!snapshot.exists) {
      return null;
    }
    return describeTarget(session, activeVault, selector, snapshot);
  } catch {
    return null;
  }
};

/**
 * A captured binding whose target no longer resolves (delete/recreate) can
 * never match again, so it is reported as a stale review instead of being
 * compared against another Environment.
 */
export const sameBindingTarget = (
  session: ReviewSession,
  activeVault: ReviewVault,
  selector: BoundaryValue,
  baselineIdentityValue: BaselineIdentity
): boolean => {
  try {
    const current = activeVault.getProjectConfigurationBaseline(selector);
    if (!current.exists) {
      return false;
    }
    return sameBaselineIdentity(
      baselineIdentityValue,
      baselineIdentity(current.configurationBaseline)
    );
  } catch {
    return false;
  }
};

export const assertFresh: (
  state: ConfigCoordinatorState,
  activeVault: ReviewVault | null,
  review: ConfigurationReview
) => asserts activeVault is ReviewVault = (state, activeVault, review) => {
  if (review.generation !== state.generation) {
    throw safeError("CONFIGURATION_PREVIEW_INVALID");
  }
  const sessionState = state.session.snapshot();
  if (sessionState.state !== "active") {
    throw safeError(
      sessionState.state === "closing"
        ? "VAULT_SESSION_CLOSING"
        : "VAULT_SESSION_LOCKED"
    );
  }
  if (!activeVault || activeVault.isLocked) {
    throw safeError("CONFIGURATION_TARGET_UNAVAILABLE");
  }
  // A target that no longer resolves (Vault switch, Project/Environment
  // deleted or recreated) is stale, never another Environment.
  const currentTarget = describeTargetOrNull(
    state.session,
    activeVault,
    review.selector
  );
  if (!currentTarget || !sameTarget(review.target, currentTarget)) {
    throw safeError("CONFIGURATION_STALE");
  }
  const bindingIdentity = sameBindingTarget(
    state.session,
    activeVault,
    review.selector,
    review.baselineIdentity
  );
  if (!bindingIdentity) {
    throw safeError("CONFIGURATION_STALE");
  }
  const current = activeVault.getProjectConfigurationBaseline(review.selector);
  if (!current.exists || current.incarnation !== review.incarnation) {
    throw safeError("CONFIGURATION_STALE");
  }
  const snapshot = activeVault.getImportProjectSnapshot(
    review.selector,
    Object.keys(review.secrets)
  );
  if (
    !snapshot.exists ||
    Object.keys(review.secrets).some(
      (key) =>
        canonical(
          // SAFETY: freshness compares canonical Vault snapshots; both sides are internal validated records.
          (snapshot.secrets as Record<string, BoundaryValue>)[key]
        ) !== canonical(review.secrets[key])
    )
  ) {
    throw safeError("CONFIGURATION_STALE");
  }
};

export const expireHandles = (
  state: ConfigCoordinatorState,
  handle: BoundaryValue
) => {
  if (!isStringValue(handle)) {
    return;
  }
  state.handles.delete(handle);
  state.bindings.delete(handle);
};

export const captureBinding = async (
  state: ConfigCoordinatorState,
  target: ConfigTargetInput
): Promise<{ success: true; binding: string } | ConfigurationFailure> => {
  if (!validConfigTarget(target)) {
    return failure(
      "CONFIGURATION_INVALID_TARGET",
      "Choose a valid Project and Environment."
    );
  }
  const { generation } = state;
  try {
    const binding = await state.session.withActiveSession(
      ({ activeVault }: { activeVault: ReviewVault | null }) => {
        if (!activeVault || activeVault.isLocked) {
          throw safeError("CONFIGURATION_TARGET_UNAVAILABLE");
        }
        const baseline = activeVault.getProjectConfigurationBaseline(target);
        if (!baseline.exists) {
          throw safeError("CONFIGURATION_TARGET_UNAVAILABLE");
        }
        const identity = describeTarget(
          state.session,
          activeVault,
          target,
          baseline
        );
        const handle = randomHandle();
        remember(state.bindings, handle, {
          baselineIdentity: baselineIdentity(baseline.configurationBaseline),
          generation,
          target: identity,
        });
        return handle;
      }
    );
    if (generation !== state.generation) {
      state.bindings.delete(binding);
      throw safeError("CONFIGURATION_PREVIEW_INVALID");
    }
    return { binding, success: true };
  } catch (error) {
    // SAFETY: coordinator failures carry a machine-readable code; unknown throws fall back to unavailable.
    const { code } = error as CodedError;
    return failure(
      code || "CONFIGURATION_TARGET_UNAVAILABLE",
      safeMessage({ code })
    );
  }
};
