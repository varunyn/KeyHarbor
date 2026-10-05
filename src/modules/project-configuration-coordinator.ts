import type {
  ReviewVault,
  ReviewSession,
  ReviewBaseline,
  ReviewBaselineSnapshot,
} from "./review-contracts";

const crypto = require("node:crypto");
const fs = require("node:fs");
const { TextDecoder } = require("node:util");
const { parseEnvironmentText, MAX_INPUT_BYTES } = require("./env-text-parser");
const { normalizeRequiredKeys } = require("./project-configuration-baseline");

const MAX_TRACKED_REVIEWS = 8;

const safeError = (code: string): Error => {
  const error = new Error(code);
  error.code = code;
  return error;
};

const evaluateSnapshot = (
  requiredKeys: string[],
  secrets: Record<string, unknown>,
  nowValue: Date
) => {
  const evaluated = nowValue instanceof Date ? nowValue : new Date(nowValue);
  const evaluatedMs = evaluated.getTime();
  if (!Number.isFinite(evaluatedMs)) {
    throw safeError("CONFIGURATION_EVALUATION_FAILED");
  }
  const entries: { key: string; status: ConfigurationStatus }[] = [];
  const counts = {
    empty: 0,
    expired: 0,
    missing: 0,
    ready: 0,
    required: requiredKeys.length,
  };
  let nextExpiryMs = Infinity;
  for (const key of requiredKeys) {
    if (!Object.hasOwn(secrets, key) || secrets[key] === null) {
      entries.push({ key, status: "Missing" });
      counts.missing += 1;
      continue;
    }
    const storedSecret = secrets[key];
    const secret =
      typeof storedSecret === "string"
        ? { expiresAt: null, value: storedSecret }
        : (storedSecret as { value: string; expiresAt?: string | null });
    if (
      !secret ||
      typeof secret !== "object" ||
      typeof secret.value !== "string"
    ) {
      throw safeError("CONFIGURATION_EVALUATION_FAILED");
    }
    const { expiresAt } = secret;
    if (expiresAt !== null && expiresAt !== undefined) {
      if (typeof expiresAt !== "string") {
        throw safeError("CONFIGURATION_EVALUATION_FAILED");
      }
      const expiry = Date.parse(expiresAt);
      if (!Number.isFinite(expiry)) {
        throw safeError("CONFIGURATION_EVALUATION_FAILED");
      }
      if (secret.value.length === 0) {
        entries.push({ key, status: "Empty" });
        counts.empty += 1;
        continue;
      }
      if (expiry <= evaluatedMs) {
        entries.push({ key, status: "Expired" });
        counts.expired += 1;
        continue;
      }
      nextExpiryMs = Math.min(nextExpiryMs, expiry);
    } else if (secret.value.length === 0) {
      entries.push({ key, status: "Empty" });
      counts.empty += 1;
      continue;
    }
    entries.push({ key, status: "Ready" });
    counts.ready += 1;
  }
  return {
    counts,
    entries,
    evaluatedAt: evaluated.toISOString(),
    nextExpiry: Number.isFinite(nextExpiryMs)
      ? new Date(nextExpiryMs).toISOString()
      : null,
  };
};

const publicTarget = (target: ReviewBinding): ReviewTargetShape => ({
  environmentId: target.environmentId,
  environmentName: target.environmentName,
  projectName: target.projectName,
  vaultName: target.vaultName,
});

const evaluate = (
  activeVault: ReviewVault,
  selector: unknown,
  baseline: ReviewBaselineSnapshot & { configurationBaseline: ReviewBaseline },
  target: ReviewBinding,
  now: Date
) => {
  const snapshot = activeVault.getImportProjectSnapshot(
    selector,
    baseline.configurationBaseline.requiredKeys
  );
  const result = evaluateSnapshot(
    baseline.configurationBaseline.requiredKeys,
    snapshot.secrets,
    now
  );
  return {
    configured: true,
    success: true,
    target: publicTarget(target),
    ...result,
  };
};

