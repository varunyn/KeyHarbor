import { runWithCleanup as finalizeOperation } from "../renderer/async-operation";
import { notificationManager } from "../renderer/notifications";
import type { useConfirmation } from "../renderer/ui/confirmation";
import { isBridgeSuccess } from "./dashboard-data";
import { t } from "./dashboard-display";
import { blankForm } from "./dashboard-types";
import type { useDashboardActions } from "./use-dashboard-actions";
import type { DashboardState } from "./use-dashboard-state";

interface DashboardWorkspaceData {
  isCurrentContext: (epoch: number, vaultId: string | null) => boolean;
}

type DashboardActionRunner = Pick<
  ReturnType<typeof useDashboardActions>,
  "runAction"
>;
type Confirm = ReturnType<typeof useConfirmation>["confirm"];

export const useDashboardWorkspaceActions = (
  state: DashboardState,
  data: DashboardWorkspaceData,
  actions: DashboardActionRunner,
  confirm: Confirm
) => {
  const {
    actionEpochRef,
    actionPendingRef,
    activeVaultRef,
    contextEpochRef,
    dialogStateRef,
    modalFocusEpochRef,
    readEpochRef,
    setCliInstalled,
    setCliReady,
    setDialog,
    setForm,
    setMenu,
  } = state;
  const { isCurrentContext } = data;
  const { runAction } = actions;

  const handleCli = async (action: "install" | "uninstall") => {
    if (action === "uninstall") {
      const confirmationActionEpoch = actionEpochRef.current;
      const confirmationContextEpoch = contextEpochRef.current;
      const confirmationVaultId = activeVaultRef.current;
      const confirmed = await confirm({
        confirmLabel: t("dashboard.uninstallCli"),
        description: t("dashboard.confirmUninstallCli"),
        title: t("dashboard.uninstallCli"),
        variant: "destructive",
      });
      if (
        !confirmed ||
        confirmationActionEpoch !== actionEpochRef.current ||
        !isCurrentContext(confirmationContextEpoch, confirmationVaultId)
      ) {
        return;
      }
    }
    await runAction(
      `cli-${action}`,
      () =>
        action === "install"
          ? window.keyharbor.cli.install()
          : window.keyharbor.cli.uninstall(),
      async (result, epoch, vaultId) => {
        if (isBridgeSuccess<{ message: string }>(result)) {
          notificationManager.success(result.message);
          const contextEpoch = contextEpochRef.current;
          try {
            const status = await window.keyharbor.cli.check();
            if (
              epoch === actionEpochRef.current &&
              isCurrentContext(contextEpoch, vaultId)
            ) {
              setCliInstalled(status.installed);
              setCliReady(true);
            }
          } catch {
            if (
              epoch === actionEpochRef.current &&
              isCurrentContext(contextEpoch, vaultId)
            ) {
              setCliReady(true);
            }
          }
        } else {
          notificationManager.error(
            result.error ||
              t("dashboard.notifications.cliInstallFailed", {
                action,
                error: "",
              })
          );
        }
      }
    );
  };

  const lock = async () => {
    if (actionPendingRef.current) {
      return;
    }
    actionPendingRef.current = true;
    actionEpochRef.current += 1;
    const actionEpoch = actionEpochRef.current;
    const contextEpoch = contextEpochRef.current;
    const vaultId = activeVaultRef.current;
    readEpochRef.current += 1;
    setMenu(null);
    modalFocusEpochRef.current += 1;
    dialogStateRef.current = null;
    setDialog(null);
    setForm(blankForm());
    await finalizeOperation(
      async () => {
        try {
          const result = await window.keyharbor.vault.lock();
          if (
            actionEpoch === actionEpochRef.current &&
            isCurrentContext(contextEpoch, vaultId) &&
            !isBridgeSuccess(result)
          ) {
            notificationManager.error(
              result.error ||
                t("dashboard.notifications.lockError", { error: "" })
            );
          }
        } catch (error) {
          if (
            actionEpoch === actionEpochRef.current &&
            isCurrentContext(contextEpoch, vaultId)
          ) {
            notificationManager.error(
              t("dashboard.notifications.lockError", {
                error: error instanceof Error ? error.message : "",
              })
            );
          }
        }
      },
      () => {
        actionPendingRef.current = false;
      }
    );
  };

  const navigate = (page: "settings" | "logs") => {
    setMenu(null);
    window.location.href = `${page}.html`;
  };

  return { handleCli, lock, navigate };
};
