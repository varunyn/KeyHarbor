import type Vault = require("./modules/vault");

const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  Tray,
  Menu,
  nativeImage,
  nativeTheme,
  powerMonitor,
  systemPreferences,
  safeStorage,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const crypto = require("node:crypto");
const https = require("node:https");
const { URL } = require("node:url");
const windowStateKeeper = require("electron-window-state");

const { getAppDataPath } = require("./modules/app-data-path");
const VaultManager = require("./modules/vault-manager");
const Logger = require("./modules/logger");
const HttpServer = require("./modules/http-server");
const I18n = require("./modules/i18n");
const TouchIdUnlock = require("./modules/touch-id-unlock");
const VaultSession = require("./modules/vault-session");
const VaultRecoveryStore = require("./modules/vault-recovery-store");
const ShutdownCoordinator = require("./modules/shutdown-coordinator");
const EnvTextImportCoordinator = require("./modules/env-text-import-coordinator");
const registerEnvTextImportIpc = require("./modules/env-text-import-ipc");
const ProjectConfigurationCoordinator = require("./modules/project-configuration-coordinator");
const registerProjectConfigurationIpc = require("./modules/project-configuration-ipc");
const { isNewerVersion } = require("./modules/version");
const {
  registerEnvironmentManagementIpc,
} = require("./modules/environment-management-ipc");

/** Canonical desktop target: one Environment inside one Project. */
type EnvironmentTarget = Readonly<{
  projectName: string;
  environmentId: string;
}>;

/** Authoritative, session-bound identity captured for review and approval. */
interface ApprovalTarget {
  vaultId: string | null;
  vaultName: string;
  vaultInstanceId: string | null;
  sessionTransitionId: number | string | undefined;
  projectName: string;
  projectIncarnation: string | null;
  environmentId: string;
  environmentName: string;
  environmentIncarnation: string | null;
}

type ApprovalRequest = ApprovalTarget & {
  keys: string[];
  action: "read" | "write";
};

interface ApprovalDecision {
  approved: boolean;
  reason?: string;
}

interface SessionSnapshot {
  state: string;
  transitionId: number;
  activeVaultId?: string | null;
  recovery: unknown[];
  warnings: unknown[];
}

interface BridgeFailure {
  success: false;
  error?: string;
  code?: string;
  [key: string]: unknown;
}

type ActiveVault = Vault;

let mainWindow: InstanceType<typeof BrowserWindow> | null = null;
let vaultManager: InstanceType<typeof VaultManager> | null = null;
let logger: InstanceType<typeof Logger> | null = null;
let httpServer: InstanceType<typeof HttpServer> | null = null;
let vaultSession: InstanceType<typeof VaultSession> | null = null;
let envTextImportCoordinator: InstanceType<
  typeof EnvTextImportCoordinator
> | null = null;
let projectConfigurationCoordinator: InstanceType<
  typeof ProjectConfigurationCoordinator
> | null = null;
let attachEnvImportWindowCleanup: () => void = () => {
  // IPC cleanup is installed during handler registration.
};
let attachProjectConfigurationWindowCleanup: () => void = () => {
  // IPC cleanup is installed during handler registration.
};
let shutdownCoordinator: InstanceType<typeof ShutdownCoordinator> | null = null;
let tray: InstanceType<typeof Tray> | null = null;
let isQuitting = false;
let i18n: InstanceType<typeof I18n> | null = null;
let touchIdUnlock: InstanceType<typeof TouchIdUnlock> | null = null;

let appInitialized = false;
let ipcHandlersInitialized = false;

const loadRendererPage = (window, page) => {
  if (typeof page !== "string" || !/^[a-z-]+\.html$/u.test(page)) {
    throw new TypeError("Invalid renderer page");
  }
  const rendererPath = path.join(__dirname, "renderer-build", "views", page);
  if (!fs.existsSync(rendererPath)) {
    throw new Error(
      `Built renderer page is missing: ${rendererPath}. Run npm run build:renderer before launching KeyHarbor.`
    );
  }
  return window.loadFile(rendererPath);
};

const KEYHARBOR_DIR = getAppDataPath();
const SETTINGS_FILE = path.join(KEYHARBOR_DIR, "settings.json");
const TOUCH_ID_CREDENTIAL_FILE = path.join(KEYHARBOR_DIR, "touch-id-key.enc");
const RECOVERY_DIR = path.join(KEYHARBOR_DIR, "recovery");

export type AppTheme = "system" | "light" | "dark";

const DEFAULT_SETTINGS = {
  autoLock: {
    enabled: true,
    timeout: 30,
  },
  checkForUpdates: true,
  locale: "system",
  screenCaptureProtection: true,
  showStatistics: true,
  theme: "system" as AppTheme,
  touchIdUnlockEnabled: false,
  vaultDiskSyncIntervalSeconds: 5,
};

interface AppSettings {
  checkForUpdates: boolean;
  locale: string;
  showStatistics: boolean;
  theme: AppTheme;
  autoLock: { enabled: boolean; timeout: number };
  screenCaptureProtection: boolean;
  vaultDiskSyncIntervalSeconds: number;
  touchIdUnlockEnabled: boolean;
}

type LoadedSettings = AppSettings & {
  __loadStatus?: "ok" | "repaired" | "reset";
  __repairs?: string[];
};

const coerceBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const coerceString = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim() ? value : fallback;

const coerceTheme = (value: unknown): AppTheme => {
  if (value === "light" || value === "dark" || value === "system") {
    return value;
  }
  return DEFAULT_SETTINGS.theme;
};

const coerceAutoLockTimeout = (value: unknown, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const coerced = Math.floor(value);
  if (coerced < 1) {
    return 1;
  }
  if (coerced > 1440) {
    return 1440;
  }
  return coerced;
};

const coerceVaultDiskSyncIntervalSeconds = (value: unknown): number => {
  const n =
    typeof value === "number" && Number.isFinite(value)
      ? Math.floor(value)
      : Number.NaN;
  if (n === 60) {
    return 60;
  }
  return 5;
};

const normalizeSettings = (
  settings?: Partial<AppSettings> | null
): {
  normalized: AppSettings;
  repairs: string[];
} => {
  const safeSettings =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {};
  const safeAutoLock =
    safeSettings.autoLock &&
    typeof safeSettings.autoLock === "object" &&
    !Array.isArray(safeSettings.autoLock)
      ? (safeSettings.autoLock as Record<string, unknown>)
      : {};

  const normalized: AppSettings = {
    autoLock: {
      enabled: coerceBoolean(
        safeAutoLock.enabled,
        DEFAULT_SETTINGS.autoLock.enabled
      ),
      timeout: coerceAutoLockTimeout(
        safeAutoLock.timeout,
        DEFAULT_SETTINGS.autoLock.timeout
      ),
    },
    checkForUpdates: coerceBoolean(
      safeSettings.checkForUpdates,
      DEFAULT_SETTINGS.checkForUpdates
    ),
    locale: coerceString(safeSettings.locale, DEFAULT_SETTINGS.locale),
    screenCaptureProtection: coerceBoolean(
      safeSettings.screenCaptureProtection,
      DEFAULT_SETTINGS.screenCaptureProtection
    ),
    showStatistics: coerceBoolean(
      safeSettings.showStatistics,
      DEFAULT_SETTINGS.showStatistics
    ),
    theme: coerceTheme(safeSettings.theme),
    touchIdUnlockEnabled: coerceBoolean(
      safeSettings.touchIdUnlockEnabled,
      DEFAULT_SETTINGS.touchIdUnlockEnabled
    ),
    vaultDiskSyncIntervalSeconds: coerceVaultDiskSyncIntervalSeconds(
      safeSettings.vaultDiskSyncIntervalSeconds
    ),
  };

  const repairs: string[] = [];
  if (normalized.checkForUpdates !== safeSettings.checkForUpdates) {
    repairs.push("checkForUpdates");
  }
  if (normalized.locale !== safeSettings.locale) {
    repairs.push("locale");
  }
  if (normalized.showStatistics !== safeSettings.showStatistics) {
    repairs.push("showStatistics");
  }
  if (normalized.autoLock.enabled !== safeAutoLock.enabled) {
    repairs.push("autoLock.enabled");
  }
  if (normalized.autoLock.timeout !== safeAutoLock.timeout) {
    repairs.push("autoLock.timeout");
  }
  if (
    normalized.screenCaptureProtection !== safeSettings.screenCaptureProtection
  ) {
    repairs.push("screenCaptureProtection");
  }
  if (
    normalized.vaultDiskSyncIntervalSeconds !==
    safeSettings.vaultDiskSyncIntervalSeconds
  ) {
    repairs.push("vaultDiskSyncIntervalSeconds");
  }
  if (normalized.theme !== safeSettings.theme) {
    repairs.push("theme");
  }
  if (normalized.touchIdUnlockEnabled !== safeSettings.touchIdUnlockEnabled) {
    repairs.push("touchIdUnlockEnabled");
  }

  return { normalized, repairs };
};

const openExternalSafely = (rawUrl: string) => {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return;
    }
    shell.openExternal(parsed.toString());
  } catch {
    // Best-effort desktop cleanup must not replace the primary action result.
  }
};

const saveSettings = (
  settings?: Partial<AppSettings> | null
): {
  success: boolean;
  error?: string;
} => {
  try {
    const { normalized } = normalizeSettings(settings);
    try {
      fs.mkdirSync(KEYHARBOR_DIR, { recursive: true });
    } catch {
      // Best-effort desktop cleanup must not replace the primary action result.
    }

    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(normalized, null, 2));
    try {
      fs.chmodSync(SETTINGS_FILE, 0o600);
    } catch {
      // Best-effort desktop cleanup must not replace the primary action result.
    }
    return { success: true };
  } catch (error) {
    console.error("Failed to save settings:", error);
    return { error: error.message, success: false };
  }
};

const loadSettings = (): LoadedSettings => {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = fs.readFileSync(SETTINGS_FILE, "utf-8");
      const parsed = JSON.parse(data);
      const { normalized, repairs } = normalizeSettings(parsed);

      if (repairs.length > 0) {
        try {
          saveSettings(normalized);
        } catch {
          // Best-effort desktop cleanup must not replace the primary action result.
        }
        return { ...normalized, __loadStatus: "repaired", __repairs: repairs };
      }

      return { ...normalized, __loadStatus: "ok", __repairs: [] };
    }
  } catch (error) {
    console.error("Failed to load settings:", error);
    const { normalized } = normalizeSettings();
    try {
      saveSettings(normalized);
    } catch {
      // Best-effort desktop cleanup must not replace the primary action result.
    }
    return {
      ...normalized,
      __loadStatus: "reset",
      __repairs: ["__invalidFile"],
    };
  }
  const { normalized } = normalizeSettings();
  return { ...normalized, __loadStatus: "ok", __repairs: [] };
};

