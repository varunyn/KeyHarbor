import { useMemo, useRef, useState } from "react";

import type {
  ProjectRecord,
  ProjectStatistics,
  VaultListEntry,
} from "../project/bridge";
import { useSidebarState } from "../renderer/use-sidebar-state";
import { selectActiveVault } from "./dashboard-data";
import type {
  AccessTimes,
  DialogForm,
  DialogKind,
  LoadState,
  SortMode,
  ViewMode,
} from "./dashboard-types";
import { blankForm } from "./dashboard-types";

export const useDashboardState = () => {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const projectsRef = useRef<ProjectRecord[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [statistics, setStatistics] = useState<ProjectStatistics | null>(null);
  const [showStatistics, setShowStatistics] = useState(true);
  const [accessTimes, setAccessTimes] = useState<AccessTimes>({});
  const [vaults, setVaults] = useState<VaultListEntry[]>([]);
  const vaultsRef = useRef<VaultListEntry[]>([]);
  const [activeVaultId, setActiveVaultId] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [menu, setMenu] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [form, setForm] = useState<DialogForm>(blankForm);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [cliInstalled, setCliInstalled] = useState(false);
  const [cliReady, setCliReady] = useState(false);
  const { open: sidebarOpen, toggleSidebar, closeSidebar } = useSidebarState();
  const [projectFilter, setProjectFilter] = useState<"all" | "starred">("all");
  const [syncAt, setSyncAt] = useState(Date.now);
  const [now, setNow] = useState(Date.now);
  const dialogStateRef = useRef<DialogKind>(null);
  const modalFocusEpochRef = useRef(0);
  const appRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const activeVaultRef = useRef<string | null>(null);
  const sessionTransitionRef = useRef(-1);
  const contextEpochRef = useRef(0);
  const pendingSwitchVaultRef = useRef<string | null>(null);
  const pageHiddenRef = useRef(false);
  const sessionActiveRef = useRef(true);
  const readEpochRef = useRef(0);
  const actionEpochRef = useRef(0);
  const actionPendingRef = useRef(false);
  const refreshRef = useRef<() => Promise<void>>(async () => {
    /* Refresh is installed after the callback is created. */
  });
  const settingsWarningRef = useRef(false);
  const mountedRef = useRef(true);

  const activeVault = selectActiveVault(vaults, activeVaultId);
  const visibleProjects = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const filtered = projects.filter(
      (project) =>
        (!query || project.name.toLocaleLowerCase().includes(query)) &&
        (projectFilter === "all" || favorites.includes(project.name))
    );
    const byName = (left: ProjectRecord, right: ProjectRecord) =>
      left.name.localeCompare(right.name);
    filtered.sort((left, right) => {
      if (sortMode === "name") {
        return byName(left, right);
      }
      if (sortMode === "secrets") {
        return right.secretCount - left.secretCount || byName(left, right);
      }
      return (
        Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || "") ||
        byName(left, right)
      );
    });
    filtered.sort(
      (left, right) =>
        Number(favorites.includes(right.name)) -
        Number(favorites.includes(left.name))
    );
    return filtered;
  }, [favorites, projects, projectFilter, search, sortMode]);

  return {
    accessTimes,
    actionBusy,
    actionEpochRef,
    actionPendingRef,
    activeVault,
    activeVaultId,
    activeVaultRef,
    appRef,
    cliInstalled,
    cliReady,
    closeSidebar,
    contextEpochRef,
    dialog,
    dialogRef,
    dialogStateRef,
    favorites,
    form,
    loadState,
    menu,
    modalFocusEpochRef,
    mountedRef,
    now,
    pageHiddenRef,
    pendingSwitchVaultRef,
    projectFilter,
    projects,
    projectsRef,
    readEpochRef,
    refreshRef,
    returnFocusRef,
    search,
    searchRef,
    sessionActiveRef,
    sessionTransitionRef,
    setAccessTimes,
    setActionBusy,
    setActiveVaultId,
    setCliInstalled,
    setCliReady,
    setDialog,
    setFavorites,
    setForm,
    setLoadState,
    setMenu,
    setNow,
    setProjectFilter,
    setProjects,
    setSearch,
    setShowStatistics,
    setSortMode,
    setStatistics,
    setSyncAt,
    setVaults,
    setViewMode,
    settingsWarningRef,
    showStatistics,
    sidebarOpen,
    sortMode,
    statistics,
    syncAt,
    toggleSidebar,
    vaults,
    vaultsRef,
    viewMode,
    visibleProjects,
  };
};

export type DashboardState = ReturnType<typeof useDashboardState>;
