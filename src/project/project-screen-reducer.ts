import type { EnvironmentSummary, SecretHistory } from "./bridge";
import type { ProjectView } from "./project-sidebar";
import type { SecretDraft } from "./secret-editor-dialog";

export type { SecretDraft } from "./secret-editor-dialog";

export type Modal =
  | "secret"
  | "delete"
  | "rotate"
  | "duplicate"
  | "configuration"
  | "import"
  | "raw"
  | "history"
  | null;

export const INITIAL_SECRET_DRAFT: SecretDraft = {
  description: "",
  expires: "",
  key: "",
  mode: "new",
  name: "",
  originalExpiry: null,
  originalExpiryDate: "",
  tags: "",
  value: "",
};

export interface ProjectScreenState {
  selected: string | null;
  view: ProjectView;
  search: string;
  filterType: string;
  filterStatus: string;
  menu: string | null;
  inspectorOpen: boolean;
  checklistOpen: boolean;
  overlayMode: boolean;
  modal: Modal;
  actionBusy: boolean;
  actionKey: string;
  secretDraft: SecretDraft;
  fieldErrors: Record<string, string>;
  duplicateTarget: string;
  duplicateEnvironmentId: string;
  duplicateEnvironments: EnvironmentSummary[];
  rawPassword: string;
  history: SecretHistory | null;
  historyLoading: boolean;
  historyShown: Record<number, boolean>;
  restoreArmed: number | null;
  reveal: { key: string; remaining: number } | null;
}

export const remainingReveal = (
  current: { key: string; remaining: number } | null
): { key: string; remaining: number } | null => {
  if (current && current.remaining > 1) {
    return { ...current, remaining: current.remaining - 1 };
  }
  return null;
};

export const createInitialProjectScreenState = (
  overlayMode?: boolean
): ProjectScreenState => ({
  actionBusy: false,
  actionKey: "",
  checklistOpen: false,
  duplicateEnvironmentId: "",
  duplicateEnvironments: [],
  duplicateTarget: "",
  fieldErrors: {},
  filterStatus: "all",
  filterType: "all",
  history: null,
  historyLoading: false,
  historyShown: {},
  inspectorOpen: false,
  menu: null,
  modal: null,
  overlayMode:
    overlayMode ??
    (typeof window !== "undefined" &&
      window.matchMedia("(max-width: 1100px)").matches),
  rawPassword: "",
  restoreArmed: null,
  reveal: null,
  search: "",
  secretDraft: INITIAL_SECRET_DRAFT,
  selected: null,
  view: "all",
});

export type ProjectScreenAction =
  | { type: "SET_SELECTED"; selected: string | null }
  | { type: "SET_VIEW"; view: ProjectView }
  | { type: "SET_SEARCH"; search: string }
  | { type: "SET_FILTER_TYPE"; filterType: string }
  | { type: "SET_FILTER_STATUS"; filterStatus: string }
  | { type: "SET_MENU"; menu: string | null }
  | { type: "SET_ROW_MENU"; key: string; open: boolean }
  | { type: "SET_INSPECTOR_OPEN"; open: boolean }
  | { type: "SET_CHECKLIST_OPEN"; open: boolean }
  | { type: "TOGGLE_CHECKLIST" }
  | { type: "SET_OVERLAY_MODE"; overlayMode: boolean }
  | { type: "SELECT_SECRET"; key: string; openInspector?: boolean }
  | { type: "CLOSE_PANELS" }
  | { type: "RESET_FILTERS" }
  | { type: "SET_MODAL"; modal: Modal }
  | { type: "OPEN_MODAL"; modal: Modal; actionKey?: string }
  | { type: "CLOSE_MODAL" }
  | { type: "SET_ACTION_BUSY"; busy: boolean }
  | { type: "SET_ACTION_KEY"; key: string }
  | { type: "SET_SECRET_DRAFT"; draft: SecretDraft }
  | { type: "UPDATE_SECRET_DRAFT"; patch: Partial<SecretDraft> }
  | { type: "SET_FIELD_ERRORS"; errors: Record<string, string> }
  | { type: "SET_DUPLICATE_TARGET"; target: string }
  | { type: "SET_DUPLICATE_ENVIRONMENT_ID"; id: string }
  | {
      type: "SET_DUPLICATE_ENVIRONMENTS";
      environments: EnvironmentSummary[];
      defaultId?: string;
    }
  | { type: "SET_RAW_PASSWORD"; password: string }
  | { type: "SET_HISTORY"; history: SecretHistory | null }
  | { type: "SET_HISTORY_LOADING"; loading: boolean }
  | { type: "SET_HISTORY_SHOWN"; shown: Record<number, boolean> }
  | { type: "TOGGLE_HISTORY_SHOWN"; index: number }
  | { type: "SET_RESTORE_ARMED"; armed: number | null }
  | { type: "CLEAR_RESTORE_ARMED"; index: number }
  | { type: "SET_REVEAL"; reveal: { key: string; remaining: number } | null }
  | { type: "TICK_REVEAL" }
  | { type: "RETIRE_SENSITIVE_STATE" }
  | { type: "SESSION_LOCKED" }
  | {
      type: "SECRET_LOADED";
      data: Record<string, unknown>;
      openInspector: boolean;
    };

