import { app, Notification } from "electron";
import type { BrowserWindow } from "electron";

/** Notifications bring the user to the gate; they never grant access. */
export const notifyApproval = (
  window: BrowserWindow,
  title: string,
  body: string,
  onUnavailable: () => void
): (() => void) => {
  let active = true;
  let notification: Notification | undefined;
  let attentionId: number | undefined;
  try {
    if (process.platform === "darwin") {
      attentionId = app.dock?.bounce("informational");
    } else {
      window.flashFrame(true);
    }
    if (Notification.isSupported()) {
      notification = new Notification({ body, silent: false, title });
      notification.once("failed", onUnavailable);
      notification.once("click", () => {
        if (!active || window.isDestroyed()) {
          return;
        }
        if (process.platform === "darwin") {
          void app.dock?.show();
          app.show();
        }
        const parent = window.getParentWindow();
        if (parent && !parent.isDestroyed()) {
          if (parent.isMinimized()) {
            parent.restore();
          }
          parent.show();
        }
        if (window.isMinimized()) {
          window.restore();
        }
        window.show();
        window.focus();
      });
      notification.show();
    } else {
      onUnavailable();
    }
  } catch {
    // Notification delivery must never prevent review in the desktop gate.
    onUnavailable();
  }
  return () => {
    active = false;
    try {
      notification?.removeAllListeners();
      notification?.close();
      if (attentionId !== undefined) {
        app.dock?.cancelBounce(attentionId);
      }
      if (!window.isDestroyed()) {
        window.flashFrame(false);
      }
    } catch {
      // The approval decision remains valid if native cleanup is unavailable.
    }
    notification = undefined;
  };
};
