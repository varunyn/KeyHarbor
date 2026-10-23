import { useCallback } from "react";

import type { DialogForm, DialogKind } from "./dashboard-types";
import { blankForm } from "./dashboard-types";
import type { DashboardState } from "./use-dashboard-state";

export const useDashboardDialogs = (state: DashboardState) => {
  const {
    actionEpochRef,
    actionPendingRef,
    dialogStateRef,
    modalFocusEpochRef,
    mountedRef,
    pageHiddenRef,
    returnFocusRef,
    sessionActiveRef,
    setActionBusy,
    setDialog,
    setForm,
    setMenu,
  } = state;
  const closeMenus = useCallback(() => setMenu(null), [setMenu]);

  const closeDialog = useCallback(
    (preserveAction = false) => {
      if (!preserveAction) {
        actionEpochRef.current += 1;
        actionPendingRef.current = false;
        setActionBusy(null);
      }
      setForm(blankForm());
      dialogStateRef.current = null;
      setDialog(null);
      modalFocusEpochRef.current += 1;
      const focusEpoch = modalFocusEpochRef.current;
      const trigger = returnFocusRef.current;
      window.requestAnimationFrame(() =>
        window.requestAnimationFrame(() => {
          if (
            !mountedRef.current ||
            pageHiddenRef.current ||
            !sessionActiveRef.current ||
            focusEpoch !== modalFocusEpochRef.current ||
            dialogStateRef.current !== null
          ) {
            return;
          }
          const visible =
            trigger?.isConnected &&
            trigger.getClientRects().length > 0 &&
            !trigger.hasAttribute("disabled");
          const fallback = document.querySelector<HTMLElement>(
            "#vault-dropdown-btn"
          );
          (visible ? trigger : fallback)?.focus();
        })
      );
    },
    [
      actionEpochRef,
      actionPendingRef,
      dialogStateRef,
      modalFocusEpochRef,
      mountedRef,
      pageHiddenRef,
      returnFocusRef,
      sessionActiveRef,
      setActionBusy,
      setDialog,
      setForm,
    ]
  );

  const openDialog = useCallback(
    (
      kind: Exclude<DialogKind, null>,
      trigger?: HTMLElement | null,
      initial?: Partial<DialogForm>
    ) => {
      closeMenus();
      modalFocusEpochRef.current += 1;
      returnFocusRef.current =
        trigger ??
        (document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null);
      setForm({ ...blankForm(), ...initial });
      dialogStateRef.current = kind;
      setDialog(kind);
    },
    [
      closeMenus,
      dialogStateRef,
      modalFocusEpochRef,
      returnFocusRef,
      setDialog,
      setForm,
    ]
  );

  const returnFocusToVaultSwitcher = useCallback(() => {
    modalFocusEpochRef.current += 1;
    const focusEpoch = modalFocusEpochRef.current;
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => {
        if (
          !mountedRef.current ||
          pageHiddenRef.current ||
          !sessionActiveRef.current ||
          focusEpoch !== modalFocusEpochRef.current ||
          dialogStateRef.current !== null
        ) {
          return;
        }
        document.querySelector<HTMLElement>("#vault-dropdown-btn")?.focus();
      })
    );
  }, [
    dialogStateRef,
    modalFocusEpochRef,
    mountedRef,
    pageHiddenRef,
    sessionActiveRef,
  ]);

  const setField = (field: keyof DialogForm, value: string) =>
    setForm((current) => ({
      ...current,
      [field]: value,
      error: field === "error" ? value : "",
    }));

  return {
    closeDialog,
    closeMenus,
    openDialog,
    returnFocusToVaultSwitcher,
    setField,
  };
};
