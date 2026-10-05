import { Fragment } from "react";

import { i18n } from "../renderer/i18n";
import { Button } from "../renderer/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../renderer/ui/dropdown-menu";
import { Input } from "../renderer/ui/input";
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
  <div className="secrets-toolbar">
    <div className="secrets-search">
      <Icon name="search" />
      <Input
        type="search"
        id="searchInput"
        className="secrets-search-input"
        placeholder={t("project.searchPlaceholder")}
        aria-label={t("project.a11y.searchLabel")}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <span className="secrets-search-kbd" aria-hidden="true">
        /
      </span>
    </div>
    <DropdownMenu
      open={menu === "filter"}
      onOpenChange={(open) => setMenu(open ? "filter" : null)}
    >
      <div className="dropdown" id="filterDropdown">
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            size="icon"
            type="button"
            className="sl-btn sl-btn-icon"
            id="filterBtn"
            aria-expanded={menu === "filter"}
            title={t("project.filter")}
            aria-label={t("project.filter")}
          >
            <Icon name="sliders-horizontal" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="dropdown-menu"
          id="filterMenu"
          align="start"
        >
          <p className="dropdown-label">{t("project.filterMenu.typeLabel")}</p>
          <DropdownMenuRadioGroup
            value={filterType}
            onValueChange={setFilterType}
          >
            {(["all", "secret", "config"] as const).map((value) => (
              <DropdownMenuRadioItem
                className="dropdown-item"
                key={value}
                value={value}
              >
                <span className="item-text">
                  {t(
                    `project.filterMenu.type${value.charAt(0).toUpperCase()}${value.slice(1)}`
                  )}
                </span>
                {filterType === value && <Icon name="check" />}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <p className="dropdown-label">
            {t("project.filterMenu.statusLabel")}
          </p>
          <DropdownMenuRadioGroup
            value={filterStatus}
            onValueChange={setFilterStatus}
          >
            {statusOptions.map(([value, label]) => (
              <DropdownMenuRadioItem
                className="dropdown-item"
                key={value}
                value={value}
              >
                <span className="item-text">{t(label)}</span>
                {filterStatus === value && <Icon name="check" />}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator className="dropdown-separator" />
          <DropdownMenuItem
            className="dropdown-item"
            onSelect={() => {
              setFilterType("all");
              setFilterStatus("all");
            }}
          >
            <span className="item-text">{t("project.filterMenu.clear")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </div>
    </DropdownMenu>
    <span className="spacer" />
    <Button
      variant="secondary"
      type="button"
      className="sl-btn sl-btn-secondary"
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
      <div className="dropdown" id="exportDropdown">
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            type="button"
            className="sl-btn sl-btn-secondary"
            id="exportBtn"
            aria-expanded={menu === "export"}
          >
            <Icon name="download" />
            <span>{t("project.exportEnv")}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="dropdown-menu dropdown-menu-left"
          id="exportMenu"
          align="end"
        >
          {(["example", "references", "backup", "raw"] as const).map((mode) => (
            <Fragment key={mode}>
              {mode === "raw" && (
                <DropdownMenuSeparator className="dropdown-separator" />
              )}
              <DropdownMenuItem
                className={`dropdown-item${mode === "raw" ? " danger" : ""}`}
                data-mode={mode}
                disabled={mode !== "backup" && !targetReady}
                onSelect={() => {
                  onExport(mode);
                }}
              >
                <Icon name={exportIcons[mode]} />
                <span className="item-text">
                  {t(`project.exportMenu.${mode}`)}
                  {mode === "example" && (
                    <span className="rec-badge">
                      {t("project.exportMenu.recommended")}
                    </span>
                  )}
                  <small>{t(`project.exportMenu.${mode}Desc`)}</small>
                </span>
              </DropdownMenuItem>
            </Fragment>
          ))}
        </DropdownMenuContent>
      </div>
    </DropdownMenu>
    <Button
      variant="default"
      type="button"
      className="sl-btn sl-btn-primary"
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
