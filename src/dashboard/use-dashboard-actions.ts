import { useCallback } from "react";

import { runWithCleanup as finalizeOperation } from "../renderer/async-operation";
import { notificationManager } from "../renderer/notifications";
import type { useConfirmation } from "../renderer/ui/confirmation";
import { isBridgeSuccess } from "./dashboard-data";
import { t } from "./dashboard-display";
import type { DashboardState } from "./use-dashboard-state";

interface DashboardActionData {
  isCurrentContext: (epoch: number, vaultId: string | null) => boolean;
}

interface DashboardActionDialogs {
  closeDialog: (preserveAction?: boolean) => void;
}

type Confirm = ReturnType<typeof useConfirmation>["confirm"];

export const useDashboardActions = (
  state: DashboardState,
  data: DashboardActionData,
  dialogs: DashboardActionDialogs,
  confirm: Confirm
) => {
  const {
    actionEpochRef,
    actionPendingRef,
    activeVaultRef,
    contextEpochRef,
    form,
    mountedRef,
    projects,
    projectsRef,
    refreshRef,
    sessionActiveRef,
    setActionBusy,
  } = state;
  const { isCurrentContext } = data;
  const { closeDialog } = dialogs;

  const runAction = useCallback(
    async <T>(
      name: string,
      action: () => Promise<T>,
      onResult: (
        value: T,
        epoch: number,
        vaultId: string | null
      ) => Promise<void>,
      allowVaultChange = false
    ) => {
      if (actionPendingRef.current) {
        return;
      }
      actionPendingRef.current = true;
      actionEpochRef.current += 1;
      const epoch = actionEpochRef.current;
      const vaultId = activeVaultRef.current;
      const contextEpoch = contextEpochRef.current;
      setActionBusy(name);
      await finalizeOperation(
        async () => {
          try {
            const result = await action();
            if (
              !mountedRef.current ||
              epoch !== actionEpochRef.current ||
              !sessionActiveRef.current ||
              (!allowVaultChange && !isCurrentContext(contextEpoch, vaultId))
            ) {
              return;
            }
            await onResult(result, epoch, vaultId);
          } catch {
            if (
              mountedRef.current &&
              epoch === actionEpochRef.current &&
              sessionActiveRef.current &&
              (allowVaultChange || isCurrentContext(contextEpoch, vaultId))
            ) {
              notificationManager.error(
                t("dashboard.notifications.failedToLoad")
              );
            }
          }
        },
        () => {
          if (mountedRef.current && epoch === actionEpochRef.current) {
            actionPendingRef.current = false;
            setActionBusy(null);
          }
        }
      );
    },
    [
      actionEpochRef,
      actionPendingRef,
      activeVaultRef,
      contextEpochRef,
      isCurrentContext,
      mountedRef,
      sessionActiveRef,
      setActionBusy,
    ]
  );

  const toggleFavorite = async (name: string) => {
    await runAction(
      "favorite",
      () => window.keyharbor.favorite.toggleProject(name),
      async (result, epoch, vaultId) => {
        if (!isBridgeSuccess<{ added: boolean }>(result)) {
          return;
        }
        const contextEpoch = contextEpochRef.current;
        await refreshRef.current();
        if (
          !mountedRef.current ||
          epoch !== actionEpochRef.current ||
          !isCurrentContext(contextEpoch, vaultId)
        ) {
          return;
        }
        notificationManager.success(
          t(
            result.added
              ? "dashboard.notifications.favoriteAdded"
              : "dashboard.notifications.favoriteRemoved"
          )
        );
      }
    );
  };

  const deleteProject = async (name: string) => {
    const confirmationActionEpoch = actionEpochRef.current;
    const confirmationContextEpoch = contextEpochRef.current;
    const confirmationVaultId = activeVaultRef.current;
    const confirmed = await confirm({
      confirmLabel: t("dashboard.deleteProject.deleteBtn"),
      description: t("dashboard.deleteProject.confirm", { name }),
      title: t("dashboard.deleteProject.deleteBtn"),
      variant: "destructive",
    });
    if (
      !confirmed ||
      confirmationActionEpoch !== actionEpochRef.current ||
      !isCurrentContext(confirmationContextEpoch, confirmationVaultId) ||
      !projectsRef.current.some((project) => project.name === name)
    ) {
      return;
    }
    await runAction(
      "delete-project",
      () => window.keyharbor.projects.delete(name),
      async (result, epoch, vaultId) => {
        if (!isBridgeSuccess(result)) {
          notificationManager.error(
            t("dashboard.notifications.failedToDelete")
          );
          return;
        }
        const contextEpoch = contextEpochRef.current;
        await refreshRef.current();
        if (
          mountedRef.current &&
          epoch === actionEpochRef.current &&
          isCurrentContext(contextEpoch, vaultId)
        ) {
          notificationManager.success(
            t("dashboard.notifications.projectDeleted", { name })
          );
        }
      }
    );
  };

  const submitProject = async () => {
    const name = form.projectName.trim();
    if (!name) {
      notificationManager.error(t("dashboard.notifications.enterName"));
      return;
    }
    if (projects.some((project) => project.name === name)) {
      notificationManager.error(t("dashboard.notifications.projectExists"));
      return;
    }
    await runAction(
      "create-project",
      () => window.keyharbor.projects.create(name),
      async (result, epoch, vaultId) => {
        if (!isBridgeSuccess(result)) {
          notificationManager.error(
            t("dashboard.notifications.failedToCreate")
          );
          return;
        }
        const contextEpoch = contextEpochRef.current;
        closeDialog(true);
        await refreshRef.current();
        if (
          mountedRef.current &&
          epoch === actionEpochRef.current &&
          isCurrentContext(contextEpoch, vaultId)
        ) {
          notificationManager.success(
            t("dashboard.notifications.projectCreated", { name })
          );
        }
      }
    );
  };

  return { deleteProject, runAction, submitProject, toggleFavorite };
};
