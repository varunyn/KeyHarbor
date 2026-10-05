import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import logoUrl from "../assets/icon.png";
import type {
  BridgeResult,
  ProjectRecord,
  ProjectStatistics,
  VaultListEntry,
} from "../project/bridge";
import { runWithCleanup as finalizeOperation } from "../renderer/async-operation";
import { i18n } from "../renderer/i18n";
import { mountRenderer } from "../renderer/mount";
import { notificationManager } from "../renderer/notifications";
import {
  RendererProviders,
  useRendererTranslation,
} from "../renderer/providers";
import { Button } from "../renderer/ui/button";
import { useConfirmation } from "../renderer/ui/confirmation";
import { Dialog, DialogContent, DialogTitle } from "../renderer/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "../renderer/ui/dropdown-menu";
import { Input } from "../renderer/ui/input";

type ViewMode = "grid" | "list";
type SortMode = "recent" | "name" | "secrets";
type DialogKind =
  | "project"
  | "create-vault"
  | "import-vault"
  | "rename-vault"
  | null;
interface DialogForm {
  projectName: string;
  vaultName: string;
  folderPath: string;
  password: string;
  passwordConfirm: string;
  renameVaultId: string;
  error: string;
}
type LoadState = "loading" | "ready" | "error";
type AccessTimes = Record<string, number>;

const folderNamePattern = /(?<name>[^/\\]+)[/\\]*$/u;

const blankForm = (): DialogForm => ({
  error: "",
  folderPath: "",
  password: "",
  passwordConfirm: "",
  projectName: "",
  renameVaultId: "",
  vaultName: "",
});
const t = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars);
const sidebarLabel = (open: boolean) =>
  t(open ? "project.sidebar.collapse" : "project.sidebar.expand");
const sidebarArrow = (open: boolean) => (open ? "arrow-left" : "arrow-right");
const closeNarrowSidebar = (
  close: React.Dispatch<React.SetStateAction<boolean>>
) => {
  if (window.matchMedia("(max-width: 860px)").matches) {
    close(false);
    document.querySelector<HTMLElement>("#indexToggle")?.focus();
  }
};
const isBridgeSuccess = <T extends object>(
  value: BridgeResult<T>
): value is Extract<BridgeResult<T>, { success: true }> => value.success;

const Icon = ({
  name,
  className = "",
}: {
  name: string;
  className?: string;
}) => (
  <span
    className={`lk-icon lk-icon-${name}${className ? ` ${className}` : ""}`}
    aria-hidden="true"
  />
);

const monogram = (name: string) => {
  const clean = name.replaceAll(/[^A-Za-z0-9]/gu, "").toUpperCase();
  let hash = 0;
  // Split UTF-16 units to keep existing project colors stable for all names.
  for (const character of name.split("")) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % 4_294_967_296;
  }
  return {
    initials: (clean.slice(0, 2) || "?").padEnd(2, "·"),
    tone: hash % 6,
  };
};

const formatDate = (value: string | undefined, now: number) => {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "—";
  }
  const days = Math.floor((now - date.getTime()) / 86_400_000);
  if (days <= 0) {
    return t("dashboard.time.today");
  }
  if (days === 1) {
    return t("dashboard.time.yesterday");
  }
  if (days < 7) {
    return t("dashboard.time.daysAgo", { count: days });
  }
  if (days < 30) {
    return t("dashboard.time.weeksAgo", { count: Math.floor(days / 7) });
  }
  return date.toLocaleDateString();
};

const formatAccessTime = (timestamp: number, now: number) => {
  const minutes = Math.floor((now - timestamp) / 60_000);
  if (minutes < 1) {
    return t("dashboard.time.justNow");
  }
  if (minutes < 60) {
    return t("dashboard.time.minutesAgo", { count: minutes });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return t("dashboard.time.hoursAgo", { count: hours });
  }
  return formatDate(new Date(timestamp).toISOString(), now);
};

