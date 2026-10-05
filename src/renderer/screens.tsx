import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  ActivityLog,
  AppSettings,
  AppTheme,
  ApprovalRequest,
  TouchIdStatus,
} from "../project/bridge";
import { requireSuccessfulResponse, runWithCleanup } from "./async-operation";
import { notificationManager } from "./notifications";
import { useRendererTranslation } from "./providers";
import { Button } from "./ui/button";
import { useConfirmation } from "./ui/confirmation";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";

const resultError = (
  result: {
    error?: string;
  },
  fallback: string
) => result.error || fallback;
const Modal = ({
  id,
  titleId,
  title,
  onClose,
  children,
  footer,
  initialFocusId,
}: {
  id?: string;
  titleId?: string;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  initialFocusId?: string;
}) => {
  const { t } = useRendererTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const priorFocus = useRef<HTMLElement | null>(null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent
        ref={ref}
        id={id}
        className="lk-ui-theme lk-form-dialog text-foreground"
        closeLabel={t("common.close")}
        showCloseButton={false}
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          priorFocus.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
          const focus = initialFocusId
            ? ref.current?.querySelector<HTMLElement>(
                `#${CSS.escape(initialFocusId)}`
              )
            : ref.current?.querySelector<HTMLElement>(
                "input:not(:disabled),button:not(:disabled),select:not(:disabled)"
              );
          focus?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = priorFocus.current;
          if (
            target?.isConnected &&
            target.getClientRects().length > 0 &&
            !target.hasAttribute("disabled")
          ) {
            target.focus();
          }
        }}
      >
        <header className="lk-form-dialog-header">
          <DialogTitle className="modal-title" data-title-id={titleId}>
            {title}
          </DialogTitle>
        </header>
        <div className="lk-form-dialog-body">{children}</div>
        {footer}
      </DialogContent>
    </Dialog>
  );
};
const EMPTY_SETTING_IDS = { description: "", label: "" };
const SettingsToggle = ({
  label,
  checked,
  onChange,
  disabled = false,
  id = "",
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  id?: string;
}) => (
  <label className="toggle-switch" aria-label={label}>
    <input
      id={id}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
    <span className="toggle-slider" />
  </label>
);
const SettingsRow = ({
  label,
  description,
  children,
  ids = EMPTY_SETTING_IDS,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
  ids?: {
    row?: string;
    label: string;
    description: string;
    hidden?: boolean;
  };
}) => (
  <div className={`settings-item${ids.hidden ? " hidden" : ""}`} id={ids.row}>
    <div className="settings-item-info">
      <span className="settings-item-label" id={ids.label}>
        {label}
      </span>
      {description && (
        <span className="settings-item-description" id={ids.description}>
          {description}
        </span>
      )}
    </div>
    {children}
  </div>
);
export const SettingsScreen = () => {
  const { t } = useRendererTranslation();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [touch, setTouch] = useState<TouchIdStatus>({
    available: false,
    enabled: false,
  });
  const [touchBusy, setTouchBusy] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [passwords, setPasswords] = useState({
    confirm: "",
    current: "",
    next: "",
  });
  const [deleteText, setDeleteText] = useState("");
  const [modalBusy, setModalBusy] = useState(false);
  const alive = useRef(true);
  const writeQueue = useRef<Promise<void>>(Promise.resolve());
  const writeId = useRef(0);
  const sessionEpoch = useRef(0);
  const sessionTransition = useRef(-1);
  const sessionTarget = useRef<string | null>(null);
  const sessionSeen = useRef(false);
  const modalEpoch = useRef(0);
  const modalBusyRef = useRef(false);
  const touchBusyRef = useRef(false);
  const clearDrafts = useCallback(() => {
    modalEpoch.current += 1;
    modalBusyRef.current = false;
    setModalBusy(false);
    setPasswords({ confirm: "", current: "", next: "" });
    setDeleteText("");
    setPasswordOpen(false);
    setDeleteOpen(false);
  }, []);
  useEffect(() => {
    alive.current = true;
    let live = true;
    const retire = () => {
      live = false;
      alive.current = false;
      sessionEpoch.current += 1;
      writeId.current += 1;
      modalEpoch.current += 1;
      modalBusyRef.current = false;
      touchBusyRef.current = false;
    };
    const off = window.keyharbor.vault.onSessionStateChanged((snapshot) => {
      if (snapshot.transitionId < sessionTransition.current) {
        return;
      }
      sessionTransition.current = snapshot.transitionId;
      const changedVault =
        sessionSeen.current && snapshot.activeVaultId !== sessionTarget.current;
      sessionSeen.current = true;
      if (snapshot.state !== "active" || changedVault) {
        sessionEpoch.current += 1;
        clearDrafts();
      }
      sessionTarget.current = snapshot.activeVaultId || null;
    });
    const onPagehide = () => retire();
    window.addEventListener("pagehide", onPagehide);
    (async () => {
      try {
        const snapshot = await window.keyharbor.vault.sessionSnapshot();
        if (!live || snapshot.transitionId < sessionTransition.current) {
          return;
        }
        sessionTransition.current = snapshot.transitionId;
        sessionTarget.current = snapshot.activeVaultId || null;
        sessionSeen.current = true;
        if (snapshot.state !== "active") {
          sessionEpoch.current += 1;
          clearDrafts();
        }
      } catch {
        // Session notifications remain authoritative when the snapshot is unavailable.
      }
    })();
    (async () => {
      const operation = sessionEpoch.current;
      try {
        const [loaded, status] = await Promise.all([
          window.keyharbor.settings.get(),
          window.keyharbor.touchId.getStatus(),
        ]);
        if (!live || operation !== sessionEpoch.current) {
          return;
        }
        setSettings(loaded);
        setTouch(status);
        if (loaded.__loadStatus === "reset") {
          notificationManager.error(
            t("settings.notifications.resetDueToError")
          );
        } else if (loaded.__loadStatus === "repaired") {
          notificationManager.success(t("settings.notifications.repaired"));
        }
      } catch {
        if (live) {
          notificationManager.error(t("settings.notifications.failedToLoad"));
        }
      }
    })();
    return () => {
      live = false;
      alive.current = false;
      sessionEpoch.current += 1;
      writeId.current += 1;
      modalEpoch.current += 1;
      modalBusyRef.current = false;
      touchBusyRef.current = false;
      off();
      window.removeEventListener("pagehide", onPagehide);
    };
  }, [clearDrafts, t]);
  const persist = useCallback(
    (next: AppSettings) => {
      setSettings(next);
      writeId.current += 1;
      const revision = writeId.current;
      const context = sessionEpoch.current;
      const previousWrite = writeQueue.current;
      writeQueue.current = (async () => {
        try {
          await previousWrite;
        } catch {
          // A failed queued write must not prevent later settings writes.
        }
        try {
          if (!alive.current || context !== sessionEpoch.current) {
            return;
          }
          const result = await window.keyharbor.settings.set(next);
          if (
            !alive.current ||
            context !== sessionEpoch.current ||
            revision !== writeId.current
          ) {
            return;
          }
          if (result.success) {
            notificationManager.success(t("settings.notifications.saved"));
          } else {
            notificationManager.error(t("settings.notifications.saveFailed"));
          }
        } catch {
          if (alive.current && revision === writeId.current) {
            notificationManager.error(t("settings.notifications.saveFailed"));
          }
        }
      })();
    },
    [t]
  );
  const patch = <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K]
  ) => {
    if (!settings) {
      return;
    }
    persist({ ...settings, [key]: value });
  };
  const setAuto = (key: "enabled" | "timeout", value: boolean | number) => {
    if (!settings) {
      return;
    }
    persist({ ...settings, autoLock: { ...settings.autoLock, [key]: value } });
  };
  const changeTouch = async (enabled: boolean) => {
    if (touchBusyRef.current) {
      return;
    }
    touchBusyRef.current = true;
    setTouchBusy(true);
    const previous = touch;
    setTouch({ ...previous, enabled });
    const epoch = sessionEpoch.current;
    await runWithCleanup(
      async () => {
        try {
          const result = await window.keyharbor.touchId.setEnabled(enabled);
          if (!alive.current || epoch !== sessionEpoch.current) {
            return;
          }
          const status =
            "status" in result ? (result.status as TouchIdStatus) : undefined;
          setTouch(
            status || {
              ...previous,
              enabled: result.success ? enabled : previous.enabled,
            }
          );
          if (result.success) {
            notificationManager.success(
              t(
                enabled
                  ? "settings.notifications.touchIdEnabled"
                  : "settings.notifications.touchIdDisabled"
              )
            );
          } else {
            notificationManager.error(
              result.error || t("settings.notifications.touchIdFailed")
            );
          }
        } catch (error) {
          if (alive.current && epoch === sessionEpoch.current) {
            setTouch(previous);
            notificationManager.error(
              error instanceof Error
                ? error.message
                : t("settings.notifications.touchIdFailed")
            );
          }
        }
      },
      () => {
        touchBusyRef.current = false;
        if (alive.current) {
          setTouchBusy(false);
        }
      }
    );
  };
  const submitPassword = async () => {
    if (modalBusyRef.current) {
      return;
    }
    const { current, next, confirm } = passwords;
    if (!current) {
      return notificationManager.error(
        t("settings.changePasswordModal.invalidCurrent")
      );
    }
    if (next !== confirm) {
      return notificationManager.error(
        t("settings.changePasswordModal.mismatch")
      );
    }
    if (next.length < 12) {
      return notificationManager.error(t("setup.requirements.length"));
    }
    modalBusyRef.current = true;
    setModalBusy(true);
    const session = sessionEpoch.current;
    const operation = modalEpoch.current;
    await runWithCleanup(
      async () => {
        try {
          const result = await window.keyharbor.vault.changePassword(
            current,
            next
          );
          if (
            !alive.current ||
            session !== sessionEpoch.current ||
            operation !== modalEpoch.current
          ) {
            return;
          }
          if (result.success) {
            notificationManager.success(
              t("settings.changePasswordModal.success")
            );
            clearDrafts();
          } else {
            notificationManager.error(
              resultError(
                result,
                t("settings.changePasswordModal.invalidCurrent")
              )
            );
          }
        } catch (error) {
          if (
            alive.current &&
            session === sessionEpoch.current &&
            operation === modalEpoch.current
          ) {
            notificationManager.error(
              error instanceof Error
                ? error.message
                : t("settings.notifications.saveFailed")
            );
          }
        }
      },
      () => {
        if (operation === modalEpoch.current) {
          modalBusyRef.current = false;
          if (alive.current) {
            setModalBusy(false);
          }
        }
      }
    );
  };
  const deleteVault = async () => {
    if (deleteText.trim() !== "DELETE" || modalBusyRef.current) {
      return;
    }
    modalBusyRef.current = true;
    setModalBusy(true);
    const session = sessionEpoch.current;
    const operation = modalEpoch.current;
    try {
      const result = await window.keyharbor.vault.delete();
      if (
        !alive.current ||
        session !== sessionEpoch.current ||
        operation !== modalEpoch.current
      ) {
        return;
      }
      if (result.success) {
        clearDrafts();
      } else {
        notificationManager.error(result.error || "Failed to delete vault");
        modalBusyRef.current = false;
        setModalBusy(false);
      }
    } catch (error) {
      if (
        alive.current &&
        session === sessionEpoch.current &&
        operation === modalEpoch.current
      ) {
        notificationManager.error(
          error instanceof Error ? error.message : "Failed to delete vault"
        );
      }
      if (operation === modalEpoch.current) {
        modalBusyRef.current = false;
        setModalBusy(false);
      }
    }
  };
  if (!settings) {
    return (
      <main className="container">
        <div className="page-header">
          <div className="page-title">{t("settings.title")}</div>
        </div>
      </main>
    );
  }
  return (
    <main className="container">
      <div className="page-header">
        <div className="page-title">
          <Button
            variant="ghost"
            size="icon"
            type="button"
            id="back-btn"
            aria-label="Back to dashboard"
            onClick={() => {
              clearDrafts();
              window.location.href = "dashboard.html";
            }}
          >
            <span className="lk-icon lk-icon-arrow-left" aria-hidden="true" />
          </Button>
          <span id="title">{t("settings.title")}</span>
        </div>
      </div>
      <div id="settings-container">
        <div className="settings-section">
          <SettingsRow
            label={t("settings.language")}
            description={t("settings.languageDesc")}
            ids={{ description: "desc-language", label: "label-language" }}
          >
            <select
              id="language-select"
              aria-labelledby="label-language"
              className="btn btn-secondary filter-select"
              value={settings.locale || "system"}
              onChange={(e) => patch("locale", e.target.value)}
            >
              <option id="lang-opt-system" value="system">
                {t("settings.languageOptions.system")}
              </option>
              <option id="lang-opt-en" value="en">
                {t("settings.languageOptions.en")}
              </option>
            </select>
          </SettingsRow>
          <SettingsRow
            label={t("settings.theme")}
            description={t("settings.themeDesc")}
            ids={{ description: "desc-theme", label: "label-theme" }}
          >
            <select
              id="theme-select"
              aria-labelledby="label-theme"
              className="btn btn-secondary filter-select"
              value={settings.theme || "system"}
              onChange={(e) => patch("theme", e.target.value as AppTheme)}
            >
              <option id="theme-opt-system" value="system">
                {t("settings.themeOptions.system")}
              </option>
              <option id="theme-opt-dark" value="dark">
                {t("settings.themeOptions.dark")}
              </option>
              <option id="theme-opt-light" value="light">
                {t("settings.themeOptions.light")}
              </option>
            </select>
          </SettingsRow>
          <SettingsRow
            label={t("settings.checkForUpdates")}
            description={t("settings.checkForUpdatesDesc")}
            ids={{
              description: "desc-check-updates",
              label: "label-check-updates",
            }}
          >
            <SettingsToggle
              label={t("settings.checkForUpdates")}
              checked={settings.checkForUpdates}
              onChange={(value) => patch("checkForUpdates", value)}
              disabled={false}
              id="check-updates-toggle"
            />
          </SettingsRow>
          <SettingsRow
            label={t("settings.showStatistics")}
            description={t("settings.showStatisticsDesc")}
            ids={{
              description: "desc-show-statistics",
              label: "label-show-statistics",
            }}
          >
            <SettingsToggle
              label={t("settings.showStatistics")}
              checked={settings.showStatistics}
              onChange={(value) => patch("showStatistics", value)}
              disabled={false}
              id="show-statistics-toggle"
            />
          </SettingsRow>
          <SettingsRow
            label={t("settings.autoLock")}
            description={t("settings.autoLockDesc")}
            ids={{ description: "desc-auto-lock", label: "label-auto-lock" }}
          >
            <SettingsToggle
              label={t("settings.autoLock")}
              checked={settings.autoLock.enabled}
              onChange={(value) => setAuto("enabled", value)}
              disabled={false}
              id="auto-lock-toggle"
            />
          </SettingsRow>
          {settings.autoLock.enabled && (
            <div className="settings-item" id="auto-lock-timeout-item">
              <div className="settings-item-info">
                <span
                  className="settings-item-label"
                  id="label-auto-lock-timeout"
                >
                  {t("settings.autoLockTimeout")}
                </span>
              </div>
              <Input
                id="auto-lock-timeout-input"
                aria-labelledby="label-auto-lock-timeout"
                type="number"
                className="settings-input"
                min={1}
                max={1440}
                value={settings.autoLock.timeout}
                onChange={(e) =>
                  setAuto(
                    "timeout",
                    Math.max(
                      1,
                      Math.min(1440, Math.trunc(Number(e.target.value)) || 30)
                    )
                  )
                }
              />
            </div>
          )}
          <SettingsRow
            label={t("settings.screenCaptureProtection")}
            description={t("settings.screenCaptureProtectionDesc")}
            ids={{
              description: "desc-screen-capture",
              label: "label-screen-capture",
            }}
          >
            <SettingsToggle
              label={t("settings.screenCaptureProtection")}
              checked={settings.screenCaptureProtection}
              onChange={(value) => patch("screenCaptureProtection", value)}
              disabled={false}
              id="screen-capture-toggle"
            />
          </SettingsRow>
          <SettingsRow
            label={t("settings.vaultDiskSyncInterval")}
            description={t("settings.vaultDiskSyncIntervalDesc")}
            ids={{
              description: "desc-vault-sync-interval",
              label: "label-vault-sync-interval",
            }}
          >
            <select
              id="vault-sync-interval-select"
              aria-labelledby="label-vault-sync-interval"
              className="btn btn-secondary filter-select"
              value={settings.vaultDiskSyncIntervalSeconds === 60 ? "60" : "5"}
              onChange={(e) =>
                patch("vaultDiskSyncIntervalSeconds", Number(e.target.value))
              }
            >
              <option id="vault-sync-opt-5" value="5">
                {t("settings.vaultDiskSync5s")}
              </option>
              <option id="vault-sync-opt-60" value="60">
                {t("settings.vaultDiskSync1m")}
              </option>
            </select>
          </SettingsRow>
          <section className="settings-vault-section">
            <h3 className="settings-section-title" id="vault-section-title">
              {t("settings.vaultSection")}
            </h3>
            <SettingsRow
              label={t("settings.touchIdUnlock")}
              description={t("settings.touchIdUnlockDesc")}
              ids={{
                description: "desc-touch-id",
                hidden: !touch.available,
                label: "label-touch-id",
                row: "touch-id-setting-item",
              }}
            >
              <SettingsToggle
                label={t("settings.touchIdUnlock")}
                checked={touch.enabled}
                onChange={(value) => {
                  void changeTouch(value);
                }}
                disabled={touchBusy}
                id="touch-id-toggle"
              />
            </SettingsRow>
            <SettingsRow
              label={t("settings.changePassword")}
              description={t("settings.changePasswordDesc")}
              ids={{
                description: "desc-change-password",
                label: "label-change-password",
              }}
            >
              <Button
                variant="secondary"
                type="button"
                id="change-password-btn"
                onClick={() => {
                  modalEpoch.current += 1;
                  modalBusyRef.current = false;
                  setModalBusy(false);
                  setPasswords({ confirm: "", current: "", next: "" });
                  setPasswordOpen(true);
                }}
              >
                {t("settings.changePassword")}
              </Button>
            </SettingsRow>
            <SettingsRow
              label={t("settings.deleteVault")}
              description={t("settings.deleteVaultDesc")}
              ids={{
                description: "desc-delete-vault",
                label: "label-delete-vault",
              }}
            >
              <Button
                variant="destructive"
                type="button"
                id="delete-vault-btn"
                onClick={() => {
                  modalEpoch.current += 1;
                  modalBusyRef.current = false;
                  setModalBusy(false);
                  setDeleteText("");
                  setDeleteOpen(true);
                }}
              >
                {t("settings.deleteVault")}
              </Button>
            </SettingsRow>
          </section>
        </div>
      </div>
      {passwordOpen && (
        <Modal
          id="change-password-modal"
          title={t("settings.changePasswordModal.title")}
          initialFocusId="change-password-current"
          onClose={clearDrafts}
          footer=<div className="lk-form-dialog-footer">
            <Button
              variant="secondary"
              id="change-password-cancel"
              disabled={modalBusy}
              onClick={clearDrafts}
            >
              {t("settings.changePasswordModal.cancel")}
            </Button>
            <Button
              variant="default"
              id="change-password-submit"
              disabled={modalBusy}
              onClick={() => {
                void submitPassword();
              }}
            >
              {t("settings.changePasswordModal.submit")}
            </Button>
          </div>
        >
          <div className="input-group">
            <label
              htmlFor="change-password-current"
              id="label-change-password-current"
            >
              {t("settings.changePasswordModal.currentPassword")}
            </label>
            <Input
              id="change-password-current"
              type="password"
              placeholder={t("settings.changePasswordModal.currentPassword")}
              autoComplete="current-password"
              value={passwords.current}
              onChange={(e) =>
                setPasswords({ ...passwords, current: e.target.value })
              }
            />
          </div>
          <div className="input-group">
            <label htmlFor="change-password-new" id="label-change-password-new">
              {t("settings.changePasswordModal.newPassword")}
            </label>
            <Input
              id="change-password-new"
              type="password"
              placeholder={t("settings.changePasswordModal.newPassword")}
              autoComplete="new-password"
              value={passwords.next}
              onChange={(e) =>
                setPasswords({ ...passwords, next: e.target.value })
              }
            />
          </div>
          <div className="input-group">
            <label
              htmlFor="change-password-confirm"
              id="label-change-password-confirm"
            >
              {t("settings.changePasswordModal.confirmPassword")}
            </label>
            <Input
              id="change-password-confirm"
              type="password"
              placeholder={t("settings.changePasswordModal.confirmPassword")}
              autoComplete="new-password"
              value={passwords.confirm}
              onChange={(e) =>
                setPasswords({ ...passwords, confirm: e.target.value })
              }
            />
          </div>
        </Modal>
      )}
      {deleteOpen && (
        <Modal
          id="delete-vault-modal"
          title={t("settings.deleteVaultModal.title")}
          initialFocusId="delete-vault-cancel"
          onClose={clearDrafts}
          footer=<div className="lk-form-dialog-footer">
            <Button
              variant="secondary"
              id="delete-vault-cancel"
              disabled={modalBusy}
              onClick={clearDrafts}
            >
              {t("settings.deleteVaultModal.cancel")}
            </Button>
            <Button
              variant="destructive"
              id="delete-vault-submit"
              disabled={modalBusy || deleteText.trim() !== "DELETE"}
              onClick={() => {
                void deleteVault();
              }}
            >
              {t("settings.deleteVaultModal.submit")}
            </Button>
          </div>
        >
          <p id="delete-vault-warning" className="delete-vault-warning">
            {t("settings.deleteVaultModal.warning")}
          </p>
          <div className="input-group">
            <label
              htmlFor="delete-vault-confirm"
              id="label-delete-vault-confirm"
            >
              {t("settings.deleteVaultModal.confirmPlaceholder")}
            </label>
            <Input
              id="delete-vault-confirm"
              placeholder={t("settings.deleteVaultModal.confirmPlaceholder")}
              type="text"
              autoComplete="off"
              value={deleteText}
              onChange={(e) => setDeleteText(e.target.value)}
            />
          </div>
        </Modal>
      )}
    </main>
  );
};
export const LockScreen = () => {
  const { t } = useRendererTranslation();
  const [password, setPassword] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [touchEnabled, setTouchEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const passwordRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    alive.current = true;
    let live = true;
    const retire = () => {
      alive.current = false;
    };
    (async () => {
      try {
        const status = await window.keyharbor.touchId.getStatus();
        if (live) {
          setTouchEnabled(status.enabled);
        }
      } catch {
        if (live) {
          setTouchEnabled(false);
        }
      }
    })();
    passwordRef.current?.focus();
    window.addEventListener("pagehide", retire);
    return () => {
      live = false;
      window.removeEventListener("pagehide", retire);
      alive.current = false;
    };
  }, []);
  const unlock = async (method: "password" | "touch") => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setUnlockError("");
    await runWithCleanup(
      async () => {
        try {
          const result =
            method === "password"
              ? await window.keyharbor.vault.unlock(password)
              : await window.keyharbor.touchId.unlock();
          if (!alive.current) {
            return;
          }
          setPassword("");
          if (result.success) {
            await window.keyharbor.navigate("dashboard");
          } else {
            const status =
              "status" in result ? (result.status as TouchIdStatus) : undefined;
            if (method === "touch" && status?.enabled === false) {
              setTouchEnabled(false);
            }
            const passwordError =
              result.error && result.error !== "Invalid password"
                ? result.error
                : t("lock.invalidPassword");
            setUnlockError(
              method === "touch" ? t("lock.touchIdFailed") : passwordError
            );
            passwordRef.current?.focus();
          }
        } catch (error) {
          if (alive.current) {
            setPassword("");
            const passwordError =
              error instanceof Error
                ? error.message
                : t("lock.invalidPassword");
            setUnlockError(
              method === "touch" ? t("lock.touchIdFailed") : passwordError
            );
            passwordRef.current?.focus();
          }
        }
      },
      () => {
        inFlight.current = false;
        if (alive.current) {
          setBusy(false);
        }
      }
    );
  };
  return (
    <main className="container">
      <section className="lock-container">
        <div className="logo">
          <h1 id="title">{t("lock.title")}</h1>
          <p id="subtitle">{t("lock.subtitle")}</p>
        </div>
        <div
          id="message-container"
          className={unlockError ? "lock-error" : ""}
          role={unlockError ? "alert" : undefined}
        >
          {unlockError}
        </div>
        <form
          id="unlock-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (password) {
              unlock("password");
            }
          }}
        >
          <div className="input-group input-inline">
            <input
              id="password"
              ref={passwordRef}
              type="password"
              autoComplete="current-password"
              placeholder={t("lock.passwordPlaceholder")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              className="btn unlock-btn"
              id="unlock-btn"
              type="submit"
              disabled={busy}
              aria-label={t("lock.title")}
            >
              <span
                className={`lk-icon lk-icon-${busy ? "loader lk-icon-spin" : "arrow-right"}`}
                aria-hidden="true"
              />
            </button>
          </div>
        </form>
        {touchEnabled && (
          <div id="touch-id-actions" className="touch-id-actions">
            <button
              className="btn btn-secondary touch-id-btn"
              id="touch-id-btn"
              type="button"
              disabled={busy}
              onClick={() => {
                void unlock("touch");
              }}
            >
              <span className="lk-icon lk-icon-key" aria-hidden="true" />
              <span id="touch-id-label">{t("lock.touchIdButton")}</span>
            </button>
          </div>
        )}
      </section>
    </main>
  );
};
const passwordStrengthClass = (score: number) => {
  if (score <= 2) {
    return " strength-weak";
  }
  if (score <= 4) {
    return " strength-medium";
  }
  return " strength-strong";
};
export const SetupScreen = () => {
  const { t } = useRendererTranslation();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<{
    text: string;
    kind: "error" | "success";
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [cliModal, setCliModal] = useState(false);
  const submitting = useRef(false);
  const alive = useRef(true);
  const navTimer = useRef<number | null>(null);
  const messageTimer = useRef<number | null>(null);
  const checks = useMemo(
    () => [
      password.length >= 12,
      /[A-Z]/u.test(password),
      /[a-z]/u.test(password),
      /[0-9]/u.test(password),
      /[^A-Za-z0-9]/u.test(password),
    ],
    [password]
  );
  const score = checks.filter(Boolean).length;
  const valid = score >= 4 && password.length > 0 && password === confirm;
  const announce = (text: string, kind: "error" | "success") => {
    setMessage({ kind, text });
    if (messageTimer.current) {
      window.clearTimeout(messageTimer.current);
    }
    messageTimer.current = window.setTimeout(() => {
      if (alive.current) {
        setMessage(null);
      }
    }, 3000);
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      submitting.current = false;
      if (navTimer.current) {
        window.clearTimeout(navTimer.current);
      }
      if (messageTimer.current) {
        window.clearTimeout(messageTimer.current);
      }
    };
  }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current) {
      return;
    }
    if (!valid) {
      announce(t("setup.errors.requirementNotMet"), "error");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setMessage(null);
    const secret = password;
    try {
      const result = await window.keyharbor.vault.setup(secret);
      if (!alive.current) {
        return;
      }
      setPassword("");
      setConfirm("");
      if (!result.success) {
        announce(result.error || t("setup.errors.requirementNotMet"), "error");
        setBusy(false);
        submitting.current = false;
        return;
      }
      announce(t("setup.success"), "success");
      navTimer.current = window.setTimeout(() => {
        (async () => {
          try {
            const status = await window.keyharbor.cli.check();
            if (alive.current) {
              if (status.installed) {
                window.keyharbor.navigate("dashboard");
              } else {
                setCliModal(true);
              }
            }
          } catch {
            if (alive.current) {
              setCliModal(true);
            }
          }
        })();
      }, 1000);
    } catch (error) {
      if (alive.current) {
        setPassword("");
        setConfirm("");
        announce(
          error instanceof Error
            ? error.message
            : t("setup.errors.requirementNotMet"),
          "error"
        );
        setBusy(false);
        submitting.current = false;
      }
    }
  };
  const installCli = async () => {
    if (installing) {
      return;
    }
    setInstalling(true);
    try {
      const result = await window.keyharbor.cli.install();
      if (!alive.current) {
        return;
      }
      if (result.success) {
        setCliModal(false);
        await window.keyharbor.navigate("dashboard");
      } else {
        announce(
          t("setup.cliModal.installError", { error: result.error || "" }),
          "error"
        );
        setInstalling(false);
      }
    } catch (error) {
      if (alive.current) {
        announce(
          t("setup.cliModal.installError", {
            error: error instanceof Error ? error.message : "",
          }),
          "error"
        );
        setInstalling(false);
      }
    }
  };
  const go = () => {
    setCliModal(false);
    window.keyharbor.navigate("dashboard");
  };
  return (
    <main className="container">
      <div className="setup-container">
        <div className="logo">
          <h1 id="title">{t("setup.title")}</h1>
          <p id="subtitle">{t("setup.subtitle")}</p>
        </div>
        <div className="card">
          <div className="card-header">
            <h2 className="card-title" id="card-title">
              {t("setup.cardTitle")}
            </h2>
          </div>
          <div id="message-container">
            {message && (
              <div
                className={`message message-${message.kind}`}
                role={message.kind === "error" ? "alert" : "status"}
              >
                {message.text}
              </div>
            )}
          </div>
          <form
            id="setup-form"
            onSubmit={(e) => {
              void submit(e);
            }}
          >
            <div className="input-group">
              <label htmlFor="password" id="label-password">
                {t("setup.password")}
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                placeholder={t("setup.passwordPlaceholder")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <div className="password-strength">
                <div
                  className={`password-strength-bar${password ? passwordStrengthClass(score) : ""}`}
                  id="strength-bar"
                />
              </div>
              <div className="requirements">
                {["length", "uppercase", "lowercase", "number", "special"].map(
                  (key, index) => (
                    <div
                      className={`requirement${checks[index] ? " met" : ""}`}
                      id={`req-${key}`}
                      key={key}
                    >
                      {t(`setup.requirements.${key}`)}
                    </div>
                  )
                )}
              </div>
            </div>
            <div className="input-group">
              <label htmlFor="confirm-password" id="label-confirm-password">
                {t("setup.confirmPassword")}
              </label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                placeholder={t("setup.confirmPasswordPlaceholder")}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            <div className="form-actions">
              <button
                type="submit"
                className="btn"
                id="setup-btn"
                disabled={!valid || busy}
              >
                {t(busy ? "setup.creatingVault" : "setup.createVault")}
              </button>
            </div>
          </form>
        </div>
        <div className="setup-warning text-center">
          <p id="warning-line1">{t("setup.warning.line1")}</p>
          <p id="warning-line2">{t("setup.warning.line2")}</p>
        </div>
      </div>
      {cliModal && (
        <Modal
          id="cli-install-modal"
          titleId="cli-modal-title"
          title={t("setup.cliModal.title")}
          onClose={go}
          footer=<div className="lk-form-dialog-footer">
            <Button
              variant="secondary"
              type="button"
              id="skip-cli-install"
              disabled={installing}
              onClick={go}
            >
              {t("setup.cliModal.skip")}
            </Button>
            <Button
              variant="default"
              type="button"
              id="confirm-cli-install"
              disabled={installing}
              onClick={() => {
                void installCli();
              }}
            >
              {t(
                installing
                  ? "setup.cliModal.installing"
                  : "setup.cliModal.install"
              )}
            </Button>
          </div>
        >
          <p id="cli-modal-description">{t("setup.cliModal.description")}</p>
          <div className="cli-features-box">
            <strong id="cli-features-title">
              {t("setup.cliModal.features")}
            </strong>
            <ul className="cli-features-list">
              <li id="cli-feature1">{t("setup.cliModal.feature1")}</li>
              <li id="cli-feature2">{t("setup.cliModal.feature2")}</li>
              <li id="cli-feature3">{t("setup.cliModal.feature3")}</li>
            </ul>
          </div>
        </Modal>
      )}
    </main>
  );
};
export const LogsScreen = () => {
  const { t } = useRendererTranslation();
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(50);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(false);
  const alive = useRef(true);
  const epoch = useRef(0);
  const loadSequence = useRef(0);
  const sessionTransition = useRef(-1);
  const sessionTarget = useRef<string | null>(null);
  const sessionSeen = useRef(false);
  const sessionActive = useRef(false);
  const container = useRef<HTMLDivElement>(null);
  const scrollTop = useRef<number | null>(null);
  const renderedLogs = useRef<ActivityLog[] | null>(null);
  const busyRef = useRef(false);
  const { confirm, confirmationDialog, cancelConfirmation } = useConfirmation();
  const load = useCallback(
    async (preserve = false) => {
      const token = epoch.current;
      loadSequence.current += 1;
      const sequence = loadSequence.current;
      if (preserve && container.current) {
        scrollTop.current = container.current.scrollTop;
      }
      try {
        const result = await window.keyharbor.logs.get();
        if (
          !alive.current ||
          token !== epoch.current ||
          sequence !== loadSequence.current
        ) {
          return;
        }
        requireSuccessfulResponse(result, "Failed to load logs");
        const reversed = [...result.data];
        reversed.reverse();
        setNow(Date.now());
        setLogs(reversed);
        setLoaded(true);
        setFailure(false);
      } catch {
        if (
          alive.current &&
          token === epoch.current &&
          sequence === loadSequence.current
        ) {
          setFailure(true);
          notificationManager.error(t("logs.notifications.failedToLoad"));
        }
      }
    },
    [t]
  );
  useEffect(() => {
    alive.current = true;
    const offSession = window.keyharbor.vault.onSessionStateChanged(
      (snapshot) => {
        if (snapshot.transitionId < sessionTransition.current) {
          return;
        }
        sessionTransition.current = snapshot.transitionId;
        const nextTarget = snapshot.activeVaultId || null;
        const changedVault =
          sessionSeen.current && nextTarget !== sessionTarget.current;
        sessionSeen.current = true;
        const wasActive = sessionActive.current;
        sessionTarget.current = nextTarget;
        sessionActive.current = snapshot.state === "active";
        if (snapshot.state !== "active" || changedVault) {
          cancelConfirmation();
          epoch.current += 1;
          loadSequence.current += 1;
          setLogs([]);
          setLoaded(false);
          setFailure(false);
          if (snapshot.state === "active") {
            load();
          }
        } else if (!wasActive) {
          load();
        }
      }
    );
    const offSync = window.keyharbor.vault.onVaultDataSynced(() => {
      if (sessionActive.current && document.visibilityState === "visible") {
        load(true);
      }
    });
    const onPagehide = () => {
      cancelConfirmation();
      alive.current = false;
      epoch.current += 1;
      loadSequence.current += 1;
    };
    const interval = window.setInterval(() => {
      if (sessionActive.current && document.visibilityState === "visible") {
        load(true);
      }
    }, 15_000);
    const visibility = () => {
      if (sessionActive.current && document.visibilityState === "visible") {
        load(true);
      }
    };
    window.addEventListener("pagehide", onPagehide);
    document.addEventListener("visibilitychange", visibility);
    (async () => {
      try {
        const snapshot = await window.keyharbor.vault.sessionSnapshot();
        if (
          !alive.current ||
          snapshot.transitionId < sessionTransition.current
        ) {
          return;
        }
        sessionTransition.current = snapshot.transitionId;
        sessionTarget.current = snapshot.activeVaultId || null;
        sessionSeen.current = true;
        sessionActive.current = snapshot.state === "active";
        if (!sessionActive.current) {
          epoch.current += 1;
          loadSequence.current += 1;
          setLogs([]);
          setLoaded(false);
        }
      } catch {
        // Session notifications remain authoritative when the snapshot is unavailable.
      }
    })();
    // Initial audit data is read through IPC; state updates follow the asynchronous response.
    // eslint-disable-next-line react/set-state-in-effect
    load();
    return () => {
      alive.current = false;
      epoch.current += 1;
      loadSequence.current += 1;
      window.clearInterval(interval);
      window.removeEventListener("pagehide", onPagehide);
      document.removeEventListener("visibilitychange", visibility);
      offSession();
      offSync();
    };
  }, [load, cancelConfirmation]);
  useLayoutEffect(() => {
    if (renderedLogs.current === logs) {
      return;
    }
    renderedLogs.current = logs;
    if (scrollTop.current !== null && container.current) {
      container.current.scrollTop = scrollTop.current;
      scrollTop.current = null;
    }
  }, [logs]);
  const filtered = useMemo(
    () =>
      logs.filter(
        (log) =>
          (category === "all" || log.category.toLowerCase() === category) &&
          (!search || log.message.toLowerCase().includes(search.toLowerCase()))
      ),
    [logs, category, search]
  );
  const ago = (timestamp: string) => {
    const date = new Date(timestamp);
    const minutes = Math.max(0, Math.floor((now - date.getTime()) / 60_000));
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (minutes < 1) {
      return t("logs.timeAgo.justNow");
    }
    if (minutes < 60) {
      return t(
        minutes === 1 ? "logs.timeAgo.minuteAgo" : "logs.timeAgo.minutesAgo",
        { count: minutes }
      );
    }
    if (hours < 24) {
      return t(hours === 1 ? "logs.timeAgo.hourAgo" : "logs.timeAgo.hoursAgo", {
        count: hours,
      });
    }
    if (days < 7) {
      return t(days === 1 ? "logs.timeAgo.dayAgo" : "logs.timeAgo.daysAgo", {
        count: days,
      });
    }
    return date.toLocaleString();
  };
  const clearLogs = async () => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    const token = epoch.current;
    await runWithCleanup(
      async () => {
        try {
          const approved = await confirm({
            confirmLabel: t("logs.clearAll"),
            description: t("logs.clearConfirm"),
            title: t("logs.clearAll"),
            variant: "destructive",
          });
          if (!approved || !alive.current || token !== epoch.current) {
            return;
          }
          setBusy(true);
          const result = await window.keyharbor.logs.clear();
          if (!alive.current || token !== epoch.current) {
            return;
          }
          requireSuccessfulResponse(result, "Failed to clear logs");
          setLogs([]);
          notificationManager.success(t("logs.notifications.cleared"));
        } catch {
          if (alive.current && token === epoch.current) {
            notificationManager.error(t("logs.notifications.failedToClear"));
          }
        }
      },
      () => {
        busyRef.current = false;
        if (alive.current) {
          setBusy(false);
        }
      }
    );
  };
  const exportLogs = async () => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    const token = epoch.current;
    await runWithCleanup(
      async () => {
        try {
          const result = await window.keyharbor.logs.export();
          if (!alive.current || token !== epoch.current) {
            return;
          }
          if (result.success) {
            notificationManager.success(
              t("logs.notifications.exported", { path: result.path || "" })
            );
          } else if (!result.cancelled) {
            notificationManager.error(t("logs.notifications.failedToExport"));
          }
        } catch {
          if (alive.current && token === epoch.current) {
            notificationManager.error(t("logs.notifications.failedToExport"));
          }
        }
      },
      () => {
        busyRef.current = false;
        if (alive.current) {
          setBusy(false);
        }
      }
    );
  };
  const loadMore = () => {
    if (
      container.current &&
      container.current.scrollHeight -
        container.current.scrollTop -
        container.current.clientHeight <
        80
    ) {
      setVisibleCount((count) => Math.min(filtered.length, count + 50));
    }
  };
  return (
    <main className="container">
      <div className="page-header">
        <div className="page-title">
          <Button
            variant="ghost"
            size="icon"
            type="button"
            id="back-btn"
            aria-label="Back to dashboard"
            onClick={() => {
              epoch.current += 1;
              window.location.href = "dashboard.html";
            }}
          >
            <span className="lk-icon lk-icon-arrow-left" aria-hidden="true" />
          </Button>
          <span id="title">{t("logs.title")}</span>
        </div>
        <div className="header-actions">
          <Button
            variant="secondary"
            id="export-logs-btn"
            type="button"
            disabled={busy}
            onClick={() => {
              void exportLogs();
            }}
          >
            {t("logs.export")}
          </Button>
          <Button
            variant="destructive"
            id="clear-logs-btn"
            type="button"
            disabled={busy}
            onClick={() => {
              void clearLogs();
            }}
          >
            {t("logs.clearAll")}
          </Button>
        </div>
      </div>
      <div className="logs-filters">
        <select
          id="category-filter"
          aria-label={t("logs.filterLabel")}
          className="btn btn-secondary filter-select"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setVisibleCount(50);
          }}
        >
          <option value="all">{t("logs.categories.all")}</option>
          <option value="access">{t("logs.categories.access")}</option>
          <option value="app">{t("logs.categories.app")}</option>
          <option value="lock">{t("logs.categories.lock")}</option>
        </select>
        <div className="search-bar">
          <Input
            id="search-input"
            aria-label={t("logs.searchPlaceholder")}
            className="logs-search-input"
            type="text"
            placeholder={t("logs.searchPlaceholder")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setVisibleCount(50);
            }}
          />
          <span
            className="search-icon lk-icon lk-icon-search"
            aria-hidden="true"
          />
        </div>
      </div>
      <div
        ref={container}
        className="logs-container"
        id="logs-container"
        onScroll={loadMore}
      >
        {!loaded && !failure && (
          <div className="loading">
            <div className="spinner" />
          </div>
        )}
        {failure && (
          <div className="empty-state">
            <div className="empty-state-title">
              {t("logs.notifications.failedToLoad")}
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                void load();
              }}
            >
              {t("common.retry")}
            </Button>
          </div>
        )}
        {loaded && filtered.length === 0 && (
          <div className="empty-state">
            <div
              className="empty-state-icon lk-icon lk-icon-clipboard lk-icon-xl"
              aria-hidden="true"
            />
            <div className="empty-state-title">
              {logs.length
                ? t("logs.emptyState.noMatchesTitle")
                : t("logs.emptyState.title")}
            </div>
            <div className="empty-state-description">
              {logs.length
                ? t("logs.emptyState.noMatchesDescription")
                : t("logs.emptyState.description")}
            </div>
          </div>
        )}
        {filtered.slice(0, visibleCount).map((log, index) => (
          <article
            className="log-item"
            key={`${log.timestamp}:${log.category}:${index}`}
          >
            <div className="log-header">
              <time
                className="log-timestamp"
                dateTime={log.timestamp}
                title={new Date(log.timestamp).toLocaleString()}
              >
                {ago(log.timestamp)}
              </time>
              <span className={`log-type ${log.category.toLowerCase()}`}>
                {t(`logs.categories.${log.category.toLowerCase()}`) ===
                `logs.categories.${log.category.toLowerCase()}`
                  ? log.category
                  : t(`logs.categories.${log.category.toLowerCase()}`)}
              </span>
            </div>
            <div className="log-message">{log.message}</div>
          </article>
        ))}
      </div>
      {confirmationDialog}
    </main>
  );
};
interface ApprovalState {
  responded: boolean;
  request: ApprovalRequest | null;
  timeLeft: number;
}
const approvalListeners = new Set<(request: ApprovalRequest) => void>();
let latestApproval: ApprovalRequest | null = null;
let approvalUnsubscribe: (() => void) | null = null;
// Register during module evaluation: Electron sends approval:data from did-finish-load,
// which can precede React mounting and the asynchronous translation request.
const attachApprovalListener = () => {
  if (approvalUnsubscribe || !window.electronAPI?.onApprovalData) {
    return;
  }
  approvalUnsubscribe = window.electronAPI.onApprovalData((request) => {
    latestApproval = request;
    for (const listener of approvalListeners) {
      listener(request);
    }
  });
};
if (typeof window !== "undefined") {
  attachApprovalListener();
  window.addEventListener("pagehide", () => {
    approvalUnsubscribe?.();
    approvalUnsubscribe = null;
    approvalListeners.clear();
    latestApproval = null;
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      attachApprovalListener();
    }
  });
}
export const ApprovalScreen = () => {
  const { t } = useRendererTranslation();
  const [state, setState] = useState<ApprovalState>({
    request: latestApproval,
    responded: false,
    timeLeft: 30,
  });
  const responded = useRef(false);
  const timer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const approveRef = useRef<HTMLButtonElement>(null);
  const requestRef = useRef<ApprovalRequest | null>(latestApproval);
  useEffect(() => {
    const receive = (request: ApprovalRequest) => {
      if (request.channel && request.channel === requestRef.current?.channel) {
        return;
      }
      responded.current = false;
      requestRef.current = request;
      setState({ request, responded: false, timeLeft: 30 });
      approveRef.current?.focus();
    };
    approvalListeners.add(receive);
    if (
      latestApproval &&
      latestApproval.channel !== requestRef.current?.channel
    ) {
      receive(latestApproval);
    }
    return () => {
      approvalListeners.delete(receive);
      if (timer.current) {
        window.clearInterval(timer.current);
      }
      if (closeTimer.current) {
        window.clearTimeout(closeTimer.current);
      }
    };
  }, []);
  const respond = useCallback((approved: boolean) => {
    const request = requestRef.current;
    if (responded.current || !request?.channel) {
      return;
    }
    responded.current = true;
    setState((current) => ({ ...current, responded: true }));
    if (timer.current) {
      window.clearInterval(timer.current);
    }
    const { channel } = request;
    window.setTimeout(
      () => window.electronAPI.sendApprovalResponse(approved, channel),
      50
    );
    closeTimer.current = window.setTimeout(() => window.close(), 300);
  }, []);
  useEffect(() => {
    if (!state.request) {
      return;
    }
    const started = Date.now();
    timer.current = window.setInterval(() => {
      const left = Math.max(0, 30 - (Date.now() - started) / 1000);
      setState((current) => ({ ...current, timeLeft: left }));
      if (left <= 0) {
        respond(false);
      }
    }, 200);
    return () => {
      if (timer.current) {
        window.clearInterval(timer.current);
      }
    };
  }, [state.request, respond]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const { target } = event;
      if (
        (event.key === "Enter" || event.key === " ") &&
        target instanceof HTMLButtonElement &&
        target.id === "deny-btn"
      ) {
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        respond(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        respond(false);
      }
    };
    document.addEventListener("keydown", key);
    const focus = () => approveRef.current?.focus();
    window.addEventListener("focus", focus);
    return () => {
      document.removeEventListener("keydown", key);
      window.removeEventListener("focus", focus);
    };
  }, [respond]);
  const { request } = state;
  const keys = request?.keys || [];
  const keyText = keys.join(", ");
  const progress = Math.max(0, (state.timeLeft / 30) * 100);
  const row = (id: string, label: string, value?: string) => (
    <div className="detail-row" key={id}>
      <div className="detail-label" id={`label-${id}`}>
        {t(label)}
      </div>
      <div className="detail-value" id={`${id}-value`}>
        {value || "-"}
      </div>
    </div>
  );
  return (
    <main className="approval-container">
      <section className="approval-card">
        <div className="titlebar">
          <div
            className="approval-icon lk-icon lk-icon-lock"
            aria-hidden="true"
          />
          <h2 className="approval-title" id="title">
            {t("approval.title")}
          </h2>
        </div>
        <div className="timeout-bar">
          <div
            className="timeout-progress"
            id="timeout-progress"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="approval-details">
          {row("vault", "approval.vault", request?.vaultName)}
          {row("project", "approval.project", request?.projectName)}
          {row("environment", "approval.environment", request?.environmentName)}
          {row(
            "keys",
            "approval.keys",
            keyText.length > 100 ? `${keyText.slice(0, 30)}...` : keyText
          )}
          {row(
            "action",
            "approval.action",
            t(
              request?.action === "write"
                ? "approval.actionTextWrite"
                : "approval.actionTextRead"
            )
          )}
        </div>
        <div className="approval-actions">
          <button
            type="button"
            className="btn approval-btn deny-btn"
            id="deny-btn"
            disabled={!request || state.responded}
            onClick={() => respond(false)}
          >
            {t("approval.deny")}
          </button>
          <button
            type="button"
            className="btn approval-btn approve-btn"
            id="approve-btn"
            ref={approveRef}
            disabled={!request || state.responded}
            onClick={() => respond(true)}
          >
            {t("approval.approve")}
          </button>
        </div>
      </section>
    </main>
  );
};
