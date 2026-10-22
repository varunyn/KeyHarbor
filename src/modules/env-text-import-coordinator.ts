import { FolderImportFlows } from "./env-text-import-folder-flows";
import { ReviewImportFlows } from "./env-text-import-review-flows";
import { captureTargetBinding, expireHandle } from "./env-text-import-support";
import type {
  BoundaryValue,
  ImportCommitResult,
  ImportCoordinatorState,
  ImportDecisionsInput,
  ImportDecision as ImportDecisionType,
  ImportFailure,
  ImportHandleInput,
  ImportPreviewResult,
  ImportTargetInput,
  ReviewTarget as ReviewTargetType,
} from "./env-text-import-types";
import { isFunctionValue } from "./env-text-import-validation";
import type { ReviewSession } from "./review-contracts";

// Class and type-only namespace intentionally share the exported name.
// eslint-disable-next-line no-redeclare
class EnvTextImportCoordinator {
  session: ReviewSession;
  _state: ImportCoordinatorState;
  _folders: FolderImportFlows;
  _reviews: ReviewImportFlows;

  constructor({ session }: { session?: ReviewSession } = {}) {
    if (!session || !isFunctionValue(session.withActiveSession)) {
      throw new TypeError("session is required");
    }
    const state: ImportCoordinatorState = {
      folderHandoff: null,
      folderScans: new Map(),
      generation: 0,
      previews: new Map(),
      session,
      targetBindings: new Map(),
    };
    this.session = session;
    this._state = state;
    this._folders = new FolderImportFlows(state);
    this._reviews = new ReviewImportFlows(state);
  }

  /** Captures Environment identity before the native file picker opens. */
  captureTarget(
    target: ImportTargetInput
  ): Promise<{ success: true; binding: string } | ImportFailure> {
    return captureTargetBinding(this._state, target);
  }

  stageFolder(target: ImportTargetInput, directory: string) {
    return this._folders.stageFolder(target, directory);
  }

  resumeFolder(target: ImportTargetInput) {
    return this._folders.resumeFolder(target);
  }

  scanFolder(
    target: ImportTargetInput,
    directory: string,
    capturedBinding: string
  ) {
    return this._folders.scanFolder(target, directory, capturedBinding);
  }

  async previewFolderFile(
    target: ImportTargetInput,
    scanId: ImportHandleInput,
    fileId: ImportHandleInput
  ): Promise<ImportPreviewResult> {
    const prepared = await this._folders.prepareFolderPreview(
      target,
      scanId,
      fileId
    );
    if (!prepared.success) {
      return prepared;
    }
    return this._reviews.preview(
      target,
      { content: prepared.content, source: "text" },
      prepared.bindingHandle
    );
  }

  preview(
    target: ImportTargetInput,
    input: BoundaryValue,
    targetBinding?: BoundaryValue
  ): Promise<ImportPreviewResult> {
    return this._reviews.preview(target, input, targetBinding);
  }

  /** Reveal freshness: any relevant drift, including Environment identity, expires the review. */
  reveal(
    handle: ImportHandleInput,
    key: BoundaryValue,
    occurrenceId: BoundaryValue
  ): Promise<{ success: true; value: string } | ImportFailure> {
    return this._reviews.reveal(handle, key, occurrenceId);
  }

  commit(
    handle: ImportHandleInput,
    decisions: ImportDecisionsInput
  ): Promise<ImportCommitResult> {
    return this._reviews.commit(handle, decisions);
  }

  // Keep the public Promise API, including rejection of synchronous failures.
  // eslint-disable-next-line require-await
  async discard(handle: ImportHandleInput): Promise<{ success: true }> {
    expireHandle(this._state, handle);
    return { success: true };
  }

  clear({ preserveFolderHandoff = false } = {}) {
    const state = this._state;
    if (!preserveFolderHandoff) {
      state.folderHandoff = null;
    }
    state.generation += 1;
    state.previews.clear();
    state.targetBindings.clear();
    state.folderScans.clear();
  }
}

// Type-only namespace preserves the existing CommonJS public type API.
// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace EnvTextImportCoordinator {
  export interface Target {
    projectName: string;
    environmentId: string;
  }
  export type ReviewTarget = ReviewTargetType;
  export type Decision = ImportDecisionType;
  export type Failure = ImportFailure;
  export type PreviewResult = ImportPreviewResult;
  export type CommitResult = ImportCommitResult;
}

export = EnvTextImportCoordinator;