const baselineIdentity = (
  baseline: ReviewBaseline | null
): BaselineIdentity => ({
  exists: Boolean(baseline),
  revision: baseline?.revision ?? null,
});

const sameBaselineIdentity = (
  left: BaselineIdentity,
  right: BaselineIdentity
): boolean =>
  Boolean(left && right) &&
  left.exists === right.exists &&
  left.revision === right.revision;

const readLimitedFile = (filePath: string) =>
  (async () => {
    let file;
    try {
      // Node file-open flags require a bitmask; nonblocking avoids hanging on special files.
      // eslint-disable-next-line no-bitwise
      const flags = fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0);
      file = await fs.promises.open(filePath, flags);
      const stats = await file.stat();
      if (!stats.isFile()) {
        throw safeError("CONFIGURATION_INVALID_FILE");
      }
      if (stats.size > MAX_INPUT_BYTES) {
        throw safeError("CONFIGURATION_INPUT_TOO_LARGE");
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
        const { bytesRead } = await file.read(
          buffer,
          0,
          buffer.length,
          position
        );
        if (bytesRead === 0) {
          break;
        }
        chunks.push(buffer.subarray(0, bytesRead));
        total += bytesRead;
        position += bytesRead;
      }
      if (total > MAX_INPUT_BYTES) {
        throw safeError("CONFIGURATION_INPUT_TOO_LARGE");
      }
      return Buffer.concat(chunks, total);
    } catch (error) {
      if (error.code?.startsWith("CONFIGURATION_")) {
        throw error;
      }
      throw safeError("CONFIGURATION_FILE_READ_FAILED");
    } finally {
      try {
        await file?.close();
      } catch {
        // Closing is best effort and must not replace a read result or its error.
      }
    }
  })();

const readTemplate = async (input: {
  source: string;
  content?: string;
  filePath?: string;
}) => {
  let content;
  if (input.source === "text") {
    if (typeof input.content !== "string") {
      throw safeError("CONFIGURATION_INVALID_INPUT");
    }
    if (Buffer.byteLength(input.content, "utf-8") > MAX_INPUT_BYTES) {
      throw safeError("CONFIGURATION_INPUT_TOO_LARGE");
    }
    ({ content } = input);
  } else {
    if (typeof input.filePath !== "string" || input.filePath.length === 0) {
      throw safeError("CONFIGURATION_INVALID_INPUT");
    }
    const bytes = await readLimitedFile(input.filePath);
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }
  const parsed = parseEnvironmentText(content);
  if (parsed.diagnostics.length > 0) {
    return {
      diagnostics: parsed.diagnostics.map(
        ({
          line,
          code,
          message,
        }: {
          line: number;
          code: string;
          message: string;
        }) => ({ code, line, message })
      ),
      duplicateNames: 0,
      requiredKeys: [],
    };
  }
  const occurrenceCounts = new Map<string, number>();
  for (const { key } of parsed.assignments) {
    occurrenceCounts.set(key, (occurrenceCounts.get(key) || 0) + 1);
  }
  let requiredKeys: string[];
  try {
    requiredKeys = normalizeRequiredKeys([...occurrenceCounts.keys()]);
  } catch {
    return {
      diagnostics: [
        {
          code: "invalid_template",
          line: 1,
          message: "The template does not contain a valid required-key list.",
        },
      ],
      duplicateNames: 0,
      requiredKeys: [],
    };
  }
  const duplicateNames = [...occurrenceCounts.values()].filter(
    (count) => count > 1
  ).length;
  parsed.assignments.length = 0;
  return { diagnostics: [], duplicateNames, requiredKeys };
};

