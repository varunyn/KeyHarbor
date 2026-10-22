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
            coordinator.clear({ preserveFolderHandoff: true });
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

  ipcMain.handle("secrets:importFolderStage", (event, target, directory) => {
    if (
      !admitted(event) ||
      event.senderFrame !== getWindow()?.webContents.mainFrame ||
      !validTarget(target) ||
      typeof directory !== "string" ||
      !directory ||
      directory.length > 32_768 ||
      directory.includes("\0")
    ) {
      return failure("IMPORT_INVALID_INPUT", "Choose a project folder.");
    }
    return coordinator.stageFolder(target, directory);
  });
  ipcMain.handle("secrets:importFolderResume", (event, target) => {
    if (
      !admitted(event) ||
      event.senderFrame !== getWindow()?.webContents.mainFrame ||
      !validTarget(target)
    ) {
      return failure("IMPORT_INVALID_INPUT", "Choose a project folder.");
    }
    return coordinator.resumeFolder(target);
  });

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
        buttonLabel: "Review",
        message: "Choose a UTF-8 .env file to review before importing.",
        properties,
        title: "Choose a file to import",
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

  ipcMain.handle(
    "secrets:importFolderScan",
    async (event, target, folderPath) => {
      if (!admitted(event)) {
        return failure(
          "IMPORT_INVALID_SENDER",
          "Import could not be completed."
        );
      }
      if (
        !validTarget(target) ||
        (folderPath !== undefined &&
          (typeof folderPath !== "string" ||
            !folderPath ||
            folderPath.length > 32_768 ||
            folderPath.includes("\0")))
      ) {
        return failure("IMPORT_INVALID_INPUT", "Choose a project folder.");
      }
      const captured = await coordinator.captureTarget(target);
      if (!captured.success) {
        return safeFailure(captured);
      }
      try {
        let directory = folderPath;
        if (directory === undefined) {
          const result = await dialog.showOpenDialog(getWindow(), {
            buttonLabel: "Scan folder",
            properties: ["openDirectory"],
            title: "Choose a project folder",
          });
          if (result.canceled || !result.filePaths?.[0]) {
            await coordinator.discard(captured.binding);
            return { cancelled: true, success: false };
          }
          [directory] = result.filePaths;
        }
        if (!admitted(event)) {
          await coordinator.discard(captured.binding);
          return failure("IMPORT_STALE", "Import was closed.");
        }
        return await coordinator.scanFolder(
          target,
          directory,
          captured.binding
        );
      } catch {
        await coordinator.discard(captured.binding);
        return failure(
          "IMPORT_FOLDER_UNAVAILABLE",
          "The selected folder could not be scanned."
        );
      }
    }
  );

  ipcMain.handle(
    "secrets:importFolderPreview",
    (event, target, scanId, fileId) => {
      if (!admitted(event)) {
        return failure(
          "IMPORT_INVALID_SENDER",
          "Import could not be completed."
        );
      }
      if (
        !validTarget(target) ||
        typeof scanId !== "string" ||
        typeof fileId !== "string"
      ) {
        return failure(
          "IMPORT_INVALID_INPUT",
          "Choose a file from the scanned folder."
        );
      }
      return coordinator.previewFolderFile(target, scanId, fileId);
    }
  );

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
