import type { AppSettings, AppTheme } from "../project/bridge";
import { useRendererTranslation } from "./providers";
import { Select } from "./ui/select";

export const LanguageSelect = ({
  value,
  onValueChange,
}: {
  value: string;
  onValueChange: (value: string) => void;
}) => {
  const { t } = useRendererTranslation();

  return (
    <Select
      id="language-select"
      aria-labelledby="label-language"
      value={value}
      onValueChange={onValueChange}
      options={[
        {
          id: "lang-opt-system",
          label: t("settings.languageOptions.system"),
          value: "system",
        },
        {
          id: "lang-opt-en",
          label: t("settings.languageOptions.en"),
          value: "en",
        },
      ]}
    />
  );
};

export const ThemeSelect = ({
  value,
  onValueChange,
}: {
  value: AppTheme;
  onValueChange: (value: AppTheme) => void;
}) => {
  const { t } = useRendererTranslation();

  return (
    <Select<AppTheme>
      id="theme-select"
      aria-labelledby="label-theme"
      value={value}
      onValueChange={onValueChange}
      options={[
        {
          id: "theme-opt-system",
          label: t("settings.themeOptions.system"),
          value: "system",
        },
        {
          id: "theme-opt-dark",
          label: t("settings.themeOptions.dark"),
          value: "dark",
        },
        {
          id: "theme-opt-light",
          label: t("settings.themeOptions.light"),
          value: "light",
        },
      ]}
    />
  );
};

export const CloseBehaviorSelect = ({
  value,
  onValueChange,
}: {
  value: AppSettings["closeBehavior"];
  onValueChange: (value: AppSettings["closeBehavior"]) => void;
}) => {
  const { t } = useRendererTranslation();

  return (
    <Select<AppSettings["closeBehavior"]>
      id="close-behavior-select"
      aria-labelledby="label-close-behavior"
      aria-describedby="desc-close-behavior"
      value={value}
      onValueChange={onValueChange}
      options={[
        { label: t("settings.closeBehaviorAsk"), value: "ask" },
        {
          label: t("settings.closeBehaviorBackground"),
          value: "background",
        },
        { label: t("settings.closeBehaviorQuit"), value: "quit" },
      ]}
    />
  );
};

export const VaultSyncIntervalSelect = ({
  value,
  onValueChange,
}: {
  value: 5 | 60;
  onValueChange: (value: 5 | 60) => void;
}) => {
  const { t } = useRendererTranslation();

  return (
    <Select<"5" | "60">
      id="vault-sync-interval-select"
      aria-labelledby="label-vault-sync-interval"
      value={value === 60 ? "60" : "5"}
      onValueChange={(selected) => onValueChange(selected === "60" ? 60 : 5)}
      options={[
        {
          id: "vault-sync-opt-5",
          label: t("settings.vaultDiskSync5s"),
          value: "5",
        },
        {
          id: "vault-sync-opt-60",
          label: t("settings.vaultDiskSync1m"),
          value: "60",
        },
      ]}
    />
  );
};