const getThemeBackgroundColor = (shouldUseDarkColors: boolean): string =>
  shouldUseDarkColors ? "#1a1a1a" : "#f8fafc";

const applyTheme = (theme: AppTheme) => {
  nativeTheme.themeSource = theme;
  const { shouldUseDarkColors } = nativeTheme;
  const bg = getThemeBackgroundColor(shouldUseDarkColors);
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.setBackgroundColor(bg);
      win.webContents.send("theme:changed", {
        shouldUseDarkColors,
        theme,
      });
    } catch {
      // Best-effort desktop cleanup must not replace the primary action result.
    }
  }
};

const setTouchIdUnlockEnabled = (enabled: boolean) => {
  const settings = loadSettings();
  return saveSettings({ ...settings, touchIdUnlockEnabled: enabled === true });
};

const getTouchIdStatus = (): { available: boolean; enabled: boolean } => {
  const settings = loadSettings();
  return touchIdUnlock
    ? touchIdUnlock.getStatus(settings.touchIdUnlockEnabled)
    : { available: false, enabled: false };
};

const isVaultSessionActive = (): boolean =>
  vaultSession?.snapshot().state === "active";

const sessionErrorResponse = (value: unknown): BridgeFailure => {
  const error = value as { message?: string; code?: string } | null;
  return {
    error: error?.message || String(value),
    success: false,
    ...(error?.code ? { code: error.code } : {}),
  };
};

/** Desktop Secret operations require an explicit Project and Environment ID. */
const validEnvironmentTarget = (
  target: unknown
): target is EnvironmentTarget => {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    return false;
  }
  const candidate = target as Record<string, unknown>;
  return (
    Object.keys(candidate).length === 2 &&
    Object.hasOwn(candidate, "projectName") &&
    Object.hasOwn(candidate, "environmentId") &&
    typeof candidate.projectName === "string" &&
    candidate.projectName.trim().length > 0 &&
    typeof candidate.environmentId === "string" &&
    candidate.environmentId.length > 0
  );
};

const captureApprovalTarget = (
  activeVault: ActiveVault,
  target: EnvironmentTarget
): ApprovalTarget => {
  const session = (vaultSession?.snapshot?.() ||
    {}) as Partial<SessionSnapshot>;
  const identity = activeVault.getEnvironmentTargetIdentity(target);
  const vaultId =
    activeVault.getVaultId?.() || session.activeVaultId || "system";
  const vaultName =
    vaultManager?.getVaultList?.().find((entry) => entry.id === vaultId)
      ?.name || "System";
  return {
    environmentId: identity.environmentId,
    environmentIncarnation: identity.environmentIncarnation,
    environmentName: identity.environmentName,
    projectIncarnation: identity.projectIncarnation,
    projectName: identity.projectName,
    sessionTransitionId: session.transitionId,
    vaultId,
    vaultInstanceId: activeVault.getVaultInstanceId(),
    vaultName,
  };
};

