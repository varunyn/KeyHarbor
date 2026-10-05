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

const safeFailure = (result) => {
  if (
    result &&
    result.success === false &&
    typeof result.code === "string" &&
    typeof result.error === "string"
  ) {
    return result;
  }
  return failure(
    "IMPORT_TARGET_UNAVAILABLE",
    "The selected Project is unavailable."
  );
};

const registerEnvImportIpc = ({
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
    throw new TypeError("Import IPC dependencies are required");
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

  ipcMain.handle("secrets:importPreview", async (event, target, input) => {
    if (!admitted(event)) {
      return failure("IMPORT_INVALID_SENDER", "Import could not be completed.");
    }
    if (!validTarget(target) || (!isTextInput(input) && !isFileInput(input))) {
      return failure(
        "IMPORT_INVALID_INPUT",
        "Choose text or a file to import."
      );
    }

    if (input.source === "text") {
      return coordinator.preview(target, input);
    }

    const captured = await coordinator.captureTarget(target);
    if (!captured?.success) {
      return safeFailure(captured);
    }
    try {
      const properties = ["openFile"];
      if (process.platform !== "linux") {
        properties.push("showHiddenFiles");
      }
      const result = await dialog.showOpenDialog(getWindow(), {
        filters: [
          { extensions: ["env", "txt"], name: "Environment Files" },
          { extensions: ["*"], name: "All Files" },
        ],
        properties,
      });
      if (
        result?.canceled ||
        !Array.isArray(result?.filePaths) ||
        result.filePaths.length === 0
      ) {
        await coordinator.discard(captured.binding);
        return { cancelled: true, success: false };
      }
      if (!admitted(event)) {
        await coordinator.discard(captured.binding);
        return failure("IMPORT_PREVIEW_INVALID", "Import was closed.");
      }
      return coordinator.preview(
        target,
        { filePath: result.filePaths[0], source: "file" },
        captured.binding
      );
    } catch {
      await coordinator.discard(captured.binding);
      return failure(
        "IMPORT_FILE_READ_FAILED",
        "The selected file could not be read."
      );
    }
  });

  ipcMain.handle("secrets:importReveal", (event, handle, key, occurrenceId) => {
    if (!admitted(event)) {
      return failure("IMPORT_INVALID_SENDER", "Import could not be completed.");
    }
    return coordinator.reveal(handle, key, occurrenceId);
  });

  ipcMain.handle("secrets:importCommit", async (event, handle, decisions) => {
    if (!admitted(event)) {
      return failure("IMPORT_INVALID_SENDER", "Import could not be completed.");
    }
    const result = await coordinator.commit(handle, decisions);
    if (result?.success) {
      try {
        logger?.logApp?.(
          `Environment import completed: ${result.added} added, ${result.replaced} replaced, ${result.skipped} skipped`
        );
      } catch {
        // Audit logging is best effort after the import has committed.
      }
    }
    return result;
  });

  ipcMain.handle("secrets:importDiscard", (event, handle) => {
    if (!admitted(event)) {
      return failure("IMPORT_INVALID_SENDER", "Import could not be completed.");
    }
    if (typeof handle !== "string" || handle.length === 0) {
      return { success: true };
    }
    return coordinator.discard(handle);
  });

  attachWindowCleanup();
  return { attachWindowCleanup };
};

export = registerEnvImportIpc;
