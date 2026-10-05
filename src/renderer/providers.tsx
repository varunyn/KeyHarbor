import React, { createContext, useContext, useEffect, useReducer } from "react";
import type { ReactNode } from "react";

import type { AppTheme } from "../project/bridge";
import { i18n } from "./i18n";
import { NotificationViewport } from "./notifications";
import { ReconciliationLayer } from "./reconciliation";

const TranslationReady = createContext(0);
const translate = (key: string, vars?: Record<string, unknown>) =>
  i18n.t(key, vars);
export const useRendererTranslation = () => {
  useContext(TranslationReady);
  return { locale: i18n.getLocale(), t: translate };
};

const applyThemeToDocument = (
  theme: AppTheme,
  shouldUseDarkColors?: boolean
) => {
  const isDark =
    theme === "dark" ||
    (theme !== "light" &&
      (shouldUseDarkColors ??
        window.matchMedia("(prefers-color-scheme: dark)").matches));
  const effectiveTheme = isDark ? "dark" : "light";
  document.documentElement.dataset.theme = effectiveTheme;
  document.body.dataset.theme = effectiveTheme;
  document.documentElement.classList.toggle("dark", isDark);
  document.documentElement.classList.toggle("light", !isDark);
  document.body.classList.toggle("dark", isDark);
  document.body.classList.toggle("light", !isDark);
};

export const RendererProviders = ({ children }: { children: ReactNode }) => {
  const [revision, bump] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    let live = true;
    const unsubscribe = i18n.subscribe(() => {
      if (live) {
        bump();
      }
    });
    document.body.classList.add(
      `platform-${window.platform}`,
      "window-focused"
    );
    const removeFocus = window.keyharbor.onWindowFocusChanged((focused) => {
      document.body.classList.toggle("window-focused", focused);
      document.body.classList.toggle("window-blurred", !focused);
    });

    const removeTheme = window.keyharbor.theme?.onThemeChanged?.((payload) => {
      if (live) {
        applyThemeToDocument(payload.theme, payload.shouldUseDarkColors);
      }
    });

    const initTheme = async () => {
      try {
        const payload = await window.keyharbor.theme?.get();
        if (live && payload) {
          applyThemeToDocument(payload.theme, payload.shouldUseDarkColors);
        }
      } catch {
        if (live) {
          applyThemeToDocument("system");
        }
      }
    };
    void initTheme();

    i18n.init();
    return () => {
      live = false;
      unsubscribe();
      removeFocus();
      removeTheme?.();
      i18n.dispose();
    };
  }, []);
  return (
    <TranslationReady.Provider value={revision}>
      <NotificationViewport>
        <ReconciliationLayer>{children}</ReconciliationLayer>
      </NotificationViewport>
    </TranslationReady.Provider>
  );
};
export const usePagehide = (cleanup: () => void) => {
  useEffect(() => {
    window.addEventListener("pagehide", cleanup);
    return () => window.removeEventListener("pagehide", cleanup);
  }, [cleanup]);
};
