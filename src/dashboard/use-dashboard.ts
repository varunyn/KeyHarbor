import { useRendererTranslation } from "../renderer/providers";
import { useConfirmation } from "../renderer/ui/confirmation";
import { useDashboardActions } from "./use-dashboard-actions";
import { useDashboardData } from "./use-dashboard-data";
import { useDashboardDialogs } from "./use-dashboard-dialogs";
import { useDashboardState } from "./use-dashboard-state";
import { useDashboardVaultActions } from "./use-dashboard-vault-actions";
import { useDashboardWorkspaceActions } from "./use-dashboard-workspace-actions";

export const useDashboard = () => {
  useRendererTranslation();
  const confirmation = useConfirmation();
  const state = useDashboardState();
  const dialogs = useDashboardDialogs(state);
  const data = useDashboardData(
    state,
    confirmation.cancelConfirmation,
    dialogs.closeMenus
  );
  const actions = useDashboardActions(
    state,
    data,
    dialogs,
    confirmation.confirm
  );
  const vaultActions = useDashboardVaultActions(
    state,
    data,
    dialogs,
    actions,
    confirmation.confirm
  );
  const workspaceActions = useDashboardWorkspaceActions(
    state,
    data,
    actions,
    confirmation.confirm
  );

  return {
    ...state,
    ...dialogs,
    ...data,
    ...actions,
    ...vaultActions,
    ...workspaceActions,
    cancelConfirmation: confirmation.cancelConfirmation,
    confirmationDialog: confirmation.confirmationDialog,
  };
};

export type DashboardController = ReturnType<typeof useDashboard>;
