import type { ProjectRecord } from "../project/bridge";
import { Button } from "../renderer/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../renderer/ui/dropdown-menu";
import { cn } from "../renderer/ui/utils";
import {
  formatAccessTime,
  formatDate,
  Icon,
  isToday,
  MONOGRAM_TONES,
  monogram,
  t,
} from "./dashboard-display";

export const ProjectActions = ({
  project,
  favorite,
  isMenuOpen,
  onToggleFavorite,
  onOpenMenu,
  onDeleteProject,
}: {
  project: ProjectRecord;
  favorite: boolean;
  isMenuOpen: boolean;
  onToggleFavorite: (name: string) => void;
  onOpenMenu: (open: boolean) => void;
  onDeleteProject: (name: string) => void;
}) => (
  <span className="dash-card-actions relative z-10 flex shrink-0 items-center gap-1">
    <Button
      variant="ghost"
      size="icon"
      type="button"
      className={cn(
        "dash-icon-btn text-muted-foreground hover:bg-secondary hover:text-foreground size-8 rounded-lg transition-colors",
        favorite && "is-fav text-warning"
      )}
      aria-pressed={favorite}
      aria-label={t(
        favorite ? "project.removeFromFavorites" : "project.addToFavorites"
      )}
      title={t(
        favorite ? "project.removeFromFavorites" : "project.addToFavorites"
      )}
      onClick={() => onToggleFavorite(project.name)}
    >
      <Icon name="star" />
    </Button>
    <DropdownMenu open={isMenuOpen} onOpenChange={onOpenMenu}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          type="button"
          className="dash-icon-btn text-muted-foreground hover:bg-secondary hover:text-foreground size-8 rounded-lg"
          aria-label={t("dashboard.a11y.menuLabel")}
        >
          <Icon name="ellipsis" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-[140px] p-1"
        onClick={(event) => event.stopPropagation()}
      >
        <DropdownMenuItem
          className="text-destructive focus:text-destructive cursor-pointer rounded-md px-2.5 py-1.5 text-xs"
          onSelect={() => onDeleteProject(project.name)}
        >
          {t("dashboard.deleteProject.deleteBtn")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </span>
);

export const ProjectCard = ({
  project,
  access,
  now,
  favorite,
  isMenuOpen,
  onOpenProject,
  onToggleFavorite,
  onOpenMenu,
  onDeleteProject,
}: {
  project: ProjectRecord;
  access?: number;
  now: number;
  favorite: boolean;
  isMenuOpen: boolean;
  onOpenProject: (name: string) => void;
  onToggleFavorite: (name: string) => void;
  onOpenMenu: (open: boolean) => void;
  onDeleteProject: (name: string) => void;
}) => {
  const mark = monogram(project.name);
  const activeToday =
    isToday(project.updatedAt) ||
    (access !== undefined &&
      now - access < 86_400_000 &&
      isToday(new Date(access).toISOString()));

  return (
    <article
      className="dash-card group border-border bg-card hover:border-primary/50 relative flex min-h-[220px] cursor-pointer flex-col justify-between rounded-xl border p-5 transition-all duration-150 hover:shadow-md"
      data-list-key={project.name}
    >
      <a
        className="absolute inset-0 z-0 rounded-[inherit]"
        href={`project.html?name=${encodeURIComponent(project.name)}`}
        aria-label={t("dashboard.card.openProject", { name: project.name })}
        onKeyDown={(event) => {
          if (event.key === " ") {
            event.preventDefault();
            onOpenProject(project.name);
          }
        }}
      >
        <span className="sr-only">
          {t("dashboard.card.openProject", { name: project.name })}
        </span>
      </a>
      <div className="dash-card-top mb-2.5 flex items-center gap-3">
        <span
          className={cn(
            "monogram flex size-10 shrink-0 items-center justify-center rounded-lg text-xs font-bold tracking-wider",
            MONOGRAM_TONES[mark.tone]
          )}
          aria-hidden="true"
        >
          {mark.initials}
        </span>
        <span className="dash-card-name text-foreground min-w-0 flex-1 truncate text-base font-semibold">
          {project.name}
        </span>
        <ProjectActions
          project={project}
          favorite={favorite}
          isMenuOpen={isMenuOpen}
          onToggleFavorite={onToggleFavorite}
          onOpenMenu={onOpenMenu}
          onDeleteProject={onDeleteProject}
        />
      </div>
      <p className="dash-card-sub text-muted-foreground mb-3 truncate text-xs">
        {t("dashboard.card.localProject")}
      </p>
      <div className="dash-card-status bg-secondary/60 text-muted-foreground my-2 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs">
        {activeToday ? (
          <span className="active-pill text-success inline-flex items-center gap-1.5 font-medium">
            <span
              className="pill-dot bg-success size-1.5 rounded-full"
              aria-hidden="true"
            />
            {t("dashboard.card.activeToday")}
          </span>
        ) : (
          <>
            <Icon name="key" className="text-primary" />
            <span>{t("dashboard.card.storedLocally")}</span>
          </>
        )}
      </div>
      <div className="dash-card-badges my-2 flex flex-wrap items-center gap-1.5">
        <span className="bg-secondary text-muted-foreground rounded px-2 py-0.5 font-mono text-[11px]">
          {t(
            project.secretCount === 1
              ? "dashboard.secretCountOne"
              : "dashboard.secretCount",
            { count: project.secretCount }
          )}
        </span>
        <span className="bg-secondary text-primary rounded px-2 py-0.5 font-mono text-[11px]">
          {t(
            project.environmentCount === 1
              ? "dashboard.card.environmentOne"
              : "dashboard.card.environments",
            { count: project.environmentCount }
          )}
        </span>
      </div>
      {access !== undefined && (
        <p className="dash-card-sub access-line text-muted-foreground mb-2 truncate text-xs tabular-nums">
          {t("dashboard.card.lastAccessed", {
            time: formatAccessTime(access, now),
          })}
        </p>
      )}
      <div className="dash-card-foot border-border text-muted-foreground mt-auto flex items-center justify-between border-t pt-3 text-xs tabular-nums">
        <span>
          {t("dashboard.updated", {
            time: formatDate(project.updatedAt, now),
          })}
        </span>
        <span className="dash-card-open text-muted-foreground group-hover:text-primary inline-flex items-center gap-1 transition-all group-hover:translate-x-0.5">
          {t("dashboard.card.open")}
          <Icon name="arrow-right" />
        </span>
      </div>
    </article>
  );
};

export const ProjectRow = ({
  project,
  now,
  favorite,
  isMenuOpen,
  onOpenProject,
  onToggleFavorite,
  onOpenMenu,
  onDeleteProject,
}: {
  project: ProjectRecord;
  now: number;
  favorite: boolean;
  isMenuOpen: boolean;
  onOpenProject: (name: string) => void;
  onToggleFavorite: (name: string) => void;
  onOpenMenu: (open: boolean) => void;
  onDeleteProject: (name: string) => void;
}) => {
  const mark = monogram(project.name);
  return (
    <div
      className="dash-row group bg-card hover:bg-secondary/40 relative flex min-h-[56px] cursor-pointer items-center gap-3 p-3.5 transition-colors"
      data-list-key={project.name}
    >
      <a
        className="absolute inset-0 z-0 rounded-[inherit]"
        href={`project.html?name=${encodeURIComponent(project.name)}`}
        aria-label={t("dashboard.card.openProject", { name: project.name })}
        onKeyDown={(event) => {
          if (event.key === " ") {
            event.preventDefault();
            onOpenProject(project.name);
          }
        }}
      >
        <span className="sr-only">
          {t("dashboard.card.openProject", { name: project.name })}
        </span>
      </a>
      <span
        className={cn(
          "monogram flex size-8 shrink-0 items-center justify-center rounded-md text-xs font-bold tracking-wider",
          MONOGRAM_TONES[mark.tone]
        )}
        aria-hidden="true"
      >
        {mark.initials}
      </span>
      <div className="row-main min-w-0 flex-1">
        <div className="row-name text-foreground truncate text-sm font-semibold">
          {project.name}
        </div>
        <div className="row-sub text-muted-foreground truncate text-xs tabular-nums">
          {t("dashboard.updated", {
            time: formatDate(project.updatedAt, now),
          })}
        </div>
      </div>
      <div className="row-meta text-muted-foreground px-2 text-xs tabular-nums">
        {t(
          project.secretCount === 1
            ? "dashboard.secretCountOne"
            : "dashboard.secretCount",
          project.secretCount === 1 ? undefined : { count: project.secretCount }
        )}
      </div>
      <ProjectActions
        project={project}
        favorite={favorite}
        isMenuOpen={isMenuOpen}
        onToggleFavorite={onToggleFavorite}
        onOpenMenu={onOpenMenu}
        onDeleteProject={onDeleteProject}
      />
    </div>
  );
};
