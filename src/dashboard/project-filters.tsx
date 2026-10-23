import React from "react";

import { Button } from "../renderer/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "../renderer/ui/dropdown-menu";
import { cn } from "../renderer/ui/utils";
import { Icon, t } from "./dashboard-display";
import type { SortMode } from "./dashboard-types";
import type { DashboardController } from "./use-dashboard";

type Props = Pick<
  DashboardController,
  | "projectFilter"
  | "setProjectFilter"
  | "projects"
  | "favorites"
  | "viewMode"
  | "setViewMode"
  | "menu"
  | "setMenu"
  | "sortMode"
  | "setSortMode"
>;

export const ProjectFilters = ({
  projectFilter,
  setProjectFilter,
  projects,
  favorites,
  viewMode,
  setViewMode,
  menu,
  setMenu,
  sortMode,
  setSortMode,
}: Props) => (
  <div className="dash-section-head mb-4 flex flex-wrap items-center gap-3">
    <fieldset
      className="dash-filters m-0 flex min-w-0 items-center gap-2 border-0 p-0"
      aria-label={t("dashboard.filters.label")}
    >
      <Button
        variant="secondary"
        size="sm"
        type="button"
        className={cn(
          "h-8 px-3 text-xs",
          projectFilter === "all" &&
            "bg-primary/10 text-primary border-primary/20"
        )}
        aria-pressed={projectFilter === "all"}
        onClick={() => setProjectFilter("all")}
      >
        {t("dashboard.filters.all", { count: projects.length })}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        type="button"
        className={cn(
          "h-8 gap-1.5 px-3 text-xs",
          projectFilter === "starred" &&
            "bg-primary/10 text-primary border-primary/20"
        )}
        aria-pressed={projectFilter === "starred"}
        onClick={() => setProjectFilter("starred")}
      >
        <Icon name="star" />
        {t("dashboard.filters.starred", {
          count: projects.filter((project) => favorites.includes(project.name))
            .length,
        })}
      </Button>
    </fieldset>
    <span className="spacer flex-1" />
    <div className="dash-seg bg-secondary/80 border-border inline-flex gap-0.5 rounded-lg border p-0.5">
      <Button
        variant="ghost"
        size="icon"
        type="button"
        className={cn(
          "text-muted-foreground size-7 rounded-md",
          viewMode === "grid" && "bg-card text-foreground font-medium shadow-xs"
        )}
        id="viewGridBtn"
        aria-label={t("dashboard.viewToggle.grid")}
        aria-pressed={viewMode === "grid"}
        onClick={() => setViewMode("grid")}
      >
        <Icon name="grid" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        type="button"
        className={cn(
          "text-muted-foreground size-7 rounded-md",
          viewMode === "list" && "bg-card text-foreground font-medium shadow-xs"
        )}
        id="viewListBtn"
        aria-label={t("dashboard.viewToggle.list")}
        aria-pressed={viewMode === "list"}
        onClick={() => setViewMode("list")}
      >
        <Icon name="list" />
      </Button>
    </div>
    <DropdownMenu
      open={menu === "sort"}
      onOpenChange={(open) => setMenu(open ? "sort" : null)}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          type="button"
          className="h-8 gap-1.5 px-3 text-xs"
          id="sortBtn"
          aria-label={t("dashboard.a11y.sortLabel")}
        >
          <span id="sortLabel">{t(`dashboard.sort.${sortMode}`)}</span>
          <Icon name="chevron-down" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        id="sortMenu"
        className="bg-card border-border min-w-[180px] rounded-xl border p-1.5 shadow-xl"
      >
        <DropdownMenuRadioGroup
          value={sortMode}
          onValueChange={(value) => {
            // SAFETY: This group emits only the SortMode values rendered below.
            setSortMode(value as SortMode);
          }}
        >
          {(["recent", "name", "secrets"] as const).map((sort) => (
            <DropdownMenuRadioItem
              key={sort}
              value={sort}
              className="cursor-pointer py-2 pr-2.5 pl-8 text-[13px]"
            >
              {t(`dashboard.sort.${sort}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
);
