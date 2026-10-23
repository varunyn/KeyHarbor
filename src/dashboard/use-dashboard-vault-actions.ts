import type { VaultListEntry } from "../project/bridge";
import { runWithCleanup as finalizeOperation } from "../renderer/async-operation";
import { notificationManager } from "../renderer/notifications";
import type { useConfirmation } from "../renderer/ui/confirmation";
import { isBridgeSuccess } from "./dashboard-data";
import { t } from "./dashboard-display";
import type { useDashboardActions } from "./use-dashboard-actions";
import type { DashboardState } from "./use-dashboard-state";

interface DashboardVaultData {
  isCurrentContext: (epoch: number, vaultId: string | null) => boolean;
  loadVaults: () => Promise<void>;
}

interface DashboardVaultDialogs {
  closeDialog: (preserveAction?: boolean) => void;
  closeMenus: () => void;
  returnFocusToVaultSwitcher: () => void;
}

type DashboardActionRunner = Pick<
  ReturnType<typeof useDashboardActions>,
  "runAction"
>;
type Confirm = ReturnType<typeof useConfirmation>["confirm"];
const folderNamePattern = /(?<name>[^/\\]+)[/\\]*$/u;

export const useDashboardVaultActions = (
  state: DashboardState,
  data: DashboardVaultData,
  dialogs: DashboardVaultDialogs,
  actions: DashboardActionRunner,
  confirmAction: Confirm
) => {
  const {
    actionEpochRef,
    activeVaultRef,
    contextEpochRef,
    dialog,
    dialogStateRef,
    form,
    mountedRef,
    pageHiddenRef,
    pendingSwitchVaultRef,
    projectsRef,
    readEpochRef,
    refreshRef,
    sessionActiveRef,
    setAccessTimes,
    setActiveVaultId,
    setFavorites,
    setForm,
    setLoadState,
    setProjects,
    setStatistics,
    vaultsRef,
  } = state;
  const { isCurrentContext, loadVaults } = data;
  const { closeDialog, closeMenus, returnFocusToVaultSwitcher } = dialogs;
  const { runAction } = actions;

  const switchVault = async (vault: VaultListEntry) => {
    closeMenus();
    if (vault.isActive) {
      return;
    }
    if (vault.status === "offline") {
      notificationManager.error(t("vault.notifications.offlineVault"));
      return;
    }
    pendingSwitchVaultRef.current = vault.id;
    await finalizeOperation(
      async () => {
        await runAction(
          "switch-vault",
          () => window.keyharbor.vault.switch(vault.id),
          async (result, actionEpoch) => {
            if (!isBridgeSuccess(result)) {
              notificationManager.error(
                t("vault.notifications.failedToSwitch")
              );
              return;
            }
            const snapshot = await window.keyharbor.vault.sessionSnapshot();
            if (
              !mountedRef.current ||
              pageHiddenRef.current ||
              !sessionActiveRef.current ||
              actionEpoch !== actionEpochRef.current ||
              snapshot.state !== "active" ||
              snapshot.activeVaultId !== vault.id
            ) {
              return;
            }
            if (activeVaultRef.current !== vault.id) {
              contextEpochRef.current += 1;
            }
            activeVaultRef.current = vault.id;
            setActiveVaultId(vault.id);
            projectsRef.current = [];
            setProjects([]);
            setFavorites([]);
            setStatistics(null);
            setAccessTimes({});
            setLoadState("loading");
            const switchContextEpoch = contextEpochRef.current;
            readEpochRef.current += 1;
            await loadVaults();
            if (
              !isCurrentContext(switchContextEpoch, vault.id) ||
              actionEpoch !== actionEpochRef.current
            ) {
              return;
            }
            await refreshRef.current();
            if (
              !isCurrentContext(switchContextEpoch, vault.id) ||
              actionEpoch !== actionEpochRef.current
            ) {
              return;
            }
            notificationManager.success(
              t("vault.notifications.switched", { name: vault.name })
            );
          },
          true
        );
      },
      () => {
        if (pendingSwitchVaultRef.current === vault.id) {
          pendingSwitchVaultRef.current = null;
        }
      }
    );
  };

  const browseFolder = async (kind: "create-vault" | "import-vault") => {
    const epoch = actionEpochRef.current;
    const vaultId = activeVaultRef.current;
    try {
      const result = await window.keyharbor.dialog.selectFolder();
      if (
        !mountedRef.current ||
        !sessionActiveRef.current ||
        epoch !== actionEpochRef.current ||
        vaultId !== activeVaultRef.current ||
        dialog !== kind ||
        !result.success ||
        !result.data
      ) {
        return;
      }
      const path = result.data;
      const folderName = path.match(folderNamePattern)?.groups?.name || "";
      setForm((current) => ({
        ...current,
        error: "",
        folderPath: path,
        vaultName:
          kind === "import-vault" && !current.vaultName && folderName !== "lkv"
            ? folderName
            : current.vaultName,
      }));
    } catch {
      if (
        mountedRef.current &&
        sessionActiveRef.current &&
        epoch === actionEpochRef.current &&
        vaultId === activeVaultRef.current &&
        dialogStateRef.current === kind
      ) {
        setForm((current) => ({
          ...current,
          error: t("vault.notifications.failedToCreate"),
        }));
      }
    }
  };

  const submitVaultCreate = async () => {
    const name = form.vaultName.trim();
    const folderPath = form.folderPath.trim();
    if (!name) {
      setForm((current) => ({
        ...current,
        error: t("vault.notifications.nameRequired"),
      }));
      return;
    }
    if (!folderPath) {
      setForm((current) => ({
        ...current,
        error: t("vault.notifications.pathRequired"),
      }));
      return;
    }
    if (form.password !== form.passwordConfirm) {
      setForm((current) => ({
        ...current,
        error: t("vault.notifications.passwordMismatch"),
      }));
      return;
    }
    const { password } = form;
    await runAction(
      "create-vault",
      () => window.keyharbor.vault.create(name, folderPath, password),
      async (result, epoch, vaultId) => {
        if (!isBridgeSuccess(result)) {
          setForm((current) => ({
            ...current,
            error: result.error || t("vault.notifications.failedToCreate"),
          }));
          return;
        }
        closeDialog(true);
        await loadVaults();
        if (
          mountedRef.current &&
          sessionActiveRef.current &&
          epoch === actionEpochRef.current &&
          vaultId === activeVaultRef.current
        ) {
          notificationManager.success(
            t("vault.notifications.created", { name })
          );
        }
      }
    );
  };

  const submitVaultImport = async () => {
    const name = form.vaultName.trim();
    const folderPath = form.folderPath.trim();
    if (!folderPath) {
      setForm((current) => ({
        ...current,
        error: t("vault.notifications.pathRequired"),
      }));
      return;
    }
    if (!name) {
      setForm((current) => ({
        ...current,
        error: t("vault.notifications.nameRequired"),
      }));
      return;
    }
    if (!form.password) {
      setForm((current) => ({
        ...current,
        error: t("vault.notifications.passwordRequired"),
      }));
      return;
    }
    const { password } = form;
    await runAction(
      "import-vault",
      () => window.keyharbor.vault.import(name, folderPath, password),
      async (result, epoch, vaultId) => {
        if (!isBridgeSuccess(result)) {
          setForm((current) => ({
            ...current,
            error: result.error || t("vault.notifications.failedToImport"),
          }));
          return;
        }
        closeDialog(true);
        await loadVaults();
        if (
          mountedRef.current &&
          sessionActiveRef.current &&
          epoch === actionEpochRef.current &&
          vaultId === activeVaultRef.current
        ) {
          notificationManager.success(
            t("vault.notifications.imported", { name })
          );
        }
      }
    );
  };

  const submitVaultRename = async () => {
    const name = form.vaultName.trim();
    if (!name) {
      setForm((current) => ({
        ...current,
        error: t("vault.notifications.nameRequired"),
      }));
      return;
    }
    await runAction(
      "rename-vault",
      () => window.keyharbor.vault.rename(form.renameVaultId, name),
      async (result, epoch, vaultId) => {
        if (!isBridgeSuccess(result)) {
          setForm((current) => ({
            ...current,
            error: result.error || t("vault.notifications.failedToRename"),
          }));
          return;
        }
        closeDialog(true);
        await loadVaults();
        if (
          mountedRef.current &&
          sessionActiveRef.current &&
          epoch === actionEpochRef.current &&
          vaultId === activeVaultRef.current
        ) {
          notificationManager.success(
            t("vault.notifications.renamed", { name })
          );
        }
      }
    );
  };

  const removeVault = async (vault: VaultListEntry) => {
    const confirmationActionEpoch = actionEpochRef.current;
    const confirmationContextEpoch = contextEpochRef.current;
    const confirmationVaultId = activeVaultRef.current;
    const confirmationTargetId = vault.id;
    const confirmed = await confirmAction({
      confirmLabel: t("vault.context.remove"),
      description: t("vault.remove.confirm", { name: vault.name }),
      title: t("vault.context.remove"),
      variant: "destructive",
    });
    const contextIsCurrent = isCurrentContext(
      confirmationContextEpoch,
      confirmationVaultId
    );
    if (!confirmed) {
      if (contextIsCurrent) {
        returnFocusToVaultSwitcher();
      }
      return;
    }
    if (
      confirmationActionEpoch !== actionEpochRef.current ||
      !contextIsCurrent ||
      !vaultsRef.current.some(
        (candidate) => candidate.id === confirmationTargetId
      )
    ) {
      if (contextIsCurrent) {
        returnFocusToVaultSwitcher();
      }
      return;
    }
    await runAction(
      "remove-vault",
      () => window.keyharbor.vault.remove(vault.id),
      async (result, epoch) => {
        if (!isBridgeSuccess(result)) {
          notificationManager.error(
            result.error || t("vault.notifications.failedToRemove")
          );
          returnFocusToVaultSwitcher();
          return;
        }
        await loadVaults();
        const refreshedVaultId = activeVaultRef.current;
        const refreshedContextEpoch = contextEpochRef.current;
        await refreshRef.current();
        if (
          mountedRef.current &&
          epoch === actionEpochRef.current &&
          isCurrentContext(refreshedContextEpoch, refreshedVaultId)
        ) {
          notificationManager.success(
            t("vault.notifications.removed", { name: vault.name })
          );
          returnFocusToVaultSwitcher();
        }
      }
    );
  };

  return {
    browseFolder,
    removeVault,
    submitVaultCreate,
    submitVaultImport,
    submitVaultRename,
    switchVault,
  };
};