const sameTarget = (left: ReviewBinding, right: ReviewBinding): boolean =>
  left.transitionId === right.transitionId &&
  left.activeVaultId === right.activeVaultId &&
  left.vaultId === right.vaultId &&
  left.vaultInstanceId === right.vaultInstanceId &&
  left.projectName === right.projectName &&
  left.projectIncarnation === right.projectIncarnation &&
  left.environmentId === right.environmentId &&
  left.environmentName === right.environmentName &&
  left.environmentIncarnation === right.environmentIncarnation;

const validTarget = (
  target: unknown
): target is { projectName: string; environmentId: string } => {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    return false;
  }
  const candidate = target as Record<string, unknown>;
  return (
    typeof candidate.projectName === "string" &&
    candidate.projectName.trim().length > 0 &&
    candidate.projectName.length <= 256 &&
    typeof candidate.environmentId === "string" &&
    candidate.environmentId.length > 0 &&
    !Object.hasOwn(candidate, "environmentName")
  );
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

const randomHandle = (): string => crypto.randomBytes(32).toString("base64url");

const safeMessage = (error: { code?: string } | null | undefined): string =>
  (
    ({
      CONFIGURATION_COMMIT_FAILED: "Required keys could not be saved.",
      CONFIGURATION_EVALUATION_FAILED:
        "Configuration status could not be evaluated safely.",
      CONFIGURATION_FILE_READ_FAILED:
        "The selected template could not be read.",
      CONFIGURATION_INPUT_TOO_LARGE: "Template exceeds the 1 MiB limit.",
      CONFIGURATION_INVALID_FILE: "Choose a regular file.",
      CONFIGURATION_INVALID_INPUT: "Choose text or a valid template file.",
      CONFIGURATION_INVALID_TARGET: "Choose a valid Project.",
      CONFIGURATION_INVALID_UTF8:
        "Template file must contain valid UTF-8 text.",
      CONFIGURATION_NOT_CONFIGURED:
        "This Project has no required-key baseline to clear.",
      CONFIGURATION_PREVIEW_INVALID: "Review is no longer available.",
      CONFIGURATION_STALE:
        "The Project or its requirements changed. Review them again.",
      CONFIGURATION_TARGET_UNAVAILABLE: "The selected Project is unavailable.",
      VAULT_SESSION_CLOSING: "The Vault is closing.",
      VAULT_SESSION_LOCKED: "Unlock the Vault to continue.",
    }) as Record<string, string>
  )[error?.code ?? ""] || "Configuration operation could not be completed.";

const failure = (code: string, error: string): ConfigurationFailure => ({
  code,
  error,
  success: false,
});

interface ReviewTargetShape {
  vaultName: string;
  projectName: string;
  environmentId: string;
  environmentName: string;
}

type ConfigurationStatus = "Ready" | "Missing" | "Empty" | "Expired";

interface BaselineIdentity {
  exists: boolean;
  revision: string | null;
}

/**
 * Identity captured before native selection and revalidated immediately before
 * the queued mutation. Environment ID, name and incarnation are part of it, so
 * a rename, delete or recreate retires the outstanding review.
 */
interface ReviewBinding {
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

interface Review {
  target: ReviewBinding;
  kind: "replace" | "clear";
  selector: { projectName: string; environmentId: string };
  incarnation: string | null;
  environmentIncarnation: string | null;
  baselineIdentity: BaselineIdentity;
  secrets: Record<string, unknown>;
  requiredKeys: string[];
  changeCounts: {
    required: number;
    added: number;
    removed: number;
    unchanged: number;
  };
  generation: number;
}

interface Binding {
  generation: number;
  target: ReviewBinding;
  baselineIdentity: BaselineIdentity;
}

interface ConfigurationFailure {
  success: false;
  code: string;
  error: string;
}

// Class and type-only namespace intentionally share the exported name.
// eslint-disable-next-line no-redeclare
class ProjectConfigurationCoordinator {
  session: ReviewSession;
  now: () => Date;
  _handles: Map<string, Review>;
  _bindings: Map<string, Binding>;
  _generation: number;

