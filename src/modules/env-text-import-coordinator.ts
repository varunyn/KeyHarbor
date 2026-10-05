import type { ReviewVault, ReviewSession } from "./review-contracts";

const crypto = require("node:crypto");
const fs = require("node:fs");
const { TextDecoder } = require("node:util");
const { parseEnvironmentText, MAX_INPUT_BYTES } = require("./env-text-parser");

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const ACTIONS = new Set(["add", "replace", "skip"]);
const MAX_TRACKED_REVIEWS = 8;

const validateDecisions = (
  entries: Map<string, ImportOccurrence[]>,
  decisions: unknown
): ImportDecision[] | null => {
  if (!Array.isArray(decisions) || decisions.length !== entries.size) {
    return null;
  }
  const seen = new Set<string>();
  const normalized: ImportDecision[] = [];
  for (const decision of decisions) {
    if (
      !decision ||
      typeof decision !== "object" ||
      !KEY_PATTERN.test(decision.key) ||
      !entries.has(decision.key) ||
      seen.has(decision.key)
    ) {
      return null;
    }
    if (!ACTIONS.has(decision.action)) {
      return null;
    }
    const occurrences = entries.get(decision.key);
    if (!occurrences) {
      return null;
    }
    if (
      decision.action === "skip" &&
      (decision.occurrenceId === null || decision.occurrenceId === undefined)
    ) {
      normalized.push({
        action: "skip",
        key: decision.key,
        occurrenceId: null,
      });
    } else {
      if (
        typeof decision.occurrenceId !== "string" ||
        !occurrences.some(({ id }) => id === decision.occurrenceId)
      ) {
        return null;
      }
      if (
        occurrences.length > 1 &&
        decision.action !== "skip" &&
        !decision.occurrenceId
      ) {
        return null;
      }
      normalized.push({
        action: decision.action,
        key: decision.key,
        occurrenceId: decision.occurrenceId,
      });
    }
    seen.add(decision.key);
  }
  return seen.size === entries.size ? normalized : null;
};

const validChoice = (key: unknown, occurrenceId: unknown): key is string =>
  typeof key === "string" &&
  KEY_PATTERN.test(key) &&
  typeof occurrenceId === "string";

const validProjectName = (name: unknown): name is string =>
  typeof name === "string" && name.trim().length > 0 && name.length <= 256;

const validTarget = (
  target: unknown
): target is { projectName: string; environmentId: string } => {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    return false;
  }
  const candidate = target as Record<string, unknown>;
  return (
    validProjectName(candidate.projectName) &&
    typeof candidate.environmentId === "string" &&
    candidate.environmentId.length > 0 &&
    !Object.hasOwn(candidate, "environmentName")
  );
};

const publicTarget = (target: TargetBinding): ReviewTargetShape => ({
  environmentId: target.environmentId,
  environmentName: target.environmentName,
  projectName: target.projectName,
  vaultName: target.vaultName,
});

const currentValue = (secret: unknown): string | undefined =>
  typeof secret === "string"
    ? secret
    : (secret as { value?: string } | null)?.value;

const randomHandle = (): string => crypto.randomBytes(32).toString("base64url");

const safeError = (code: string): Error => {
  const error = new Error(code);
  error.code = code;
  return error;
};

const readLimitedFile = async (filePath: string) => {
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

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  const keys = Object.keys(value);
  keys.sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
};

const sameTarget = (a: TargetBinding, b: TargetBinding): boolean =>
  a.transitionId === b.transitionId &&
  a.activeVaultId === b.activeVaultId &&
  a.vaultId === b.vaultId &&
  a.vaultInstanceId === b.vaultInstanceId &&
  a.projectName === b.projectName &&
  a.projectIncarnation === b.projectIncarnation &&
  a.environmentId === b.environmentId &&
  a.environmentName === b.environmentName &&
  a.environmentIncarnation === b.environmentIncarnation;

const safeErrorMessage = (
  error: { code?: string } | null | undefined
): string =>
  (
    ({
      IMPORT_INVALID_SELECTION: "Review choices are invalid.",
      IMPORT_PREVIEW_INVALID: "Review is no longer available.",
      IMPORT_STALE: "Target changed. Review the import again.",
      IMPORT_TARGET_UNAVAILABLE: "The selected Project is unavailable.",
      VAULT_SESSION_CLOSING: "The Vault is closing.",
      VAULT_SESSION_LOCKED: "Unlock the Vault to continue.",
    }) as Record<string, string>
  )[error?.code ?? ""] || "Import could not be completed.";