/** Canonical form so data drift during a native picker is detected, not exported. */
const canonicalValue = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalValue).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  // Sorting only a new array preserves the record and the canonical byte representation.
  return `{${Object.keys(record)
    // eslint-disable-next-line unicorn/no-array-sort
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalValue(record[key])}`)
    .join(",")}}`;
};

/**
 * Project backup admission captured before the native save picker. It binds the
 * session, Vault instance, Project incarnation, and default Environment, so a
 * Vault switch or delete/recreate rejects instead of exporting a different
 * Project than the one the user reviewed.
 */
interface ProjectBackupIdentity {
  sessionTransitionId: number | string | undefined;
  vaultId: string | null;
  vaultInstanceId: string | null;
  projectName: string;
  projectIncarnation: string | null;
  defaultEnvironmentId: string;
  fingerprint: string;
}

const captureProjectBackupIdentity = (
  activeVault: ActiveVault,
  projectName: string
): { identity: ProjectBackupIdentity; encryptedBackup: Buffer } => {
  const session = (vaultSession?.snapshot?.() ||
    {}) as Partial<SessionSnapshot>;
  const snapshot = activeVault.captureProjectBackupSnapshot(projectName);
  return {
    encryptedBackup: snapshot.encryptedBackup,
    identity: {
      defaultEnvironmentId: snapshot.defaultEnvironmentId,
      fingerprint: snapshot.fingerprint,
      projectIncarnation: snapshot.projectIncarnation ?? null,
      projectName,
      sessionTransitionId: session.transitionId,
      vaultId: snapshot.vaultId ?? null,
      vaultInstanceId: snapshot.vaultInstanceId ?? null,
    },
  };
};

const sameProjectBackupIdentity = (
  left: ProjectBackupIdentity,
  right: ProjectBackupIdentity
): boolean =>
  left.sessionTransitionId === right.sessionTransitionId &&
  left.vaultId === right.vaultId &&
  left.vaultInstanceId === right.vaultInstanceId &&
  left.projectName === right.projectName &&
  left.projectIncarnation === right.projectIncarnation &&
  left.defaultEnvironmentId === right.defaultEnvironmentId &&
  left.fingerprint === right.fingerprint;

const sameApprovalTarget = (
  left: ApprovalTarget,
  right: ApprovalTarget
): boolean =>
  left.vaultId === right.vaultId &&
  left.vaultName === right.vaultName &&
  left.vaultInstanceId === right.vaultInstanceId &&
  left.sessionTransitionId === right.sessionTransitionId &&
  left.projectName === right.projectName &&
  left.projectIncarnation === right.projectIncarnation &&
  left.environmentId === right.environmentId &&
  left.environmentName === right.environmentName &&
  left.environmentIncarnation === right.environmentIncarnation;

const completePendingRecovery = async (
  openResult: SessionSnapshot & Record<string, unknown>
) => {
  let result = openResult;
  const session = vaultSession;
  if (!session) {
    return result;
  }
  while (result.state === "recovering") {
    const [item] = session.snapshot().recovery;
    if (!item) {
      break;
    }
    const canUseCurrent = item.allowedDecisions.includes("use_current");
    const canDefer = item.allowedDecisions.includes("defer");
    const buttons: string[] = ["Keep recovered data"];
    if (canUseCurrent) {
      buttons.push("Use current disk data");
    }
    buttons.push(canDefer ? "Defer this Vault" : "Cancel unlock");
    // Recovery dialogs must be answered sequentially before the next artifact is examined.
    // eslint-disable-next-line no-await-in-loop
    const choice = await dialog.showMessageBox(mainWindow, {
      buttons,
      cancelId: buttons.length - 1,
      defaultId: 0,
      detail:
        "Choose which authenticated data should be used. The other version will not be overwritten without your choice.",
      message:
        "KeyHarbor found protected session changes that need a recovery decision.",
      noLink: true,
      title: "Vault recovery required",
      type: "warning",
    });
    const selected = buttons[choice.response];
    if (selected === "Cancel unlock") {
      // Cancel unlock must finish closing this recovery session before returning its locked snapshot.
      // eslint-disable-next-line no-await-in-loop
      await session.close({ reason: "manual" });
      return {
        outcome: "recovery_deferred",
        state: "locked",
        transitionId: result.transitionId,
      };
    }
    const choices = {
      "Keep recovered data": "keep_recovered",
      "Use current disk data": "use_current",
    };
    const decision = choices[selected as keyof typeof choices] ?? "defer";
    // Each authenticated recovery decision changes the snapshot used by the next iteration.
    // eslint-disable-next-line no-await-in-loop
    await session.resolveRecovery({
      artifactId: item.artifactId,
      capsuleId: item.capsuleId,
      decision,
      kind: item.kind,
    });
    const previousResult = result;
    result = { ...previousResult, ...session.snapshot() };
  }
  return result;
};

const attachVaultConflictNotifier = () => {
  if (!vaultManager) {
    return;
  }
  vaultManager.setConflictNotifier((payload) => {
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    if (win) {
      try {
        win.webContents.send("vault:reconciliation-required", payload);
      } catch {
        // Best-effort desktop cleanup must not replace the primary action result.
      }
    }
  });
};

const getSystemVault = () => (vaultManager ? vaultManager.systemVault : null);

const showApprovalDialog = (
  request: Partial<ApprovalRequest>,
  signal: AbortSignal | null = null
): Promise<ApprovalDecision> => {
  const projectName = request?.projectName || "";
  const keys = Array.isArray(request?.keys) ? request.keys : [];
  const action = request?.action === "write" ? "write" : "read";
  // Convert native window, IPC, and abort events into one settled approval decision.
  // eslint-disable-next-line promise/avoid-new
  return new Promise<ApprovalDecision>((resolve) => {
    let approvalWindow: InstanceType<typeof BrowserWindow> | null = null;
    let isResolved = false;
    let channelName = "";
    let responseHandler:
      | ((event: Electron.IpcMainEvent, approved: unknown) => void)
      | null = null;
    let abortHandler: (() => void) | null = null;

    const targetLog = {
      action,
      environmentId: request?.environmentId,
      environmentName: request?.environmentName,
      projectName,
      vaultId: request?.vaultId ?? null,
      vaultInstanceId: request?.vaultInstanceId ?? null,
    };

    const cleanup = () => {
      if (channelName && responseHandler) {
        try {
          ipcMain.removeListener(channelName, responseHandler);
        } catch {
          // Best-effort desktop cleanup must not replace the primary action result.
        }
      }
      if (signal && abortHandler) {
        signal.removeEventListener("abort", abortHandler);
      }
      if (approvalWindow && !approvalWindow.isDestroyed()) {
        approvalWindow.close();
        approvalWindow = null;
      }
    };

    const doResolve = (result: ApprovalDecision) => {
      if (isResolved) {
        return;
      }
      isResolved = true;
      cleanup();
      resolve(result);
    };

    abortHandler = () =>
      doResolve({ approved: false, reason: "Session closing" });
    if (signal?.aborted) {
      abortHandler();
      return;
    }
    signal?.addEventListener("abort", abortHandler, { once: true });

    try {
      approvalWindow = new BrowserWindow({
        alwaysOnTop: true,
        backgroundColor: getThemeBackgroundColor(
          nativeTheme.shouldUseDarkColors
        ),
        frame: false,
        height: 390,
        icon: path.join(__dirname, "assets", "icon.png"),
        modal: true,
        parent: mainWindow,
        resizable: false,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          preload: path.join(__dirname, "preload.js"),
        },
        width: 450,
      });

      loadRendererPage(approvalWindow, "approval.html");

      if (process.platform === "win32") {
        approvalWindow.setMenu(null);
      }

      channelName = `approval-response-${crypto.randomBytes(16).toString("hex")}`;

      responseHandler = (event, approved) => {
        if (!approvalWindow || approvalWindow.isDestroyed()) {
          return;
        }
        if (event?.sender?.id !== approvalWindow.webContents.id) {
          return;
        }
        // The key ARRAY is passed so every structured access event carries
        // one exact key, matching usage views on fields rather than substrings.
        if (approved) {
          doResolve({ approved: true });
        } else {
          logger?.logAccess(`Access denied (${action})`, projectName, keys, {
            ...targetLog,
            outcome: "denied",
          });
          doResolve({ approved: false, reason: "User denied" });
        }
      };

      ipcMain.once(channelName, responseHandler);

      approvalWindow.webContents.setWindowOpenHandler(({ url }) => {
        openExternalSafely(url);
        return { action: "deny" };
      });

      approvalWindow.webContents.on("will-navigate", (event, url) => {
        if (typeof url === "string" && url.startsWith("file://")) {
          return;
        }
        event.preventDefault();
        openExternalSafely(url);
      });

      approvalWindow.on("close", () => {
        if (!isResolved) {
          logger?.logAccess(`Access denied (${action})`, projectName, keys, {
            ...targetLog,
            outcome: "denied",
          });
          doResolve({ approved: false, reason: "Dialog closed" });
        }
      });

      approvalWindow.webContents.once("did-finish-load", () => {
        approvalWindow.webContents.send("approval:data", {
          action,
          channel: channelName,
          environmentId: request.environmentId,
          environmentName: request.environmentName,
          keys,
          projectName,
          vaultName: request.vaultName,
        });
      });

      approvalWindow.webContents.on(
        "did-fail-load",
        (event, errorCode, errorDescription) => {
          doResolve({
            approved: false,
            reason: `Failed to load dialog: ${errorDescription}`,
          });
        }
      );
    } catch (error) {
      doResolve({ approved: false, reason: `Error: ${error.message}` });
    }
  });
};

const ensureHttpServerStarted = async () => {
  if (!vaultManager || !logger) {
    return;
  }

  if (!httpServer) {
    httpServer = new HttpServer(vaultManager, logger, vaultSession);
    httpServer.setApprovalCallback(showApprovalDialog);
  }

  if (httpServer.server) {
    return;
  }

  try {
    await httpServer.start();
  } catch (error) {
    console.error("Failed to start HTTP server:", error);
  }
};

const getVaultDiskSyncIntervalMs = () => {
  const settings = loadSettings();
  const sec = settings.vaultDiskSyncIntervalSeconds === 60 ? 60 : 5;
  return sec * 1000;
};

const getVaultSessionPolicy = () => {
  const settings = loadSettings();
  return {
    autoLockEnabled: settings.autoLock?.enabled === true,
    autoLockTimeoutSeconds: (settings.autoLock?.timeout || 30) * 60,
    diskSyncIntervalMs: getVaultDiskSyncIntervalMs(),
  };
};

const applyScreenCaptureProtection = () => {
  const settings = loadSettings();
  const enabled = settings.screenCaptureProtection !== false;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setContentProtection(enabled);
  }
};

const getAppVersion = () => {
  try {
    const v = app.getVersion?.();
    if (typeof v === "string" && v.trim()) {
      return v.trim();
    }
  } catch {
    // Best-effort desktop cleanup must not replace the primary action result.
  }

  return "0.0.0";
};

const APP_VERSION = getAppVersion();

const createWindow = () => {
  const mainWindowState = windowStateKeeper({
    defaultHeight: 700,
    defaultWidth: 1000,
  });

  mainWindow = new BrowserWindow({
    acceptFirstMouse: true,
    backgroundColor: getThemeBackgroundColor(nativeTheme.shouldUseDarkColors),
    height: mainWindowState.height,
    icon: path.join(__dirname, "assets", "icon.png"),
    menuBarVisible: false,
    minHeight: 500,
    minWidth: 680,
    show: false,
    titleBarStyle: "default",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
    width: mainWindowState.width,
    x: mainWindowState.x,
    y: mainWindowState.y,
  });

  envTextImportCoordinator?.clear();
  projectConfigurationCoordinator?.clear();
  attachEnvImportWindowCleanup();
  attachProjectConfigurationWindowCleanup();

  mainWindowState.manage(mainWindow);

  mainWindow.on("focus", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("window-focus-changed", true);
    }
  });
  mainWindow.on("blur", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("window-focus-changed", false);
    }
  });

  applyScreenCaptureProtection();

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (typeof url === "string" && url.startsWith("file://")) {
      return;
    }
    event.preventDefault();
    openExternalSafely(url);
  });

  if (!getSystemVault()?.exists()) {
    loadRendererPage(mainWindow, "setup.html");
  } else if (isVaultSessionActive() && !getSystemVault()?.isLocked) {
    loadRendererPage(mainWindow, "dashboard.html");
    logger.logLock("Vault already unlocked - showing dashboard");
  } else {
    loadRendererPage(mainWindow, "lock.html");
  }

  mainWindow.once("ready-to-show", () => {
    if (process.platform === "win32") {
      mainWindow.setMenu(null);
    }
    mainWindow.show();
  });

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();

      if (process.platform === "darwin") {
        app.dock.hide();
      }
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
};

// Keep the Promise-returning API, including rejected Promises for synchronous session failures.
// eslint-disable-next-line require-await
const lockVault = async (reason = "manual") => {
  if (!vaultSession) {
    return {
      outcome: "already_locked",
      reason,
      state: "locked",
      vaults: [],
      warnings: [],
    };
  }
  return vaultSession.close({ reason });
};

const createTray = () => {
  if (tray) {
    tray.destroy();
  }

  const iconPath = path.join(__dirname, "assets", "icon.png");
  let iconImage;

  try {
    iconImage = nativeImage.createFromPath(iconPath);

    tray = new Tray(iconImage);

    if (process.platform === "darwin") {
      tray.setImage(iconImage.resize({ height: 16, width: 16 }));
    }
  } catch (error) {
    console.error("Failed to create tray icon:", error);

    try {
      iconImage = nativeImage.createEmpty();
      tray = new Tray(iconImage);

      if (process.platform === "darwin") {
        tray.setImage(iconImage.resize({ height: 16, width: 16 }));
      }
    } catch (fallbackError) {
      console.error("Failed to create fallback icon:", fallbackError);
      return;
    }
  }

  const showLabel = i18n ? i18n.t("tray.show") : "Show KeyHarbor";
  const lockLabel = i18n ? i18n.t("tray.lock") : "Lock Vault";
  const quitLabel = i18n ? i18n.t("tray.quit") : "Quit";

  const contextMenu = Menu.buildFromTemplate([
    {
      click: () => {
        if (process.platform === "darwin") {
          app.dock.show();
        }

        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      },
      label: showLabel,
    },
    {
      click: async () => {
        if (isVaultSessionActive()) {
          try {
            await lockVault("manual");
          } catch (error) {
            console.error("Failed to lock Vault:", error?.message || error);
          }
        }
      },
      label: lockLabel,
    },
    { type: "separator" },
    {
      click: () => {
        isQuitting = true;
        void shutdownCoordinator?.requestQuit();
      },
      label: quitLabel,
    },
  ]);

  tray.setToolTip("KeyHarbor");
  tray.setContextMenu(contextMenu);
};

// Preserve the asynchronous update-check API and its existing rejection behavior.
// eslint-disable-next-line require-await
const checkVersion = async () => {
  try {
    // Node HTTPS reports completion through response/error events, requiring a Promise adapter.
    // eslint-disable-next-line promise/avoid-new
    return new Promise((resolve) => {
      const url = new URL(
        "https://api.github.com/repos/varunyn/KeyHarbor/releases/latest"
      );

      const options = {
        headers: {
          "User-Agent": `KeyHarbor-App/${APP_VERSION}`,
        },
        method: "GET",
        timeout: 5000,
      };

      const req = https.request(url, options, (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          try {
            if (res.statusCode === 200) {
              const response = JSON.parse(data);
              const serverVersion =
                typeof response.tag_name === "string"
                  ? response.tag_name.trim().replace(/^v/u, "")
                  : "";
              resolve(
                isNewerVersion(serverVersion, APP_VERSION)
                  ? serverVersion
                  : null
              );
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        });
      });

      req.on("error", () => {
        resolve(null);
      });

      req.on("timeout", () => {
        req.destroy();
        resolve(null);
      });

      req.end();
    });
  } catch {
    return null;
  }
};

const showUpdateDialog = (newVersion) => {
  let updateWindow = new BrowserWindow({
    alwaysOnTop: false,
    frame: true,
    height: 240,
    icon: path.join(__dirname, "assets", "icon.png"),
    modal: false,
    parent: mainWindow,
    resizable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
    width: 450,
  });

  const title = i18n ? i18n.t("update.title") : "New update available";
  const description = i18n
    ? i18n.t("update.description", {
        newVersion,
        oldVersion: APP_VERSION,
      })
    : `v${APP_VERSION} ➠ v${newVersion}<br/>Click the update button to see more details.`;
  const closeText = i18n ? i18n.t("common.close") : "Close";
  const updateText = i18n ? i18n.t("update.update") : "Update";

  const updateHTML = `
    <!DOCTYPE html>
    <html lang="${i18n ? i18n.getLocale() : "en"}">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>KeyHarbor</title>
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                background-color: #1a1a1a;
                color: #e0e0e0;
                margin: 0;
                padding: 30px;
            }
            .title {
                font-size: 24px;
                font-weight: 600;
                margin-bottom: 15px;
                color: #e0e0e0;
            }
            .description {
                color: #a0a0a0;
                line-height: 1.5;
                margin-bottom: 25px;
            }
            .actions {
                display: flex;
                gap: 15px;
                justify-content: end;
            }
            .btn {
                display: flex;
                flex-direction: column;
                align-items: center;
                padding: 6px 14px;
                font-family: -apple-system, BlinkMacSystemFont, "Roboto", sans-serif;
                border-radius: 6px;
                border: none;
                color: #fff;
                background-origin: border-box;
                user-select: none;
                touch-action: manipulation;
                cursor: pointer;
                font-size: 14px;
            }
            .btn {
                background: linear-gradient(180deg, rgb(75, 145, 247) 0%, rgb(54, 122, 246) 100%);
                box-shadow: 0px 0.5px 1.5px rgba(54, 122, 246, 0.25), inset 0px 0.8px 0px -0.25px rgba(255, 255, 255, 0.2);
            }
            .btn:focus {
                box-shadow: inset 0px 0.8px 0px -0.25px rgba(255, 255, 255, 0.2), 0px 0.5px 1.5px rgba(54, 122, 246, 0.25), 0px 0px 0px 3.5px rgba(58, 108, 217, 0.5);
                outline: 0;
            }
            .btn:active {
                background: linear-gradient(180deg, rgb(107, 163, 249) 0%, #4b91f7 100%);
            }
            .btn-secondary{
                background: linear-gradient(180deg, rgb(100, 100, 100) 0%, rgb(90, 90, 90) 100%);
                box-shadow: 0px 0.5px 1.5px rgba(90, 90, 90, 0.25), inset 0px 0.8px 0px -0.25px rgba(255, 255, 255, 0.2);
            }
            .btn-secondary:focus {
                box-shadow: inset 0px 0.8px 0px -0.25px rgba(255, 255, 255, 0.2), 0px 0.5px 1.5px rgba(90, 90, 90, 0.25), 0px 0px 0px 3.5px rgba(90, 90, 90, 0.5);
                outline: 0;
            }
            .btn-secondary:active {
                background: linear-gradient(180deg, rgb(120, 120, 120) 0%, rgb(100, 100, 100) 100%);
            }
        </style>
    </head>
    <body>
        <div class="title">${title}</div>
        <div class="description">
            ${description}
        </div>
        <div class="actions">
            <button class="btn btn-secondary" onclick="closeDialog()">${closeText}</button>
            <button class="btn btn-primary" onclick="openUpdatePage()">${updateText}</button>
        </div>
        <script>
            function openUpdatePage() {
                window.open('https://github.com/varunyn/KeyHarbor/releases/latest', '_blank');
                closeDialog();
            }
            function closeDialog() {
                window.close();
            }
        </script>
    </body>
    </html>`;

  updateWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(updateHTML)}`
  );

  if (process.platform === "win32") {
    updateWindow.setMenu(null);
  }

  updateWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: "deny" };
  });

  updateWindow.webContents.on("will-navigate", (event, url) => {
    if (typeof url === "string" && url.startsWith("file://")) {
      return;
    }
    event.preventDefault();
    openExternalSafely(url);
  });

  updateWindow.on("closed", () => {
    updateWindow = null;
  });
};