const handleCloseModal = (state: ProjectScreenState): ProjectScreenState => {
  let next: ProjectScreenState = {
    ...state,
    actionBusy: false,
    menu: null,
    modal: null,
  };
  if (state.modal === "history") {
    next = {
      ...next,
      history: null,
      historyLoading: false,
      historyShown: {},
      restoreArmed: null,
    };
  } else if (state.modal === "duplicate") {
    next = {
      ...next,
      duplicateEnvironmentId: "",
      duplicateEnvironments: [],
      duplicateTarget: "",
      fieldErrors: {},
    };
  } else if (state.modal === "secret") {
    next = {
      ...next,
      fieldErrors: {},
      secretDraft: INITIAL_SECRET_DRAFT,
    };
  } else if (state.modal === "raw") {
    next = {
      ...next,
      fieldErrors: {},
      rawPassword: "",
    };
  }
  return next;
};

const reducers = {
  CLEAR_RESTORE_ARMED: (state, action) => ({
    ...state,
    restoreArmed:
      state.restoreArmed === action.index ? null : state.restoreArmed,
  }),
  CLOSE_MODAL: (state) => handleCloseModal(state),
  CLOSE_PANELS: (state) => ({
    ...state,
    checklistOpen: false,
    inspectorOpen: false,
    menu: null,
  }),
  OPEN_MODAL: (state, action) => ({
    ...state,
    actionKey: action.actionKey ?? state.actionKey,
    modal: action.modal,
  }),
  RESET_FILTERS: (state) => ({
    ...state,
    filterStatus: "all",
    filterType: "all",
    search: "",
    selected: null,
    view: "all",
  }),
  RETIRE_SENSITIVE_STATE: (state) => ({
    ...state,
    actionBusy: false,
    duplicateEnvironmentId: "",
    duplicateEnvironments: [],
    fieldErrors: {},
    history: null,
    historyLoading: false,
    historyShown: {},
    menu: null,
    modal: null,
    rawPassword: "",
    restoreArmed: null,
    reveal: null,
    secretDraft: INITIAL_SECRET_DRAFT,
    selected: null,
  }),
  SECRET_LOADED: (state, action) => {
    const keys = Object.keys(action.data);
    const selected =
      state.selected && Object.hasOwn(action.data, state.selected)
        ? state.selected
        : (keys[0] ?? null);
    return {
      ...state,
      inspectorOpen: action.openInspector ? true : state.inspectorOpen,
      reveal: null,
      selected,
    };
  },
  SELECT_SECRET: (state, action) => ({
    ...state,
    inspectorOpen:
      action.openInspector === undefined ? true : action.openInspector,
    reveal: null,
    selected: action.key,
  }),
  SESSION_LOCKED: (state) => ({
    ...state,
    fieldErrors: {},
    history: null,
    historyLoading: false,
    historyShown: {},
    rawPassword: "",
    restoreArmed: null,
    reveal: null,
    secretDraft: {
      ...state.secretDraft,
      description: "",
      tags: "",
      value: "",
    },
    selected: null,
  }),
  SET_ACTION_BUSY: (state, action) => ({ ...state, actionBusy: action.busy }),
  SET_ACTION_KEY: (state, action) => ({ ...state, actionKey: action.key }),
  SET_CHECKLIST_OPEN: (state, action) => ({
    ...state,
    checklistOpen: action.open,
  }),
  SET_DUPLICATE_ENVIRONMENTS: (state, action) => ({
    ...state,
    duplicateEnvironmentId:
      action.defaultId ??
      action.environments.find((entry) => entry.isDefault)?.id ??
      action.environments[0]?.id ??
      "",
    duplicateEnvironments: action.environments,
  }),
  SET_DUPLICATE_ENVIRONMENT_ID: (state, action) => ({
    ...state,
    duplicateEnvironmentId: action.id,
  }),
  SET_DUPLICATE_TARGET: (state, action) => ({
    ...state,
    duplicateTarget: action.target,
  }),
  SET_FIELD_ERRORS: (state, action) => ({
    ...state,
    fieldErrors: action.errors,
  }),
  SET_FILTER_STATUS: (state, action) => ({
    ...state,
    filterStatus: action.filterStatus,
  }),
  SET_FILTER_TYPE: (state, action) => ({
    ...state,
    filterType: action.filterType,
  }),
  SET_HISTORY: (state, action) => ({ ...state, history: action.history }),
  SET_HISTORY_LOADING: (state, action) => ({
    ...state,
    historyLoading: action.loading,
  }),
  SET_HISTORY_SHOWN: (state, action) => ({
    ...state,
    historyShown: action.shown,
  }),
  SET_INSPECTOR_OPEN: (state, action) => ({
    ...state,
    inspectorOpen: action.open,
  }),
  SET_MENU: (state, action) => ({ ...state, menu: action.menu }),
  SET_MODAL: (state, action) => ({ ...state, modal: action.modal }),
  SET_OVERLAY_MODE: (state, action) => ({
    ...state,
    overlayMode: action.overlayMode,
  }),
  SET_RAW_PASSWORD: (state, action) => ({
    ...state,
    rawPassword: action.password,
  }),
  SET_RESTORE_ARMED: (state, action) => ({
    ...state,
    restoreArmed: action.armed,
  }),
  SET_REVEAL: (state, action) => ({ ...state, reveal: action.reveal }),
  SET_ROW_MENU: (state, action) => {
    const rowKey = `row:${action.key}`;
    if (action.open) {
      return { ...state, menu: rowKey };
    }
    return {
      ...state,
      menu: state.menu === rowKey ? null : state.menu,
    };
  },
  SET_SEARCH: (state, action) => ({ ...state, search: action.search }),
  SET_SECRET_DRAFT: (state, action) => ({
    ...state,
    secretDraft: action.draft,
  }),
  SET_SELECTED: (state, action) => ({ ...state, selected: action.selected }),
  SET_VIEW: (state, action) => ({ ...state, view: action.view }),
  TICK_REVEAL: (state) => ({
    ...state,
    reveal: remainingReveal(state.reveal),
  }),
  TOGGLE_CHECKLIST: (state) => ({
    ...state,
    checklistOpen: !state.checklistOpen,
  }),
  TOGGLE_HISTORY_SHOWN: (state, action) => ({
    ...state,
    historyShown: {
      ...state.historyShown,
      [action.index]: !state.historyShown[action.index],
    },
  }),
  UPDATE_SECRET_DRAFT: (state, action) => ({
    ...state,
    secretDraft: { ...state.secretDraft, ...action.patch },
  }),
} satisfies {
  [K in ProjectScreenAction["type"]]: (
    state: ProjectScreenState,
    action: Extract<ProjectScreenAction, { type: K }>
  ) => ProjectScreenState;
};

export const projectScreenReducer = (
  state: ProjectScreenState,
  action: ProjectScreenAction
): ProjectScreenState => {
  const handler = reducers[action.type] as (
    s: ProjectScreenState,
    a: ProjectScreenAction
  ) => ProjectScreenState;
  return handler ? handler(state, action) : state;
};