const failure = (code: string, error: string): ImportFailure => ({
  code,
  error,
  success: false,
});

const remember = <T>(map: Map<string, T>, key: string, value: T) => {
  map.set(key, value);
  while (map.size > MAX_TRACKED_REVIEWS) {
    const oldest = map.keys().next();
    if (!oldest.done) {
      map.delete(oldest.value);
    }
  }
};

/** Public review target: identity plus display labels, never persisted. */
interface ReviewTargetShape {
  vaultName: string;
  projectName: string;
  environmentId: string;
  environmentName: string;
}

type ImportOccurrenceStatus = "new" | "identical" | "changed";

interface ImportOccurrence {
  id: string;
  line: number;
  empty: boolean;
  status: ImportOccurrenceStatus;
  defaultAction: "add" | "skip";
  value: string;
}

type ImportDecisionAction = "add" | "replace" | "skip";

interface ImportDecision {
  key: string;
  occurrenceId: string | null;
  action: ImportDecisionAction;
}

interface ImportPreviewEntry {
  key: string;
  occurrences: Omit<ImportOccurrence, "value">[];
  duplicate: boolean;
}

interface ImportFailure {
  success: false;
  code: string;
  error: string;
  cancelled?: boolean;
}

type ImportPreviewResult =
  | (ImportFailure & { cancelled?: boolean })
  | {
      success: true;
      handle: string | null;
      target: ReviewTargetShape | null;
      entries: ImportPreviewEntry[];
      diagnostics: { line: number; code: string; message: string }[];
    };

type ImportCommitResult =
  | {
      success: true;
      count: number;
      added: number;
      replaced: number;
      skipped: number;
    }
  | ImportFailure;

/**
 * Identity binding captured before native selection. It includes the
 * Environment ID, name and incarnation so a rename, delete or recreate in a
 * different Environment never silently retargets an outstanding review.
 */
interface TargetBinding {
  transitionId: number | string;
  activeVaultId: string | null;
  vaultId: string | null;
  vaultInstanceId: string | null;
  projectName: string;
  projectIncarnation: string | null;
  environmentId: string;
  environmentName: string;
  environmentIncarnation: string | null;
  vaultName: string;
}

interface ImportPreview {
  target: TargetBinding;
  projectName: string;
  projectIncarnation: string | null;
  environmentIncarnation: string | null;
  generation: number;
  selector: { projectName: string; environmentId: string };
  secrets: Record<string, unknown>;
  entries: Map<string, ImportOccurrence[]>;
}

const validInput = (
  input: unknown
): input is {
  source: "text" | "file";
  content?: unknown;
  filePath?: unknown;
} =>
  Boolean(
    input &&
    typeof input === "object" &&
    ["text", "file"].includes((input as { source?: string }).source ?? "")
  );
const validFilePath = (filePath: unknown): filePath is string =>
  typeof filePath === "string" && filePath.length > 0;

// Class and type-only namespace intentionally share the exported name.
// eslint-disable-next-line no-redeclare
class EnvTextImportCoordinator {
  session: ReviewSession;
  _previews: Map<string, ImportPreview>;
  _targetBindings: Map<string, TargetBinding>;
  _generation: number;

  constructor({ session }: { session?: ReviewSession } = {}) {
    if (!session || typeof session.withActiveSession !== "function") {
      throw new TypeError("session is required");
    }
    this.session = session;
    this._previews = new Map();
    this._targetBindings = new Map();
    this._generation = 0;
  }

  /** Captures Environment identity before the native file picker opens. */
  async captureTarget(
    target: unknown
  ): Promise<{ success: true; binding: string } | ImportFailure> {
    if (!validTarget(target)) {
      return failure(
        "IMPORT_INVALID_TARGET",
        "Choose a valid Project and Environment."
      );
    }
    const generation = this._generation;
    try {
      const binding = await this.session.withActiveSession(
        ({ activeVault }: { activeVault: ReviewVault | null }) => {
          if (!activeVault || activeVault.isLocked) {
            throw safeError("IMPORT_TARGET_UNAVAILABLE");
          }
          const project = activeVault.getImportProjectSnapshot(target, []);
          if (!project.exists) {
            throw safeError("IMPORT_TARGET_UNAVAILABLE");
          }
          const identity = this._targetDescriptor(activeVault, target, project);
          const handle = randomHandle();
          remember(this._targetBindings, handle, identity);
          return handle;
        }
      );
      if (generation !== this._generation) {
        this._targetBindings.delete(binding);
        return failure("IMPORT_PREVIEW_INVALID", "Import was closed.");
      }
      return { binding, success: true };
    } catch (error) {
      return failure(
        error.code || "VAULT_SESSION_LOCKED",
        safeErrorMessage(error)
      );
    }
  }

