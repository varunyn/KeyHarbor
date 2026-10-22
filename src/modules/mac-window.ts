import path from "node:path";

import type { BrowserWindow } from "electron";
import { app, nativeTheme } from "electron";

export type MacWindowMaterial = "glass" | "vibrancy" | "opaque";
interface NativeMaterial {
  updateMaterial: (handle: Buffer, enabled: boolean, dark: boolean) => boolean;
}
let nativeMaterial: NativeMaterial | null | undefined;
const materials = new WeakMap<BrowserWindow, MacWindowMaterial>();

const loadNativeMaterial = (): NativeMaterial | null => {
  if (nativeMaterial !== undefined) {
    return nativeMaterial;
  }
  try {
    const directory = app.isPackaged
      ? path.join(process.resourcesPath, "mac-window")
      : path.join(
          app.getAppPath(),
          "native/mac-window/bin",
          `darwin-${process.arch}`
        );
    // eslint-disable-next-line global-require -- Native addons load only on macOS, after app readiness.
    nativeMaterial = require(
      path.join(directory, "window-material.node")
    ) as NativeMaterial;
  } catch {
    // Older SDKs and development checkouts retain Electron's native sidebar material.
    nativeMaterial = null;
  }
  return nativeMaterial;
};

export const getMacWindowMaterial = (
  window: BrowserWindow | null
): MacWindowMaterial | null =>
  window ? (materials.get(window) ?? null) : null;

export const updateMacWindowMaterial = (
  window: BrowserWindow
): MacWindowMaterial | null => {
  if (process.platform !== "darwin") {
    return null;
  }
  const reduced =
    nativeTheme.prefersReducedTransparency ||
    nativeTheme.shouldUseHighContrastColors;
  const native = loadNativeMaterial();
  window.setVibrancy(null);
  let glass = false;
  try {
    glass =
      native?.updateMaterial(
        window.getNativeWindowHandle(),
        !reduced,
        nativeTheme.shouldUseDarkColors
      ) === true;
  } catch {
    // A failed optional material must leave a usable native window.
  }
  let material: MacWindowMaterial = "vibrancy";
  if (reduced) {
    material = "opaque";
  } else if (glass) {
    material = "glass";
  }
  if (material === "vibrancy") {
    window.setVibrancy("sidebar");
  }
  const opaqueColor = nativeTheme.shouldUseDarkColors ? "#202020" : "#f5f5f5";
  window.setBackgroundColor(reduced ? opaqueColor : "#00000000");
  materials.set(window, material);
  return material;
};