  constructor({
    session,
    now = () => new Date(),
  }: { session?: ReviewSession; now?: () => Date } = {}) {
    if (!session || typeof session.withActiveSession !== "function") {
      throw new TypeError("session is required");
    }
    if (typeof now !== "function") {
      throw new TypeError("now must be a function");
    }
    this.session = session;
    this.now = now;
    this._handles = new Map();
    this._bindings = new Map();
    this._generation = 0;
  }

  async get(target: unknown) {
    if (!validTarget(target)) {
      return failure(
        "CONFIGURATION_INVALID_TARGET",
        "Choose a valid Project and Environment."
      );
    }
    try {
      return await this.session.withActiveSession(
        ({ activeVault }: { activeVault: ReviewVault | null }) => {
          if (!activeVault || activeVault.isLocked) {
            throw safeError("CONFIGURATION_TARGET_UNAVAILABLE");
          }
          const baseline = activeVault.getProjectConfigurationBaseline(target);
          if (!baseline.exists) {
            throw safeError("CONFIGURATION_TARGET_UNAVAILABLE");
          }
          const identity = this._targetDescriptor(
            activeVault,
            target,
            baseline
          );
          if (!baseline.configurationBaseline) {
            return {
              configured: false,
              success: true,
              target: publicTarget(identity),
            };
          }
          return evaluate(
            activeVault,
            target,
            baseline as ReviewBaselineSnapshot & {
              configurationBaseline: ReviewBaseline;
            },
            identity,
            this.now()
          );
        }
      );
    } catch (error) {
      return failure(
        error.code || "CONFIGURATION_EVALUATION_FAILED",
        safeMessage(error)
      );
    }
  }

  /** Captures Environment identity and the baseline revision before the native file picker opens. */
  async captureTarget(
    target: unknown
  ): Promise<{ success: true; binding: string } | ConfigurationFailure> {
    if (!validTarget(target)) {
      return failure(
        "CONFIGURATION_INVALID_TARGET",
        "Choose a valid Project and Environment."
      );
    }
    const generation = this._generation;
    try {
      const binding = await this.session.withActiveSession(
        ({ activeVault }: { activeVault: ReviewVault | null }) => {
          if (!activeVault || activeVault.isLocked) {
            throw safeError("CONFIGURATION_TARGET_UNAVAILABLE");
          }
          const baseline = activeVault.getProjectConfigurationBaseline(target);
          if (!baseline.exists) {
            throw safeError("CONFIGURATION_TARGET_UNAVAILABLE");
          }
          const identity = this._targetDescriptor(
            activeVault,
            target,
            baseline
          );
          const handle = randomHandle();
          this._remember(this._bindings, handle, {
            baselineIdentity: baselineIdentity(baseline.configurationBaseline),
            generation,
            target: identity,
          });
          return handle;
        }
      );
      if (generation !== this._generation) {
        this._bindings.delete(binding);
        throw safeError("CONFIGURATION_PREVIEW_INVALID");
      }
      return { binding, success: true };
    } catch (error) {
      return failure(
        error.code || "CONFIGURATION_TARGET_UNAVAILABLE",
        safeMessage(error)
      );
    }
  }