  async preview(
    target: unknown,
    input: unknown,
    targetBinding?: unknown
  ): Promise<ImportPreviewResult> {
    const projectName = validTarget(target) ? target.projectName : "";
    const candidate = input as {
      source?: unknown;
      content?: unknown;
      filePath?: unknown;
    } | null;
    const generation = this._generation;
    const abandonBinding = () => {
      if (typeof targetBinding === "string") {
        this._targetBindings.delete(targetBinding);
      }
    };
    if (!validTarget(target)) {
      abandonBinding();
      return failure(
        "IMPORT_INVALID_TARGET",
        "Choose a valid Project and Environment."
      );
    }
    if (!validInput(candidate)) {
      abandonBinding();
      return failure(
        "IMPORT_INVALID_INPUT",
        "Choose text or a file to import."
      );
    }

    let content;
    try {
      if (candidate.source === "text") {
        if (typeof candidate.content !== "string") {
          abandonBinding();
          return failure("IMPORT_INVALID_INPUT", "Input must be text.");
        }
        if (Buffer.byteLength(candidate.content, "utf-8") > MAX_INPUT_BYTES) {
          abandonBinding();
          return failure(
            "IMPORT_INPUT_TOO_LARGE",
            "Input exceeds the 1 MiB limit."
          );
        }
        ({ content } = candidate);
      } else {
        if (!validFilePath(candidate.filePath)) {
          abandonBinding();
          return failure("IMPORT_INVALID_INPUT", "Choose a valid file.");
        }
        const bytes = await readLimitedFile(candidate.filePath);
        content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      }
    } catch (error) {
      abandonBinding();
      if (error.code === "IMPORT_INVALID_FILE") {
        return failure(error.code, "Choose a regular file.");
      }
      if (error.code === "IMPORT_INPUT_TOO_LARGE") {
        return failure(error.code, "File exceeds the 1 MiB limit.");
      }
      if (error instanceof TypeError) {
        return failure(
          "IMPORT_INVALID_UTF8",
          "File must contain valid UTF-8 text."
        );
      }
      return failure(
        "IMPORT_FILE_READ_FAILED",
        "The selected file could not be read."
      );
    }

    if (generation !== this._generation) {
      abandonBinding();
      return failure("IMPORT_PREVIEW_INVALID", "Import was closed.");
    }

    const parsed = parseEnvironmentText(content);
    if (parsed.diagnostics.length > 0) {
      abandonBinding();
      return {
        diagnostics: parsed.diagnostics,
        entries: [],
        handle: null,
        success: true,
        target: null,
      };
    }

    try {
      const result = await this.session.withActiveSession(
        ({ activeVault }: { activeVault: ReviewVault | null }) => {
          if (!activeVault || activeVault.isLocked) {
            throw safeError("IMPORT_TARGET_UNAVAILABLE");
          }
          // A target captured before native selection that no longer resolves
          // (delete/recreate) is a stale review, never an unresolved default.
          let targetIdentity: TargetBinding | null = null;
          if (targetBinding !== undefined) {
            const binding = this._targetBindings.get(targetBinding as string);
            this._targetBindings.delete(targetBinding as string);
            if (!binding) {
              throw safeError("IMPORT_STALE");
            }
            targetIdentity = this._targetDescriptorOrNull(
              activeVault,
              target,
              binding.projectIncarnation
            );
            if (!targetIdentity || !sameTarget(binding, targetIdentity)) {
              throw safeError("IMPORT_STALE");
            }
          }
          const snapshot = activeVault.getImportProjectSnapshot(target, [
            ...new Set<string>(
              parsed.assignments.map(({ key }: { key: string }) => key)
            ),
          ]);
          if (!snapshot.exists) {
            throw safeError("IMPORT_TARGET_UNAVAILABLE");
          }
          if (!targetIdentity) {
            targetIdentity = this._targetDescriptor(
              activeVault,
              target,
              snapshot
            );
          }
          if (generation !== this._generation) {
            throw safeError("IMPORT_PREVIEW_INVALID");
          }
          const grouped = new Map<string, ImportOccurrence[]>();
          for (const assignment of parsed.assignments) {
            let occurrences = grouped.get(assignment.key);
            if (!occurrences) {
              occurrences = [];
              grouped.set(assignment.key, occurrences);
            }
            const current = snapshot.secrets[assignment.key];
            let status: ImportOccurrenceStatus = "changed";
            if (current === null) {
              status = "new";
            } else if (currentValue(current) === assignment.value) {
              status = "identical";
            }
            occurrences.push({
              defaultAction:
                status === "new" && assignment.value.length > 0
                  ? "add"
                  : "skip",
              empty: assignment.value.length === 0,
              id: randomHandle(),
              line: assignment.line,
              status,
              value: assignment.value,
            });
          }
          const entries: ImportPreviewEntry[] = [...grouped.entries()].map(
            ([key, occurrences]) => ({
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
            })
          );
          const handle = randomHandle();
          remember(this._previews, handle, {
            entries: new Map(
              [...grouped].map(([key, occurrences]) => [key, occurrences])
            ),
            environmentIncarnation: snapshot.environmentIncarnation,
            generation,
            projectIncarnation: snapshot.incarnation,
            projectName,
            secrets: snapshot.secrets,
            selector: { ...target },
            target: targetIdentity,
          });
          return {
            diagnostics: [],
            entries,
            handle,
            success: true,
            target: publicTarget(targetIdentity),
          } as ImportPreviewResult;
        }
      );
      if (generation !== this._generation) {
        if (result?.success && result.handle) {
          this._expire(result.handle);
        }
        abandonBinding();
        return failure("IMPORT_PREVIEW_INVALID", "Import was closed.");
      }
      return result;
    } catch (error) {
      abandonBinding();
      return failure(
        error.code || "IMPORT_TARGET_UNAVAILABLE",
        safeErrorMessage(error)
      );
    }
  }

