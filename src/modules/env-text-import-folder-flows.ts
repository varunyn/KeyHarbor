import path from "node:path";

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
  BoundaryValue,
  FolderHandoff,
  FolderScanResult,
  ImportCoordinatorState,
  ImportHandleInput,
  ImportTargetInput,
} from "./env-text-import-types";
import {
  isRecordValue,
  isStringValue,
  validTarget,
} from "./env-text-import-validation";
import { scanProjectFolder } from "./project-folder-scan";

export class FolderImportFlows {
  _state: ImportCoordinatorState;
  choices = new Map<string, FolderScanResult>();
  queue: FolderHandoff[] = [];

  constructor(state: ImportCoordinatorState) {
    this._state = state;
  }

  async discoverFolder(directory: string) {
    const state = this._state;
    this.choices.clear();
    this.queue = [];
    state.folderHandoff = null;
    const { generation } = state;
    try {
      const snapshot = state.session.snapshot();
      const available = await state.session.withActiveSession(
        ({ activeVault }) => Boolean(activeVault && !activeVault.isLocked)
      );
      if (!available) {
        return failure("IMPORT_STALE", "Unlock a Vault before importing.");
      }
      const result = await scanProjectFolder(directory);
      return await state.session.withActiveSession(({ activeVault }) => {
        if (
          !activeVault ||
          activeVault.isLocked ||
          generation !== state.generation ||
          snapshot.transitionId !== state.session.snapshot().transitionId
        ) {
          return failure("IMPORT_STALE", "Choose the folder again.");
        }
        const directories = [
          ...new Set(
            result.summary.files.map((file) => path.posix.dirname(file.path))
          ),
        ];
        directories.sort((a, b) => a.localeCompare(b));
        const folders = directories.map((folder) => {
          const files = result.summary.files.filter(
            (file) => path.posix.dirname(file.path) === folder
          );
          const id = randomHandle();
          const suggestedName = [
            result.summary.folderName,
            ...(folder === "." ? [] : folder.split("/")),
          ].join(" → ");
          this.choices.set(id, {
            contents: new Map(
              files.flatMap((file) => {
                const content = result.contents.get(file.id);
                return content === undefined ? [] : [[file.id, content]];
              })
            ),
            summary: { ...result.summary, files, folderName: suggestedName },
          });
          return { fileCount: files.length, id, path: folder, suggestedName };
        });
        return {
          discovery: { folders, limited: result.summary.limited },
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

  stageChoice(target: ImportTargetInput, choiceId: ImportHandleInput) {
    return this.stageChoices([{ choiceId, target }]);
  }

  async stageChoices(selections: BoundaryValue) {
    const state = this._state;
    state.folderHandoff = null;
    this.queue = [];
    if (
      !Array.isArray(selections) ||
      !selections.length ||
      selections.length > 64
    ) {
      return failure("IMPORT_INVALID_INPUT", "Choose folders to import.");
    }
    const handoffs: FolderHandoff[] = [];
    const seen = new Set<string>();
    const projects = new Set<string>();
    for (const selection of selections) {
      if (
        !isRecordValue(selection) ||
        !isStringValue(selection.choiceId) ||
        !validTarget(selection.target) ||
        seen.has(selection.choiceId) ||
        projects.has(selection.target.projectName)
      ) {
        return failure(
          "IMPORT_INVALID_INPUT",
          "Choose distinct folders and Projects."
        );
      }
      const scan = this.choices.get(selection.choiceId);
      if (!scan) {
        return failure("IMPORT_STALE", "Choose the folder again.");
      }
      seen.add(selection.choiceId);
      projects.add(selection.target.projectName);
      // Each target is bound through the same guarded capture used by single-folder imports.
      // eslint-disable-next-line no-await-in-loop
      const result = await this.stageFolder(selection.target, "", scan);
      if (!result.success) {
        return result;
      }
      const handoff = state.folderHandoff;
      state.folderHandoff = null;
      if (!handoff) {
        return failure("IMPORT_STALE", "Choose the folder again.");
      }
      handoffs.push(handoff);
    }
    [state.folderHandoff] = handoffs;
    this.queue = handoffs.slice(1);
    this.choices.clear();
    return { success: true as const };
  }

  async nextFolder(scanId: ImportHandleInput) {
    const state = this._state;
    const current = isStringValue(scanId)
      ? state.folderScans.get(scanId)
      : undefined;
    const [next] = this.queue;
    if (!current || !next) {
      return failure("IMPORT_STALE", "Choose the folder again.");
    }
    return await state.session.withActiveSession(({ activeVault }) => {
      const target = {
        environmentId: next.target.environmentId,
        projectName: next.target.projectName,
      };
      const currentBinding = describeTargetOrNull(
        state.session,
        activeVault,
        current.selector
      );
      const nextBinding = describeTargetOrNull(
        state.session,
        activeVault,
        target
      );
      if (
        !currentBinding ||
        !nextBinding ||
        !sameTarget(current.target, currentBinding) ||
        !sameTarget(next.target, nextBinding)
      ) {
        this.queue = [];
        return failure(
          "IMPORT_STALE",
          "Target changed. Choose the folder again."
        );
      }
      this.queue.shift();
      state.folderScans.clear();
      state.folderHandoff = { ...next, expiresAt: Date.now() + 120_000 };
      return { success: true as const, target };
    });
  }

  async stageFolder(
    target: ImportTargetInput,
    directory: string,
    scan?: FolderScanResult
  ) {
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
      scan,
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
    return this.scanFolder(
      target,
      handoff.directory,
      captured.binding,
      handoff.scan
    );
  }

  async scanFolder(
    target: ImportTargetInput,
    directory: string,
    capturedBinding: string,
    scanned?: FolderScanResult
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
      const result = scanned ?? (await scanProjectFolder(directory));
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
          scan: {
            ...result.summary,
            remainingProjects: this.queue.length,
            scanId,
          },
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