  async preview(target: unknown, input: unknown, targetBinding?: unknown) {
    const candidate = input as {
      source?: unknown;
      content?: unknown;
      filePath?: unknown;
    } | null;
    const generation = this._generation;
    const abandonBinding = () => {
      if (typeof targetBinding === "string") {
        this._bindings.delete(targetBinding);
      }
    };
    if (!validTarget(target)) {
      abandonBinding();
      return failure(
        "CONFIGURATION_INVALID_TARGET",
        "Choose a valid Project and Environment."
      );
    }
    if (
      !candidate ||
      typeof candidate !== "object" ||
      !["text", "file"].includes(candidate.source as string)
    ) {
      abandonBinding();
      return failure(
        "CONFIGURATION_INVALID_INPUT",
        "Choose text or a file to review."
      );
    }

    let template: {
      requiredKeys: string[];
      duplicateNames: number;
      diagnostics: { line: number; code: string; message: string }[];
    };
    try {
      template = await readTemplate(
        candidate as {
          content?: string;
          filePath?: string;
          source: string;
        }
      );
    } catch (error) {
      abandonBinding();
      return failure(
        error.code ||
          (error instanceof TypeError
            ? "CONFIGURATION_INVALID_UTF8"
            : "CONFIGURATION_FILE_READ_FAILED"),
        safeMessage(error)
      );
    }
    if (generation !== this._generation) {
      abandonBinding();
      return failure(
        "CONFIGURATION_PREVIEW_INVALID",
        safeMessage(safeError("CONFIGURATION_PREVIEW_INVALID"))
      );
    }

    if (template.diagnostics.length > 0) {
      abandonBinding();
      return {
        changes: null,
        diagnostics: template.diagnostics,
        duplicateNames: 0,
        entries: [],
        handle: null,
        success: true,
        target: null,
      };
    }

    const { requiredKeys, duplicateNames } = template;

    try {
      const result = await this.session.withActiveSession(
        ({ activeVault }: { activeVault: ReviewVault | null }) => {
          if (!activeVault || activeVault.isLocked) {
            throw safeError("CONFIGURATION_TARGET_UNAVAILABLE");
          }
          // A binding captured before native selection that no longer resolves
          // (delete/recreate) is a stale review, never an unresolved default.
          let binding: Binding | null | undefined;
          if (targetBinding !== undefined) {
            binding = this._bindings.get(targetBinding as string);
            this._bindings.delete(targetBinding as string);
            if (!binding || binding.generation !== generation) {
              throw safeError("CONFIGURATION_STALE");
            }
            if (!this._sameBindingTarget(activeVault, target, binding)) {
              throw safeError("CONFIGURATION_STALE");
            }
          }
          const baseline = activeVault.getProjectConfigurationBaseline(target);
          if (!baseline.exists) {
            throw safeError("CONFIGURATION_TARGET_UNAVAILABLE");
          }
          const targetIdentity = this._targetDescriptor(
            activeVault,
            target,
            baseline
          );
          if (binding && !sameTarget(binding.target, targetIdentity)) {
            throw safeError("CONFIGURATION_STALE");
          }
          if (generation !== this._generation) {
            throw safeError("CONFIGURATION_PREVIEW_INVALID");
          }

          const previous: string[] =
            baseline.configurationBaseline?.requiredKeys || [];
          const previousSet = new Set(previous);
          const nextSet = new Set(requiredKeys);
          const changes = {
            added: requiredKeys.filter((key) => !previousSet.has(key)),
            removed: previous.filter((key) => !nextSet.has(key)),
            unchanged: requiredKeys.filter((key) => previousSet.has(key)),
          };
          const snapshot = activeVault.getImportProjectSnapshot(
            target,
            requiredKeys
          );
          const evaluated = evaluateSnapshot(
            requiredKeys,
            snapshot.secrets,
            this.now()
          );
          const entries = requiredKeys.map((key) => ({
            key,
            status:
              evaluated.entries.find(
                (entry: { key: string }) => entry.key === key
              )?.status || ("Missing" as ConfigurationStatus),
          }));
          const handle = randomHandle();
          this._remember(this._handles, handle, {
            baselineIdentity: baselineIdentity(baseline.configurationBaseline),
            changeCounts: {
              added: changes.added.length,
              removed: changes.removed.length,
              required: requiredKeys.length,
              unchanged: changes.unchanged.length,
            },
            environmentIncarnation: baseline.environmentIncarnation,
            generation,
            incarnation: baseline.incarnation,
            kind: "replace",
            requiredKeys,
            secrets: snapshot.secrets,
            selector: {
              ...(target as { projectName: string; environmentId: string }),
            },
            target: targetIdentity,
          });
          return {
            changes,
            diagnostics: [],
            duplicateNames,
            entries,
            handle,
            success: true,
            target: publicTarget(targetIdentity),
          };
        }
      );
      if (generation !== this._generation) {
        if (result?.handle) {
          this._handles.delete(result.handle);
        }
        abandonBinding();
        return failure(
          "CONFIGURATION_PREVIEW_INVALID",
          safeMessage(safeError("CONFIGURATION_PREVIEW_INVALID"))
        );
      }
      return result;
    } catch (error) {
      abandonBinding();
      return failure(
        error.code || "CONFIGURATION_TARGET_UNAVAILABLE",
        safeMessage(error)
      );
    }
  }

