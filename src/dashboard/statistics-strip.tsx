import type { ProjectStatistics } from "../project/bridge";
import { cn } from "../renderer/ui/utils";
import { Icon, t } from "./dashboard-display";
import { isToneName, TONE_CLASSES } from "./icon-registry";

export const StatisticsStrip = ({
  statistics,
}: {
  statistics: ProjectStatistics;
}) => {
  const expiring = statistics.expiringSecrets > 0;
  let expiryTone = "";
  if (expiring) {
    expiryTone = statistics.hasExpired ? "text-destructive" : "text-warning";
  }
  const expired = statistics.hasExpired;
  const metrics = [
    {
      icon: "folder",
      iconTone: "",
      label: t("dashboard.statistics.totalProjects"),
      tone: "",
      value: statistics.totalProjects,
    },
    {
      icon: "key",
      iconTone: "",
      label: t("dashboard.statistics.totalSecrets"),
      tone: "",
      value: statistics.totalSecrets,
    },
    {
      icon: "clock",
      iconTone: expiryTone,
      label: t(
        expired
          ? "dashboard.statistics.expiringAndExpired"
          : "dashboard.statistics.expiringSecrets"
      ),
      tone: expiryTone,
      value: statistics.expiringSecrets,
    },
    {
      icon: "activity",
      iconTone: "",
      label: t("dashboard.statistics.recentAccess"),
      tone: "",
      value: statistics.recentAccessCount,
    },
  ];
  return (
    <div className="dash-strip-wrap mb-6" id="stripWrap">
      <section
        className="dash-strip grid grid-cols-2 gap-3 lg:grid-cols-4"
        id="overviewStrip"
        aria-label={t("dashboard.statistics.overview")}
      >
        {metrics.map((metric) => (
          <div
            className="dash-metric bg-card border-border/80 flex items-center justify-between rounded-xl border p-4 shadow-xs"
            key={metric.label}
          >
            <div>
              <span className="m-label text-muted-foreground block text-xs">
                {metric.label}
              </span>
              <span
                className={cn(
                  "m-value text-foreground font-mono text-2xl font-semibold tracking-tight",
                  isToneName(metric.tone) ? TONE_CLASSES[metric.tone] : ""
                )}
              >
                {metric.value}
              </span>
            </div>
            <div
              className={cn(
                "m-icon bg-secondary text-primary flex size-9 items-center justify-center rounded-lg",
                isToneName(metric.iconTone) ? TONE_CLASSES[metric.iconTone] : ""
              )}
            >
              <Icon name={metric.icon} />
            </div>
          </div>
        ))}
      </section>
      <p className="dash-stat-note text-muted-foreground mt-2 text-right text-xs">
        {t("dashboard.statistics.scopeLabel")}
      </p>
    </div>
  );
};