const initializeApp = () => {
  if (appInitialized) {
    return;
  }
  appInitialized = true;

  if (!fs.existsSync(KEYHARBOR_DIR)) {
    fs.mkdirSync(KEYHARBOR_DIR, { recursive: true });
  }
  try {
    if (os.platform() !== "win32") {
      fs.chmodSync(KEYHARBOR_DIR, 0o700);
    }
  } catch {
    // Best-effort desktop cleanup must not replace the primary action result.
  }

  const settings = loadSettings();

  i18n = new I18n();
  i18n.initialize(settings.locale);

  logger = new Logger(path.join(KEYHARBOR_DIR, "logs.enc"));

  const recoveryStore = new VaultRecoveryStore(RECOVERY_DIR);
  vaultManager = new VaultManager(KEYHARBOR_DIR, { recoveryStore });
  vaultManager.init();

  touchIdUnlock = new TouchIdUnlock({
    credentialPath: TOUCH_ID_CREDENTIAL_FILE,
    platform: process.platform,
    safeStorage,
    systemPreferences,
  });

  vaultSession = new VaultSession({
    logger,
    monitorScheduler: {
      clearInterval: (handle) => clearInterval(handle),
      getIdleTimeSeconds: () => powerMonitor.getSystemIdleTime(),
      setInterval: (callback, milliseconds) =>
        setInterval(callback, milliseconds),
    },
    onStateChange: (snapshot) => {
      if (snapshot.state !== "active") {
        envTextImportCoordinator?.clear();
      }
      if (snapshot.state !== "active") {
        projectConfigurationCoordinator?.clear();
      }
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }
      try {
        mainWindow.webContents.send("vault:session-state-changed", snapshot);
        if (snapshot.state === "locked") {
          mainWindow.webContents.send("vault:locked");
          loadRendererPage(mainWindow, "lock.html");
        }
      } catch {
        // Best-effort desktop cleanup must not replace the primary action result.
      }
    },
    recoveryStore,
    securityCoordinator: {
      // The security coordinator contract returns a Promise even when cleanup is synchronous.
      // eslint-disable-next-line require-await
      afterKeyRotation: async (key) => {
        if (getTouchIdStatus().enabled) {
          try {
            touchIdUnlock.refresh(key);
          } catch (error) {
            console.error(
              "Failed to refresh the Touch ID credential after changing the password:",
              error.message
            );
            try {
              touchIdUnlock.disable();
              setTouchIdUnlockEnabled(false);
            } catch {
              // Best-effort desktop cleanup must not replace the primary action result.
            }
          }
        }
        const logsPath = path.join(KEYHARBOR_DIR, "logs.enc");
        if (fs.existsSync(logsPath)) {
          fs.unlinkSync(logsPath);
        }
      },
    },
    settingsProvider: getVaultSessionPolicy,
    vaultManager,
  });

  envTextImportCoordinator = new EnvTextImportCoordinator({
    session: vaultSession,
  });
  projectConfigurationCoordinator = new ProjectConfigurationCoordinator({
    session: vaultSession,
  });

  httpServer = new HttpServer(vaultManager, logger, vaultSession);

  httpServer.setApprovalCallback(showApprovalDialog);

  shutdownCoordinator = new ShutdownCoordinator({
    app,
    beforeExit: async () => {
      if (httpServer) {
        await httpServer.stop();
      }
    },
    destroyUi: () => {
      if (tray) {
        tray.destroy();
        tray = null;
      }
      for (const win of BrowserWindow.getAllWindows()) {
        win.destroy();
      }
    },
    reportError: (error) =>
      console.error("Vault shutdown failed:", error?.message || error),
    session: vaultSession,
  });

  createTray();

  if (settings.checkForUpdates) {
    // Schedule the update dialog from the existing update-check settlement without delaying initialization.
    // eslint-disable-next-line promise/prefer-await-to-then
    checkVersion().then((newVersion) => {
      if (newVersion && mainWindow) {
        setTimeout(() => {
          showUpdateDialog(newVersion);
        }, 2000);
      }
    });
  }

  try {
    const cliPath = path.join(__dirname, "..", "cli", "keyharbor.js");

    if (fs.existsSync(cliPath)) {
      if (os.platform() !== "win32") {
        try {
          fs.chmodSync(cliPath, "755");
        } catch {
          // Best-effort desktop cleanup must not replace the primary action result.
        }
      }

      try {
        const createStandaloneCli = (cliJsPath, electronPath) => {
          if (os.platform() === "win32") {
            return `@echo off
set ELECTRON_RUN_AS_NODE=1
"${electronPath}" "${cliJsPath}" %*`;
          }
          return `#!/bin/bash
ELECTRON_RUN_AS_NODE=1 "${electronPath}" "${cliJsPath}" "$@"`;
        };

        const homeDir = os.homedir();
        const targetDir =
          os.platform() === "win32"
            ? path.join(homeDir, "bin")
            : path.join(homeDir, ".local", "bin");

        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        const targetPath = path.join(
          targetDir,
          os.platform() === "win32" ? "keyharbor.cmd" : "keyharbor"
        );
        const standaloneContent = createStandaloneCli(
          cliPath,
          process.execPath
        );

        fs.writeFileSync(targetPath, standaloneContent);

        if (os.platform() !== "win32") {
          fs.chmodSync(targetPath, "755");
        }
      } catch {
        // Best-effort desktop cleanup must not replace the primary action result.
      }
    }
  } catch {
    // Best-effort desktop cleanup must not replace the primary action result.
  }
};

const encodeEnvValue = (value) => {
  const stringValue = String(value ?? "");
  const escaped = stringValue
    .replaceAll("\\", "\\\\")
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n")
    .replaceAll('"', '\\"');
  return `"${escaped}"`;
};

const writeExportFile = (filePath: string, content: string | Buffer) => {
  fs.writeFileSync(filePath, content);
  try {
    if (os.platform() !== "win32") {
      fs.chmodSync(filePath, 0o600);
    }
  } catch {
    // Best-effort desktop cleanup must not replace the primary action result.
  }
};

const reconciliationError = (value: unknown) => {
  const error = value as { message?: string; code?: string } | null;
  return {
    error: error?.message || String(error),
    success: false,
    ...(error?.code ? { code: error.code } : {}),
  };
};

