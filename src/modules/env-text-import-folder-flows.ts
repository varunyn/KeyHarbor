import {
  captureTargetBinding,
  describeTarget,
  describeTargetOrNull,
  failure,
  remember,
  randomHandle,
  safeError,
  sameTarget,
} from "./env-text-import-support";
import type {
  ImportCoordinatorState,
  ImportHandleInput,
  ImportTargetInput,
} from "./env-text-import-types";
import { isStringValue, validTarget } from "./env-text-import-validation";
import { scanProjectFolder } from "./project-folder-scan";

export class FolderImportFlows {
  _state: ImportCoordinatorState;

  constructor(state: ImportCoordinatorState) {
    this._state = state;
  }

  async stageFolder(target: ImportTargetInput, directory: string) {
    const state = this._state;
    state.folderHandoff = null;
    const captured = await captureTargetBinding(state, target);
    if (!captured.success) {
      return captured;
    }
    const binding = state.targetBindings.get(captured.binding);
    state.targetBindings.delete(captured.binding);
    if (!binding) {
      return failure("IMPORT_STALE", "Choose the folder again.");
    }
    state.folderHandoff = {
      directory,
      expiresAt: Date.now() + 120_000,
      target: binding,
    };
    return { success: true as const };
  }

  async resumeFolder(target: ImportTargetInput) {
    const state = this._state;
    const handoff = state.folderHandoff;
    state.folderHandoff = null;
    if (!handoff || Date.now() > handoff.expiresAt || !validTarget(target)) {
      return failure("IMPORT_STALE", "Choose the folder again.");
    }
    const captured = await captureTargetBinding(state, target);
    if (!captured.success) {
      return captured;
    }
    const current = state.targetBindings.get(captured.binding);
    if (!current || !sameTarget(handoff.target, current)) {
      state.targetBindings.delete(captured.binding);
      return failure(
        "IMPORT_STALE",
        "Target changed. Choose the folder again."
      );
    }
    return this.scanFolder(target, handoff.directory, captured.binding);
  }

  async scanFolder(
    target: ImportTargetInput,
    directory: string,
    capturedBinding: string
  ) {
    const state = this._state;
    const { generation } = state;
    const binding = state.targetBindings.get(capturedBinding);
    state.targetBindings.delete(capturedBinding);
    state.folderScans.clear();
    if (!validTarget(target) || !binding) {
      return failure("IMPORT_STALE", "Choose the folder again.");
    }
    try {
      const result = await scanProjectFolder(directory);
      return await state.session.withActiveSession(({ activeVault }) => {
        const current = describeTargetOrNull(
          state.session,
          activeVault,
          target
        );
        if (
          generation !== state.generation ||
          !current ||
          !sameTarget(binding, current)
        ) {
          return failure(
            "IMPORT_STALE",
            "Target changed. Choose the folder again."
          );
        }
        const scanId = randomHandle();
        state.folderScans.set(scanId, {
          contents: result.contents,
          selector: target,
          target: binding,
        });
        return {
          scan: { ...result.summary, scanId },
          success: true as const,
        };
      });
    } catch {
      return failure(
        "IMPORT_FOLDER_UNAVAILABLE",
        "The selected folder could not be scanned."
      );
    }
  }

  async prepareFolderPreview(
    target: ImportTargetInput,
    scanId: ImportHandleInput,
    fileId: ImportHandleInput
  ) {
    const state = this._state;
    const scan = isStringValue(scanId)
      ? state.folderScans.get(scanId)
      : undefined;
    const content =
      isStringValue(fileId) && scan ? scan.contents.get(fileId) : undefined;
    if (
      !validTarget(target) ||
      !scan ||
      content === undefined ||
      target.projectName !== scan.target.projectName
    ) {
      return failure("IMPORT_STALE", "Choose the folder again.");
    }
    const { generation } = state;
    try {
      const bindingHandle = await state.session.withActiveSession(
        ({ activeVault }) => {
          const current = describeTargetOrNull(
            state.session,
            activeVault,
            scan.selector
          );
          if (
            generation !== state.generation ||
            !current ||
            !sameTarget(scan.target, current) ||
            !activeVault
          ) {
            throw safeError("IMPORT_STALE");
          }
          const snapshot = activeVault.getImportProjectSnapshot(target, []);
          if (!snapshot.exists) {
            throw safeError("IMPORT_STALE");
          }
          const handle = randomHandle();
          remember(
            state.targetBindings,
            handle,
            describeTarget(state.session, activeVault, target, snapshot)
          );
          return handle;
        }
      );
      return {
        bindingHandle,
        content,
        success: true as const,
      };
    } catch {
      return failure(
        "IMPORT_STALE",
        "Target changed. Choose the folder again."
      );
    }
  }
}
