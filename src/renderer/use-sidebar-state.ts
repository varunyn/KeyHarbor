import { useEffect, useSyncExternalStore } from "react";

const preferenceKey = "keyharbor.sidebar.expanded";
const preferenceChanged = "keyharbor:sidebar-preference-changed";
let storageUnavailable = false;
let fallbackOpen = window.matchMedia("(min-width: 861px)").matches;

const readSidebarOpen = () => {
  if (storageUnavailable) {
    return fallbackOpen;
  }
  try {
    const stored = window.localStorage.getItem(preferenceKey);
    if (stored === "true" || stored === "false") {
      return stored === "true";
    }
  } catch {
    // Keep the current document usable when preference storage is unavailable.
  }
  return fallbackOpen;
};

const writeSidebarOpen = (open: boolean) => {
  fallbackOpen = open;
  try {
    window.localStorage.setItem(preferenceKey, String(open));
  } catch {
    storageUnavailable = true;
    // The in-memory preference still supports toggling in this document.
  }
  window.dispatchEvent(new Event(preferenceChanged));
};

const toggleSidebar = () => writeSidebarOpen(!readSidebarOpen());
const closeSidebar = () => {
  writeSidebarOpen(false);
  document.querySelector<HTMLElement>("#indexToggle")?.focus();
};

export const closeNarrowSidebar = () => {
  if (window.matchMedia("(max-width: 860px)").matches) {
    closeSidebar();
  }
};

const subscribe = (onChange: () => void) => {
  window.addEventListener(preferenceChanged, onChange);
  window.addEventListener("storage", onChange);
  window.addEventListener("pageshow", onChange);
  return () => {
    window.removeEventListener(preferenceChanged, onChange);
    window.removeEventListener("storage", onChange);
    window.removeEventListener("pageshow", onChange);
  };
};

export const useSidebarState = () => {
  const open = useSyncExternalStore(subscribe, readSidebarOpen);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "b"
      ) {
        return;
      }
      const { target } = event;
      if (
        (target instanceof HTMLElement &&
          (target.isContentEditable ||
            /^(?:INPUT|TEXTAREA|SELECT)$/u.test(target.tagName))) ||
        document.querySelector('[role="dialog"], [role="alertdialog"]')
      ) {
        return;
      }
      event.preventDefault();
      toggleSidebar();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  return { closeSidebar, open, toggleSidebar };
};