const setupIpcHandlers = () => {
  if (ipcHandlersInitialized) {
    return;
  }
  ipcHandlersInitialized = true;

  registerEnvironmentManagementIpc({ ipcMain, session: vaultSession });

  ipcMain.handle("vault:instanceIdentity", async () => {
    try {
      const vaultInstanceId = await vaultSession.withActiveSession(
        ({ activeVault }) => activeVault.getVaultInstanceId()
      );
      return { data: { vaultInstanceId }, success: true };
    } catch (error) {
      return sessionErrorResponse(error);
    }
  });

  const envImportIpc = registerEnvTextImportIpc({
    coordinator: envTextImportCoordinator,
    dialog,
    getWindow: () => mainWindow,
    ipcMain,
    logger,
  });
  attachEnvImportWindowCleanup = envImportIpc.attachWindowCleanup;
  const configurationIpc = registerProjectConfigurationIpc({
    coordinator: projectConfigurationCoordinator,
    dialog,
    getWindow: () => mainWindow,
    ipcMain,
    logger,
  });
  attachProjectConfigurationWindowCleanup =
    configurationIpc.attachWindowCleanup;

  ipcMain.handle("vault:setup", async (event, password) => {
    try {
      const opened = await vaultSession.open({
        credential: password,
        method: "setup",
        reason: "setup",
      });
      const result = await completePendingRecovery(opened);
      return { success: result.state === "active", ...result };
    } catch (error) {
      return {
        error: error.message,
        success: false,
        ...(error.code ? { code: error.code } : {}),
      };
    }
  });

  ipcMain.handle("vault:exists", () => {
    try {
      return vaultManager?.systemVault?.exists?.() === true;
    } catch {
      return false;
    }
  });

  ipcMain.handle("vault:sessionSnapshot", () => vaultSession.snapshot());

  ipcMain.handle("vault:unlock", async (event, password) => {
    try {
      const opened = await vaultSession.open({
        credential: password,
        method: "password",
        reason: "manual",
      });
      const result = await completePendingRecovery(opened);

      if (getTouchIdStatus().enabled && vaultManager.systemVault.key) {
        try {
          touchIdUnlock.refresh(vaultManager.systemVault.key);
        } catch (error) {
          console.error(
            "Failed to refresh the Touch ID credential:",
            error.message
          );
        }
      }

      return { success: result.state === "active", ...result };
    } catch (error) {
      return {
        error: error.message,
        success: false,
        ...(error.code ? { code: error.code } : {}),
      };
    }
  });

  ipcMain.handle("vault:lock", async () => {
    try {
      const result = await lockVault("manual");
      return { success: result.state === "locked", ...result };
    } catch (error) {
      return {
        error: error.message,
        success: false,
        ...(error.code ? { code: error.code } : {}),
      };
    }
  });

  ipcMain.handle("vault:verifyPassword", async (event, password) => {
    try {
      const valid = await vaultSession.withActiveSession(({ activeVault }) =>
        activeVault.verifyPassword(password)
      );
      return valid
        ? { success: true }
        : { error: "Incorrect password", success: false };
    } catch (error) {
      return {
        error: error.message,
        success: false,
        ...(error.code ? { code: error.code } : {}),
      };
    }
  });

  ipcMain.handle(
    "vault:changePassword",
    async (event, currentPassword, newPassword) => {
      try {
        await vaultSession.withActiveSession(({ security }) =>
          security.changePassword(currentPassword, newPassword)
        );
        return { success: true };
      } catch (error) {
        return {
          error: error.message,
          success: false,
          ...(error.code ? { code: error.code } : {}),
        };
      }
    }
  );

  ipcMain.handle("vault:delete", async () => {
    try {
      const result = await vaultSession.destroy({ confirmation: "delete" });
      try {
        if (touchIdUnlock) {
          touchIdUnlock.disable();
        }
        setTouchIdUnlockEnabled(false);
      } catch (error) {
        console.error(
          "Failed to remove the Touch ID credential while deleting the vault:",
          error.message
        );
      }

      vaultManager.init();

      if (mainWindow && !mainWindow.isDestroyed()) {
        loadRendererPage(mainWindow, "setup.html");
      }
      return {
        success:
          result.outcome === "destroyed" || result.outcome === "already_absent",
        ...result,
      };
    } catch (error) {
      return {
        error: error.message,
        success: false,
        ...(error.code ? { code: error.code } : {}),
      };
    }
  });

  ipcMain.handle("vaults:list", async () => {
    try {
      const data = await vaultSession.withActiveSession(({ vaults }) =>
        vaults.list()
      );
      return { data, success: true };
    } catch (error) {
      return {
        error: error.message,
        success: false,
        ...(error.code ? { code: error.code } : {}),
      };
    }
  });

  ipcMain.handle("vault:switch", async (event, vaultId) => {
    try {
      await vaultSession.withActiveSession(({ vaults }) =>
        vaults.switch(vaultId)
      );
      envTextImportCoordinator.clear();
      projectConfigurationCoordinator.clear();
      return { success: true };
    } catch (error) {
      return { error: error.message, success: false };
    }
  });

  ipcMain.handle("vault:create", async (event, name, folderPath, password) => {
    try {
      const result = await vaultSession.withActiveSession(({ vaults }) =>
        vaults.create(name, folderPath, password)
      );
      envTextImportCoordinator.clear();
      projectConfigurationCoordinator.clear();
      return { data: result, success: true };
    } catch (error) {
      return { error: error.message, success: false };
    }
  });

  ipcMain.handle("vault:import", async (event, name, lkvPath, password) => {
    try {
      const result = await vaultSession.withActiveSession(({ vaults }) =>
        vaults.import(name, lkvPath, password)
      );
      envTextImportCoordinator.clear();
      projectConfigurationCoordinator.clear();
      return { data: result, success: true };
    } catch (error) {
      return { error: error.message, success: false };
    }
  });

  ipcMain.handle("vault:rename", async (event, vaultId, newName) => {
    try {
      await vaultSession.withActiveSession(({ vaults }) =>
        vaults.rename(vaultId, newName)
      );
      return { success: true };
    } catch (error) {
      return {
        error: error.message,
        success: false,
        ...(error.code ? { code: error.code } : {}),
      };
    }
  });

  ipcMain.handle("vault:remove", async (event, vaultId) => {
    try {
      await vaultSession.withActiveSession(({ vaults }) =>
        vaults.remove(vaultId)
      );
      return { success: true };
    } catch (error) {
      return {
        error: error.message,
        success: false,
        ...(error.code ? { code: error.code } : {}),
      };
    }
  });

  ipcMain.handle("dialog:selectFolder", async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled) {
        return { data: null, success: true };
      }
      return { data: result.filePaths[0], success: true };
    } catch (error) {
      return { error: error.message, success: false };
    }
  });

  ipcMain.handle("projects:get", async () => {
    try {
      const data = await vaultSession.withActiveSession(({ activeVault }) =>
        activeVault.getProjects()
      );
      return { data, success: true };
    } catch (error) {
      return sessionErrorResponse(error);
    }
  });

  ipcMain.handle("project:create", async (event, name) => {
    try {
      await vaultSession.withActiveSession(({ activeVault }) =>
        activeVault.createProject(name)
      );
      return { success: true };
    } catch (error) {
      return sessionErrorResponse(error);
    }
  });

  ipcMain.handle("project:delete", async (event, name) => {
    try {
      await vaultSession.withActiveSession(({ activeVault }) =>
        activeVault.deleteProject(name)
      );
      return { success: true };
    } catch (error) {
      return sessionErrorResponse(error);
    }
  });

  ipcMain.handle("secrets:get", async (event, target) => {
    if (!validEnvironmentTarget(target)) {
      return {
        error: "A Project and Environment are required",
        success: false,
      };
    }
    try {
      const data = await vaultSession.withActiveSession(({ activeVault }) =>
        activeVault.getSecrets(target)
      );
      return { data, success: true };
    } catch (error) {
      return sessionErrorResponse(error);
    }
  });

  ipcMain.handle(
    "secret:set",
    async (event, target, key, value, expiresAt = null, meta = {}) => {
      if (!validEnvironmentTarget(target)) {
        return {
          error: "A Project and Environment are required",
          success: false,
        };
      }
      try {
        await vaultSession.withActiveSession(({ activeVault }) =>
          activeVault.setSecret(target, key, value, expiresAt, meta)
        );
        return { success: true };
      } catch (error) {
        return sessionErrorResponse(error);
      }
    }
  );

  ipcMain.handle(
    "secret:update",
    async (
      event,
      target,
      fromKey,
      toKey,
      value,
      expiresAt = null,
      meta = {}
    ) => {
      if (!validEnvironmentTarget(target)) {
        return {
          error: "A Project and Environment are required",
          success: false,
        };
      }
      try {
        await vaultSession.withActiveSession(({ activeVault }) => {
          const didRename =
            typeof fromKey === "string" &&
            typeof toKey === "string" &&
            fromKey !== toKey;
          let renameSucceeded = false;
          try {
            if (didRename) {
              activeVault.renameSecret(target, fromKey, toKey);
              renameSucceeded = true;
            }
            activeVault.setSecret(
              target,
              didRename ? toKey : fromKey,
              value,
              expiresAt,
              meta
            );
          } catch (error) {
            if (renameSucceeded) {
              try {
                activeVault.renameSecret(target, toKey, fromKey);
              } catch {
                // Best-effort desktop cleanup must not replace the primary action result.
              }
            }
            throw error;
          }
        });
        return { success: true };
      } catch (error) {
        return sessionErrorResponse(error);
      }
    }
  );

  ipcMain.handle("secret:rename", async (event, target, fromKey, toKey) => {
    if (!validEnvironmentTarget(target)) {
      return {
        error: "A Project and Environment are required",
        success: false,
      };
    }
    try {
      await vaultSession.withActiveSession(({ activeVault }) =>
        activeVault.renameSecret(target, fromKey, toKey)
      );
      return { success: true };
    } catch (error) {
      return sessionErrorResponse(error);
    }
  });

  ipcMain.handle("secret:delete", async (event, target, key) => {
    if (!validEnvironmentTarget(target)) {
      return {
        error: "A Project and Environment are required",
        success: false,
      };
    }
    try {
      await vaultSession.withActiveSession(({ activeVault }) =>
        activeVault.deleteSecret(target, key)
      );
      return { success: true };
    } catch (error) {
      return sessionErrorResponse(error);
    }
  });

  ipcMain.handle("favorite:toggleProject", async (event, projectName) => {
    try {
      const added = await vaultSession.withActiveSession(({ activeVault }) =>
        activeVault.toggleProjectFavorite(projectName)
      );
      return { added, success: true };
    } catch (error) {
      return sessionErrorResponse(error);
    }
  });

  ipcMain.handle("favorite:toggleSecret", async (event, target, secretKey) => {
    if (!validEnvironmentTarget(target)) {
      return {
        error: "A Project and Environment are required",
        success: false,
      };
    }
    try {
      const added = await vaultSession.withActiveSession(({ activeVault }) =>
        activeVault.toggleSecretFavorite(target, secretKey)
      );
      return { added, success: true };
    } catch (error) {
      return sessionErrorResponse(error);
    }
  });

  ipcMain.handle("favorites:get", async () => {
    try {
      const favorites = await vaultSession.withActiveSession(
        ({ activeVault }) => activeVault.getFavorites()
      );
      return { data: favorites, success: true };
    } catch (error) {
      return sessionErrorResponse(error);
    }
  });

  ipcMain.handle("statistics:get", async () => {
    try {
      const data = await vaultSession.withActiveSession(({ activeVault }) => {
        const stats = activeVault.getStatistics();
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentAccessCount = logger.countCompletedAccess(
          oneDayAgo.getTime(),
          activeVault.getVaultInstanceId()
        );
        return { ...stats, recentAccessCount };
      });

      return { data, success: true };
    } catch (error) {
      return sessionErrorResponse(error);
    }
  });

  ipcMain.handle("secret:get", async (event, target, key) => {
    if (!validEnvironmentTarget(target)) {
      return {
        error: "A Project and Environment are required",
        success: false,
      };
    }
    try {
      return await vaultSession.withActiveSession(
        async ({ activeVault, signal }) => {
          const captured = captureApprovalTarget(activeVault, target);
          const secret = activeVault.getSecret(target, key);
          const result = await showApprovalDialog(
            { ...captured, action: "read", keys: [key] },
            signal
          );
          if (result.approved) {
            if (
              !sameApprovalTarget(
                captured,
                captureApprovalTarget(activeVault, target)
              ) ||
              JSON.stringify(secret) !==
                JSON.stringify(activeVault.getSecret(target, key))
            ) {
              return {
                code: "ENVIRONMENT_TARGET_STALE",
                error: "Target changed. Request approval again.",
                success: false,
              };
            }
            logger?.logAccess("Secret read", captured.projectName, [key], {
              action: "read",
              environmentId: captured.environmentId,
              environmentName: captured.environmentName,
              outcome: "approved",
              projectName: captured.projectName,
              vaultId: captured.vaultId,
              vaultInstanceId: captured.vaultInstanceId,
            });
            return { data: secret, success: true };
          }
          return { error: "Access denied", success: false };
        }
      );
    } catch (error) {
      return sessionErrorResponse(error);
    }
  });

  ipcMain.handle("secret:getHistory", async (event, target, key) => {
    if (!validEnvironmentTarget(target)) {
      return {
        error: "A Project and Environment are required",
        success: false,
      };
    }
    try {
      const history = await vaultSession.withActiveSession(({ activeVault }) =>
        activeVault.getSecretHistory(target, key)
      );
      return { data: history, success: true };
    } catch (error) {
      return sessionErrorResponse(error);
    }
  });

  ipcMain.handle(
    "secret:restoreVersion",
    async (event, target, key, versionIndex) => {
      if (!validEnvironmentTarget(target)) {
        return {
          error: "A Project and Environment are required",
          success: false,
        };
      }
      try {
        await vaultSession.withActiveSession(({ activeVault }) =>
          activeVault.restoreSecretVersion(target, key, versionIndex)
        );
        return { success: true };
      } catch (error) {
        return sessionErrorResponse(error);
      }
    }
  );

  ipcMain.handle("logs:get", async () => {
    try {
      const data = await vaultSession.withActiveSession(() => logger.getLogs());
      return { data, success: true };
    } catch (error) {
      return sessionErrorResponse(error);
    }
  });

  ipcMain.handle("logs:clear", async () => {
    try {
      await vaultSession.withActiveSession(() => logger.clearLogs());
      return { success: true };
    } catch (error) {
      return sessionErrorResponse(error);
    }
  });

  ipcMain.handle("logs:export", async () => {
    try {
      const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: `keyharbor-logs-${new Date().toISOString().split("T")[0]}.json`,
        filters: [{ extensions: ["json"], name: "JSON Files" }],
      });

      if (!result.canceled && result.filePath) {
        await vaultSession.withActiveSession(() => {
          const logs = logger.getLogs();
          const exportData = {
            exportedAt: new Date().toISOString(),
            logs,
            totalLogs: logs.length,
          };
          fs.writeFileSync(
            result.filePath,
            JSON.stringify(exportData, null, 2)
          );
          try {
            if (os.platform() !== "win32") {
              fs.chmodSync(result.filePath, 0o600);
            }
          } catch {
            // Best-effort desktop cleanup must not replace the primary action result.
          }
          logger.logApp(`Logs exported to ${result.filePath}`);
        });
        return { path: result.filePath, success: true };
      }

      return { cancelled: true, success: false };
    } catch (error) {
      return sessionErrorResponse(error);
    }
  });

  const EXPORT_MODES = ["example", "references", "raw"] as const;
  type ExportMode = (typeof EXPORT_MODES)[number];

  interface ExportAdmission {
    target: ApprovalTarget;
    secretsSnapshot: string;
    secrets: ReturnType<ActiveVault["getSecrets"]>;
  }

  ipcMain.handle(
    "secrets:export",
    async (event, target, mode = "raw", options = {}) => {
      if (!validEnvironmentTarget(target)) {
        return {
          error: "A Project and Environment are required",
          success: false,
        };
      }
      // A removed or unknown mode is rejected explicitly; it is never coerced into raw export.
      if (
        typeof mode !== "string" ||
        !EXPORT_MODES.includes(mode as ExportMode)
      ) {
        return {
          code: "EXPORT_MODE_UNSUPPORTED",
          error: `Unsupported export mode. Use one of: ${EXPORT_MODES.join(", ")}.`,
          success: false,
        };
      }
      const exportMode = mode as ExportMode;
      const exportOptions =
        options && typeof options === "object"
          ? (options as Record<string, unknown>)
          : {};
      const password =
        typeof exportOptions.password === "string"
          ? exportOptions.password
          : "";

      // Target identity AND the relevant Secret data are captured before the
      // native save picker so values changed during the picker are rejected
      // instead of exported without renewed review.
      let admission: ExportAdmission;
      try {
        admission = await vaultSession.withActiveSession(({ activeVault }) => {
          const secrets = activeVault.getSecrets(target);
          return {
            secrets,
            secretsSnapshot: canonicalValue(secrets),
            target: captureApprovalTarget(activeVault, target),
          };
        });
      } catch (error) {
        return sessionErrorResponse(error);
      }

      const captured = admission.target;
      const safeProject = encodeURIComponent(target.projectName);
      const safeEnvironment = encodeURIComponent(captured.environmentName);
      const suffix = `-${safeEnvironment}`;
      const dialogs: Record<ExportMode, Electron.SaveDialogOptions> = {
        example: {
          defaultPath: `${safeProject}${suffix}.env.example`,
          filters: [
            { extensions: ["example", "env"], name: "Env Example Files" },
          ],
        },
        raw: {
          defaultPath: `${safeProject}${suffix}.env`,
          filters: [{ extensions: ["env"], name: "Environment Files" }],
        },
        references: {
          defaultPath: `${safeProject}${suffix}.references.env`,
          filters: [{ extensions: ["env"], name: "Environment Files" }],
        },
      };
      const result = await dialog.showSaveDialog(
        mainWindow,
        dialogs[exportMode]
      );
      if (result.canceled || !result.filePath) {
        return { cancelled: true, success: false };
      }
      const exportFilePath = result.filePath;
      try {
        return await vaultSession.withActiveSession(({ activeVault }) => {
          if (
            !sameApprovalTarget(
              captured,
              captureApprovalTarget(activeVault, target)
            )
          ) {
            return {
              code: "ENVIRONMENT_TARGET_STALE",
              error:
                "Target changed while choosing a file. Start the export again.",
              success: false,
            };
          }
          if (
            canonicalValue(activeVault.getSecrets(target)) !==
            admission.secretsSnapshot
          ) {
            return {
              code: "ENVIRONMENT_TARGET_STALE",
              error:
                "Secrets changed while choosing a file. Review and export again.",
              success: false,
            };
          }
          if (exportMode === "raw" && !activeVault.verifyPassword(password)) {
            return { error: "Incorrect password", success: false };
          }
          const { secrets } = admission;
          const lines: string[] = [];
          for (const [key, secret] of Object.entries(secrets)) {
            if (typeof key !== "string" || /[\r\n\0=]/u.test(key)) {
              return {
                error: `Invalid key for .env export: ${String(key)}`,
                success: false,
              };
            }
            if (exportMode === "example") {
              lines.push(`${key}=`);
            } else if (exportMode === "references") {
              lines.push(
                `${key}=keyharbor://${safeProject}/${encodeURIComponent(key)}?environment=${safeEnvironment}`
              );
            } else {
              lines.push(`${key}=${encodeEnvValue(secret?.value)}`);
            }
          }
          writeExportFile(exportFilePath, lines.join("\n"));
          if (exportMode === "raw") {
            logger?.logAccess(
              "Raw values exported",
              target.projectName,
              Object.keys(secrets),
              { ...captured, action: "export", outcome: "approved" }
            );
          } else {
            logger?.logApp(
              `Environment export completed (${exportMode}): ${target.projectName}/${captured.environmentName}`
            );
          }
          return { path: result.filePath, success: true };
        });
      } catch (error) {
        if (
          exportMode === "raw" &&
          error.message === "Invalid current password"
        ) {
          return { error: "Incorrect password", success: false };
        }
        return sessionErrorResponse(error);
      }
    }
  );

  ipcMain.handle("projects:backup", async (event, projectName) => {
    if (typeof projectName !== "string" || projectName.trim().length === 0) {
      return { error: "A Project is required", success: false };
    }

    // Session/Vault/Project identity and the relevant Project data are captured
    // BEFORE the native save picker. A Vault switch, delete/recreate, or data
    // drift during the picker rejects the backup before anything is written.
    let admission: { identity: ProjectBackupIdentity; encryptedBackup: Buffer };
    try {
      admission = await vaultSession.withActiveSession(({ activeVault }) =>
        captureProjectBackupIdentity(activeVault, projectName)
      );
    } catch (error) {
      return sessionErrorResponse(error);
    }

    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `${encodeURIComponent(projectName)}.lkvb`,
      filters: [{ extensions: ["lkvb"], name: "KeyHarbor Backup" }],
    });
    if (result.canceled || !result.filePath) {
      return { cancelled: true, success: false };
    }
    const backupFilePath = result.filePath;
    try {
      return await vaultSession.withActiveSession(({ activeVault }) => {
        const current = captureProjectBackupIdentity(activeVault, projectName);
        if (!sameProjectBackupIdentity(admission.identity, current.identity)) {
          return {
            code: "ENVIRONMENT_TARGET_STALE",
            error:
              "The Project or Vault changed while choosing a file. Start the backup again.",
            success: false,
          };
        }
        writeExportFile(backupFilePath, admission.encryptedBackup);
        logger?.logApp(
          `Encrypted Project backup exported: ${projectName} (all Environments)`
        );
        return { path: result.filePath, success: true };
      });
    } catch (error) {
      return sessionErrorResponse(error);
    }
  });

  ipcMain.handle("navigate", async (event, page) => {
    if (page === "dashboard" && isVaultSessionActive()) {
      loadRendererPage(mainWindow, "dashboard.html");
    } else if (page === "setup") {
      loadRendererPage(mainWindow, "setup.html");
    } else if (page === "lock") {
      if (isVaultSessionActive()) {
        const result = await lockVault("manual");
        if (result.state !== "locked") {
          return { success: false, ...result };
        }
      } else {
        loadRendererPage(mainWindow, "lock.html");
      }
    }
    return { success: true };
  });

  // Preserve the IPC handler's Promise API while its current work remains synchronous.
  // eslint-disable-next-line require-await
  ipcMain.handle("app:quit", async () => {
    isQuitting = true;
    void shutdownCoordinator?.requestQuit();
    return { success: true };
  });

  ipcMain.handle("vault:save", async () => {
    try {
      await vaultSession.withActiveSession(({ activeVault }) =>
        activeVault.saveNow()
      );
      return { success: true };
    } catch (error) {
      return sessionErrorResponse(error);
    }
  });

  const reconciliationOrigins = new Set([
    "save",
    "periodic",
    "focus",
    "external-notification",
  ]);

  ipcMain.handle("vault:reconcileExternalChange", async (event, origin) => {
    if (typeof origin !== "string" || !reconciliationOrigins.has(origin)) {
      return {
        code: "VAULT_INVALID_RECONCILIATION_ORIGIN",
        error: "Invalid reconciliation origin",
        success: false,
      };
    }

    try {
      const result = await vaultSession.withActiveSession(({ activeVault }) =>
        activeVault.reconcileExternalChange({ origin })
      );
      return { success: true, ...result };
    } catch (error) {
      return reconciliationError(error);
    }
  });

  ipcMain.handle(
    "vault:resolveReconciliation",
    async (event, reconciliationId, decision) => {
      if (typeof reconciliationId !== "string" || !reconciliationId.trim()) {
        return {
          code: "VAULT_INVALID_RECONCILIATION_ID",
          error: "Reconciliation ID is required",
          success: false,
        };
      }
      if (decision !== "use_disk" && decision !== "keep_session") {
        return {
          code: "VAULT_INVALID_RECONCILIATION_DECISION",
          error: "Invalid reconciliation decision",
          success: false,
        };
      }

      try {
        const result = await vaultSession.withActiveSession(({ activeVault }) =>
          activeVault.resolveReconciliation({ decision, reconciliationId })
        );
        return { success: true, ...result };
      } catch (error) {
        return reconciliationError(error);
      }
    }
  );

  // Preserve the IPC handler's Promise API while its current work remains synchronous.
  // eslint-disable-next-line require-await
  ipcMain.handle("cli:install", async () => {
    try {
      const cliPath = path.join(__dirname, "..", "cli", "keyharbor.js");
      if (!fs.existsSync(cliPath)) {
        return {
          error: i18n
            ? i18n.t("cli.errors.fileNotFound")
            : "CLI file not found",
          success: false,
        };
      }

      if (os.platform() !== "win32") {
        try {
          fs.chmodSync(cliPath, "755");
        } catch {
          // Best-effort desktop cleanup must not replace the primary action result.
        }
      }

      const createCliScript = (electronPath) =>
        os.platform() === "win32"
          ? `@echo off\nset ELECTRON_RUN_AS_NODE=1\n"${electronPath}" "${cliPath}" %*`
          : `#!/bin/bash\nELECTRON_RUN_AS_NODE=1 "${electronPath}" "${cliPath}" "$@"`;

      const homeDir = os.homedir();
      const collectInstallPaths = () => {
        const installPaths =
          os.platform() === "win32"
            ? [
                path.join(
                  process.env.LOCALAPPDATA ||
                    path.join(homeDir, "AppData", "Local"),
                  "Microsoft",
                  "WindowsApps"
                ),
                path.join(
                  process.env.APPDATA ||
                    path.join(homeDir, "AppData", "Roaming"),
                  "npm"
                ),
                path.join(homeDir, "bin"),
              ]
            : [path.join(homeDir, ".local", "bin")];

        const pathEnv = process.env.PATH || "";
        const pathSeparator = os.platform() === "win32" ? ";" : ":";
        for (const dir of pathEnv.split(pathSeparator)) {
          if (
            dir &&
            fs.existsSync(dir) &&
            dir.includes(homeDir) &&
            !installPaths.includes(dir)
          ) {
            installPaths.push(dir);
          }
        }

        return installPaths;
      };
      const installPaths = collectInstallPaths();
      const configureShellPath = (targetPath: string, pathInfo: string) => {
        try {
          const shellHomeDir = os.homedir();
          const shellConfigs = [
            path.join(shellHomeDir, ".zshrc"),
            path.join(shellHomeDir, ".bashrc"),
            path.join(shellHomeDir, ".bash_profile"),
            path.join(shellHomeDir, ".profile"),
          ];

          const localBinPath = path.join(shellHomeDir, ".local", "bin");
          const pathLine = `\n# KeyHarbor CLI\nexport PATH="$PATH:${localBinPath}"\n`;

          let configFileUpdated = false;

          for (const configPath of shellConfigs) {
            try {
              if (fs.existsSync(configPath)) {
                const content = fs.readFileSync(configPath, "utf-8");

                if (!content.includes(localBinPath)) {
                  fs.appendFileSync(configPath, pathLine);
                }
                configFileUpdated = true;
                break;
              }
            } catch {
              continue;
            }
          }

          if (configFileUpdated) {
            return {
              message: i18n
                ? i18n.t("cli.install.success")
                : "CLI installed successfully.",
              success: true,
            };
          }
          try {
            const defaultConfig =
              os.platform() === "darwin" ? ".zshrc" : ".bashrc";
            const configPath = path.join(shellHomeDir, defaultConfig);

            fs.writeFileSync(configPath, `${pathLine.trim()}\n`);
            return {
              message: i18n
                ? i18n.t("cli.install.success")
                : "CLI installed successfully.",
              success: true,
            };
          } catch {
            return {
              message: i18n
                ? i18n.t("cli.install.successPathSetupFailed")
                : "CLI installed successfully. But terminal setup failed. Please add ~/.local/bin to your PATH manually.",
              success: true,
            };
          }
        } catch {
          return {
            message: i18n
              ? i18n.t("cli.install.successAtPathSetupFailed", {
                  path: targetPath,
                })
              : `CLI installed successfully${pathInfo}. But terminal setup failed. Please add ~/.local/bin to your PATH manually.`,
            success: true,
          };
        }
      };

      for (const dir of installPaths) {
        try {
          if (!fs.existsSync(dir)) {
            if (dir === path.join(homeDir, ".local", "bin")) {
              fs.mkdirSync(dir, { recursive: true });
            } else {
              continue;
            }
          }

          const testFile = path.join(dir, ".keyharbor-test");
          fs.writeFileSync(testFile, "test");
          fs.unlinkSync(testFile);

          const cliName =
            os.platform() === "win32" ? "keyharbor.cmd" : "keyharbor";
          const targetPath = path.join(dir, cliName);

          if (fs.existsSync(targetPath)) {
            fs.unlinkSync(targetPath);
          }

          fs.writeFileSync(targetPath, createCliScript(process.execPath));

          try {
            fs.chmodSync(targetPath, "755");
          } catch {
            // Best-effort desktop cleanup must not replace the primary action result.
          }

          const pathInfo = ` at ${targetPath}`;

          if (os.platform() !== "win32") {
            return configureShellPath(targetPath, pathInfo);
          }

          return {
            message: i18n
              ? i18n.t("cli.install.successAt", { path: targetPath })
              : `CLI installed successfully${pathInfo}`,
            success: true,
          };
        } catch {
          continue;
        }
      }

      return {
        error: i18n
          ? i18n.t("cli.errors.noSuitablePath")
          : "CLI installation failed: Cannot find suitable path",
        success: false,
      };
    } catch (error) {
      return { error: error.message, success: false };
    }
  });

  // Preserve the IPC handler's Promise API while its current work remains synchronous.
  // eslint-disable-next-line require-await
  ipcMain.handle("cli:check", async () => {
    try {
      const checkCliInPath = () => {
        try {
          const pathEnv = process.env.PATH || "";
          const pathSeparator = os.platform() === "win32" ? ";" : ":";
          const pathDirs = pathEnv.split(pathSeparator);

          if (os.platform() !== "win32") {
            const localBinPath = path.join(os.homedir(), ".local", "bin");
            if (!pathDirs.includes(localBinPath)) {
              pathDirs.push(localBinPath);
            }
          }

          const cliNames =
            os.platform() === "win32"
              ? ["keyharbor.cmd", "keyharbor.bat", "keyharbor.exe", "keyharbor"]
              : ["keyharbor"];

          for (const dir of pathDirs) {
            if (!dir || !fs.existsSync(dir)) {
              continue;
            }

            for (const cliName of cliNames) {
              const cliPath = path.join(dir, cliName);
              if (fs.existsSync(cliPath)) {
                return { installed: true, path: cliPath };
              }
            }
          }

          return { installed: false };
        } catch {
          return { installed: false };
        }
      };

      return checkCliInPath();
    } catch {
      return { installed: false };
    }
  });

  // Preserve the IPC handler's Promise API while its current work remains synchronous.
  // eslint-disable-next-line require-await
  ipcMain.handle("cli:uninstall", async () => {
    try {
      const findAndRemoveCli = () => {
        try {
          const pathEnv = process.env.PATH || "";
          const pathSeparator = os.platform() === "win32" ? ";" : ":";
          const pathDirs = pathEnv.split(pathSeparator);

          if (os.platform() !== "win32") {
            const localBinPath = path.join(os.homedir(), ".local", "bin");
            if (!pathDirs.includes(localBinPath)) {
              pathDirs.push(localBinPath);
            }
          }

          const cliNames =
            os.platform() === "win32"
              ? ["keyharbor.cmd", "keyharbor.bat", "keyharbor.exe", "keyharbor"]
              : ["keyharbor"];

          const isUsableDirectory = (dir: string) =>
            Boolean(dir) && fs.existsSync(dir);
          let removed = false;
          const removedPaths: string[] = [];

          for (const dir of pathDirs) {
            if (!isUsableDirectory(dir)) {
              continue;
            }

            for (const cliName of cliNames) {
              const cliPath = path.join(dir, cliName);
              if (fs.existsSync(cliPath)) {
                try {
                  fs.unlinkSync(cliPath);
                  removed = true;
                  removedPaths.push(cliPath);
                  console.log(`Removed CLI from: ${cliPath}`);
                } catch (error) {
                  console.log(`Failed to remove ${cliPath}: ${error.message}`);
                }
              }
            }
          }

          if (os.platform() === "win32") {
            const extraDirs = [
              path.join(
                process.env.LOCALAPPDATA ||
                  path.join(os.homedir(), "AppData", "Local"),
                "Microsoft",
                "WindowsApps"
              ),
              path.join(
                process.env.APPDATA ||
                  path.join(os.homedir(), "AppData", "Roaming"),
                "npm"
              ),
            ];

            for (const dir of extraDirs) {
              if (!fs.existsSync(dir)) {
                continue;
              }

              for (const cliName of [
                "keyharbor.cmd",
                "keyharbor.bat",
                "keyharbor.ps1",
              ]) {
                const cliPath = path.join(dir, cliName);
                if (fs.existsSync(cliPath)) {
                  try {
                    fs.unlinkSync(cliPath);
                    removed = true;
                    removedPaths.push(cliPath);
                    console.log(`Removed CLI from: ${cliPath}`);
                  } catch (error) {
                    console.log(
                      `Failed to remove ${cliPath}: ${error.message}`
                    );
                  }
                }
              }
            }
          }

          return { removed, removedPaths };
        } catch (error) {
          console.log(`Error during CLI removal: ${error.message}`);
          return { removed: false, removedPaths: [] };
        }
      };

      const removeFromPath = () => {
        if (os.platform() === "win32") {
          return { modifiedConfigs: [], pathRemoved: false };
        }

        try {
          const homeDir = os.homedir();
          const shellConfigs = [
            path.join(homeDir, ".zshrc"),
            path.join(homeDir, ".bashrc"),
            path.join(homeDir, ".bash_profile"),
            path.join(homeDir, ".profile"),
          ];

          const localBinPath = path.join(homeDir, ".local", "bin");
          let pathRemoved = false;
          const modifiedConfigs: string[] = [];

          for (const configPath of shellConfigs) {
            try {
              if (fs.existsSync(configPath)) {
                let content = fs.readFileSync(configPath, "utf-8");

                const lines = content.split("\n");
                const filteredLines = lines.filter(
                  (line) =>
                    !line.includes(localBinPath) &&
                    !line.includes("# KeyHarbor CLI")
                );

                if (lines.length !== filteredLines.length) {
                  content = filteredLines
                    .join("\n")
                    .replaceAll(/\n{3,}/gu, "\n\n");
                  fs.writeFileSync(configPath, content);
                  pathRemoved = true;
                  modifiedConfigs.push(path.basename(configPath));
                }
              }
            } catch {
              continue;
            }
          }

          return { modifiedConfigs, pathRemoved };
        } catch {
          return { modifiedConfigs: [], pathRemoved: false };
        }
      };

      const result = findAndRemoveCli();
      const pathResult = removeFromPath();

      const removedAnything = result.removed || pathResult.pathRemoved;
      const messageKey = removedAnything
        ? "cli.uninstall.success"
        : "cli.uninstall.notFound";
      const fallbackMessage = removedAnything
        ? "CLI uninstalled successfully."
        : "CLI not found. Already uninstalled or not installed.";
      const message = i18n ? i18n.t(messageKey) : fallbackMessage;

      return { message, success: true };
    } catch (error) {
      return { error: error.message, success: false };
    }
  });

  ipcMain.handle("i18n:getTranslations", () => {
    if (i18n) {
      return i18n.getAllTranslations();
    }
    return { locale: "en", translations: {} };
  });

  ipcMain.handle("settings:get", () => loadSettings());

  ipcMain.handle("theme:get", () => {
    const settings = loadSettings();
    return {
      shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
      theme: settings.theme,
    };
  });

  ipcMain.handle("touch-id:getStatus", () => getTouchIdStatus());

  ipcMain.handle("touch-id:setEnabled", async (event, enabled) => {
    try {
      await vaultSession.withActiveSession(async () => {
        const systemVault = getSystemVault();
        if (!systemVault || systemVault.isLocked) {
          throw new Error("Vault is locked");
        }
        if (enabled === true) {
          await touchIdUnlock.enable(systemVault.key);
          const result = setTouchIdUnlockEnabled(true);
          if (!result.success) {
            touchIdUnlock.disable();
            throw new Error(
              result.error || "Failed to save the Touch ID setting"
            );
          }
        } else {
          touchIdUnlock.disable();
          const result = setTouchIdUnlockEnabled(false);
          if (!result.success) {
            throw new Error(
              result.error || "Failed to save the Touch ID setting"
            );
          }
        }
      });

      return { status: getTouchIdStatus(), success: true };
    } catch (error) {
      return { ...sessionErrorResponse(error), status: getTouchIdStatus() };
    }
  });

  ipcMain.handle("touch-id:unlock", async () => {
    const status = getTouchIdStatus();
    if (!status.enabled) {
      return {
        error: "Touch ID unlock is not enabled",
        status,
        success: false,
      };
    }

    try {
      const key = await touchIdUnlock.unlockKey();
      try {
        const opened = await vaultSession.open({
          credential: key,
          method: "key",
          reason: "touch_id",
        });
        const result = await completePendingRecovery(opened);
        return {
          success: result.state === "active",
          ...result,
          status: getTouchIdStatus(),
        };
      } finally {
        key.fill(0);
      }
    } catch (error) {
      if (
        error.message === "Invalid key" ||
        error.code === "TOUCH_ID_CREDENTIAL_INVALID"
      ) {
        try {
          touchIdUnlock.disable();
          setTouchIdUnlockEnabled(false);
        } catch {
          // Best-effort desktop cleanup must not replace the primary action result.
        }
      }
      return {
        error: error.message,
        status: getTouchIdStatus(),
        success: false,
      };
    }
  });

  ipcMain.handle("settings:set", async (event, newSettings) => {
    const currentSettings = loadSettings();
    const safeNewSettings =
      newSettings &&
      typeof newSettings === "object" &&
      !Array.isArray(newSettings)
        ? newSettings
        : {};
    const safeNewAutoLock =
      safeNewSettings.autoLock &&
      typeof safeNewSettings.autoLock === "object" &&
      !Array.isArray(safeNewSettings.autoLock)
        ? safeNewSettings.autoLock
        : {};
    const { normalized: mergedSettings } = normalizeSettings({
      ...currentSettings,
      ...safeNewSettings,
      autoLock: {
        ...currentSettings.autoLock,
        ...safeNewAutoLock,
      },
      touchIdUnlockEnabled: currentSettings.touchIdUnlockEnabled,
    });
    const saveResult = saveSettings(mergedSettings);

    if (saveResult.success) {
      const themeChanged =
        typeof mergedSettings.theme === "string" &&
        mergedSettings.theme !== currentSettings.theme;
      if (themeChanged) {
        applyTheme(mergedSettings.theme);
      }

      const localeChanged =
        typeof mergedSettings.locale === "string" &&
        mergedSettings.locale !== currentSettings.locale;
      if (localeChanged && i18n) {
        i18n.setLocale(mergedSettings.locale);
        createTray();

        const payload = i18n.getAllTranslations();
        for (const win of BrowserWindow.getAllWindows()) {
          try {
            win.webContents.send("i18n:localeChanged", payload);
          } catch {
            // Best-effort desktop cleanup must not replace the primary action result.
          }
        }
      }

      await vaultSession.configure(getVaultSessionPolicy());

      const screenCaptureChanged =
        mergedSettings.screenCaptureProtection !==
        currentSettings.screenCaptureProtection;
      if (screenCaptureChanged) {
        applyScreenCaptureProtection();
      }
    }

    return saveResult;
  });
};

