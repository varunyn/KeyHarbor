import type { ReactNode } from "react";

type Translations = Record<string, unknown>;
type Listener = () => void;
class RendererI18n {
  private translations: Translations = {};
  private locale = "en";
  private listeners = new Set<Listener>();
  private loading: Promise<boolean> | null = null;
  private bound = false;
  private initialized = false;
  private localeUnsubscribe: (() => void) | null = null;
  private generation = 0;
  async init(): Promise<boolean> {
    if (this.initialized) {
      this.bindLocaleChanges();
      return true;
    }
    if (this.loading) {
      return this.loading;
    }
    const { generation } = this;
    this.loading = this.load(generation);
    const loaded = await this.loading;
    return loaded;
  }
  private async load(generation: number): Promise<boolean> {
    try {
      const data = await window.keyharbor.i18n.getTranslations();
      if (generation !== this.generation) {
        return false;
      }
      this.apply(data);
      this.initialized = true;
      if (generation === this.generation) {
        this.bindLocaleChanges();
      }
      return true;
    } catch (error: unknown) {
      if (generation === this.generation) {
        console.error("Failed to load translations:", error);
      }
      return false;
    } finally {
      if (generation === this.generation) {
        this.loading = null;
      }
    }
  }
  private bindLocaleChanges() {
    if (this.bound) {
      return;
    }
    this.bound = true;
    this.localeUnsubscribe = window.keyharbor.i18n.onLocaleChanged((next) => {
      if (!next?.translations) {
        window.location.reload();
        return;
      }
      this.apply(next);
      window.location.reload();
    });
  }
  private apply(data: { locale?: string; translations?: Translations }) {
    this.translations = data.translations || {};
    this.locale = data.locale || "en";
    document.documentElement.lang = this.locale;
    for (const listener of this.listeners) {
      listener();
    }
  }
  t(key: string, vars: Record<string, unknown> = {}): string {
    let value: unknown = this.translations;
    for (const part of key.split(".")) {
      value =
        value && typeof value === "object"
          ? (value as Record<string, unknown>)[part]
          : undefined;
    }
    if (typeof value !== "string") {
      return key;
    }
    return value.replaceAll(
      /\{\{(?<name>[^}]+)\}\}/gu,
      (
        match,
        _name: string,
        _offset: number,
        _value: string,
        groups: { name: string }
      ) =>
        Object.hasOwn(vars, groups.name) ? String(vars[groups.name]) : match
    );
  }
  getLocale() {
    return this.locale;
  }
  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  dispose() {
    this.generation += 1;
    this.loading = null;
    this.initialized = false;
    this.localeUnsubscribe?.();
    this.localeUnsubscribe = null;
    this.bound = false;
  }
}
export const i18n = new RendererI18n();
export interface TranslationProviderProps {
  children: ReactNode;
}