  async previewClear(target: unknown) {
    if (!validTarget(target)) {
      return failure(
        "CONFIGURATION_INVALID_TARGET",
        "Choose a valid Project and Environment."
      );
    }
    const generation = this._generation;
    try {
      const result = await this.session.withActiveSession(
        ({ activeVault }: { activeVault: ReviewVault | null }) => {
          if (!activeVault || activeVault.isLocked) {
            throw safeError("CONFIGURATION_TARGET_UNAVAILABLE");
          }
          const baseline = activeVault.getProjectConfigurationBaseline(target);
          if (!baseline.exists) {
            throw safeError("CONFIGURATION_TARGET_UNAVAILABLE");
          }
          if (!baseline.configurationBaseline) {
            throw safeError("CONFIGURATION_NOT_CONFIGURED");
          }
          const targetIdentity = this._targetDescriptor(
            activeVault,
            target,
            baseline
          );
          const snapshot = activeVault.getImportProjectSnapshot(
            target,
            baseline.configurationBaseline.requiredKeys
          );
          const handle = randomHandle();
          this._remember(this._handles, handle, {
            baselineIdentity: baselineIdentity(baseline.configurationBaseline),
            changeCounts: {
              added: 0,
              removed: baseline.configurationBaseline.requiredKeys.length,
              required: 0,
              unchanged: 0,
            },
            environmentIncarnation: baseline.environmentIncarnation,
            generation,
            incarnation: baseline.incarnation,
            kind: "clear",
            requiredKeys: [],
            secrets: snapshot.secrets,
            selector: {
              ...(target as { projectName: string; environmentId: string }),
            },
            target: targetIdentity,
          });
          return {
            handle,
            removed: [...baseline.configurationBaseline.requiredKeys],
            secretsRemain: true,
            success: true,
            target: publicTarget(targetIdentity),
          };
        }
      );
      if (generation !== this._generation) {
        if (result?.handle) {
          this._handles.delete(result.handle);
        }
        return failure(
          "CONFIGURATION_PREVIEW_INVALID",
          safeMessage(safeError("CONFIGURATION_PREVIEW_INVALID"))
        );
      }
      return result;
    } catch (error) {
      return failure(
        error.code || "CONFIGURATION_TARGET_UNAVAILABLE",
        safeMessage(error)
      );
    }
  }

  async commit(handle: unknown) {
    const review =
      typeof handle === "string" ? this._handles.get(handle) : undefined;
    if (!review) {
      return failure(
        "CONFIGURATION_PREVIEW_INVALID",
        safeMessage(safeError("CONFIGURATION_PREVIEW_INVALID"))
      );
    }
    this._handles.delete(handle as string);
    try {
      return await this.session.withActiveSession(
        async ({ activeVault }: { activeVault: ReviewVault | null }) => {
          this._assertFresh(activeVault, review);
          const expected = {
            baseline: review.baselineIdentity,
            environmentIncarnation: review.environmentIncarnation,
            incarnation: review.incarnation,
            // Revalidates Environment identity immediately before the write.
            validateTarget: () => this._assertFresh(activeVault, review),
          };
          const applied =
            review.kind === "clear"
              ? await activeVault.clearProjectConfigurationBaseline(
                  review.selector,
                  expected
                )
              : await activeVault.replaceProjectConfigurationBaseline(
                  review.selector,
                  review.requiredKeys,
                  expected
                );
          return {
            addedCount: review.changeCounts.added,
            changed: applied.changed,
            kind: review.kind,
            removedCount: review.changeCounts.removed,
            requiredCount: review.changeCounts.required,
            success: true,
            unchangedCount: review.changeCounts.unchanged,
          };
        }
      );
    } catch (error) {
      return failure(
        error.code || "CONFIGURATION_COMMIT_FAILED",
        safeMessage(error)
      );
    }
  }

