import type {
  BoundaryValue,
  CodedError,
  ImportCoordinatorState,
  ImportFailure,
  ImportOccurrence,
  ImportPreview,
  ImportPreviewEntry,
  ImportTargetInput,
  ReviewTarget,
  TargetBinding,
} from "./env-text-import-types";
import {
  isRecordValue,
  isStringValue,
  validTarget,
} from "./env-text-import-validation";
import type { ReviewSession, ReviewVault } from "./review-contracts";

const crypto = require("node:crypto");
const fs = require("node:fs");
const { TextDecoder } = require("node:util");
const { parseEnvironmentText, MAX_INPUT_BYTES } = require("./env-text-parser");

export { MAX_INPUT_BYTES };

export const MAX_TRACKED_REVIEWS = 8;

interface ImportErrorMessages {
  IMPORT_INVALID_SELECTION: string;
  IMPORT_PREVIEW_INVALID: string;
  IMPORT_STALE: string;
  IMPORT_TARGET_UNAVAILABLE: string;
  VAULT_SESSION_CLOSING: string;
  VAULT_SESSION_LOCKED: string;
}

const IMPORT_ERROR_MESSAGES: ImportErrorMessages = {
  IMPORT_INVALID_SELECTION: "Review choices are invalid.",
  IMPORT_PREVIEW_INVALID: "Review is no longer available.",
  IMPORT_STALE: "Target changed. Review the import again.",
  IMPORT_TARGET_UNAVAILABLE: "The selected Project is unavailable.",
  VAULT_SESSION_CLOSING: "The Vault is closing.",
  VAULT_SESSION_LOCKED: "Unlock the Vault to continue.",
};

export const randomHandle = (): string =>
  crypto.randomBytes(32).toString("base64url");

export const safeError = (code: string): CodedError => {
  // SAFETY: Error.code is an established Node/CommonJS extension used as a machine-readable failure key.
  const error = new Error(code) as CodedError;
  error.code = code;
  return error;
};