  /** Reveal freshness: any relevant drift, including Environment identity, expires the review. */
  async reveal(
    handle: unknown,
    key: unknown,
    occurrenceId: unknown
  ): Promise<{ success: true; value: string } | ImportFailure> {
    const preview =
      typeof handle === "string" ? this._previews.get(handle) : undefined;
    if (!preview || !validChoice(key, occurrenceId)) {
      return failure(
        "IMPORT_PREVIEW_INVALID",
        "Review is no longer available."
      );
    }
    const occurrence = preview.entries
      .get(key as string)
      ?.find((item) => item.id === occurrenceId);
    if (!occurrence) {
      return failure(
        "IMPORT_INVALID_SELECTION",
        "Choose an entry from the current review."
      );
    }
    try {
      return await this.session.withActiveSession(
        ({ activeVault }: { activeVault: ReviewVault | null }) => {
          this._assertFresh(activeVault, preview);
          return { success: true, value: occurrence.value };
        }
      );
    } catch (error) {
      this._expire(handle);
      return failure(error.code || "IMPORT_STALE", safeErrorMessage(error));
    }
  }

  async commit(
    handle: unknown,
    decisions: unknown
  ): Promise<ImportCommitResult> {
    const preview =
      typeof handle === "string" ? this._previews.get(handle) : undefined;
    if (!preview) {
      return failure(
        "IMPORT_PREVIEW_INVALID",
        "Review is no longer available."
      );
    }
    const normalized = validateDecisions(preview.entries, decisions);
    if (!normalized) {
      return failure("IMPORT_INVALID_SELECTION", "Review choices are invalid.");
    }
    this._previews.delete(handle as string);
    try {
      const result = await this.session.withActiveSession(
        async ({ activeVault }: { activeVault: ReviewVault | null }) => {
          this._assertFresh(activeVault, preview);
          const selected: {
            key: string;
            value: string;
            action: "add" | "replace";
          }[] = [];
          for (const decision of normalized) {
            if (decision.action === "skip") {
              continue;
            }
            const occurrence = preview.entries
              .get(decision.key)
              ?.find(({ id }) => id === decision.occurrenceId);
            if (!occurrence) {
              throw safeError("IMPORT_INVALID_SELECTION");
            }
            const { status } = occurrence;
            if (
              (decision.action === "add" && status !== "new") ||
              (decision.action === "replace" && status !== "changed")
            ) {
              throw safeError("IMPORT_INVALID_SELECTION");
            }
            selected.push({
              action: decision.action,
              key: decision.key,
              value: occurrence.value,
            });
          }
          if (selected.length > 0) {
            // The queued mutation revalidates Environment identity immediately
            // before writing, not only when the review was created.
            await activeVault.applySecretImportBatch(
              preview.selector,
              selected,
              {
                environmentIncarnation: preview.environmentIncarnation,
                incarnation: preview.projectIncarnation,
                secrets: preview.secrets,
                validateTarget: () => this._assertFresh(activeVault, preview),
              }
            );
          }
          const added = selected.filter(
            ({ action }) => action === "add"
          ).length;
          const replaced = selected.filter(
            ({ action }) => action === "replace"
          ).length;
          return {
            added,
            count: selected.length,
            replaced,
            skipped: preview.entries.size - selected.length,
            success: true,
          } as ImportCommitResult;
        }
      );
      return result;
    } catch (error) {
      return failure(error.code || "IMPORT_FAILED", safeErrorMessage(error));
    }
  }

