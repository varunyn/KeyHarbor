import type { Unsubscribe } from "./bridge";

export type AppTheme = "system" | "light" | "dark";

export interface ThemeChangePayload {
  macWindowMaterial?: "glass" | "vibrancy" | "opaque" | null;
  theme: AppTheme;
  shouldUseDarkColors: boolean;
}

export interface ThemeBridge {
  get: () => Promise<ThemeChangePayload>;
  onThemeChanged: (callback: (data: ThemeChangePayload) => void) => Unsubscribe;
}
