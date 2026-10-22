import fs from "node:fs";
import path from "node:path";

import { app } from "electron";

const escapeRegExp = (value: string): string =>
  String(value).replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\class I18n {");

const isString = (value: unknown): value is string => typeof value === "string";

type LocaleValue =
  | string
  | number
  | boolean
  | null
  | LocaleValue[]
  | { [key: string]: LocaleValue };

const isLocaleValue = (value: unknown): value is LocaleValue => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isLocaleValue);
  }
  return typeof value === "object" && Object.values(value).every(isLocaleValue);
};

type LocaleContainer = { [key: string]: LocaleValue } | LocaleValue[];

const isLocaleContainer = (
  value: LocaleValue | undefined
): value is LocaleContainer => value !== null && typeof value === "object";

const isText = (value: LocaleValue | undefined): value is string =>
  typeof value === "string";

class I18n {
  currentLocale = "en";
  translations: LocaleValue = {};
  fallbackTranslations: LocaleValue = {};
  fallbackLocale = "en";
  supportedLocales = ["en"];

  resolveLocale(preferredLocale: unknown): string {
    const normalized = isString(preferredLocale)
      ? preferredLocale.trim().toLowerCase()
      : "";

    if (normalized && normalized !== "system") {
      if (this.supportedLocales.includes(normalized)) {
        return normalized;
      }
      return this.fallbackLocale;
    }

    const systemLocale = app.getLocale();
    const languageCode = (systemLocale || "").split("-")[0].toLowerCase();
    return this.supportedLocales.includes(languageCode)
      ? languageCode
      : this.fallbackLocale;
  }

  initialize(preferredLocale: string | null = null): string {
    this.currentLocale = this.resolveLocale(preferredLocale);

    this.loadTranslations();

    return this.currentLocale;
  }

  loadTranslations(): void {
    const localesDir = path.join(__dirname, "..", "locales");

    if (!fs.existsSync(localesDir)) {
      fs.mkdirSync(localesDir, { recursive: true });
    }

    const currentLocalePath = path.join(
      localesDir,
      `${this.currentLocale}.json`
    );
    const fallbackLocalePath = path.join(
      localesDir,
      `${this.fallbackLocale}.json`
    );

    try {
      if (fs.existsSync(currentLocalePath)) {
        const parsed: unknown = JSON.parse(
          fs.readFileSync(currentLocalePath, "utf-8")
        );
        if (isLocaleValue(parsed)) {
          this.translations = parsed;
        }
      }
    } catch (error) {
      console.error(`Failed to load locale ${this.currentLocale}:`, error);
    }

    this.fallbackTranslations = {};
    if (this.currentLocale !== this.fallbackLocale) {
      try {
        if (fs.existsSync(fallbackLocalePath)) {
          const parsed: unknown = JSON.parse(
            fs.readFileSync(fallbackLocalePath, "utf-8")
          );
          if (isLocaleValue(parsed)) {
            this.fallbackTranslations = parsed;
          }
        }
      } catch (error) {
        console.error(`Failed to load fallback locale:`, error);
      }
    }
  }

  t(key: string, replacements: Record<string, unknown> = {}): string {
    const keys = key.split(".");
    let translation: LocaleValue | undefined = this.translations;

    for (const k of keys) {
      if (isLocaleContainer(translation)) {
        translation = translation[k];
      } else {
        translation = undefined;
        break;
      }
    }

    if (translation === undefined && this.fallbackTranslations) {
      translation = this.fallbackTranslations;
      for (const k of keys) {
        if (isLocaleContainer(translation)) {
          translation = translation[k];
        } else {
          translation = undefined;
          break;
        }
      }
    }

    if (translation === undefined) {
      return key;
    }

    if (!isText(translation)) {
      return key;
    }

    let result = translation;
    for (const [placeholder, value] of Object.entries(replacements)) {
      const pattern = new RegExp(
        `\\{\\{${escapeRegExp(placeholder)}\\}\\}`,
        "gu"
      );
      result = result.replace(pattern, () => String(value));
    }

    return result;
  }

  getLocale(): string {
    return this.currentLocale;
  }

  setLocale(locale: string): void {
    this.currentLocale = this.resolveLocale(locale);
    this.loadTranslations();
  }

  getAllTranslations() {
    return {
      locale: this.currentLocale,
      translations: this.translations,
    };
  }
}

export = I18n;
