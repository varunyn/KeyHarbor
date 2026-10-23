import { useEffect } from "react";

import { i18n } from "../renderer/i18n";
import { notificationManager } from "../renderer/notifications";
import { closeNarrowSidebar } from "../renderer/use-sidebar-state";
import { t } from "./dashboard-display";
import { blankForm } from "./dashboard-types";
import type { DashboardState } from "./use-dashboard-state";

export const useDashboardSession = (
  state: DashboardState,
  cancelConfirmation: () => void,
  closeMenus: () => void,
  isCurrentContext: (epoch: number, vaultId: string | null) => boolean,
  loadVaults: () => Promise<void>,
  refresh: () => Promise<void>
) => {
  const {
    actionEpochRef,
    actionPendingRef,
    activeVaultRef,
    appRef,
    contextEpochRef,
    dialogStateRef,
    mountedRef,
    pageHiddenRef,
    pendingSwitchVaultRef,
    projectsRef,
    readEpochRef,
    refreshRef,
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
    setProjects,
    setStatistics,
  } = state;
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh, refreshRef]);

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
        closeNarrowSidebar();
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
  }, [
    actionEpochRef,
    actionPendingRef,
    activeVaultRef,
    appRef,
    cancelConfirmation,
    closeMenus,
    contextEpochRef,
    dialogStateRef,
    isCurrentContext,
    loadVaults,
    mountedRef,
    pageHiddenRef,
    pendingSwitchVaultRef,
    projectsRef,
    readEpochRef,
    refreshRef,
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
    setProjects,
    setStatistics,
  ]);

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
  }, [appRef, setMenu]);
};