  // Keep the public Promise API, including rejection of synchronous failures.
  // eslint-disable-next-line require-await
  async discard(handle: unknown): Promise<{ success: true }> {
    this._expire(handle);
    return { success: true };
  }

  clear() {
    this._generation += 1;
    this._previews.clear();
    this._targetBindings.clear();
  }

  /**
   * Identity when the target still resolves, otherwise null. Delete/recreate of
   * the Project or Environment yields null so callers report a stale review
   * instead of leaking a raw resolution error or falling back to a default.
   */
  _targetDescriptorOrNull(
    activeVault: ReviewVault | null,
    selector: unknown,
    _projectIncarnation: string | null
  ): TargetBinding | null {
    if (!activeVault) {
      return null;
    }
    try {
      const snapshot = activeVault.getImportProjectSnapshot(selector, []);
      if (!snapshot.exists) {
        return null;
      }
      return this._targetDescriptor(activeVault, selector, snapshot);
    } catch {
      return null;
    }
  }

  _targetDescriptor(
    activeVault: ReviewVault,
    selector: unknown,
    project: { incarnation: string | null }
  ): TargetBinding {
    const state = this.session.snapshot();
    const vaultName =
      this.session.vaultManager
        ?.getVaultList?.()
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
  }

  _assertFresh(
    activeVault: ReviewVault | null,
    preview: ImportPreview
  ): asserts activeVault is ReviewVault {
    if (preview.generation !== this._generation) {
      throw safeError("IMPORT_PREVIEW_INVALID");
    }
    const sessionState = this.session.snapshot();
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
    const currentTarget = this._targetDescriptorOrNull(
      activeVault,
      preview.selector,
      preview.projectIncarnation
    );
    if (!currentTarget || !sameTarget(preview.target, currentTarget)) {
      throw safeError("IMPORT_STALE");
    }
    const snapshot = activeVault.getImportProjectSnapshot(preview.selector, [
      ...preview.entries.keys(),
    ]);
    if (
      !snapshot.exists ||
      snapshot.incarnation !== preview.projectIncarnation
    ) {
      throw safeError("IMPORT_STALE");
    }
    for (const key of preview.entries.keys()) {
      if (
        canonical(snapshot.secrets[key]) !== canonical(preview.secrets[key])
      ) {
        throw safeError("IMPORT_STALE");
      }
    }
  }

  _expire(handle: unknown) {
    if (typeof handle !== "string") {
      return;
    }
    this._previews.delete(handle);
    this._targetBindings.delete(handle);
  }
}

// Type-only namespace preserves the existing CommonJS public type API.
// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace EnvTextImportCoordinator {
  export interface Target {
    projectName: string;
    environmentId: string;
  }
  export type ReviewTarget = ReviewTargetShape;
  export type Decision = ImportDecision;
  export type Failure = ImportFailure;
  export type PreviewResult = ImportPreviewResult;
  export type CommitResult = ImportCommitResult;
}

export = EnvTextImportCoordinator;