  // Keep the public Promise API, including rejection of synchronous failures.
  // eslint-disable-next-line require-await
  async discard(handle: unknown): Promise<{ success: true }> {
    if (typeof handle === "string") {
      this._handles.delete(handle);
      this._bindings.delete(handle);
    }
    return { success: true };
  }

  clear() {
    this._generation += 1;
    this._handles.clear();
    this._bindings.clear();
  }

  /**
   * A captured binding whose target no longer resolves (delete/recreate) can
   * never match again, so it is reported as a stale review instead of being
   * compared against another Environment.
   */
  _sameBindingTarget(
    activeVault: ReviewVault,
    selector: unknown,
    binding: Binding
  ): boolean {
    try {
      const current = activeVault.getProjectConfigurationBaseline(selector);
      if (!current.exists) {
        return false;
      }
      const currentTarget = this._targetDescriptor(
        activeVault,
        selector,
        current
      );
      return (
        sameTarget(binding.target, currentTarget) &&
        sameBaselineIdentity(
          binding.baselineIdentity,
          baselineIdentity(current.configurationBaseline)
        )
      );
    } catch {
      return false;
    }
  }

  _targetDescriptor(
    activeVault: ReviewVault,
    selector: unknown,
    project: { incarnation: string | null }
  ): ReviewBinding {
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
    review: Review
  ): asserts activeVault is ReviewVault {
    if (review.generation !== this._generation) {
      throw safeError("CONFIGURATION_PREVIEW_INVALID");
    }
    const state = this.session.snapshot();
    if (state.state !== "active") {
      throw safeError(
        state.state === "closing"
          ? "VAULT_SESSION_CLOSING"
          : "VAULT_SESSION_LOCKED"
      );
    }
    if (!activeVault || activeVault.isLocked) {
      throw safeError("CONFIGURATION_TARGET_UNAVAILABLE");
    }
    // A target that no longer resolves (Vault switch, Project/Environment
    // deleted or recreated) is stale, never another Environment.
    if (
      !this._sameBindingTarget(activeVault, review.selector, {
        baselineIdentity: review.baselineIdentity,
        generation: review.generation,
        target: review.target,
      })
    ) {
      throw safeError("CONFIGURATION_STALE");
    }
    const current = activeVault.getProjectConfigurationBaseline(
      review.selector
    );
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
          canonical(snapshot.secrets[key]) !== canonical(review.secrets[key])
      )
    ) {
      throw safeError("CONFIGURATION_STALE");
    }
  }

  // Preserve the existing instance method used by review-handle storage.
  // eslint-disable-next-line class-methods-use-this
  _remember<T>(map: Map<string, T>, key: string, value: T) {
    map.set(key, value);
    while (map.size > MAX_TRACKED_REVIEWS) {
      const oldest = map.keys().next();
      if (!oldest.done) {
        map.delete(oldest.value);
      }
    }
  }
}

// Type-only namespace preserves the existing CommonJS public type API.
// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace ProjectConfigurationCoordinator {
  export interface Target {
    projectName: string;
    environmentId: string;
  }
  export type ReviewTargetInfo = ReviewTargetShape;
  export type Failure = ConfigurationFailure;
}

export = ProjectConfigurationCoordinator;
