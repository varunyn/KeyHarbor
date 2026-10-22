import { useCallback, useReducer } from "react";

import type { EnvironmentSummary, SecretHistory } from "./bridge";
import {
  createInitialProjectScreenState,
  projectScreenReducer,
} from "./project-screen-reducer";
import type { Modal, SecretDraft } from "./project-screen-reducer";
import type { ProjectView } from "./project-sidebar";

export const useProjectScreenState = (initialOverlayMode?: boolean) => {
  const [state, dispatch] = useReducer(
    projectScreenReducer,
    initialOverlayMode,
    createInitialProjectScreenState
  );

  const setSelected = useCallback((selected: string | null) => {
    dispatch({ selected, type: "SET_SELECTED" });
  }, []);

  const setView = useCallback((view: ProjectView) => {
    dispatch({ type: "SET_VIEW", view });
  }, []);

  const setSearch = useCallback((search: string) => {
    dispatch({ search, type: "SET_SEARCH" });
  }, []);

  const setFilterType = useCallback((filterType: string) => {
    dispatch({ filterType, type: "SET_FILTER_TYPE" });
  }, []);

  const setFilterStatus = useCallback((filterStatus: string) => {
    dispatch({ filterStatus, type: "SET_FILTER_STATUS" });
  }, []);

  const setMenu = useCallback((menu: string | null) => {
    dispatch({ menu, type: "SET_MENU" });
  }, []);

  const setRowMenu = useCallback((key: string, open: boolean) => {
    dispatch({ key, open, type: "SET_ROW_MENU" });
  }, []);

  const setInspectorOpen = useCallback((open: boolean) => {
    dispatch({ open, type: "SET_INSPECTOR_OPEN" });
  }, []);

  const setChecklistOpen = useCallback((open: boolean) => {
    dispatch({ open, type: "SET_CHECKLIST_OPEN" });
  }, []);

  const toggleChecklist = useCallback(() => {
    dispatch({ type: "TOGGLE_CHECKLIST" });
  }, []);

  const setOverlayMode = useCallback((overlayMode: boolean) => {
    dispatch({ overlayMode, type: "SET_OVERLAY_MODE" });
  }, []);

  const setModal = useCallback((modal: Modal) => {
    dispatch({ modal, type: "SET_MODAL" });
  }, []);

  const openModal = useCallback((modal: Modal, actionKey?: string) => {
    dispatch({ actionKey, modal, type: "OPEN_MODAL" });
  }, []);

  const closeModal = useCallback(() => {
    dispatch({ type: "CLOSE_MODAL" });
  }, []);

  const setActionBusy = useCallback((busy: boolean) => {
    dispatch({ busy, type: "SET_ACTION_BUSY" });
  }, []);

  const setActionKey = useCallback((key: string) => {
    dispatch({ key, type: "SET_ACTION_KEY" });
  }, []);

  const setSecretDraft = useCallback((draft: SecretDraft) => {
    dispatch({ draft, type: "SET_SECRET_DRAFT" });
  }, []);

  const updateSecretDraft = useCallback((patch: Partial<SecretDraft>) => {
    dispatch({ patch, type: "UPDATE_SECRET_DRAFT" });
  }, []);

  const setFieldErrors = useCallback((errors: Record<string, string>) => {
    dispatch({ errors, type: "SET_FIELD_ERRORS" });
  }, []);

  const setDuplicateTarget = useCallback((target: string) => {
    dispatch({ target, type: "SET_DUPLICATE_TARGET" });
  }, []);

  const setDuplicateEnvironmentId = useCallback((id: string) => {
    dispatch({ id, type: "SET_DUPLICATE_ENVIRONMENT_ID" });
  }, []);

  const setDuplicateEnvironments = useCallback(
    (environments: EnvironmentSummary[], defaultId?: string) => {
      dispatch({ defaultId, environments, type: "SET_DUPLICATE_ENVIRONMENTS" });
    },
    []
  );

  const setRawPassword = useCallback((password: string) => {
    dispatch({ password, type: "SET_RAW_PASSWORD" });
  }, []);

  const setHistory = useCallback((history: SecretHistory | null) => {
    dispatch({ history, type: "SET_HISTORY" });
  }, []);

  const setHistoryLoading = useCallback((loading: boolean) => {
    dispatch({ loading, type: "SET_HISTORY_LOADING" });
  }, []);

  const setHistoryShown = useCallback((shown: Record<number, boolean>) => {
    dispatch({ shown, type: "SET_HISTORY_SHOWN" });
  }, []);

  const toggleHistoryShown = useCallback((index: number) => {
    dispatch({ index, type: "TOGGLE_HISTORY_SHOWN" });
  }, []);

  const setRestoreArmed = useCallback((armed: number | null) => {
    dispatch({ armed, type: "SET_RESTORE_ARMED" });
  }, []);

  const clearRestoreArmed = useCallback((index: number) => {
    dispatch({ index, type: "CLEAR_RESTORE_ARMED" });
  }, []);

  const setReveal = useCallback(
    (reveal: { key: string; remaining: number } | null) => {
      dispatch({ reveal, type: "SET_REVEAL" });
    },
    []
  );

  const tickReveal = useCallback(() => {
    dispatch({ type: "TICK_REVEAL" });
  }, []);

  const retireSensitiveState = useCallback(() => {
    dispatch({ type: "RETIRE_SENSITIVE_STATE" });
  }, []);

  const sessionLocked = useCallback(() => {
    dispatch({ type: "SESSION_LOCKED" });
  }, []);

  const selectSecret = useCallback((key: string, openInspector?: boolean) => {
    dispatch({ key, openInspector, type: "SELECT_SECRET" });
  }, []);

  const secretLoaded = useCallback(
    (data: Record<string, unknown>, openInspector: boolean) => {
      dispatch({ data, openInspector, type: "SECRET_LOADED" });
    },
    []
  );

  const closePanels = useCallback(() => {
    dispatch({ type: "CLOSE_PANELS" });
  }, []);

  const resetFilters = useCallback(() => {
    dispatch({ type: "RESET_FILTERS" });
  }, []);

  return {
    ...state,
    clearRestoreArmed,
    closeModal,
    closePanels,
    dispatch,
    openModal,
    resetFilters,
    retireSensitiveState,
    secretLoaded,
    selectSecret,
    sessionLocked,
    setActionBusy,
    setActionKey,
    setChecklistOpen,
    setDuplicateEnvironmentId,
    setDuplicateEnvironments,
    setDuplicateTarget,
    setFieldErrors,
    setFilterStatus,
    setFilterType,
    setHistory,
    setHistoryLoading,
    setHistoryShown,
    setInspectorOpen,
    setMenu,
    setModal,
    setOverlayMode,
    setRawPassword,
    setRestoreArmed,
    setReveal,
    setRowMenu,
    setSearch,
    setSecretDraft,
    setSelected,
    setView,
    state,
    tickReveal,
    toggleChecklist,
    toggleHistoryShown,
    updateSecretDraft,
  };
};