export const readLimitedFile = async (filePath: string) => {
  // Node file-open flags require a bitmask; nonblocking avoids hanging on special files.
  // eslint-disable-next-line no-bitwise
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0);
  const file = await fs.promises.open(filePath, flags);
  try {
    const stats = await file.stat();
    if (!stats.isFile()) {
      throw safeError("IMPORT_INVALID_FILE");
    }
    if (stats.size > MAX_INPUT_BYTES) {
      throw safeError("IMPORT_INPUT_TOO_LARGE");
    }
    const chunks: Buffer[] = [];
    let total = 0;
    let position = 0;
    while (total <= MAX_INPUT_BYTES) {
      const buffer = Buffer.alloc(
        Math.min(64 * 1024, MAX_INPUT_BYTES + 1 - total)
      );
      // Each bounded read advances this file offset; parallel reads would race the limit.
      // eslint-disable-next-line no-await-in-loop
      const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) {
        break;
      }
      chunks.push(buffer.subarray(0, bytesRead));
      total += bytesRead;
      position += bytesRead;
    }
    return Buffer.concat(chunks, total);
  } finally {
    await file.close();
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

export const sameTarget = (a: TargetBinding, b: TargetBinding): boolean =>
  a.transitionId === b.transitionId &&
  a.activeVaultId === b.activeVaultId &&
  a.vaultId === b.vaultId &&
  a.vaultInstanceId === b.vaultInstanceId &&
  a.projectName === b.projectName &&
  a.projectIncarnation === b.projectIncarnation &&
  a.environmentId === b.environmentId &&
  a.environmentName === b.environmentName &&
  a.environmentIncarnation === b.environmentIncarnation;

export const safeErrorMessage = (
  error: { code?: string } | null | undefined
): string =>
  IMPORT_ERROR_MESSAGES[
    // SAFETY: code is validated against the known message table; unknown codes fall back below.
    (error?.code ?? "") as keyof typeof IMPORT_ERROR_MESSAGES
  ] || "Import could not be completed.";

export const failure = (code: string, error: string): ImportFailure => ({
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

export const publicTarget = (target: TargetBinding): ReviewTarget => ({
  environmentId: target.environmentId,
  environmentName: target.environmentName,
  projectName: target.projectName,
  vaultName: target.vaultName,
});

export const currentValue = (secret: BoundaryValue): string | undefined => {
  if (isStringValue(secret)) {
    return secret;
  }
  // SAFETY: non-string snapshots are either null or objects carrying an optional value field.
  return (secret as { value?: string } | null)?.value;
};

export const decodeFileBytes = (bytes: Buffer): string =>
  new TextDecoder("utf-8", { fatal: true }).decode(bytes);

export const parseImportContent = (content: string) =>
  parseEnvironmentText(content);

export const describeTarget = (
  session: ReviewSession,
  activeVault: ReviewVault,
  selector: BoundaryValue,
  project: { incarnation: string | null }
): TargetBinding => {
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
): TargetBinding | null => {
  if (!activeVault) {
    return null;
  }
  try {
    const snapshot = activeVault.getImportProjectSnapshot(selector, []);
    if (!snapshot.exists) {
      return null;
    }
    return describeTarget(session, activeVault, selector, snapshot);
  } catch {
    return null;
  }
};

export const assertPreviewFresh: (
  state: ImportCoordinatorState,
  activeVault: ReviewVault | null,
  preview: ImportPreview
) => asserts activeVault is ReviewVault = (state, activeVault, preview) => {
  if (preview.generation !== state.generation) {
    throw safeError("IMPORT_PREVIEW_INVALID");
  }
  const sessionState = state.session.snapshot();
  if (sessionState.state !== "active") {
    throw safeError(
      sessionState.state === "closing"
        ? "VAULT_SESSION_CLOSING"
        : "VAULT_SESSION_LOCKED"
    );
  }
  // A target that no longer resolves (Vault switch, Project/Environment deleted or
  // recreated) is stale; it must never resolve to another collection.
  if (!activeVault || activeVault.isLocked) {
    throw safeError("IMPORT_STALE");
  }
  const currentTarget = describeTargetOrNull(
    state.session,
    activeVault,
    preview.selector
  );
  if (!currentTarget || !sameTarget(preview.target, currentTarget)) {
    throw safeError("IMPORT_STALE");
  }
  const snapshot = activeVault.getImportProjectSnapshot(preview.selector, [
    ...preview.entries.keys(),
  ]);
  if (!snapshot.exists || snapshot.incarnation !== preview.projectIncarnation) {
    throw safeError("IMPORT_STALE");
  }
  for (const key of preview.entries.keys()) {
    // SAFETY: freshness compares canonical Vault snapshots; both sides are internal validated records.
    const current = (snapshot.secrets as Record<string, BoundaryValue>)[key];
    const previous = preview.secrets[key];
    if (canonical(current) !== canonical(previous)) {
      throw safeError("IMPORT_STALE");
    }
  }
};

export const expireHandle = (
  state: ImportCoordinatorState,
  handle: BoundaryValue
) => {
  if (!isStringValue(handle)) {
    return;
  }
  state.folderScans.delete(handle);
  state.previews.delete(handle);
  state.targetBindings.delete(handle);
};

export const captureTargetBinding = async (
  state: ImportCoordinatorState,
  target: ImportTargetInput
): Promise<{ success: true; binding: string } | ImportFailure> => {
  if (!validTarget(target)) {
    return failure(
      "IMPORT_INVALID_TARGET",
      "Choose a valid Project and Environment."
    );
  }
  const { generation } = state;
  try {
    const binding = await state.session.withActiveSession(
      ({ activeVault }: { activeVault: ReviewVault | null }) => {
        if (!activeVault || activeVault.isLocked) {
          throw safeError("IMPORT_TARGET_UNAVAILABLE");
        }
        const project = activeVault.getImportProjectSnapshot(target, []);
        if (!project.exists) {
          throw safeError("IMPORT_TARGET_UNAVAILABLE");
        }
        const identity = describeTarget(
          state.session,
          activeVault,
          target,
          project
        );
        const handle = randomHandle();
        remember(state.targetBindings, handle, identity);
        return handle;
      }
    );
    if (generation !== state.generation) {
      state.targetBindings.delete(binding);
      return failure("IMPORT_PREVIEW_INVALID", "Import was closed.");
    }
    return { binding, success: true };
  } catch (error) {
    // SAFETY: coordinator failures carry a machine-readable code; unknown throws fall back to locked.
    const { code } = error as CodedError;
    return failure(code || "VAULT_SESSION_LOCKED", safeErrorMessage({ code }));
  }
};

export const buildPreviewEntries = (
  grouped: Map<string, ImportOccurrence[]>
): ImportPreviewEntry[] =>
  [...grouped.entries()].map(([key, occurrences]) => ({
    duplicate: occurrences.length > 1,
    key,
    occurrences: occurrences.map(
      ({ id, line, empty, status, defaultAction }) => ({
        defaultAction,
        empty,
        id,
        line,
        status,
      })
    ),
  }));

export interface ImportAssignment {
  key: string;
  value: string;
  line: number;
}

export const buildGroupedOccurrences = (
  assignments: readonly ImportAssignment[],
  secrets: Record<string, BoundaryValue>
): Map<string, ImportOccurrence[]> => {
  const grouped = new Map<string, ImportOccurrence[]>();
  for (const assignment of assignments) {
    let occurrences = grouped.get(assignment.key);
    if (!occurrences) {
      occurrences = [];
      grouped.set(assignment.key, occurrences);
    }
    const current = secrets[assignment.key];
    let status: ImportOccurrence["status"] = "changed";
    if (current === null) {
      status = "new";
    } else if (currentValue(current) === assignment.value) {
      status = "identical";
    }
    occurrences.push({
      defaultAction:
        status === "new" && assignment.value.length > 0 ? "add" : "skip",
      empty: assignment.value.length === 0,
      id: randomHandle(),
      line: assignment.line,
      status,
      value: assignment.value,
    });
  }
  return grouped;
};
