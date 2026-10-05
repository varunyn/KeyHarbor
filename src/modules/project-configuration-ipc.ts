import {
  isFileInput,
  isTextInput,
  validTarget,
} from "./environment-review-input";

const failure = (code: string, error: string) => ({
  code,
  error,
  success: false,
});

const safeFailure = (result, code: string, message: string) => {
  if (
    result &&
    result.success === false &&
    typeof result.code === "string" &&
    typeof result.error === "string"
  ) {
    return result;
  }
  if (result && result.success === true) {
    return result;
  }
  return failure(code, message);
};

const validHandle = (handle: unknown): handle is string =>
  typeof handle === "string" && handle.length > 0 && handle.length <= 512;

interface FileSelection {
  canceled?: boolean;
  filePaths?: string[];
}

const selectionWasCancelled = (
  result: FileSelection | null | undefined
): boolean =>
  Boolean(
    result?.canceled ||
    !Array.isArray(result?.filePaths) ||
    result.filePaths.length === 0
  );

const registerProjectConfigurationIpc = ({
  ipcMain,
  coordinator,
  dialog,
  getWindow,
  logger,
}) => {
  if (
    !ipcMain?.handle ||
    !coordinator ||
    !dialog?.showOpenDialog ||
    typeof getWindow !== "function"
  ) {
    throw new TypeError("Project configuration IPC dependencies are required");
  }
  const attachedContents = new WeakSet();
  const attachWindowCleanup = () => {
    const window = getWindow();
    if (!window || window.isDestroyed?.()) {
      return;
    }
    const contents = window.webContents;
    if (contents && !attachedContents.has(contents)) {
      attachedContents.add(contents);
      contents.on(
        "did-start-navigation",
        (_event, _url, _inPlace, isMainFrame) => {
          if (isMainFrame) {
            coordinator.clear();
          }
        }
      );
      contents.on("render-process-gone", () => coordinator.clear());
      window.once?.("closed", () => coordinator.clear());
    }
  };
  const admitted = (event) => {
    attachWindowCleanup();
    const window = getWindow();
    return Boolean(
      window &&
      !window.isDestroyed?.() &&
      event?.sender?.id === window.webContents?.id
    );
  };
  ipcMain.handle("projects:configurationGet", async (event, target) => {
    if (!admitted(event)) {
      return failure(
        "CONFIGURATION_INVALID_SENDER",
        "Configuration could not be loaded."
      );
    }
    if (!validTarget(target)) {
      return failure(
        "CONFIGURATION_INVALID_TARGET",
        "Choose a valid Project and Environment."
      );
    }
    return safeFailure(
      await coordinator.get(target),
      "CONFIGURATION_EVALUATION_FAILED",
      "Configuration could not be loaded."
    );
  });
  ipcMain.handle(
    "projects:configurationPreview",
    async (event, target, input) => {
      if (!admitted(event)) {
        return failure(
          "CONFIGURATION_INVALID_SENDER",
          "Configuration preview could not be opened."
        );
      }
      if (
        !validTarget(target) ||
        (!isTextInput(input) && !isFileInput(input))
      ) {
        return failure(
          "CONFIGURATION_INVALID_INPUT",
          "Choose text or a file to review."
        );
      }
      if (input.source === "text") {
        return safeFailure(
          await coordinator.preview(target, input),
          "CONFIGURATION_PREVIEW_FAILED",
          "Configuration preview could not be created."
        );
      }
      const captured = await coordinator.captureTarget(target);
      if (!captured?.success) {
        return safeFailure(
          captured,
          "CONFIGURATION_TARGET_UNAVAILABLE",
          "The selected Project is unavailable."
        );
      }
      const selectionWindow = getWindow();
      try {
        if (
          !selectionWindow ||
          selectionWindow.isDestroyed?.() ||
          !admitted(event)
        ) {
          await coordinator.discard(captured.binding);
          return failure(
            "CONFIGURATION_PREVIEW_INVALID",
            "Configuration preview was closed."
          );
        }
        const properties = ["openFile"];
        if (process.platform !== "linux") {
          properties.push("showHiddenFiles");
        }
        const result = await dialog.showOpenDialog(selectionWindow, {
          filters: [
            {
              extensions: ["env", "example", "txt"],
              name: "Environment Files",
            },
            { extensions: ["*"], name: "All Files" },
          ],
          properties,
        });
        if (selectionWasCancelled(result)) {
          await coordinator.discard(captured.binding);
          return { cancelled: true, success: false };
        }
        if (
          !admitted(event) ||
          getWindow() !== selectionWindow ||
          selectionWindow.isDestroyed?.()
        ) {
          await coordinator.discard(captured.binding);
          return failure(
            "CONFIGURATION_PREVIEW_INVALID",
            "Configuration preview was closed."
          );
        }
        return safeFailure(
          await coordinator.preview(
            target,
            { filePath: result.filePaths[0], source: "file" },
            captured.binding
          ),
          "CONFIGURATION_PREVIEW_FAILED",
          "The selected file could not be reviewed."
        );
      } catch {
        await coordinator.discard(captured.binding);
        return failure(
          "CONFIGURATION_FILE_READ_FAILED",
          "The selected file could not be read."
        );
      }
    }
  );
  ipcMain.handle(
    "projects:configurationClearPreview",
    async (event, target) => {
      if (!admitted(event)) {
        return failure(
          "CONFIGURATION_INVALID_SENDER",
          "Configuration could not be cleared."
        );
      }
      if (!validTarget(target)) {
        return failure(
          "CONFIGURATION_INVALID_TARGET",
          "Choose a valid Project and Environment."
        );
      }
      return safeFailure(
        await coordinator.previewClear(target),
        "CONFIGURATION_CLEAR_PREVIEW_FAILED",
        "Clear review could not be created."
      );
    }
  );
  ipcMain.handle("projects:configurationCommit", async (event, handle) => {
    if (!admitted(event)) {
      return failure(
        "CONFIGURATION_INVALID_SENDER",
        "Configuration could not be saved."
      );
    }
    if (!validHandle(handle)) {
      return failure(
        "CONFIGURATION_PREVIEW_INVALID",
        "Review the configuration again before saving."
      );
    }
    const result = safeFailure(
      await coordinator.commit(handle),
      "CONFIGURATION_COMMIT_FAILED",
      "Configuration could not be saved."
    );
    if (result?.success) {
      try {
        logger?.logApp?.(
          `Project configuration ${result.kind === "clear" ? "cleared" : "saved"}: ${result.requiredCount} required, ${result.addedCount} added, ${result.removedCount} removed, ${result.unchangedCount} unchanged`
        );
      } catch {
        // Audit logging is best effort after the baseline has committed.
      }
    }
    return result;
  });
  ipcMain.handle("projects:configurationDiscard", (event, handle) => {
    if (!admitted(event)) {
      return failure(
        "CONFIGURATION_INVALID_SENDER",
        "Configuration review could not be closed."
      );
    }
    if (handle !== null && handle !== undefined && !validHandle(handle)) {
      return { success: true };
    }
    return coordinator.discard(handle);
  });
  attachWindowCleanup();
  return { attachWindowCleanup };
};

export = registerProjectConfigurationIpc;