const isToday = (value?: string) => {
  if (!value) {
    return false;
  }
  const date = new Date(value);
  const today = new Date();
  return (
    Number.isFinite(date.getTime()) &&
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
};

const openProject = (name: string) => {
  window.location.href = `project.html?name=${encodeURIComponent(name)}`;
};

const selectActiveVault = (
  vaults: VaultListEntry[],
  activeVaultId: string | null
) =>
  vaults.find((vault) => vault.id === activeVaultId) ??
  vaults.find((vault) => vault.isActive) ??
  vaults[0] ??
  null;

const collectAccessTimes = (
  nextProjects: ProjectRecord[],
  logResult: BridgeResult<{
    data: { timestamp: string; category: string; message: string }[];
  }>
) => {
  const nextAccess: AccessTimes = Object.create(null) as AccessTimes;
  if (
    isBridgeSuccess<{
      data: { timestamp: string; category: string; message: string }[];
    }>(logResult)
  ) {
    for (const log of logResult.data) {
      if (log.category !== "access") {
        continue;
      }
      const timestamp = Date.parse(log.timestamp);
      if (!Number.isFinite(timestamp)) {
        continue;
      }
      for (const project of nextProjects) {
        const previousAccess = nextAccess[project.name];
        if (
          log.message.includes(`Project: ${project.name}`) &&
          (previousAccess === undefined || timestamp > previousAccess)
        ) {
          nextAccess[project.name] = timestamp;
        }
      }
    }
  }
  return nextAccess;
};

const requireProjectData = (
  result: BridgeResult<{ data: ProjectRecord[] }>
): ProjectRecord[] => {
  if (!isBridgeSuccess<{ data: ProjectRecord[] }>(result)) {
    throw new Error(result.error || "Unable to load projects");
  }
  return result.data;
};

const App = () => {
  useRendererTranslation();
  const { confirm, confirmationDialog, cancelConfirmation } = useConfirmation();
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
  const [sidebarOpen, setSidebarOpen] = useState(
    () => window.matchMedia("(min-width: 861px)").matches
  );
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

  const isCurrentRead = useCallback(
    (epoch: number, vaultId: string | null) =>
      mountedRef.current &&
      !pageHiddenRef.current &&
      sessionActiveRef.current &&
      readEpochRef.current === epoch &&
      activeVaultRef.current === vaultId,
    []
  );

  const isCurrentContext = useCallback(
    (epoch: number, vaultId: string | null) =>
      mountedRef.current &&
      !pageHiddenRef.current &&
      sessionActiveRef.current &&
      contextEpochRef.current === epoch &&
      activeVaultRef.current === vaultId,
    []
  );

  const loadVaults = useCallback(async () => {
    const requestVaultId = activeVaultRef.current;
    let result: Awaited<ReturnType<typeof window.keyharbor.vault.list>>;
    try {
      result = await window.keyharbor.vault.list();
    } catch {
      return;
    }
    if (!isBridgeSuccess<{ data: VaultListEntry[] }>(result)) {
      return;
    }
    if (
      !mountedRef.current ||
      !sessionActiveRef.current ||
      activeVaultRef.current !== requestVaultId
    ) {
      return;
    }
    vaultsRef.current = result.data;
    setVaults(result.data);
    const active =
      result.data.find((vault) => vault.isActive) ??
      result.data.find((vault) => vault.id === "system") ??
      result.data[0] ??
      null;
    if (active) {
      const changed = activeVaultRef.current !== active.id;
      if (changed) {
        contextEpochRef.current += 1;
        projectsRef.current = [];
        setProjects([]);
        setFavorites([]);
        setStatistics(null);
        setAccessTimes({});
        setLoadState("loading");
      }
      activeVaultRef.current = active.id;
      setActiveVaultId(active.id);
      if (changed) {
        refreshRef.current();
      }
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!sessionActiveRef.current) {
      return;
    }
    readEpochRef.current += 1;
    const epoch = readEpochRef.current;
    const vaultId = activeVaultRef.current;
    setLoadState((previous) => (previous === "ready" ? "ready" : "loading"));
    try {
      const [projectResult, favoriteResult, logResult, settings] =
        await Promise.all([
          window.keyharbor.projects.get(),
          window.keyharbor.favorites.get(),
          window.keyharbor.logs.get(),
          window.keyharbor.settings.get(),
        ]);
      if (!isCurrentRead(epoch, vaultId)) {
        return;
      }
      const nextProjects = requireProjectData(projectResult);
      const nextFavorites = isBridgeSuccess<{ data: { projects: string[] } }>(
        favoriteResult
      )
        ? favoriteResult.data.projects
        : [];
      const nextAccess = collectAccessTimes(nextProjects, logResult);
      projectsRef.current = nextProjects;
      setProjects(nextProjects);
      setFavorites(nextFavorites);
      setAccessTimes(nextAccess);
      setShowStatistics(settings.showStatistics !== false);
      if (!settingsWarningRef.current && settings.__loadStatus === "reset") {
        settingsWarningRef.current = true;
        notificationManager.error(t("settings.notifications.resetDueToError"));
      } else if (
        !settingsWarningRef.current &&
        settings.__loadStatus === "repaired"
      ) {
        settingsWarningRef.current = true;
        notificationManager.success(t("settings.notifications.repaired"));
      }
      if (settings.showStatistics === false) {
        setStatistics(null);
      } else {
        const statResult = await window.keyharbor.statistics.get();
        if (!isCurrentRead(epoch, vaultId)) {
          return;
        }
        setStatistics(
          isBridgeSuccess<{ data: ProjectStatistics }>(statResult)
            ? statResult.data
            : null
        );
      }
      setSyncAt(Date.now());
      setLoadState("ready");
    } catch {
      if (!isCurrentRead(epoch, vaultId)) {
        return;
      }
      setLoadState("error");
      notificationManager.error(t("dashboard.notifications.failedToLoad"));
    }
  }, [isCurrentRead]);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  const closeMenus = useCallback(() => setMenu(null), []);
  const closeDialog = useCallback((preserveAction = false) => {
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
  }, []);
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
    [closeMenus]
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
  }, []);

  const runAction = useCallback(
    async <T,>(
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
    [isCurrentContext]
  );

  useEffect(() => {
    mountedRef.current = true;
    let disposed = false;
    const initialize = async () => {
      await i18n.init();
      if (disposed || pageHiddenRef.current) {
        return;
      }
      document.title = `KeyHarbor — ${t("dashboard.title")}`;
      let snapshot: Awaited<
        ReturnType<typeof window.keyharbor.vault.sessionSnapshot>
      >;
      try {
        snapshot = await window.keyharbor.vault.sessionSnapshot();
      } catch {
        if (!disposed) {
          setLoadState("error");
          notificationManager.error(t("dashboard.notifications.failedToLoad"));
        }
        return;
      }
      if (disposed || pageHiddenRef.current) {
        return;
      }
      if (snapshot.transitionId < sessionTransitionRef.current) {
        return;
      }
      sessionTransitionRef.current = snapshot.transitionId;
      sessionActiveRef.current = snapshot.state === "active";
      if (!sessionActiveRef.current) {
        await window.keyharbor.navigate("lock");
        return;
      }
      if (snapshot.activeVaultId) {
        activeVaultRef.current = snapshot.activeVaultId;
        setActiveVaultId(snapshot.activeVaultId);
      }
      await Promise.all([loadVaults(), refreshRef.current()]);
      const initialContextEpoch = contextEpochRef.current;
      const initialVaultId = activeVaultRef.current;
      try {
        const cli = await window.keyharbor.cli.check();
        if (
          !disposed &&
          isCurrentContext(initialContextEpoch, initialVaultId)
        ) {
          setCliInstalled(cli.installed);
          setCliReady(true);
        }
      } catch {
        if (
          !disposed &&
          isCurrentContext(initialContextEpoch, initialVaultId)
        ) {
          setCliReady(true);
        }
      }
    };
    initialize();

    const unsubscribeSession = window.keyharbor.vault.onSessionStateChanged(
      (snapshot) => {
        if (snapshot.transitionId < sessionTransitionRef.current) {
          return;
        }
        sessionTransitionRef.current = snapshot.transitionId;
        const active = snapshot.state === "active";
        sessionActiveRef.current = active;
        if (!active) {
          cancelConfirmation();
          contextEpochRef.current += 1;
          readEpochRef.current += 1;
          actionEpochRef.current += 1;
          actionPendingRef.current = false;
          setActionBusy(null);
          setMenu(null);
          setForm(blankForm());
          dialogStateRef.current = null;
          setDialog(null);
          pendingSwitchVaultRef.current = null;
          if (snapshot.state === "locked") {
            window.keyharbor.navigate("lock");
          }
          return;
        }
        if (
          snapshot.activeVaultId &&
          snapshot.activeVaultId !== activeVaultRef.current
        ) {
          cancelConfirmation();
          if (pendingSwitchVaultRef.current !== snapshot.activeVaultId) {
            contextEpochRef.current += 1;
          }
          activeVaultRef.current = snapshot.activeVaultId;
          setActiveVaultId(snapshot.activeVaultId);
          projectsRef.current = [];
          setProjects([]);
          setFavorites([]);
          setStatistics(null);
          setAccessTimes({});
          setLoadState("loading");
          setForm(blankForm());
          dialogStateRef.current = null;
          setDialog(null);
          loadVaults();
          refreshRef.current();
        }
      }
    );
    const unsubscribeSynced = window.keyharbor.vault.onVaultDataSynced(() => {
      if (document.visibilityState === "visible") {
        refreshRef.current();
      }
    });
    const unsubscribeFocus = window.keyharbor.onWindowFocusChanged(
      (focused) => {
        if (focused) {
          refreshRef.current();
        } else {
          setMenu(null);
        }
      }
    );
    const onFocus = () => {
      if (document.visibilityState === "visible") {
        refreshRef.current();
      }
    };
    const onBrowserSync = () => {
      if (document.visibilityState === "visible") {
        refreshRef.current();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        refreshRef.current();
      }
    };
    const onPageHide = () => {
      cancelConfirmation();
      pageHiddenRef.current = true;
      contextEpochRef.current += 1;
      readEpochRef.current += 1;
      actionEpochRef.current += 1;
      actionPendingRef.current = false;
      sessionActiveRef.current = false;
      dialogStateRef.current = null;
      setForm(blankForm());
      setDialog(null);
      setActionBusy(null);
      setMenu(null);
    };
    const onPageShow = async () => {
      if (!pageHiddenRef.current) {
        return;
      }
      pageHiddenRef.current = false;
      try {
        const snapshot = await window.keyharbor.vault.sessionSnapshot();
        if (!mountedRef.current || pageHiddenRef.current) {
          return;
        }
        if (snapshot.transitionId < sessionTransitionRef.current) {
          return;
        }
        sessionTransitionRef.current = Math.max(
          sessionTransitionRef.current,
          snapshot.transitionId
        );
        sessionActiveRef.current = snapshot.state === "active";
        if (!sessionActiveRef.current) {
          window.keyharbor.navigate("lock");
          return;
        }
        if (snapshot.activeVaultId) {
          activeVaultRef.current = snapshot.activeVaultId;
          setActiveVaultId(snapshot.activeVaultId);
        }
        contextEpochRef.current += 1;
        loadVaults();
        refreshRef.current();
      } catch {
        // A snapshot failure leaves the session unchanged; the next event can retry.
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLocaleLowerCase() === "k"
      ) {
        event.preventDefault();
        if (!dialogStateRef.current) {
          searchRef.current?.focus();
        }
      }
      if (
        event.key === "Escape" &&
        !dialogStateRef.current &&
        !event.defaultPrevented
      ) {
        closeMenus();
        closeNarrowSidebar(setSidebarOpen);
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const { target } = event;
      if (
        target instanceof Element &&
        !target.closest(
          '[data-slot="dropdown-menu-content"], [data-slot="dialog-content"]'
        ) &&
        appRef.current &&
        !appRef.current.contains(target)
      ) {
        setMenu(null);
      }
    };
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        refreshRef.current();
      }
    }, 10_000);
    const clockTimer = window.setInterval(() => setNow(Date.now()), 30_000);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", closeMenus);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("keyharbor:vault-data-synced", onBrowserSync);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      mountedRef.current = false;
      sessionActiveRef.current = false;
      readEpochRef.current += 1;
      actionEpochRef.current += 1;
      unsubscribeSession();
      unsubscribeSynced();
      unsubscribeFocus();
      window.clearInterval(poll);
      window.clearInterval(clockTimer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", closeMenus);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("keyharbor:vault-data-synced", onBrowserSync);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [cancelConfirmation, closeMenus, isCurrentContext, loadVaults]);

  useEffect(() => {
    if (!appRef.current) {
      return;
    }
    const root = appRef.current;
    const onMouseDown = (event: MouseEvent) => {
      const { target } = event;
      if (!(target instanceof Element)) {
        return;
      }
      if (!target.closest('.dropdown, [data-slot="button"]')) {
        setMenu(null);
      }
    };
    root.addEventListener("mousedown", onMouseDown);
    return () => root.removeEventListener("mousedown", onMouseDown);
  }, []);

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
    const confirmed = await confirm({
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
  const setField = (field: keyof DialogForm, value: string) =>
    setForm((current) => ({
      ...current,
      [field]: value,
      error: field === "error" ? value : "",
    }));

  const projectActions = (project: ProjectRecord) => {
    const favorite = favorites.includes(project.name);
    return (
      <span className="dash-card-actions relative z-10">
        <Button
          variant="ghost"
          type="button"
          className={`dash-icon-btn${favorite ? " is-fav" : ""}`}
          aria-pressed={favorite}
          aria-label={t(
            favorite ? "project.removeFromFavorites" : "project.addToFavorites"
          )}
          title={t(
            favorite ? "project.removeFromFavorites" : "project.addToFavorites"
          )}
          onClick={() => toggleFavorite(project.name)}
        >
          <Icon name="star" />
        </Button>
        <DropdownMenu
          open={menu === `project:${project.name}`}
          onOpenChange={(open) =>
            setMenu(open ? `project:${project.name}` : null)
          }
        >
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              type="button"
              className="dash-icon-btn"
              aria-label={t("dashboard.a11y.menuLabel")}
            >
              <Icon name="ellipsis" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onClick={(event) => event.stopPropagation()}
          >
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => {
                closeMenus();
                deleteProject(project.name);
              }}
            >
              {t("dashboard.deleteProject.deleteBtn")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    );
  };

  const projectCard = (project: ProjectRecord) => {
    const mark = monogram(project.name);
    const access = accessTimes[project.name];
    const activeToday =
      isToday(project.updatedAt) ||
      (typeof access === "number" &&
        now - access < 86_400_000 &&
        isToday(new Date(access).toISOString()));
    return (
      <article
        key={project.name}
        className="dash-card relative"
        data-list-key={project.name}
      >
        <a
          className="absolute inset-0 z-0 rounded-[inherit]"
          href={`project.html?name=${encodeURIComponent(project.name)}`}
          aria-label={t("dashboard.card.openProject", { name: project.name })}
          onKeyDown={(event) => {
            if (event.key === " ") {
              event.preventDefault();
              openProject(project.name);
            }
          }}
        >
          <span className="sr-only">
            {t("dashboard.card.openProject", { name: project.name })}
          </span>
        </a>
        <div className="dash-card-top">
          <span className={`monogram mono-${mark.tone}`} aria-hidden="true">
            {mark.initials}
          </span>
          <span className="dash-card-name">{project.name}</span>
          {projectActions(project)}
        </div>
        <p className="dash-card-sub">{t("dashboard.card.localProject")}</p>
        <div className="dash-card-status">
          {activeToday ? (
            <span className="active-pill">
              <span className="pill-dot" aria-hidden="true" />
              {t("dashboard.card.activeToday")}
            </span>
          ) : (
            <>
              <Icon name="key" />
              <span>{t("dashboard.card.storedLocally")}</span>
            </>
          )}
        </div>
        <div className="dash-card-badges">
          <span>
            {t(
              project.secretCount === 1
                ? "dashboard.secretCountOne"
                : "dashboard.secretCount",
              { count: project.secretCount }
            )}
          </span>
          <span>
            {t(
              project.environmentCount === 1
                ? "dashboard.card.environmentOne"
                : "dashboard.card.environments",
              { count: project.environmentCount }
            )}
          </span>
        </div>
        {typeof access === "number" && (
          <p className="dash-card-sub access-line">
            {t("dashboard.card.lastAccessed", {
              time: formatAccessTime(access, now),
            })}
          </p>
        )}
        <div className="dash-card-foot">
          <span>
            {t("dashboard.updated", {
              time: formatDate(project.updatedAt, now),
            })}
          </span>
          <span className="dash-card-open">
            {t("dashboard.card.open")}
            <Icon name="arrow-right" />
          </span>
        </div>
      </article>
    );
  };
  const projectRow = (project: ProjectRecord) => {
    const mark = monogram(project.name);
    return (
      <div
        key={project.name}
        className="dash-row relative"
        data-list-key={project.name}
      >
        <a
          className="absolute inset-0 z-0 rounded-[inherit]"
          href={`project.html?name=${encodeURIComponent(project.name)}`}
          aria-label={t("dashboard.card.openProject", { name: project.name })}
          onKeyDown={(event) => {
            if (event.key === " ") {
              event.preventDefault();
              openProject(project.name);
            }
          }}
        >
          <span className="sr-only">
            {t("dashboard.card.openProject", { name: project.name })}
          </span>
        </a>
        <span className={`monogram mono-${mark.tone}`} aria-hidden="true">
          {mark.initials}
        </span>
        <div className="row-main">
          <div className="row-name">{project.name}</div>
          <div className="row-sub">
            {t("dashboard.updated", {
              time: formatDate(project.updatedAt, now),
            })}
          </div>
        </div>
        <div className="row-meta">
          {t(
            project.secretCount === 1
              ? "dashboard.secretCountOne"
              : "dashboard.secretCount",
            project.secretCount === 1
              ? undefined
              : { count: project.secretCount }
          )}
        </div>
        {projectActions(project)}
      </div>
    );
  };

  const statisticsStrip = () => {
    if (!showStatistics || !statistics) {
      return null;
    }
    const expiring = statistics.expiringSecrets > 0;
    let expiryTone = "";
    if (expiring) {
      expiryTone = statistics.hasExpired ? "tone-red" : "tone-amber";
    }
    const expired = statistics.hasExpired;
    const metrics = [
      {
        icon: "folder",
        iconTone: "",
        label: t("dashboard.statistics.totalProjects"),
        tone: "",
        value: statistics.totalProjects,
      },
      {
        icon: "key",
        iconTone: "",
        label: t("dashboard.statistics.totalSecrets"),
        tone: "",
        value: statistics.totalSecrets,
      },
      {
        icon: "clock",
        iconTone: expiryTone,
        label: t(
          expired
            ? "dashboard.statistics.expiringAndExpired"
            : "dashboard.statistics.expiringSecrets"
        ),
        tone: expiryTone,
        value: statistics.expiringSecrets,
      },
      {
        icon: "activity",
        iconTone: "",
        label: t("dashboard.statistics.recentAccess"),
        tone: "",
        value: statistics.recentAccessCount,
      },
    ];
    return (
      <div className="dash-strip-wrap" id="stripWrap">
        <section
          className="dash-strip"
          id="overviewStrip"
          aria-label={t("dashboard.statistics.overview")}
        >
          {metrics.map((metric) => (
            <div className="dash-metric" key={metric.icon}>
              <span className="m-label">{metric.label}</span>
              <span className={`m-icon ${metric.iconTone}`}>
                <Icon name={metric.icon} />
              </span>
              <span className={`m-value ${metric.tone}`}>{metric.value}</span>
            </div>
          ))}
        </section>
        <p className="dash-stat-note">{t("dashboard.statistics.scopeLabel")}</p>
      </div>
    );
  };

  const projectState = () => {
    if (loadState === "loading") {
      return (
        <div className="dash-state">
          <output className="spinner" aria-label={t("common.loading")} />
        </div>
      );
    }
    if (loadState === "error") {
      return (
        <div className="dash-state">
          <Icon name="circle-alert" />
          <h2>{t("dashboard.notifications.failedToLoad")}</h2>
          <p>{t("dashboard.emptyState.noResultsBody")}</p>
          <Button
            variant="secondary"
            type="button"
            className="dh-btn dh-btn-secondary"
            onClick={() => refresh()}
          >
            {t("project.retry")}
          </Button>
        </div>
      );
    }
    if (!visibleProjects.length) {
      return (
        <div className="dash-state">
          <Icon name="folder" />
          <h2>
            {projects.length
              ? t("dashboard.emptyState.title")
              : t("dashboard.emptyState.emptyTitle")}
          </h2>
          <p>
            {projects.length
              ? t("dashboard.emptyState.noResultsBody")
              : t("dashboard.emptyState.emptyBody")}
          </p>
          {projects.length ? (
            <Button
              variant="secondary"
              type="button"
              className="dh-btn dh-btn-secondary"
              onClick={() => {
                setSearch("");
                setProjectFilter("all");
                searchRef.current?.focus();
              }}
            >
              {t("dashboard.emptyState.clearSearch")}
            </Button>
          ) : (
            <Button
              variant="default"
              type="button"
              className="dh-btn dh-btn-primary"
              onClick={(event) => openDialog("project", event.currentTarget)}
            >
              <Icon name="plus" />
              {t("dashboard.addProject")}
            </Button>
          )}
        </div>
      );
    }
    return (
      <div className={viewMode === "grid" ? "dash-grid" : "dash-list"}>
        {visibleProjects.map(viewMode === "grid" ? projectCard : projectRow)}
      </div>
    );
  };

  const cliActionLabel = () => {
    if (actionBusy === "cli-install") {
      return t("dashboard.installing");
    }
    if (actionBusy === "cli-uninstall") {
      return t("dashboard.uninstalling");
    }
    return t(
      cliReady && cliInstalled
        ? "dashboard.uninstallCli"
        : "dashboard.installCli"
    );
  };

  const openCreateVault = (trigger?: HTMLElement | null) =>
    openDialog("create-vault", trigger);
  const openImportVault = (trigger?: HTMLElement | null) =>
    openDialog("import-vault", trigger);
  const dialogTitles = {
    "create-vault": "vault.create.title",
    "import-vault": "vault.import.title",
    project: "dashboard.addProjectModal.title",
    "rename-vault": "vault.rename.title",
  };
  const dialogTitle = t(dialogTitles[dialog ?? "rename-vault"]);

  return (
    <div className="dash-app" ref={appRef}>
      <aside
        className={`dash-index${sidebarOpen ? "" : " is-collapsed"}`}
        id="indexPanel"
        aria-label={t("dashboard.a11y.indexLabel")}
      >
        <div className="dash-brand">
          <img src={logoUrl} alt="" />
          <span>KeyHarbor</span>
          <Button
            variant="ghost"
            type="button"
            className="dh-btn dh-btn-icon dash-sidebar-toggle"
            aria-label={sidebarLabel(sidebarOpen)}
            title={sidebarLabel(sidebarOpen)}
            aria-expanded={sidebarOpen}
            aria-controls="indexPanel"
            onClick={() => setSidebarOpen((open) => !open)}
          >
            <Icon name={sidebarArrow(sidebarOpen)} />
          </Button>
        </div>
        <div className="dash-vault-switcher">
          <DropdownMenu
            open={menu === "vaults" || menu?.startsWith("vault:")}
            onOpenChange={(open) => {
              if (open) {
                loadVaults();
              }
              setMenu(open ? "vaults" : null);
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                type="button"
                className="dash-vault-btn"
                id="vault-dropdown-btn"
              >
                <span className="dash-vault-text">
                  <small>{t("dashboard.crumbsVault")}</small>
                  <strong id="vault-dropdown-name">
                    {activeVault?.name ?? t("dashboard.vaultDefault")}
                  </strong>
                </span>
                <Icon name="chevron-down" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              side="right"
              sideOffset={8}
              className="dash-vault-menu"
              id="vault-dropdown-menu"
              onCloseAutoFocus={(event) => {
                if (dialogStateRef.current !== null || !document.hasFocus()) {
                  event.preventDefault();
                }
              }}
            >
              <div id="vault-dropdown-list" className="dash-vault-list">
                {vaults.map((vault) => (
                  <div
                    key={vault.id}
                    className={`vault-dropdown-row${vault.isActive ? " active" : ""}${vault.status === "offline" ? " offline" : ""}`}
                  >
                    <DropdownMenuItem
                      className={`dash-vault-item${vault.isActive ? " active" : ""}${vault.status === "offline" ? " offline" : ""}`}
                      disabled={vault.status === "offline"}
                      onSelect={() => switchVault(vault)}
                    >
                      <span className="dropdown-item-left">
                        {vault.status === "offline" && (
                          <Icon
                            name="circle-alert"
                            className="dropdown-item-icon status-offline"
                          />
                        )}
                        <span
                          className={`dropdown-item-name${vault.isActive ? " active" : ""}`}
                        >
                          {vault.name}
                        </span>
                      </span>
                    </DropdownMenuItem>
                    {!vault.isSystem && (
                      <DropdownMenuSub
                        open={menu === `vault:${vault.id}`}
                        onOpenChange={(open) =>
                          setMenu((current) => {
                            if (open) {
                              return `vault:${vault.id}`;
                            }
                            return current === `vault:${vault.id}`
                              ? "vaults"
                              : current;
                          })
                        }
                      >
                        <DropdownMenuSubTrigger
                          className="dropdown-item-context-btn"
                          aria-label={`${vault.name} ${t("dashboard.a11y.menuLabel")}`}
                        >
                          <Icon name="ellipsis" />
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="dash-vault-context-menu">
                          <DropdownMenuItem
                            onSelect={() => {
                              openDialog(
                                "rename-vault",
                                document.querySelector<HTMLElement>(
                                  "#vault-dropdown-btn"
                                ),
                                {
                                  renameVaultId: vault.id,
                                  vaultName: vault.name,
                                }
                              );
                            }}
                          >
                            {t("vault.context.rename")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => removeVault(vault)}
                          >
                            {t("vault.context.remove")}
                          </DropdownMenuItem>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    )}
                  </div>
                ))}
              </div>
              <DropdownMenuSeparator className="dash-vault-separator" />
              <DropdownMenuItem
                id="vault-new-btn"
                className="dash-vault-item"
                onSelect={() =>
                  openCreateVault(
                    document.querySelector<HTMLElement>("#vault-dropdown-btn")
                  )
                }
              >
                {t("vault.selector.newVault")}
              </DropdownMenuItem>
              <DropdownMenuItem
                id="vault-import-btn"
                className="dash-vault-item"
                onSelect={() =>
                  openImportVault(
                    document.querySelector<HTMLElement>("#vault-dropdown-btn")
                  )
                }
              >
                {t("vault.selector.importVault")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <nav className="dash-nav" aria-label={t("dashboard.a11y.primaryNav")}>
          <Button
            variant="secondary"
            type="button"
            aria-current="page"
            aria-label={t("dashboard.sidebar.navProjects")}
            title={t("dashboard.sidebar.navProjects")}
          >
            <Icon name="folder" />
            <span>{t("dashboard.sidebar.navProjects")}</span>
            <span className="dash-nav-count">{projects.length}</span>
          </Button>
          <Button
            variant="secondary"
            type="button"
            id="navActivity"
            title={t("dashboard.sidebar.navActivity")}
            aria-label={t("dashboard.sidebar.navActivity")}
            onClick={() => navigate("logs")}
          >
            <Icon name="clock" />
            <span>{t("dashboard.sidebar.navActivity")}</span>
          </Button>
          <Button
            variant="secondary"
            type="button"
            id="navSettings"
            title={t("dashboard.sidebar.navSettings")}
            aria-label={t("dashboard.sidebar.navSettings")}
            onClick={() => navigate("settings")}
          >
            <Icon name="settings" />
            <span>{t("dashboard.sidebar.navSettings")}</span>
          </Button>
        </nav>
        <div className="dash-sync">
          <span className="dash-sync-dot" aria-hidden="true" />
          <span>
            {t("dashboard.sidebar.unlocked")}
            <small id="syncLabel">
              {t("dashboard.sidebar.synced", {
                time: formatAccessTime(syncAt, now),
              })}
            </small>
          </span>
        </div>
      </aside>
      <button
        type="button"
        className="dash-sidebar-scrim"
        hidden={!sidebarOpen}
        aria-label={t("project.sidebar.collapse")}
        onClick={() => setSidebarOpen(false)}
      />
      <main className="dash-main">
        <header className="dash-topbar">
          <Button
            variant="secondary"
            type="button"
            className="dh-btn dh-btn-icon dash-index-toggle"
            id="indexToggle"
            aria-label={t("dashboard.a11y.indexLabel")}
            aria-controls="indexPanel"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen((open) => !open)}
          >
            <Icon name="list" />
          </Button>
          <nav
            className="dash-crumbs"
            aria-label={t("dashboard.a11y.crumbsLabel")}
          >
            <span>{t("dashboard.crumbsVault")}</span>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{t("dashboard.title")}</span>
          </nav>
          <div className="dash-search">
            <Icon name="search" />
            <Input
              ref={searchRef}
              type="search"
              id="search-input"
              placeholder={t("dashboard.searchPlaceholder")}
              aria-label={t("dashboard.a11y.searchLabel")}
              autoComplete="off"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <kbd className="dash-search-kbd" aria-hidden="true">
              ⌘K
            </kbd>
          </div>
          <div className="dash-toolbar">
            <Button
              variant="secondary"
              type="button"
              className="dh-btn dh-btn-secondary"
              id="lock-btn"
              disabled={actionBusy !== null}
              onClick={() => lock()}
            >
              <Icon name="lock" />
              <span>{t("dashboard.lock")}</span>
            </Button>
            <DropdownMenu
              open={menu === "actions"}
              onOpenChange={(open) => setMenu(open ? "actions" : null)}
            >
              <DropdownMenuTrigger asChild>
                <Button
                  variant="secondary"
                  type="button"
                  className="dh-btn-icon"
                  id="settings-dropdown-btn"
                  aria-label={t("dashboard.a11y.menuLabel")}
                >
                  <Icon name="ellipsis" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  id="install-cli-btn"
                  disabled={!cliReady || actionBusy !== null}
                  onSelect={() =>
                    handleCli(cliInstalled ? "uninstall" : "install")
                  }
                >
                  {cliActionLabel()}
                </DropdownMenuItem>
                <DropdownMenuItem
                  id="settings-btn"
                  onSelect={() => navigate("settings")}
                >
                  {t("dashboard.settings")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="default"
              type="button"
              className="dh-btn dh-btn-primary"
              id="add-project-btn"
              aria-label={t("dashboard.addProject")}
              title={t("dashboard.addProject")}
              disabled={actionBusy !== null}
              onClick={(event) => openDialog("project", event.currentTarget)}
            >
              <Icon name="plus" />
              <span className="btn-label-collapsible">
                {t("dashboard.addProject")}
              </span>
            </Button>
          </div>
        </header>
        <div className="dash-canvas">
          <div className="dash-heading">
            <h1>{t("dashboard.title")}</h1>
            <p className="dash-subtitle">{t("dashboard.subtitle")}</p>
          </div>
          {statisticsStrip()}
          <section
            className="dash-section"
            aria-label={t("dashboard.a11y.sectionLabel")}
          >
            <div className="dash-section-head">
              <fieldset
                className="dash-filters"
                aria-label={t("dashboard.filters.label")}
              >
                <Button
                  variant="secondary"
                  type="button"
                  aria-pressed={projectFilter === "all"}
                  onClick={() => setProjectFilter("all")}
                >
                  {t("dashboard.filters.all", { count: projects.length })}
                </Button>
                <Button
                  variant="secondary"
                  type="button"
                  aria-pressed={projectFilter === "starred"}
                  onClick={() => setProjectFilter("starred")}
                >
                  <Icon name="star" />
                  {t("dashboard.filters.starred", {
                    count: projects.filter((project) =>
                      favorites.includes(project.name)
                    ).length,
                  })}
                </Button>
              </fieldset>
              <span className="spacer" />
              <div
                className="dash-seg"
                aria-label={t("dashboard.viewToggle.label")}
              >
                <Button
                  variant="secondary"
                  type="button"
                  id="viewGridBtn"
                  aria-label={t("dashboard.viewToggle.grid")}
                  aria-pressed={viewMode === "grid"}
                  onClick={() => setViewMode("grid")}
                >
                  <Icon name="grid" />
                </Button>
                <Button
                  variant="secondary"
                  type="button"
                  id="viewListBtn"
                  aria-label={t("dashboard.viewToggle.list")}
                  aria-pressed={viewMode === "list"}
                  onClick={() => setViewMode("list")}
                >
                  <Icon name="list" />
                </Button>
              </div>
              <DropdownMenu
                open={menu === "sort"}
                onOpenChange={(open) => setMenu(open ? "sort" : null)}
              >
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    type="button"
                    id="sortBtn"
                    aria-label={t("dashboard.a11y.sortLabel")}
                  >
                    <span id="sortLabel">
                      {t(`dashboard.sort.${sortMode}`)}
                    </span>
                    <Icon name="chevron-down" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" id="sortMenu">
                  <DropdownMenuRadioGroup
                    value={sortMode}
                    onValueChange={(value) => setSortMode(value as SortMode)}
                  >
                    {(["recent", "name", "secrets"] as const).map((sort) => (
                      <DropdownMenuRadioItem key={sort} value={sort}>
                        {t(`dashboard.sort.${sort}`)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div id="projects-container">{projectState()}</div>
          </section>
          {loadState === "ready" && projects.length > 0 && (
            <Button
              variant="ghost"
              type="button"
              className="dash-add-tile"
              disabled={actionBusy !== null}
              onClick={(event) => openDialog("project", event.currentTarget)}
            >
              <span className="dash-add-icon">
                <Icon name="plus" />
              </span>
              <strong>{t("dashboard.addTile.title")}</strong>
              <span>{t("dashboard.addTile.description")}</span>
            </Button>
          )}
        </div>
        <footer className="dash-footer">
          <span>
            <kbd>Enter</kbd> {t("dashboard.card.open")}
          </span>
          <span>
            <kbd>⌘K / Ctrl+K</kbd> {t("dashboard.a11y.searchLabel")}
          </span>
          <span className="dash-footer-local">
            <span className="dash-sync-dot" aria-hidden="true" />
            {t("dashboard.card.storedLocally")}
          </span>
        </footer>
      </main>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            closeDialog();
          }
        }}
      >
        <DialogContent
          ref={dialogRef}
          closeLabel={t("common.close")}
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const fields = {
              "create-vault": "#vault-create-name",
              "import-vault": "#vault-import-path",
              project: "#project-name",
              "rename-vault": "#vault-rename-input",
            };
            if (dialog) {
              dialogRef.current
                ?.querySelector<HTMLElement>(fields[dialog])
                ?.focus();
            }
          }}
        >
          <DialogTitle>{dialogTitle}</DialogTitle>
          <div className="modal-body">
            {dialog === "project" && (
              <div className="input-group">
                <label htmlFor="project-name" id="label-project-name">
                  {t("dashboard.addProjectModal.label")}
                </label>
                <Input
                  id="project-name"
                  type="text"
                  autoComplete="off"
                  placeholder={t("dashboard.addProjectModal.placeholder")}
                  value={form.projectName}
                  onChange={(event) =>
                    setField("projectName", event.target.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      submitProject();
                    }
                  }}
                />
              </div>
            )}
            {dialog === "create-vault" && (
              <>
                <div className="input-group">
                  <label htmlFor="vault-create-name">
                    {t("vault.create.nameLabel")}
                  </label>
                  <Input
                    id="vault-create-name"
                    type="text"
                    autoComplete="off"
                    placeholder={t("vault.create.namePlaceholder")}
                    value={form.vaultName}
                    onChange={(event) =>
                      setField("vaultName", event.target.value)
                    }
                  />
                </div>
                <div className="input-group">
                  <label htmlFor="vault-create-path">
                    {t("vault.create.pathLabel")}
                  </label>
                  <div className="input-row">
                    <Input
                      id="vault-create-path"
                      type="text"
                      readOnly
                      placeholder={t("vault.create.pathPlaceholder")}
                      value={form.folderPath}
                    />
                    <Button
                      variant="secondary"
                      type="button"
                      className="dh-btn dh-btn-secondary"
                      id="vault-create-browse"
                      disabled={actionBusy !== null}
                      onClick={() => browseFolder("create-vault")}
                    >
                      {t("vault.create.browse")}
                    </Button>
                  </div>
                </div>
                <div className="input-group">
                  <label htmlFor="vault-create-password">
                    {t("vault.create.passwordLabel")}
                  </label>
                  <Input
                    id="vault-create-password"
                    type="password"
                    autoComplete="new-password"
                    placeholder={t("vault.create.passwordPlaceholder")}
                    value={form.password}
                    onChange={(event) =>
                      setField("password", event.target.value)
                    }
                  />
                </div>
                <div className="input-group">
                  <label htmlFor="vault-create-confirm">
                    {t("vault.create.confirmLabel")}
                  </label>
                  <Input
                    id="vault-create-confirm"
                    type="password"
                    autoComplete="new-password"
                    placeholder={t("vault.create.confirmPlaceholder")}
                    value={form.passwordConfirm}
                    onChange={(event) =>
                      setField("passwordConfirm", event.target.value)
                    }
                  />
                </div>
              </>
            )}
            {dialog === "import-vault" && (
              <>
                <div className="input-group">
                  <label htmlFor="vault-import-path">
                    {t("vault.import.pathLabel")}
                  </label>
                  <div className="input-row">
                    <Input
                      id="vault-import-path"
                      type="text"
                      readOnly
                      placeholder={t("vault.import.pathPlaceholder")}
                      value={form.folderPath}
                    />
                    <Button
                      variant="secondary"
                      type="button"
                      className="dh-btn dh-btn-secondary"
                      id="vault-import-browse"
                      disabled={actionBusy !== null}
                      onClick={() => browseFolder("import-vault")}
                    >
                      {t("vault.import.browse")}
                    </Button>
                  </div>
                </div>
                <div className="input-group">
                  <label htmlFor="vault-import-name">
                    {t("vault.import.nameLabel")}
                  </label>
                  <Input
                    id="vault-import-name"
                    type="text"
                    autoComplete="off"
                    placeholder={t("vault.import.namePlaceholder")}
                    value={form.vaultName}
                    onChange={(event) =>
                      setField("vaultName", event.target.value)
                    }
                  />
                </div>
                <div className="input-group">
                  <label htmlFor="vault-import-password">
                    {t("vault.import.passwordLabel")}
                  </label>
                  <Input
                    id="vault-import-password"
                    type="password"
                    autoComplete="current-password"
                    placeholder={t("vault.import.passwordPlaceholder")}
                    value={form.password}
                    onChange={(event) =>
                      setField("password", event.target.value)
                    }
                  />
                  <p className="input-desc">{t("vault.import.passwordDesc")}</p>
                </div>
              </>
            )}
            {dialog === "rename-vault" && (
              <div className="input-group">
                <label htmlFor="vault-rename-input">
                  {t("vault.rename.label")}
                </label>
                <Input
                  id="vault-rename-input"
                  type="text"
                  autoComplete="off"
                  placeholder={t("vault.rename.placeholder")}
                  value={form.vaultName}
                  onChange={(event) =>
                    setField("vaultName", event.target.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      submitVaultRename();
                    }
                  }}
                />
              </div>
            )}
            <p className="modal-error" role="alert">
              {form.error}
            </p>
          </div>
          <div className="modal-footer">
            <Button
              variant="secondary"
              type="button"
              className="dh-btn dh-btn-secondary"
              onClick={() => closeDialog()}
            >
              {t("common.cancel")}
            </Button>
            {dialog === "project" && (
              <Button
                variant="default"
                type="button"
                className="dh-btn dh-btn-primary"
                id="confirm-add-project"
                disabled={actionBusy !== null}
                onClick={() => submitProject()}
              >
                {t("dashboard.addProjectModal.add")}
              </Button>
            )}
            {dialog === "create-vault" && (
              <Button
                variant="default"
                type="button"
                className="dh-btn dh-btn-primary"
                id="vault-create-submit"
                disabled={actionBusy !== null}
                onClick={() => submitVaultCreate()}
              >
                {t("vault.create.submit")}
              </Button>
            )}
            {dialog === "import-vault" && (
              <Button
                variant="default"
                type="button"
                className="dh-btn dh-btn-primary"
                id="vault-import-submit"
                disabled={actionBusy !== null}
                onClick={() => submitVaultImport()}
              >
                {t("vault.import.submit")}
              </Button>
            )}
            {dialog === "rename-vault" && (
              <Button
                variant="default"
                type="button"
                className="dh-btn dh-btn-primary"
                id="vault-rename-submit"
                disabled={actionBusy !== null}
                onClick={() => submitVaultRename()}
              >
                {t("vault.rename.submit")}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {confirmationDialog}
    </div>
  );
};

const rootNode = document.querySelector<HTMLElement>("#dashboard-root");
if (!rootNode) {
  throw new Error("Missing Dashboard root element");
}
mountRenderer(
  rootNode,
  <RendererProviders>
    <App />
  </RendererProviders>
);