type MenuItem = Electron.MenuItemConstructorOptions;

const buildAppMenu = () => {
  const isMac = process.platform === "darwin";

  const template: MenuItem[] = [];

  if (isMac) {
    template.push({
      role: "appMenu",
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          accelerator: "Cmd+,",
          click: () => {
            if (
              mainWindow &&
              !mainWindow.isDestroyed() &&
              isVaultSessionActive()
            ) {
              loadRendererPage(mainWindow, "settings.html");
              mainWindow.show();
            }
          },
          label: i18n ? i18n.t("menu.preferences") : "Preferences...",
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }

  template.push(
    {
      label: "Edit",
      submenu: [{ role: "cut" }, { role: "copy" }, { role: "paste" }],
    },
    {
      label: "View",
      submenu: [
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Developer",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "toggleDevTools" },
      ],
    }
  );

  const windowSubmenu: MenuItem[] = [
    { role: "minimize" },
    { role: "zoom" },
    { role: "close" },
  ];

  if (isMac) {
    windowSubmenu.push({ type: "separator" }, { role: "front" });
  }

  template.push({
    label: "Window",
    submenu: windowSubmenu,
  });

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
};

// Register readiness work before the synchronous app lifecycle listeners below, preserving Electron startup timing.
// eslint-disable-next-line promise/prefer-await-to-then
app.whenReady().then(async () => {
  const initialSettings = loadSettings();
  applyTheme(initialSettings.theme);

  nativeTheme.on("updated", () => {
    const settings = loadSettings();
    if (settings.theme === "system") {
      const { shouldUseDarkColors } = nativeTheme;
      const bg = getThemeBackgroundColor(shouldUseDarkColors);
      for (const win of BrowserWindow.getAllWindows()) {
        try {
          win.setBackgroundColor(bg);
          win.webContents.send("theme:changed", {
            shouldUseDarkColors,
            theme: "system",
          });
        } catch {
          // Best-effort desktop cleanup must not replace the primary action result.
        }
      }
    }
  });

  try {
    const { default: contextMenu } = await import("electron-context-menu");
    contextMenu({
      showCopyImage: true,
      showInspectElement: !app.isPackaged,
      showSaveImageAs: true,
      showSearchWithGoogle: true,
      showServices: process.platform === "darwin",
    });
  } catch (error) {
    console.error(
      "Failed to load electron-context-menu; context menus are disabled:",
      error
    );
  }

  initializeApp();

  buildAppMenu();

  createWindow();
  setupIpcHandlers();
  attachVaultConflictNotifier();

  await ensureHttpServerStarted();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow && mainWindow.isDestroyed() === false) {
      if (process.platform === "darwin") {
        app.dock.show();
      }
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    void shutdownCoordinator?.requestQuit();
  }
});

app.on("before-quit", (event) => {
  isQuitting = true;
  shutdownCoordinator?.handleBeforeQuit(event);
});
