import {
  ArrowLeft,
  Palette,
  Settings2,
  ShieldCheck,
  Vault,
} from "lucide-react";
import type { ReactNode } from "react";

import { useRendererTranslation } from "./providers";
import { Button } from "./ui/button";
import { cn } from "./ui/utils";
import { WorkspaceShell } from "./workspace-shell";

const EMPTY_SETTING_IDS = { description: "", label: "" };
export const SettingsRow = ({
  label,
  description,
  children,
  ids = EMPTY_SETTING_IDS,
}: {
  label: string;
  description: ReactNode;
  children: ReactNode;
  ids?: { row?: string; label: string; description: string; hidden?: boolean };
}) => (
  <div
    className={cn(
      "border-border/60 flex flex-wrap items-center justify-between gap-4 border-b py-5 last:border-b-0",
      ids.hidden && "hidden"
    )}
    id={ids.row}
  >
    <div className="min-w-0 flex-1 basis-56 space-y-1">
      <span className="text-foreground text-sm font-medium" id={ids.label}>
        {label}
      </span>
      {description && (
        <div
          className="text-muted-foreground max-w-lg text-xs leading-relaxed"
          id={ids.description}
        >
          {description}
        </div>
      )}
    </div>
    <div className="flex shrink-0 items-center gap-2">{children}</div>
  </div>
);

const sections = {
  appearance: { icon: Palette, tone: "bg-primary/10 text-primary" },
  behavior: { icon: Settings2, tone: "bg-primary/10 text-primary" },
  security: { icon: ShieldCheck, tone: "bg-success/10 text-success" },
  vault: { icon: Vault, tone: "bg-warning/10 text-warning" },
};
export const SettingsSection = ({
  section,
  children,
  headingId,
}: {
  section: keyof typeof sections;
  children: ReactNode;
  headingId?: string;
}) => {
  const { t } = useRendererTranslation();
  const { icon: Icon, tone } = sections[section];
  return (
    <section
      className="border-border/60 mt-7 grid gap-2 border-t pt-6 first:mt-0 lg:grid-cols-[180px_minmax(0,1fr)]"
      aria-labelledby={headingId ?? `settings-section-${section}`}
    >
      <div className="py-3 lg:pr-4">
        <span
          className={cn(
            "mb-3 inline-flex size-8 items-center justify-center rounded-lg",
            tone
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <h2
          id={headingId ?? `settings-section-${section}`}
          className="text-foreground text-sm font-semibold"
        >
          {t(`settings.sections.${section}.title`)}
        </h2>
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
          {t(`settings.sections.${section}.description`)}
        </p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
};

export const SettingsPage = ({
  children,
  onBack,
}: {
  children?: ReactNode;
  onBack?: () => void;
}) => {
  const { t } = useRendererTranslation();
  return (
    <WorkspaceShell
      activePage="settings"
      title={t("settings.title")}
      actions={
        onBack && (
          <Button variant="ghost" size="sm" id="back-btn" onClick={onBack}>
            <ArrowLeft aria-hidden="true" className="size-4" />
            {t("dashboard.title")}
          </Button>
        )
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 pt-8 pb-12 sm:px-8 sm:pt-10">
          <header className="mb-8">
            <h1
              id="title"
              className="text-foreground text-2xl font-semibold tracking-tight"
            >
              {t("settings.title")}
            </h1>
            <p className="text-muted-foreground mt-2 text-xs">
              {t("settings.description")}
            </p>
          </header>
          {children}
        </div>
      </div>
    </WorkspaceShell>
  );
};
