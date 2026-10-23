import React from "react";

import { Button } from "../renderer/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../renderer/ui/dropdown-menu";
import { Input } from "../renderer/ui/input";
import { topBarClass } from "../renderer/ui/nav-bar";
import { SidebarToggle } from "../renderer/ui/sidebar-toggle";
import { cn } from "../renderer/ui/utils";
import { Icon, t } from "./dashboard-display";
import type { DashboardController } from "./use-dashboard";

type Props = Pick<
  DashboardController,
  | "sidebarOpen"
  | "toggleSidebar"
  | "searchRef"
  | "search"
  | "setSearch"
  | "actionBusy"
  | "lock"
  | "menu"
  | "setMenu"
  | "cliReady"
  | "cliInstalled"
  | "navigate"
  | "openDialog"
> & { onCli: DashboardController["handleCli"] };

export const DashboardHeader = ({
  sidebarOpen,
  toggleSidebar,
  searchRef,
  search,
  setSearch,
  actionBusy,
  lock,
  menu,
  setMenu,
  cliReady,
  cliInstalled,
  onCli,
  navigate,
  openDialog,
}: Props) => {
  const cliActionLabel = () => {
    if (actionBusy === "cli-install") {
      return t("dashboard.installing");
    }
    if (actionBusy === "cli-uninstall") {
      return t("dashboard.uninstalling");
    }
    return t(
      cliReady && cliInstalled
        ? "dashboard.uninstallCli"
        : "dashboard.installCli"
    );
  };

  return (
    <header className={cn("dash-topbar", topBarClass)}>
      <div className="flex min-w-0 shrink-0 items-center gap-3">
        <SidebarToggle expanded={sidebarOpen} onToggle={toggleSidebar} />
        <nav
          className="dash-crumbs text-muted-foreground flex min-w-0 items-center gap-2 text-[13px]"
          aria-label={t("dashboard.a11y.crumbsLabel")}
        >
          <span className="shrink-0">{t("dashboard.crumbsVault")}</span>
          <span aria-hidden="true" className="opacity-40">
            /
          </span>
          <span aria-current="page" className="text-foreground truncate">
            {t("dashboard.title")}
          </span>
        </nav>
      </div>
      <div className="dash-search relative mx-auto max-w-[420px] min-w-[120px] flex-1">
        <Icon
          name="search"
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
        />
        <Input
          ref={searchRef}
          type="search"
          id="search-input"
          placeholder={t("dashboard.searchPlaceholder")}
          aria-label={t("dashboard.a11y.searchLabel")}
          autoComplete="off"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="bg-secondary/50 border-border h-10 pr-14 pl-9 text-[13px]"
        />
        <kbd className="dash-search-kbd text-muted-foreground border-border/80 bg-background/50 pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded border px-1.5 py-0.5 font-mono text-[10px]">
          ⌘K
        </kbd>
      </div>
      <div className="dash-toolbar flex shrink-0 items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          type="button"
          className="dh-btn dh-btn-secondary h-10 gap-2 px-4 text-[13px] font-medium"
          id="lock-btn"
          disabled={actionBusy !== null}
          onClick={() => lock()}
        >
          <Icon name="lock" />
          <span>{t("dashboard.lock")}</span>
        </Button>
        <DropdownMenu
          open={menu === "actions"}
          onOpenChange={(open) => setMenu(open ? "actions" : null)}
        >
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              size="icon"
              type="button"
              className="dh-btn-icon size-10"
              id="settings-dropdown-btn"
              aria-label={t("dashboard.a11y.menuLabel")}
            >
              <Icon name="ellipsis" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="bg-card border-border min-w-[200px] rounded-xl border p-1.5 shadow-xl"
          >
            <DropdownMenuItem
              id="install-cli-btn"
              className="hover:bg-secondary flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px]"
              disabled={!cliReady || actionBusy !== null}
              onSelect={() => onCli(cliInstalled ? "uninstall" : "install")}
            >
              <Icon name="download" className="text-muted-foreground" />
              <span>{cliActionLabel()}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              id="settings-btn"
              className="hover:bg-secondary flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px]"
              onSelect={() => navigate("settings")}
            >
              <Icon name="settings" className="text-muted-foreground" />
              <span>{t("dashboard.settings")}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="default"
          size="sm"
          type="button"
          className="dh-btn dh-btn-primary h-10 gap-2 px-4 text-[13px] font-medium"
          id="add-project-btn"
          aria-label={t("dashboard.addProject")}
          title={t("dashboard.addProject")}
          disabled={actionBusy !== null}
          onClick={(event) => openDialog("project", event.currentTarget)}
        >
          <Icon name="plus" />
          <span className="btn-label-collapsible max-[860px]:hidden">
            {t("dashboard.addProject")}
          </span>
        </Button>
      </div>
    </header>
  );
};
