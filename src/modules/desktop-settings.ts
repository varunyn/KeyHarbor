import fs from "node:fs";
import path from "node:path";

import type { AppSettings, AppTheme, BridgeResult } from "../project/bridge";
import { normalizeCloseBehavior } from "./window-close-controller";

type StoredSettings = Omit<AppSettings, "__loadStatus" | "__repairs">;

interface NormalizedSettings {
  normalized: StoredSettings;
  repairs: string[];
}

const DEFAULT_SETTINGS: StoredSettings = {
  autoLock: {
    enabled: true,
    timeout: 30,
  },
  checkForUpdates: true,
  closeBehavior: "ask",
  locale: "system",
  screenCaptureProtection: true,
  showStatistics: true,
  theme: "system",
  touchIdUnlockEnabled: false,
  vaultDiskSyncIntervalSeconds: 5,
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

export const normalizeSettings = (
  settings?: Partial<StoredSettings> | null
): NormalizedSettings => {
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

  const normalized: StoredSettings = {
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
    closeBehavior: normalizeCloseBehavior(safeSettings.closeBehavior),
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
  if (
    safeSettings.closeBehavior !== undefined &&
    normalized.closeBehavior !== safeSettings.closeBehavior
  ) {
    repairs.push("closeBehavior");
  }
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

export const createSettingsStore = (directory: string) => {
  const settingsFile = path.join(directory, "settings.json");
  const saveSettings = (
    settings?: Partial<StoredSettings> | null
  ): BridgeResult => {
    try {
      const { normalized } = normalizeSettings(settings);
      try {
        fs.mkdirSync(directory, { recursive: true });
      } catch {
        // Best-effort desktop cleanup must not replace the primary action result.
      }

      fs.writeFileSync(settingsFile, JSON.stringify(normalized, null, 2));
      try {
        fs.chmodSync(settingsFile, 0o600);
      } catch {
        // Best-effort desktop cleanup must not replace the primary action result.
      }
      return { success: true };
    } catch (error) {
      console.error("Failed to save settings:", error);
      return { error: error.message, success: false };
    }
  };

  const loadSettings = (): AppSettings => {
    try {
      if (fs.existsSync(settingsFile)) {
        const data = fs.readFileSync(settingsFile, "utf-8");
        const parsed = JSON.parse(data);
        const { normalized, repairs } = normalizeSettings(parsed);

        if (repairs.length > 0) {
          try {
            saveSettings(normalized);
          } catch {
            // Best-effort desktop cleanup must not replace the primary action result.
          }
          return {
            ...normalized,
            __loadStatus: "repaired",
            __repairs: repairs,
          };
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

  return { load: loadSettings, save: saveSettings };
};
