import { Fragment } from "react";

import { i18n } from "../renderer/i18n";
import { Button } from "../renderer/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../renderer/ui/dropdown-menu";
import { Input } from "../renderer/ui/input";
import { cn } from "../renderer/ui/utils";
import { Icon } from "./components";

export type ProjectExportMode = "example" | "references" | "backup" | "raw";
interface ProjectToolbarProps {
  search: string;
  setSearch: (search: string) => void;
  menu: string | null;
  setMenu: (menu: string | null) => void;
  filterType: string;
  setFilterType: (type: string) => void;
  filterStatus: string;
  setFilterStatus: (status: string) => void;
  targetReady: boolean;
  onImport: () => void;
  onNewSecret: () => void;
  onExport: (mode: ProjectExportMode) => void;
}
const t = (key: string) => i18n.t(key);
const exportIcons = {
  backup: "key",
  example: "file-text",
  raw: "circle-alert",
  references: "lock",
} as const;
const statusOptions = [
  ["all", "project.filterMenu.statusAll"],
  ["healthy", "project.filterMenu.statusHealthy"],
  ["attention", "project.filterMenu.statusAttention"],
] as const;
const filterItemClass = (selected: boolean) =>
  cn(
    "flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 text-xs",
    selected
      ? "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary font-medium"
      : "hover:bg-secondary"
  );
export const ProjectToolbar = ({
  search,
  setSearch,
  menu,
  setMenu,
  filterType,
  setFilterType,
  filterStatus,
  setFilterStatus,
  targetReady,
  onImport,
  onNewSecret,
  onExport,
}: ProjectToolbarProps) => (
  <div className="border-border/40 secrets-toolbar flex flex-wrap items-center gap-2 border-b px-6 py-3">
    <div className="secrets-search relative max-w-[340px] min-w-[200px] flex-1">
      <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2">
        <Icon name="search" />
      </span>
      <Input
        type="search"
        id="searchInput"
        className="bg-secondary/40 border-border/80 secrets-search-input h-10 pr-8 pl-9 text-[13px]"
        placeholder={t("project.searchPlaceholder")}
        aria-label={t("project.a11y.searchLabel")}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <span
        className="text-muted-foreground border-border/80 secrets-search-kbd pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded border px-1.5 font-mono text-[10px]"
        aria-hidden="true"
      >
        /
      </span>
    </div>
    <DropdownMenu
      open={menu === "filter"}
      onOpenChange={(open) => setMenu(open ? "filter" : null)}
    >
      <div className="dropdown relative" id="filterDropdown">
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            size="icon"
            type="button"
            className="size-10"
            id="filterBtn"
            aria-expanded={menu === "filter"}
            title={t("project.filter")}
            aria-label={t("project.filter")}
          >
            <Icon name="sliders-horizontal" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="bg-card border-border min-w-[180px] rounded-xl border p-2 shadow-xl"
          id="filterMenu"
          align="start"
        >
          <p className="text-muted-foreground px-2 py-1 text-[10px] font-semibold uppercase">
            {t("project.filterMenu.typeLabel")}
          </p>
          <div>
            {(["all", "secret", "config"] as const).map((value) => (
              <DropdownMenuItem
                className={filterItemClass(filterType === value)}
                key={value}
                aria-current={filterType === value || undefined}
                onSelect={() => setFilterType(value)}
              >
                <span>
                  {t(
                    `project.filterMenu.type${value.charAt(0).toUpperCase()}${value.slice(1)}`
                  )}
                </span>
                {filterType === value && (
                  <Icon name="check" className="size-4 shrink-0" />
                )}
              </DropdownMenuItem>
            ))}
          </div>
          <p className="text-muted-foreground mt-2 px-2 py-1 text-[10px] font-semibold uppercase">
            {t("project.filterMenu.statusLabel")}
          </p>
          <div>
            {statusOptions.map(([value, label]) => (
              <DropdownMenuItem
                className={filterItemClass(filterStatus === value)}
                key={value}
                aria-current={filterStatus === value || undefined}
                onSelect={() => setFilterStatus(value)}
              >
                <span>{t(label)}</span>
                {filterStatus === value && (
                  <Icon name="check" className="size-4 shrink-0" />
                )}
              </DropdownMenuItem>
            ))}
          </div>
          <DropdownMenuSeparator className="border-border my-1.5 border-t" />
          <DropdownMenuItem
            className="hover:bg-secondary text-muted-foreground hover:text-foreground cursor-pointer rounded-lg px-2.5 py-1.5 text-xs"
            onSelect={() => {
              setFilterType("all");
              setFilterStatus("all");
            }}
          >
            <span>{t("project.filterMenu.clear")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </div>
    </DropdownMenu>
    <span className="flex-1" />
    <Button
      variant="secondary"
      size="sm"
      type="button"
      className="h-10 gap-2 px-4 text-[13px] font-medium"
      id="importBtn"
      disabled={!targetReady}
      onClick={onImport}
    >
      <Icon name="upload" />
      <span>{t("project.importEnv")}</span>
    </Button>
    <DropdownMenu
      open={menu === "export"}
      onOpenChange={(open) => setMenu(open ? "export" : null)}
    >
      <div className="dropdown relative" id="exportDropdown">
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            className="h-10 gap-2 px-4 text-[13px] font-medium"
            id="exportBtn"
            aria-expanded={menu === "export"}
          >
            <Icon name="download" />
            <span>{t("project.exportEnv")}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="bg-card border-border min-w-[240px] rounded-xl border p-1.5 shadow-xl"
          id="exportMenu"
          align="end"
        >
          {(["example", "references", "backup", "raw"] as const).map((mode) => (
            <Fragment key={mode}>
              {mode === "raw" && (
                <DropdownMenuSeparator className="border-border my-1.5 border-t" />
              )}
              <DropdownMenuItem
                className={`hover:bg-secondary flex cursor-pointer items-start rounded-lg p-2 text-xs gap-2.5${mode === "raw" ? " text-destructive hover:bg-destructive/10" : ""}`}
                data-mode={mode}
                disabled={mode !== "backup" && !targetReady}
                onSelect={() => {
                  onExport(mode);
                }}
              >
                <Icon name={exportIcons[mode]} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 font-medium">
                    <span>{t(`project.exportMenu.${mode}`)}</span>
                    {mode === "example" && (
                      <span className="bg-primary/10 text-primary rounded px-1.5 text-[10px] font-semibold">
                        {t("project.exportMenu.recommended")}
                      </span>
                    )}
                  </div>
                  <small className="text-muted-foreground mt-0.5 block text-xs">
                    {t(`project.exportMenu.${mode}Desc`)}
                  </small>
                </div>
              </DropdownMenuItem>
            </Fragment>
          ))}
        </DropdownMenuContent>
      </div>
    </DropdownMenu>
    <Button
      variant="default"
      size="sm"
      type="button"
      className="h-10 gap-2 px-4 text-[13px] font-medium"
      id="newBtn"
      aria-label={t("project.newSecret")}
      title={t("project.newSecret")}
      disabled={!targetReady}
      onClick={onNewSecret}
    >
      <Icon name="plus" />
      <span className="btn-label-collapsible">{t("project.newSecret")}</span>
    </Button>
  </div>
);
