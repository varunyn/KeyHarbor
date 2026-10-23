import { Loader2 } from "lucide-react";
import React from "react";

import { Button } from "../renderer/ui/button";
import { Icon, t } from "./dashboard-display";
import { ProjectCard, ProjectRow } from "./project-cards";
import type { DashboardController } from "./use-dashboard";

const openProject = (name: string) => {
  window.location.href = `project.html?name=${encodeURIComponent(name)}`;
};

type Props = Pick<
  DashboardController,
  | "loadState"
  | "refresh"
  | "visibleProjects"
  | "projects"
  | "setSearch"
  | "setProjectFilter"
  | "searchRef"
  | "openDialog"
  | "viewMode"
  | "accessTimes"
  | "now"
  | "favorites"
  | "menu"
  | "toggleFavorite"
  | "setMenu"
  | "closeMenus"
  | "deleteProject"
>;

export const ProjectCollection = ({
  loadState,
  refresh,
  visibleProjects,
  projects,
  setSearch,
  setProjectFilter,
  searchRef,
  openDialog,
  viewMode,
  accessTimes,
  now,
  favorites,
  menu,
  toggleFavorite,
  setMenu,
  closeMenus,
  deleteProject,
}: Props) => {
  if (loadState === "loading") {
    return (
      <div className="dash-state flex flex-col items-center justify-center gap-3 py-20 text-center">
        <Loader2
          className="text-primary size-8 animate-spin"
          aria-label={t("common.loading")}
        />
      </div>
    );
  }
  if (loadState === "error") {
    return (
      <div className="dash-state flex flex-col items-center justify-center gap-3 py-16 text-center">
        <Icon name="circle-alert" className="text-destructive size-10" />
        <h2 className="text-foreground text-base font-semibold">
          {t("dashboard.notifications.failedToLoad")}
        </h2>
        <p className="text-muted-foreground max-w-sm text-xs">
          {t("dashboard.emptyState.noResultsBody")}
        </p>
        <Button
          variant="secondary"
          type="button"
          className="dh-btn dh-btn-secondary mt-2"
          onClick={() => refresh()}
        >
          {t("project.retry")}
        </Button>
      </div>
    );
  }
  if (!visibleProjects.length) {
    return (
      <div className="dash-state flex flex-col items-center justify-center gap-3 py-16 text-center">
        <Icon name="folder" className="text-muted-foreground/60 size-10" />
        <h2 className="text-foreground text-base font-semibold">
          {projects.length
            ? t("dashboard.emptyState.title")
            : t("dashboard.emptyState.emptyTitle")}
        </h2>
        <p className="text-muted-foreground max-w-sm text-xs">
          {projects.length
            ? t("dashboard.emptyState.noResultsBody")
            : t("dashboard.emptyState.emptyBody")}
        </p>
        {projects.length ? (
          <Button
            variant="secondary"
            type="button"
            className="dh-btn dh-btn-secondary mt-2"
            onClick={() => {
              setSearch("");
              setProjectFilter("all");
              searchRef.current?.focus();
            }}
          >
            {t("dashboard.emptyState.clearSearch")}
          </Button>
        ) : (
          <Button
            variant="default"
            type="button"
            className="dh-btn dh-btn-primary mt-2 gap-1.5"
            onClick={(event) => openDialog("project", event.currentTarget)}
          >
            <Icon name="plus" />
            {t("dashboard.addProject")}
          </Button>
        )}
      </div>
    );
  }
  if (viewMode === "grid") {
    return (
      <div className="dash-grid grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {visibleProjects.map((project) => (
          <ProjectCard
            key={project.name}
            project={project}
            access={accessTimes[project.name]}
            now={now}
            favorite={favorites.includes(project.name)}
            isMenuOpen={menu === `project:${project.name}`}
            onOpenProject={openProject}
            onToggleFavorite={toggleFavorite}
            onOpenMenu={(open) =>
              setMenu(open ? `project:${project.name}` : null)
            }
            onDeleteProject={(name) => {
              closeMenus();
              deleteProject(name);
            }}
          />
        ))}
      </div>
    );
  }
  return (
    <div className="dash-list border-border divide-border bg-card flex flex-col divide-y overflow-hidden rounded-xl border shadow-xs">
      {visibleProjects.map((project) => (
        <ProjectRow
          key={project.name}
          project={project}
          now={now}
          favorite={favorites.includes(project.name)}
          isMenuOpen={menu === `project:${project.name}`}
          onOpenProject={openProject}
          onToggleFavorite={toggleFavorite}
          onOpenMenu={(open) =>
            setMenu(open ? `project:${project.name}` : null)
          }
          onDeleteProject={(name) => {
            closeMenus();
            deleteProject(name);
          }}
        />
      ))}
    </div>
  );
};
