import type { ReactNode } from "react";

import { i18n } from "../renderer/i18n";
import { ProjectName } from "../renderer/ui/project-name";
import { cn } from "../renderer/ui/utils";
import { Icon } from "./icon";
import { relative } from "./secret-presentation";

const t = (key: string, vars?: Record<string, string | number>) =>
  i18n.t(key, vars);

const secretCountLabelFor = (count: number) =>
  count === 1
    ? t("project.summary.secretsOne")
    : t("project.summary.secrets", { count });
export const ProjectSummary = ({
  entryCount,
  attention,
  updatedAt,
}: {
  entryCount: number;
  attention: number;
  updatedAt: string | null;
}) => (
  <div
    className="text-muted-foreground secrets-footing flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
    id="footing"
    aria-live="polite"
  >
    <span>{secretCountLabelFor(entryCount)}</span>
    <span
      className={cn(
        "font-medium",
        attention > 0 ? "text-warning" : "text-muted-foreground"
      )}
    >
      {t("project.summary.needsAttention", { count: attention })}
    </span>
    {updatedAt && (
      <>
        <span className="opacity-40" aria-hidden="true">
          ·
        </span>
        <span>
          {t("project.summary.updated", { time: relative(updatedAt) })}
        </span>
      </>
    )}
  </div>
);

export const ProjectHeader = ({
  projectName,
  actions,
  summary,
  children,
}: {
  projectName: string;
  actions: ReactNode;
  summary: ReactNode;
  children: ReactNode;
}) => (
  <section
    className="w-full shrink-0 px-6 pt-8"
    aria-labelledby="projectHeading"
  >
    <div className="flex flex-wrap items-end justify-between gap-5">
      <div className="min-w-0 flex-1 basis-64">
        <div className="text-primary mb-2 flex items-center gap-1.5 text-xs font-medium">
          <Icon name="folder" />
          {t("project.header.title")}
        </div>
        <h1
          id="projectHeading"
          className="text-foreground text-2xl font-semibold tracking-tight"
        >
          <ProjectName name={projectName} wrap />
        </h1>
        <p className="text-muted-foreground mt-2 text-xs">
          {t("project.header.description")}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">{actions}</div>
    </div>
    <div className="border-border/60 mt-6 flex flex-wrap items-center justify-between gap-3 border-b pb-5">
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {summary}
    </div>
  </section>
);
