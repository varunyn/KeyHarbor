import { i18n } from "../renderer/i18n";
import { Button } from "../renderer/ui/button";
import type { ConfigurationResult } from "./bridge";
import { Icon } from "./icon";

type ConfigurationChecklist = Extract<
  ConfigurationResult,
  { success: true; configured: true }
>;
const t = (key: string, vars?: Record<string, string | number>) =>
  i18n.t(key, vars);

interface ConfigurationPanelProps {
  result: ConfigurationResult | { state: "loading" | "unavailable" } | null;
  checklist: ConfigurationChecklist | null;
  targetAvailable: boolean;
  open: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onSecret: (key: string, mode: "new" | "edit") => void;
}

const configurationSummaryFor = (
  result: ConfigurationPanelProps["result"],
  checklist: ConfigurationChecklist | null
) => {
  if (!result || ("state" in result && result.state === "loading")) {
    return t("project.configuration.loading");
  }
  if (
    ("state" in result && result.state === "unavailable") ||
    ("success" in result && !result.success)
  ) {
    return t("project.configuration.unavailable");
  }
  if (checklist) {
    return t("project.configuration.readySummary", {
      ready: checklist.counts.ready,
      required: checklist.counts.required,
    });
  }
  return t("project.configuration.notConfigured");
};

const configurationActionFor = (
  result: ConfigurationPanelProps["result"],
  checklist: ConfigurationChecklist | null
) => {
  if (result && "state" in result && result.state === "unavailable") {
    return t("project.retry");
  }
  return checklist
    ? t("project.configuration.updateAction")
    : t("project.configuration.setAction");
};

export const ConfigurationPanel = ({
  result,
  checklist,
  targetAvailable,
  open,
  onOpen,
  onToggle,
  onSecret,
}: ConfigurationPanelProps) => {
  const statusCounts = checklist?.counts;
  const configurationSummaryText = configurationSummaryFor(result, checklist);
  const configurationActionText = configurationActionFor(result, checklist);
  const showUnavailableHint =
    result && "state" in result && result.state === "unavailable";
  return (
    <section
      className="border-border/60 configuration-panel w-full shrink-0 border-t px-6 py-5"
      id="configurationPanel"
      aria-labelledby="configurationHeading"
    >
      <div className="configuration-panel-head flex flex-wrap items-center justify-between gap-4">
        <div className="configuration-overview space-y-1">
          <h2
            id="configurationHeading"
            className="text-foreground text-xs font-medium"
          >
            {t("project.configuration.heading")}
          </h2>
          <output
            id="configurationSummaryText"
            className="text-muted-foreground block text-xs"
            aria-live="polite"
          >
            {configurationSummaryText}
          </output>
          {checklist && statusCounts && (
            <p
              className="text-muted-foreground configuration-breakdown text-xs"
              id="configurationBreakdown"
            >
              {t("project.configuration.breakdown", {
                empty: statusCounts.empty,
                expired: statusCounts.expired,
                missing: statusCounts.missing,
              })}
            </p>
          )}
        </div>
        <div className="configuration-panel-actions flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            className="h-8 px-3 text-xs font-medium"
            id="configurationAction"
            disabled={!targetAvailable}
            onClick={onOpen}
          >
            {configurationActionText}
          </Button>
          {checklist && (
            <Button
              variant="ghost"
              size="icon"
              type="button"
              className="size-8"
              id="configurationToggle"
              aria-expanded={open}
              aria-controls="configurationChecklist"
              aria-label={t(
                `project.configuration.${open ? "hideChecklist" : "showChecklist"}`
              )}
              title={t(
                `project.configuration.${open ? "hideChecklist" : "showChecklist"}`
              )}
              onClick={onToggle}
            >
              <Icon name="chevron-down" />
            </Button>
          )}
        </div>
      </div>
      {showUnavailableHint && (
        <p className="text-destructive mt-2 text-xs" id="configurationError">
          {t("project.configuration.retryHint")}
        </p>
      )}
      {checklist && (
        <section
          aria-label={t("project.configuration.heading")}
          id="configurationChecklistScroll"
          className="mt-3 max-h-48 overflow-y-auto"
          hidden={!open}
        >
          <ul
            className="border-border/40 divide-border/30 configuration-checklist divide-y border-t pt-3"
            id="configurationChecklist"
          >
            {checklist.entries.map((entry) => (
              <li
                className="flex items-center justify-between py-2 text-xs"
                key={entry.key}
              >
                <code className="text-foreground font-mono font-medium">
                  {entry.key}
                </code>
                <span
                  className="bg-secondary text-muted-foreground rounded-md px-2 py-0.5 text-[11px]"
                  data-status={entry.status}
                >
                  {t(
                    `project.configuration.status.${entry.status.toLowerCase()}`
                  )}
                </span>
                {entry.status === "Ready" ? (
                  <span />
                ) : (
                  <Button
                    variant="link"
                    size="sm"
                    type="button"
                    className="text-primary h-auto p-0 text-xs hover:underline"
                    aria-label={t(
                      entry.status === "Missing"
                        ? "project.configuration.addKey"
                        : "project.configuration.editKey",
                      { key: entry.key }
                    )}
                    onClick={() =>
                      onSecret(
                        entry.key,
                        entry.status === "Missing" ? "new" : "edit"
                      )
                    }
                  >
                    {t(
                      entry.status === "Missing"
                        ? "project.configuration.addSecret"
                        : "project.configuration.editSecret"
                    )}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
};
