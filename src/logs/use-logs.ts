import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ActivityLog } from "../project/bridge";
import {
  requireSuccessfulResponse,
  runWithCleanup,
} from "../renderer/async-operation";
import { notificationManager } from "../renderer/notifications";
import { useRendererTranslation } from "../renderer/providers";
import { useConfirmation } from "../renderer/ui/confirmation";

export const useLogs = () => {
  const { t } = useRendererTranslation();
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(50);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(false);
  const alive = useRef(true);
  const epoch = useRef(0);
  const loadSequence = useRef(0);
  const sessionTransition = useRef(-1);
  const sessionTarget = useRef<string | null>(null);
  const sessionSeen = useRef(false);
  const sessionActive = useRef(false);
  const container = useRef<HTMLDivElement>(null);
  const scrollTop = useRef<number | null>(null);
  const renderedLogs = useRef<ActivityLog[] | null>(null);
  const busyRef = useRef(false);
  const { confirm, confirmationDialog, cancelConfirmation } = useConfirmation();
  const load = useCallback(
    async (preserve = false) => {
      const token = epoch.current;
      loadSequence.current += 1;
      const sequence = loadSequence.current;
      if (preserve && container.current) {
        scrollTop.current = container.current.scrollTop;
      }
      try {
        const result = await window.keyharbor.logs.get();
        if (
          !alive.current ||
          token !== epoch.current ||
          sequence !== loadSequence.current
        ) {
          return;
        }
        requireSuccessfulResponse(result, "Failed to load logs");
        const reversed = [...result.data];
        reversed.reverse();
        setNow(Date.now());
        setLogs(reversed);
        setLoaded(true);
        setFailure(false);
      } catch {
        if (
          alive.current &&
          token === epoch.current &&
          sequence === loadSequence.current
        ) {
          setFailure(true);
          notificationManager.error(t("logs.notifications.failedToLoad"));
        }
      }
    },
    [t]
  );
  useEffect(() => {
    alive.current = true;
    const offSession = window.keyharbor.vault.onSessionStateChanged(
      (snapshot) => {
        if (snapshot.transitionId < sessionTransition.current) {
          return;
        }
        sessionTransition.current = snapshot.transitionId;
        const nextTarget = snapshot.activeVaultId || null;
        const changedVault =
          sessionSeen.current && nextTarget !== sessionTarget.current;
        sessionSeen.current = true;
        const wasActive = sessionActive.current;
        sessionTarget.current = nextTarget;
        sessionActive.current = snapshot.state === "active";
        if (snapshot.state !== "active" || changedVault) {
          cancelConfirmation();
          epoch.current += 1;
          loadSequence.current += 1;
          setLogs([]);
          setLoaded(false);
          setFailure(false);
          if (snapshot.state === "active") {
            load();
          }
        } else if (!wasActive) {
          load();
        }
      }
    );
    const offSync = window.keyharbor.vault.onVaultDataSynced(() => {
      if (sessionActive.current && document.visibilityState === "visible") {
        load(true);
      }
    });
    const onPagehide = () => {
      cancelConfirmation();
      alive.current = false;
      epoch.current += 1;
      loadSequence.current += 1;
    };
    const interval = window.setInterval(() => {
      if (sessionActive.current && document.visibilityState === "visible") {
        load(true);
      }
    }, 15_000);
    const visibility = () => {
      if (sessionActive.current && document.visibilityState === "visible") {
        load(true);
      }
    };
    window.addEventListener("pagehide", onPagehide);
    document.addEventListener("visibilitychange", visibility);
    (async () => {
      try {
        const snapshot = await window.keyharbor.vault.sessionSnapshot();
        if (
          !alive.current ||
          snapshot.transitionId < sessionTransition.current
        ) {
          return;
        }
        sessionTransition.current = snapshot.transitionId;
        sessionTarget.current = snapshot.activeVaultId || null;
        sessionSeen.current = true;
        sessionActive.current = snapshot.state === "active";
        if (!sessionActive.current) {
          epoch.current += 1;
          loadSequence.current += 1;
          setLogs([]);
          setLoaded(false);
        }
      } catch {
        // Session notifications remain authoritative when the snapshot is unavailable.
      }
    })();
    // Initial audit data is read through IPC; state updates follow the asynchronous response.
    // eslint-disable-next-line react/set-state-in-effect
    load();
    return () => {
      alive.current = false;
      epoch.current += 1;
      loadSequence.current += 1;
      window.clearInterval(interval);
      window.removeEventListener("pagehide", onPagehide);
      document.removeEventListener("visibilitychange", visibility);
      offSession();
      offSync();
    };
  }, [load, cancelConfirmation]);
  useLayoutEffect(() => {
    if (renderedLogs.current === logs) {
      return;
    }
    renderedLogs.current = logs;
    if (scrollTop.current !== null && container.current) {
      container.current.scrollTop = scrollTop.current;
      scrollTop.current = null;
    }
  }, [logs]);
  const filtered = useMemo(
    () =>
      logs.filter(
        (log) =>
          (category === "all" || log.category.toLowerCase() === category) &&
          (!search || log.message.toLowerCase().includes(search.toLowerCase()))
      ),
    [logs, category, search]
  );
  const ago = (timestamp: string) => {
    const date = new Date(timestamp);
    const minutes = Math.max(0, Math.floor((now - date.getTime()) / 60_000));
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (minutes < 1) {
      return t("logs.timeAgo.justNow");
    }
    if (minutes < 60) {
      return t(
        minutes === 1 ? "logs.timeAgo.minuteAgo" : "logs.timeAgo.minutesAgo",
        { count: minutes }
      );
    }
    if (hours < 24) {
      return t(hours === 1 ? "logs.timeAgo.hourAgo" : "logs.timeAgo.hoursAgo", {
        count: hours,
      });
    }
    if (days < 7) {
      return t(days === 1 ? "logs.timeAgo.dayAgo" : "logs.timeAgo.daysAgo", {
        count: days,
      });
    }
    return date.toLocaleString();
  };
  const clearLogs = async () => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    const token = epoch.current;
    await runWithCleanup(
      async () => {
        try {
          const approved = await confirm({
            confirmLabel: t("logs.clearAll"),
            description: t("logs.clearConfirm"),
            title: t("logs.clearAll"),
            variant: "destructive",
          });
          if (!approved || !alive.current || token !== epoch.current) {
            return;
          }
          setBusy(true);
          const result = await window.keyharbor.logs.clear();
          if (!alive.current || token !== epoch.current) {
            return;
          }
          requireSuccessfulResponse(result, "Failed to clear logs");
          setLogs([]);
          notificationManager.success(t("logs.notifications.cleared"));
        } catch {
          if (alive.current && token === epoch.current) {
            notificationManager.error(t("logs.notifications.failedToClear"));
          }
        }
      },
      () => {
        busyRef.current = false;
        if (alive.current) {
          setBusy(false);
        }
      }
    );
  };
  const exportLogs = async () => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    const token = epoch.current;
    await runWithCleanup(
      async () => {
        try {
          const result = await window.keyharbor.logs.export();
          if (!alive.current || token !== epoch.current) {
            return;
          }
          if (result.success) {
            notificationManager.success(
              t("logs.notifications.exported", { path: result.path || "" })
            );
          } else if (!result.cancelled) {
            notificationManager.error(t("logs.notifications.failedToExport"));
          }
        } catch {
          if (alive.current && token === epoch.current) {
            notificationManager.error(t("logs.notifications.failedToExport"));
          }
        }
      },
      () => {
        busyRef.current = false;
        if (alive.current) {
          setBusy(false);
        }
      }
    );
  };
  const loadMore = () => {
    if (
      container.current &&
      container.current.scrollHeight -
        container.current.scrollTop -
        container.current.clientHeight <
        80
    ) {
      setVisibleCount((count) => Math.min(filtered.length, count + 50));
    }
  };
  return {
    ago,
    busy,
    category,
    clearLogs,
    confirmationDialog,
    container,
    exportLogs,
    failure,
    filtered,
    load,
    loadMore,
    loaded,
    logs,
    search,
    setCategory,
    setSearch,
    setVisibleCount,
    visibleCount,
  };
};
