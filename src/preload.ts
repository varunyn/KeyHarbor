const { contextBridge, ipcRenderer } = require("electron");

const api = {
  app: {
    quit: () => ipcRenderer.invoke("app:quit"),
  },
  approval: {
    onResponse: (listener) => ipcRenderer.on("approval:response", listener),
    sendData: (data) => ipcRenderer.send("approval:data", data),
  },
  cli: {
    check: () => ipcRenderer.invoke("cli:check"),
    install: () => ipcRenderer.invoke("cli:install"),
    uninstall: () => ipcRenderer.invoke("cli:uninstall"),
  },
  dialog: {
    selectFolder: () => ipcRenderer.invoke("dialog:selectFolder"),
  },
  favorite: {
    toggleProject: (projectName) =>
      ipcRenderer.invoke("favorite:toggleProject", projectName),
    toggleSecret: (target, secretKey) =>
      ipcRenderer.invoke("favorite:toggleSecret", target, secretKey),
  },
  favorites: {
    get: () => ipcRenderer.invoke("favorites:get"),
  },
  i18n: {
    getTranslations: () => ipcRenderer.invoke("i18n:getTranslations"),
    onLocaleChanged: (listener) => {
      if (typeof listener !== "function") {
        return () => {
          // No listener was registered; there is nothing to unsubscribe.
        };
      }
      const handler = (_event, data) => {
        ipcRenderer.removeListener("i18n:localeChanged", handler);
        listener(data);
      };
      ipcRenderer.on("i18n:localeChanged", handler);
      return () => ipcRenderer.removeListener("i18n:localeChanged", handler);
    },
  },
  logs: {
    clear: () => ipcRenderer.invoke("logs:clear"),
    export: () => ipcRenderer.invoke("logs:export"),
    get: () => ipcRenderer.invoke("logs:get"),
  },
  navigate: (page) => ipcRenderer.invoke("navigate", page),
  onWindowFocusChanged: (listener) => {
    if (typeof listener !== "function") {
      return () => {
        // No listener was registered; there is nothing to unsubscribe.
      };
    }
    const handler = (_event, focused) => listener(focused);
    ipcRenderer.on("window-focus-changed", handler);
    return () => ipcRenderer.removeListener("window-focus-changed", handler);
  },
  projects: {
    backup: (projectName) => ipcRenderer.invoke("projects:backup", projectName),
    configurationClearPreview: (target) =>
      ipcRenderer.invoke("projects:configurationClearPreview", target),
    configurationCommit: (handle) =>
      ipcRenderer.invoke("projects:configurationCommit", handle),
    configurationDiscard: (handle) =>
      ipcRenderer.invoke("projects:configurationDiscard", handle),
    configurationGet: (target) =>
      ipcRenderer.invoke("projects:configurationGet", target),
    configurationPreview: (target, input) =>
      ipcRenderer.invoke("projects:configurationPreview", target, input),
    create: (name) => ipcRenderer.invoke("project:create", name),
    createEnvironment: (projectName, name) =>
      ipcRenderer.invoke("project:environment:create", projectName, name),
    delete: (name) => ipcRenderer.invoke("project:delete", name),
    deleteEnvironment: (target, replacementDefaultEnvironmentId) =>
      ipcRenderer.invoke(
        "project:environment:delete",
        target,
        replacementDefaultEnvironmentId
      ),
    environments: (projectName) =>
      ipcRenderer.invoke("projects:environments", projectName),
    get: () => ipcRenderer.invoke("projects:get"),
    renameEnvironment: (target, name) =>
      ipcRenderer.invoke("project:environment:rename", target, name),
  },
  secrets: {
    delete: (target, key) => ipcRenderer.invoke("secret:delete", target, key),
    export: (target, mode = "raw", options = {}) =>
      ipcRenderer.invoke("secrets:export", target, mode, options),
    get: (target, key) => ipcRenderer.invoke("secret:get", target, key),
    getAll: (target) => ipcRenderer.invoke("secrets:get", target),
    getHistory: (target, key) =>
      ipcRenderer.invoke("secret:getHistory", target, key),
    importCommit: (handle, decisions) =>
      ipcRenderer.invoke("secrets:importCommit", handle, decisions),
    importDiscard: (handle) =>
      ipcRenderer.invoke("secrets:importDiscard", handle),
    importPreview: (target, input) =>
      ipcRenderer.invoke("secrets:importPreview", target, input),
    importReveal: (handle, key, occurrenceId) =>
      ipcRenderer.invoke("secrets:importReveal", handle, key, occurrenceId),
    rename: (target, fromKey, toKey) =>
      ipcRenderer.invoke("secret:rename", target, fromKey, toKey),
    restoreVersion: (target, key, versionIndex) =>
      ipcRenderer.invoke("secret:restoreVersion", target, key, versionIndex),
    set: (target, key, value, expiresAt = null, meta = {}) =>
      ipcRenderer.invoke("secret:set", target, key, value, expiresAt, meta),
    update: (target, fromKey, toKey, value, expiresAt = null, meta = {}) =>
      ipcRenderer.invoke(
        "secret:update",
        target,
        fromKey,
        toKey,
        value,
        expiresAt,
        meta
      ),
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (settings) => ipcRenderer.invoke("settings:set", settings),
  },
  statistics: {
    get: () => ipcRenderer.invoke("statistics:get"),
  },
  theme: {
    get: () => ipcRenderer.invoke("theme:get"),
    onThemeChanged: (listener) => {
      if (typeof listener !== "function") {
        return () => {
          // No listener was registered; there is nothing to unsubscribe.
        };
      }
      const handler = (_event, data) => listener(data);
      ipcRenderer.on("theme:changed", handler);
      return () => ipcRenderer.removeListener("theme:changed", handler);
    },
  },
  touchId: {
    getStatus: () => ipcRenderer.invoke("touch-id:getStatus"),
    setEnabled: (enabled) => ipcRenderer.invoke("touch-id:setEnabled", enabled),
    unlock: () => ipcRenderer.invoke("touch-id:unlock"),
  },
  vault: {
    changePassword: (currentPassword, newPassword) =>
      ipcRenderer.invoke("vault:changePassword", currentPassword, newPassword),
    create: (name, folderPath, password) =>
      ipcRenderer.invoke("vault:create", name, folderPath, password),
    delete: () => ipcRenderer.invoke("vault:delete"),
    exists: () => ipcRenderer.invoke("vault:exists"),
    import: (name, lkvPath, password) =>
      ipcRenderer.invoke("vault:import", name, lkvPath, password),
    instanceIdentity: () => ipcRenderer.invoke("vault:instanceIdentity"),
    list: () => ipcRenderer.invoke("vaults:list"),
    lock: () => ipcRenderer.invoke("vault:lock"),
    onReconciliationRequired: (listener) => {
      if (typeof listener !== "function") {
        return () => {
          // No listener was registered; there is nothing to unsubscribe.
        };
      }
      const handler = (_event, payload) => listener(payload);
      ipcRenderer.on("vault:reconciliation-required", handler);
      return () =>
        ipcRenderer.removeListener("vault:reconciliation-required", handler);
    },
    onSessionStateChanged: (listener) => {
      if (typeof listener !== "function") {
        return () => {
          // No listener was registered; there is nothing to unsubscribe.
        };
      }
      const handler = (_event, snapshot) => listener(snapshot);
      ipcRenderer.on("vault:session-state-changed", handler);
      return () =>
        ipcRenderer.removeListener("vault:session-state-changed", handler);
    },
    onVaultDataSynced: (listener) => {
      if (typeof listener !== "function") {
        return () => {
          // No listener was registered; there is nothing to unsubscribe.
        };
      }
      const handler = () => listener();
      ipcRenderer.on("vault:data-synced", handler);
      return () => ipcRenderer.removeListener("vault:data-synced", handler);
    },
    reconcileExternalChange: (origin) =>
      ipcRenderer.invoke("vault:reconcileExternalChange", origin),
    remove: (vaultId) => ipcRenderer.invoke("vault:remove", vaultId),
    rename: (vaultId, newName) =>
      ipcRenderer.invoke("vault:rename", vaultId, newName),
    resolveReconciliation: (reconciliationId, decision) =>
      ipcRenderer.invoke(
        "vault:resolveReconciliation",
        reconciliationId,
        decision
      ),
    save: () => ipcRenderer.invoke("vault:save"),
    sessionSnapshot: () => ipcRenderer.invoke("vault:sessionSnapshot"),
    setup: (password) => ipcRenderer.invoke("vault:setup", password),
    switch: (vaultId) => ipcRenderer.invoke("vault:switch", vaultId),
    unlock: (password) => ipcRenderer.invoke("vault:unlock", password),
    verifyPassword: (password) =>
      ipcRenderer.invoke("vault:verifyPassword", password),
  },
};
contextBridge.exposeInMainWorld("keyharbor", api);
contextBridge.exposeInMainWorld("platform", process.platform);
contextBridge.exposeInMainWorld("isDev", process.argv.includes("--dev"));
contextBridge.exposeInMainWorld("electronAPI", {
  onApprovalData: (listener) => {
    const handler = (_event, data) => listener(data);
    ipcRenderer.on("approval:data", handler);
    return () => ipcRenderer.removeListener("approval:data", handler);
  },
  sendApprovalResponse: (approved, channel) => {
    if (channel) {
      ipcRenderer.send(channel, approved);
    }
  },
});
