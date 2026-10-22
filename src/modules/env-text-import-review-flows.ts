import {
  MAX_INPUT_BYTES,
  assertPreviewFresh,
  buildGroupedOccurrences,
  buildPreviewEntries,
  decodeFileBytes,
  describeTarget,
  describeTargetOrNull,
  expireHandle,
  failure,
  parseImportContent,
  publicTarget,
  randomHandle,
  readLimitedFile,
  remember,
  safeError,
  safeErrorMessage,
  sameTarget,
} from "./env-text-import-support";
import type {
  BoundaryValue,
  CodedError,
  ImportCommitResult,
  ImportCoordinatorState,
  ImportDecisionsInput,
  ImportFailure,
  ImportHandleInput,
  ImportPreview,
  ImportPreviewResult,
  ImportTargetInput,
  ImportTargetSelector,
  ValidImportInput,
} from "./env-text-import-types";
import {
  isRecordValue,
  isStringValue,
  validChoice,
  validFilePath,
  validInput,
  validTarget,
  validateDecisions,
} from "./env-text-import-validation";
import type { ReviewVault } from "./review-contracts";

const loadCandidateContent = async (
  candidate: ValidImportInput
): Promise<string | ImportFailure> => {
  if (candidate.source === "text") {
    const { content: text } = candidate;
    if (!isStringValue(text)) {
      return failure("IMPORT_INVALID_INPUT", "Input must be text.");
    }
    if (Buffer.byteLength(text, "utf-8") > MAX_INPUT_BYTES) {
      return failure(
        "IMPORT_INPUT_TOO_LARGE",
        "Input exceeds the 1 MiB limit."
      );
    }
    return text;
  }
  const { filePath } = candidate;
  if (!validFilePath(filePath)) {
    return failure("IMPORT_INVALID_INPUT", "Choose a valid file.");
  }
  try {
    const bytes = await readLimitedFile(filePath);
    return decodeFileBytes(bytes);
  } catch (error) {
    // SAFETY: file pipeline throws coded errors; unknown throws map to a read failure.
    const { code } = error as CodedError;
    if (code === "IMPORT_INVALID_FILE") {
      return failure(code, "Choose a regular file.");
    }
    if (code === "IMPORT_INPUT_TOO_LARGE") {
      return failure(code, "File exceeds the 1 MiB limit.");
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
};

export class ReviewImportFlows {
  _state: ImportCoordinatorState;

  constructor(state: ImportCoordinatorState) {
    this._state = state;
  }

  async preview(
    target: ImportTargetInput,
    input: BoundaryValue,
    targetBinding?: BoundaryValue
  ): Promise<ImportPreviewResult> {
    const state = this._state;
    const projectName = validTarget(target) ? target.projectName : "";
    const { generation } = state;
    const abandonBinding = () => {
      if (isStringValue(targetBinding)) {
        state.targetBindings.delete(targetBinding);
      }
    };
    if (!validTarget(target)) {
      abandonBinding();
      return failure(
        "IMPORT_INVALID_TARGET",
        "Choose a valid Project and Environment."
      );
    }
    if (!isRecordValue(input) || !validInput(input)) {
      abandonBinding();
      return failure(
        "IMPORT_INVALID_INPUT",
        "Choose text or a file to import."
      );
    }
    const candidate = input;

    const loaded = await loadCandidateContent(candidate);
    if (!isStringValue(loaded)) {
      abandonBinding();
      return loaded;
    }
    const content: string = loaded;

    if (generation !== state.generation) {
      abandonBinding();
      return failure("IMPORT_PREVIEW_INVALID", "Import was closed.");
    }

    const parsed = parseImportContent(content);
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
      const result = await state.session.withActiveSession(
        ({ activeVault }: { activeVault: ReviewVault | null }) =>
          this._buildPreview(
            activeVault,
            target,
            targetBinding,
            generation,
            projectName,
            parsed.assignments
          )
      );
      if (generation !== state.generation) {
        if (result?.success && result.handle) {
          expireHandle(state, result.handle);
        }
        abandonBinding();
        return failure("IMPORT_PREVIEW_INVALID", "Import was closed.");
      }
      return result;
    } catch (error) {
      abandonBinding();
      // SAFETY: coordinator failures carry a machine-readable code; unknown throws fall back to unavailable.
      const { code } = error as CodedError;
      return failure(
        code || "IMPORT_TARGET_UNAVAILABLE",
        safeErrorMessage({ code })
      );
    }
  }

  _buildPreview(
    activeVault: ReviewVault | null,
    target: ImportTargetSelector,
    targetBinding: BoundaryValue | undefined,
    generation: number,
    projectName: string,
    assignments: readonly { key: string; value: string; line: number }[]
  ): ImportPreviewResult {
    const state = this._state;
    if (!activeVault || activeVault.isLocked) {
      throw safeError("IMPORT_TARGET_UNAVAILABLE");
    }
    // A target captured before native selection that no longer resolves
    // (delete/recreate) is a stale review, never an unresolved default.
    let targetIdentity: ImportPreview["target"] | null = null;
    if (targetBinding !== undefined) {
      if (!isStringValue(targetBinding)) {
        throw safeError("IMPORT_STALE");
      }
      const binding = state.targetBindings.get(targetBinding);
      state.targetBindings.delete(targetBinding);
      if (!binding) {
        throw safeError("IMPORT_STALE");
      }
      targetIdentity = describeTargetOrNull(state.session, activeVault, target);
      if (!targetIdentity || !sameTarget(binding, targetIdentity)) {
        throw safeError("IMPORT_STALE");
      }
    }
    const snapshot = activeVault.getImportProjectSnapshot(target, [
      ...new Set<string>(assignments.map(({ key }) => key)),
    ]);
    if (!snapshot.exists) {
      throw safeError("IMPORT_TARGET_UNAVAILABLE");
    }
    if (!targetIdentity) {
      targetIdentity = describeTarget(
        state.session,
        activeVault,
        target,
        snapshot
      );
    }
    if (generation !== state.generation) {
      throw safeError("IMPORT_PREVIEW_INVALID");
    }
    // SAFETY: Vault snapshot secrets are internal validated records; narrow for comparison.
    const secrets = snapshot.secrets as Record<string, BoundaryValue>;
    const grouped = buildGroupedOccurrences(assignments, secrets);
    const entries = buildPreviewEntries(grouped);
    const handle = randomHandle();
    remember(state.previews, handle, {
      entries: new Map(
        [...grouped].map(([key, occurrences]) => [key, occurrences])
      ),
      environmentIncarnation: snapshot.environmentIncarnation,
      generation,
      projectIncarnation: snapshot.incarnation,
      projectName,
      // SAFETY: Vault snapshot secrets are internal validated records; store them for freshness comparison.
      secrets: snapshot.secrets as ImportPreview["secrets"],
      selector: { ...target },
      target: targetIdentity,
    });
    // SAFETY: preview result is built from validated snapshot identity and grouped occurrences above.
    const previewResult = {
      diagnostics: [],
      entries,
      handle,
      success: true,
      target: publicTarget(targetIdentity),
    } as ImportPreviewResult;
    return previewResult;
  }

  /** Reveal freshness: any relevant drift, including Environment identity, expires the review. */
  async reveal(
    handle: ImportHandleInput,
    key: BoundaryValue,
    occurrenceId: BoundaryValue
  ): Promise<{ success: true; value: string } | ImportFailure> {
    const state = this._state;
    const preview = isStringValue(handle)
      ? state.previews.get(handle)
      : undefined;
    if (!preview || !validChoice(key, occurrenceId)) {
      return failure(
        "IMPORT_PREVIEW_INVALID",
        "Review is no longer available."
      );
    }
    const occurrence = preview.entries
      .get(key)
      ?.find((item) => item.id === occurrenceId);
    if (!occurrence) {
      return failure(
        "IMPORT_INVALID_SELECTION",
        "Choose an entry from the current review."
      );
    }
    try {
      return await state.session.withActiveSession(
        ({ activeVault }: { activeVault: ReviewVault | null }) => {
          assertPreviewFresh(state, activeVault, preview);
          return { success: true, value: occurrence.value };
        }
      );
    } catch (error) {
      expireHandle(state, handle);
      // SAFETY: freshness failures carry a machine-readable code; unknown throws map to stale.
      const { code } = error as CodedError;
      return failure(code || "IMPORT_STALE", safeErrorMessage({ code }));
    }
  }

  async commit(
    handle: ImportHandleInput,
    decisions: ImportDecisionsInput
  ): Promise<ImportCommitResult> {
    const state = this._state;
    const preview = isStringValue(handle)
      ? state.previews.get(handle)
      : undefined;
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
    if (isStringValue(handle)) {
      state.previews.delete(handle);
    }
    try {
      const result = await state.session.withActiveSession(
        async ({ activeVault }: { activeVault: ReviewVault | null }) => {
          assertPreviewFresh(state, activeVault, preview);
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
                validateTarget: () =>
                  assertPreviewFresh(state, activeVault, preview),
              }
            );
          }
          const added = selected.filter(
            ({ action }) => action === "add"
          ).length;
          const replaced = selected.filter(
            ({ action }) => action === "replace"
          ).length;
          // SAFETY: commit counts are derived from the validated selection above.
          const commitResult = {
            added,
            count: selected.length,
            replaced,
            skipped: preview.entries.size - selected.length,
            success: true,
          } as ImportCommitResult;
          return commitResult;
        }
      );
      return result;
    } catch (error) {
      // SAFETY: commit failures carry a machine-readable code; unknown throws map to a generic failure.
      const { code } = error as CodedError;
      return failure(code || "IMPORT_FAILED", safeErrorMessage({ code }));
    }
  }
}
