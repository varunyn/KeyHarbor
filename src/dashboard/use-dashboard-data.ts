import { useCallback } from "react";

import type { ProjectStatistics, VaultListEntry } from "../project/bridge";
import { notificationManager } from "../renderer/notifications";
import {
  collectAccessTimes,
  isBridgeSuccess,
  requireProjectData,
} from "./dashboard-data";
import { t } from "./dashboard-display";
import { useDashboardSession } from "./use-dashboard-session";
import type { DashboardState } from "./use-dashboard-state";

export const useDashboardData = (
  state: DashboardState,
  cancelConfirmation: () => void,
  closeMenus: () => void
) => {
  const {
    activeVaultRef,
    contextEpochRef,
    mountedRef,
    pageHiddenRef,
    projectsRef,
    readEpochRef,
    refreshRef,
    sessionActiveRef,
    setAccessTimes,
    setActiveVaultId,
    setFavorites,
    setLoadState,
    setProjects,
    setShowStatistics,
    setStatistics,
    setSyncAt,
    setVaults,
    settingsWarningRef,
    vaultsRef,
  } = state;
  const isCurrentRead = useCallback(
    (epoch: number, vaultId: string | null) =>
      mountedRef.current &&
      !pageHiddenRef.current &&
      sessionActiveRef.current &&
      readEpochRef.current === epoch &&
      activeVaultRef.current === vaultId,
    [activeVaultRef, mountedRef, pageHiddenRef, readEpochRef, sessionActiveRef]
  );

  const isCurrentContext = useCallback(
    (epoch: number, vaultId: string | null) =>
      mountedRef.current &&
      !pageHiddenRef.current &&
      sessionActiveRef.current &&
      contextEpochRef.current === epoch &&
      activeVaultRef.current === vaultId,
    [
      activeVaultRef,
      contextEpochRef,
      mountedRef,
      pageHiddenRef,
      sessionActiveRef,
    ]
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
  }, [
    activeVaultRef,
    contextEpochRef,
    mountedRef,
    projectsRef,
    refreshRef,
    sessionActiveRef,
    setAccessTimes,
    setActiveVaultId,
    setFavorites,
    setLoadState,
    setProjects,
    setStatistics,
    setVaults,
    vaultsRef,
  ]);

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
  }, [
    activeVaultRef,
    isCurrentRead,
    projectsRef,
    readEpochRef,
    sessionActiveRef,
    setAccessTimes,
    setFavorites,
    setLoadState,
    setProjects,
    setShowStatistics,
    setStatistics,
    setSyncAt,
    settingsWarningRef,
  ]);

  useDashboardSession(
    state,
    cancelConfirmation,
    closeMenus,
    isCurrentContext,
    loadVaults,
    refresh
  );

  return { isCurrentContext, isCurrentRead, loadVaults, refresh };
};
