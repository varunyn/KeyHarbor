import {
  ArrowLeft,
  ArrowRight,
  Check,
  Key,
  Loader2,
  Lock,
  X,
} from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { AGENT_APPROVAL_TIMEOUT_MS } from "../modules/agent-proxy-timeouts";
import type {
  AppSettings,
  AppTheme,
  ApprovalRequest,
  TouchIdStatus,
} from "../project/bridge";
import { runWithCleanup } from "./async-operation";
import { notificationManager } from "./notifications";
import { useRendererTranslation } from "./providers";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import { cn } from "./ui/utils";

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
const SETTINGS_SELECT_CLASS =
  "bg-secondary text-foreground border-border focus-visible:ring-primary h-8 min-w-[100px] rounded-lg border px-2.5 text-[13px] font-sans shadow-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none";

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
  <Switch
    id={id}
    aria-label={label}
    checked={checked}
    disabled={disabled}
    onCheckedChange={onChange}
  />
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
  <div
    className={cn(
      "border-border flex items-center justify-between border-b px-4 py-3.5 last:border-b-0",
      ids.hidden && "hidden"
    )}
    id={ids.row}
  >
    <div className="flex flex-col gap-0.5">
      <span className="text-foreground text-[14px] font-medium" id={ids.label}>
        {label}
      </span>
      {description && (
        <span
          className="text-muted-foreground text-[12px]"
          id={ids.description}
        >
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
  useEffect(
    () =>
      window.keyharbor.settings.onCloseBehaviorChanged((closeBehavior) => {
        setSettings((current) =>
          current ? { ...current, closeBehavior } : current
        );
      }),
    []
  );
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
      <main className="flex h-dvh flex-col overflow-x-hidden overflow-y-auto p-5">
        <div className="border-border mb-5 flex shrink-0 items-center justify-between border-b pb-5">
          <div className="text-foreground text-[28px] font-semibold">
            {t("settings.title")}
          </div>
        </div>
      </main>
    );
  }
  return (
    <main className="flex h-dvh flex-col overflow-x-hidden overflow-y-auto p-5">
      <div className="border-border mb-5 flex shrink-0 items-center justify-between border-b pb-5">
        <div className="text-foreground flex items-center gap-2.5 text-[28px] font-semibold">
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
            <ArrowLeft className="size-5" aria-hidden="true" />
          </Button>
          <span id="title">{t("settings.title")}</span>
        </div>
      </div>
      <div id="settings-container">
        <div className="border-border bg-card rounded-lg border">
          <SettingsRow
            label={t("settings.language")}
            description={t("settings.languageDesc")}
            ids={{ description: "desc-language", label: "label-language" }}
          >
            <select
              id="language-select"
              aria-labelledby="label-language"
              className={SETTINGS_SELECT_CLASS}
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
              className={SETTINGS_SELECT_CLASS}
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
            label={t("settings.closeBehavior")}
            description={t("settings.closeBehaviorDesc")}
            ids={{
              description: "desc-close-behavior",
              label: "label-close-behavior",
            }}
          >
            <select
              aria-describedby="desc-close-behavior"
              aria-labelledby="label-close-behavior"
              className={SETTINGS_SELECT_CLASS}
              id="close-behavior-select"
              onChange={(event) =>
                patch(
                  "closeBehavior",
                  event.target.value as AppSettings["closeBehavior"]
                )
              }
              value={settings.closeBehavior}
            >
              <option value="ask">{t("settings.closeBehaviorAsk")}</option>
              <option value="background">
                {t("settings.closeBehaviorBackground")}
              </option>
              <option value="quit">{t("settings.closeBehaviorQuit")}</option>
            </select>
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
            <div
              className="border-border flex items-center justify-between border-b px-4 py-3.5 last:border-b-0"
              id="auto-lock-timeout-item"
            >
              <div className="flex flex-col gap-0.5">
                <span
                  className="text-foreground text-[14px] font-medium"
                  id="label-auto-lock-timeout"
                >
                  {t("settings.autoLockTimeout")}
                </span>
              </div>
              <Input
                id="auto-lock-timeout-input"
                aria-labelledby="label-auto-lock-timeout"
                type="number"
                className="h-8 w-24 text-[13px]"
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
              className={SETTINGS_SELECT_CLASS}
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
            <h3
              className="text-foreground border-border border-t px-4 pt-4 pb-2 text-[16px] font-semibold"
              id="vault-section-title"
            >
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
          <p
            id="delete-vault-warning"
            className="text-muted-foreground mb-3 text-[13px] leading-relaxed"
          >
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
    <main className="flex h-dvh flex-col items-center justify-center p-5">
      <section className="w-full max-w-[400px]">
        <div className="mb-10 text-center">
          <h1
            id="title"
            className="text-primary text-[36px] font-bold tracking-tight"
          >
            {t("lock.title")}
          </h1>
          <p id="subtitle" className="text-muted-foreground mt-2 text-[16px]">
            {t("lock.subtitle")}
          </p>
        </div>
        <div
          id="message-container"
          className="text-destructive mb-3 min-h-[1.25rem] text-center text-[14px]"
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
          <div className="relative flex items-center">
            <Input
              id="password"
              ref={passwordRef}
              type="password"
              autoComplete="current-password"
              placeholder={t("lock.passwordPlaceholder")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-10 pr-10 text-[14px]"
            />
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 size-8"
              id="unlock-btn"
              type="submit"
              disabled={busy}
              aria-label={t("lock.title")}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <ArrowRight className="size-4" aria-hidden="true" />
              )}
            </Button>
          </div>
        </form>
        {touchEnabled && (
          <div id="touch-id-actions" className="mt-3.5">
            <Button
              variant="secondary"
              className="h-9 w-full gap-2 text-[13px]"
              id="touch-id-btn"
              type="button"
              disabled={busy}
              onClick={() => {
                void unlock("touch");
              }}
            >
              <Key className="size-4" aria-hidden="true" />
              <span id="touch-id-label">{t("lock.touchIdButton")}</span>
            </Button>
          </div>
        )}
      </section>
    </main>
  );
};
const passwordStrengthWidth = (score: number) => {
  if (score <= 2) {
    return "w-1/3 bg-destructive";
  }
  if (score <= 4) {
    return "w-2/3 bg-[var(--warning,#fbbf24)]";
  }
  return "w-full bg-[var(--success,#4edea3)]";
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
    <main className="flex h-dvh flex-col overflow-x-hidden overflow-y-auto p-5">
      <div className="mx-auto my-auto w-full max-w-[500px] py-8">
        <div className="mb-8 text-center">
          <h1
            id="title"
            className="text-primary text-[36px] font-bold tracking-tight"
          >
            {t("setup.title")}
          </h1>
          <p id="subtitle" className="text-muted-foreground mt-2 text-[16px]">
            {t("setup.subtitle")}
          </p>
        </div>
        <div className="border-border bg-card rounded-lg border p-6 shadow-sm">
          <div className="mb-5">
            <h2
              className="text-foreground text-[20px] font-semibold"
              id="card-title"
            >
              {t("setup.cardTitle")}
            </h2>
          </div>
          <div id="message-container">
            {message && (
              <div
                className={cn(
                  "mb-4 rounded-md p-3 text-[13px]",
                  message.kind === "error"
                    ? "border-destructive/30 bg-destructive/10 text-destructive border"
                    : "border-success/30 bg-success/10 text-success border"
                )}
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
            <div className="mb-4 flex flex-col gap-1.5">
              <label
                htmlFor="password"
                id="label-password"
                className="text-foreground text-[14px] font-medium"
              >
                {t("setup.password")}
              </label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                placeholder={t("setup.passwordPlaceholder")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <div className="bg-secondary mt-1.5 h-1 overflow-hidden rounded-full">
                <div
                  className={cn(
                    "h-full transition-all duration-300",
                    password ? passwordStrengthWidth(score) : "w-0"
                  )}
                  id="strength-bar"
                />
              </div>
              <div className="mt-2.5 space-y-1">
                {["length", "uppercase", "lowercase", "number", "special"].map(
                  (key, index) => (
                    <div
                      className={cn(
                        "flex items-center gap-2 text-[12px]",
                        checks[index]
                          ? "text-[var(--success,#4edea3)]"
                          : "text-muted-foreground"
                      )}
                      id={`req-${key}`}
                      key={key}
                    >
                      {checks[index] ? (
                        <Check
                          className="size-3.5 shrink-0 text-[var(--success,#4edea3)]"
                          aria-hidden="true"
                        />
                      ) : (
                        <X
                          className="text-destructive size-3.5 shrink-0"
                          aria-hidden="true"
                        />
                      )}
                      <span>{t(`setup.requirements.${key}`)}</span>
                    </div>
                  )
                )}
              </div>
            </div>
            <div className="mb-6 flex flex-col gap-1.5">
              <label
                htmlFor="confirm-password"
                id="label-confirm-password"
                className="text-foreground text-[14px] font-medium"
              >
                {t("setup.confirmPassword")}
              </label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                placeholder={t("setup.confirmPasswordPlaceholder")}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            <div>
              <Button
                type="submit"
                variant="default"
                className="w-full"
                id="setup-btn"
                disabled={!valid || busy}
              >
                {t(busy ? "setup.creatingVault" : "setup.createVault")}
              </Button>
            </div>
          </form>
        </div>
        <div className="text-muted-foreground mt-8 text-center text-[13px] leading-relaxed">
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
          <p
            id="cli-modal-description"
            className="text-muted-foreground text-[13px] leading-relaxed"
          >
            {t("setup.cliModal.description")}
          </p>
          <div className="border-border bg-secondary/50 mt-4 rounded-lg border p-4 text-[13px]">
            <strong
              id="cli-features-title"
              className="text-foreground block font-semibold"
            >
              {t("setup.cliModal.features")}
            </strong>
            <ul className="text-muted-foreground mt-2 list-disc space-y-1 pl-5">
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
const isAgentApproval = (request: ApprovalRequest | null): boolean =>
  request?.action === "connect" || request?.action === "use";

const AgentApprovalDetails = ({
  request,
  row,
}: {
  request: ApprovalRequest | null;
  row: (id: string, label: string, value?: string) => React.ReactNode;
}) => {
  const { t } = useRendererTranslation();
  if (!request || !isAgentApproval(request)) {
    return null;
  }
  return (
    <>
      {row("destination", "approval.destination", request.origin)}
      {row(
        "methods",
        "approval.methods",
        request.method ?? request.methods?.join(", ")
      )}
      {row(
        "paths",
        "approval.paths",
        request.path ?? request.pathPrefixes?.join(", ")
      )}
      {request.action === "use" &&
        row(
          "body-size",
          "approval.bodySize",
          t("approval.byteCount", { count: request.bodyBytes ?? 0 })
        )}
      {request.allowPrivateNetwork && (
        <p className="mt-[12px] text-[12px] leading-normal text-[var(--warning)]">
          {t("approval.privateNetwork")}
        </p>
      )}
      {request.customTrust && (
        <p className="mt-[12px] text-[12px] leading-normal text-[var(--warning)]">
          {t("approval.customTrust")}
        </p>
      )}
      {request.bodyPreview && (
        <details className="mt-[12px] text-[12px]">
          <summary className="text-muted-foreground focus-visible:outline-ring cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2">
            {t("approval.bodyPreview")}
          </summary>
          <pre className="mt-[8px] block font-mono leading-normal [overflow-wrap:anywhere] whitespace-pre-wrap">
            {request.bodyPreview}
          </pre>
        </details>
      )}
      {request.requestDigest && (
        <details className="mt-[12px] text-[12px]">
          <summary className="text-muted-foreground focus-visible:outline-ring cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2">
            {t("approval.requestDigest")}
          </summary>
          <code className="mt-[8px] block font-mono leading-normal [overflow-wrap:anywhere] whitespace-pre-wrap">
            {request.requestDigest}
          </code>
        </details>
      )}
    </>
  );
};

const approvalTimeoutSeconds = (request: ApprovalRequest | null) =>
  isAgentApproval(request) ? AGENT_APPROVAL_TIMEOUT_MS / 1000 : 30;

export const ApprovalScreen = () => {
  const { t } = useRendererTranslation();
  const [state, setState] = useState<ApprovalState>({
    request: latestApproval,
    responded: false,
    timeLeft: approvalTimeoutSeconds(latestApproval),
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
      setState({
        request,
        responded: false,
        timeLeft: approvalTimeoutSeconds(request),
      });
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
      const left = Math.max(
        0,
        approvalTimeoutSeconds(state.request) - (Date.now() - started) / 1000
      );
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
      if (event.key === "Escape") {
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
  const agentRequest = isAgentApproval(request);
  const actionLabel = {
    connect: "approval.actionTextConnect",
    read: "approval.actionTextRead",
    use: "approval.actionTextUse",
    write: "approval.actionTextWrite",
  }[request?.action ?? "read"];
  const keys = request?.keys || [];
  const keyText = keys.join(", ");
  const progress = Math.max(
    0,
    (state.timeLeft / approvalTimeoutSeconds(request)) * 100
  );
  const row = (id: string, label: string, value?: string) => (
    <div className="mb-[8px] flex gap-[10px] last:mb-0" key={id}>
      <div
        className="text-muted-foreground w-[128px] shrink-0 font-semibold"
        id={`label-${id}`}
      >
        {t(label)}
      </div>
      <div
        className="text-foreground min-w-0 flex-1 [overflow-wrap:anywhere]"
        id={`${id}-value`}
      >
        {value || "-"}
      </div>
    </div>
  );
  return (
    <main className="flex h-dvh flex-col items-center justify-center p-[20px]">
      <section
        aria-labelledby="title"
        className="border-border bg-card text-foreground flex max-h-full w-full max-w-[520px] flex-col rounded-[8px] border border-solid p-[20px]"
      >
        <div className="flex shrink-0 gap-[8px]">
          <Lock className="mb-[20px] size-[28px] shrink-0" aria-hidden="true" />
          <h2 className="mt-[2px] text-[20px] font-semibold" id="title">
            {t(agentRequest ? "approval.agentTitle" : "approval.title")}
          </h2>
        </div>
        <div className="bg-secondary mb-[20px] h-[4px] shrink-0 overflow-hidden">
          <div
            className="h-full bg-[var(--warning)]"
            id="timeout-progress"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div
          className="bg-secondary mb-[20px] min-h-0 flex-[0_1_auto] overflow-y-auto rounded-[8px] px-[16px] py-[12px]"
          id="approval-details"
        >
          {row("vault", "approval.vault", request?.vaultName)}
          {row("project", "approval.project", request?.projectName)}
          {row("environment", "approval.environment", request?.environmentName)}
          {row(
            "keys",
            "approval.keys",
            keyText.length > 100 ? `${keyText.slice(0, 30)}...` : keyText
          )}
          {row("action", "approval.action", t(actionLabel))}
          <AgentApprovalDetails request={request} row={row} />
        </div>
        {agentRequest && (
          <p className="text-muted-foreground mb-[16px] shrink-0 text-[12px] leading-normal">
            {t("approval.agentNote")}
          </p>
        )}
        <div className="flex shrink-0 gap-[15px]">
          <Button
            type="button"
            className="h-[40px] flex-1 text-[14px]"
            variant="destructive"
            id="deny-btn"
            disabled={!request || state.responded}
            onClick={() => respond(false)}
          >
            {t("approval.deny")}
          </Button>
          <Button
            type="button"
            className="h-[40px] flex-1 text-[14px]"
            id="approve-btn"
            ref={approveRef}
            disabled={!request || state.responded}
            onClick={() => respond(true)}
          >
            {t("approval.approve")}
          </Button>
        </div>
      </section>
    </main>
  );
};
