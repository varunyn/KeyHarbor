import type React from "react";

import logoUrl from "../assets/icon.png";
import type { VaultListEntry } from "../project/bridge";
import { Button } from "../renderer/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../renderer/ui/dropdown-menu";
import { cn } from "../renderer/ui/utils";
import { nativeWindowStyles } from "../renderer/window-chrome";
import { formatAccessTime, Icon, t } from "./dashboard-display";
import type { DialogForm, DialogKind } from "./dashboard-types";

type VaultSwitcherProps = Pick<
  DashboardSidebarProps,
  | "sidebarOpen"
  | "menu"
  | "setMenu"
  | "loadVaults"
  | "activeVault"
  | "vaults"
  | "switchVault"
  | "openDialog"
  | "removeVault"
  | "openCreateVault"
  | "openImportVault"
  | "dialogStateRef"
>;

const VaultSwitcher = ({
  sidebarOpen,
  menu,
  setMenu,
  loadVaults,
  activeVault,
  vaults,
  switchVault,
  openDialog,
  removeVault,
  openCreateVault,
  openImportVault,
  dialogStateRef,
}: VaultSwitcherProps) => (
  <div
    className={cn(
      "dash-vault-switcher",
      sidebarOpen ? "mb-2.5 w-full" : "my-1 flex w-full justify-center"
    )}
  >
    <DropdownMenu
      open={menu === "vaults" || menu?.startsWith("vault:")}
      onOpenChange={(open) => {
        if (open) {
          loadVaults();
        }
        setMenu(open ? "vaults" : null);
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          type="button"
          className={cn(
            "dash-vault-btn border-border/70 border transition-colors",
            sidebarOpen
              ? "bg-secondary/50 hover:bg-secondary flex h-auto min-h-[46px] w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left"
              : "bg-secondary/60 hover:bg-secondary text-foreground relative flex size-10 items-center justify-center rounded-xl p-0"
          )}
          id="vault-dropdown-btn"
          title={`${t("dashboard.crumbsVault")}: ${activeVault?.name ?? t("dashboard.vaultDefault")}`}
          aria-label={`${t("dashboard.crumbsVault")}: ${activeVault?.name ?? t("dashboard.vaultDefault")}`}
        >
          {sidebarOpen ? (
            <>
              <span className="dash-vault-text min-w-0 flex-1">
                <small className="text-muted-foreground block text-[11px] leading-none font-semibold tracking-wider uppercase">
                  {t("dashboard.crumbsVault")}
                </small>
                <strong
                  id="vault-dropdown-name"
                  className="text-foreground mt-0.5 block truncate text-sm leading-tight font-semibold"
                >
                  {activeVault?.name ?? t("dashboard.vaultDefault")}
                </strong>
              </span>
              <Icon
                name="chevron-down"
                className="text-muted-foreground size-3.5 shrink-0"
              />
            </>
          ) : (
            <>
              <Icon name="vault" className="text-foreground size-4.5" />
              <span id="vault-dropdown-name" className="sr-only">
                {activeVault?.name ?? t("dashboard.vaultDefault")}
              </span>
              <span className="bg-muted-foreground/60 absolute right-1.5 bottom-1.5 size-1.5 rounded-full" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={sidebarOpen ? "start" : "center"}
        side="right"
        sideOffset={8}
        className="dash-vault-menu bg-card border-border min-w-[220px] rounded-xl border p-1.5 shadow-xl"
        id="vault-dropdown-menu"
        onCloseAutoFocus={(event) => {
          if (dialogStateRef.current !== null || !document.hasFocus()) {
            event.preventDefault();
          }
        }}
      >
        <div
          id="vault-dropdown-list"
          className="dash-vault-list max-h-[260px] space-y-0.5 overflow-y-auto"
        >
          {vaults.map((vault) => (
            <div
              key={vault.id}
              className={cn(
                "vault-dropdown-row group flex min-w-0 items-center rounded-lg",
                vault.isActive && "active bg-primary/10",
                vault.status === "offline" && "offline opacity-60"
              )}
            >
              <DropdownMenuItem
                className={cn(
                  "dash-vault-item min-w-0 flex-1 cursor-pointer rounded-lg px-2.5 py-2 text-xs",
                  vault.isActive && "active text-primary font-medium",
                  vault.status === "offline" && "offline"
                )}
                disabled={vault.status === "offline"}
                onSelect={() => switchVault(vault)}
              >
                <span className="dropdown-item-left flex min-w-0 flex-1 items-center gap-2">
                  {vault.status === "offline" && (
                    <Icon
                      name="circle-alert"
                      className="dropdown-item-icon status-offline text-warning size-3.5 shrink-0"
                    />
                  )}
                  <span
                    className={cn(
                      "dropdown-item-name truncate",
                      vault.isActive && "active text-primary font-medium"
                    )}
                  >
                    {vault.name}
                  </span>
                </span>
              </DropdownMenuItem>
              {!vault.isSystem && (
                <DropdownMenuSub
                  open={menu === `vault:${vault.id}`}
                  onOpenChange={(open) =>
                    setMenu((current) => {
                      if (open) {
                        return `vault:${vault.id}`;
                      }
                      return current === `vault:${vault.id}`
                        ? "vaults"
                        : current;
                    })
                  }
                >
                  <DropdownMenuSubTrigger
                    className="dropdown-item-context-btn text-muted-foreground hover:text-foreground flex size-8 items-center justify-center rounded-lg p-0"
                    aria-label={`${vault.name} ${t("dashboard.a11y.menuLabel")}`}
                  >
                    <Icon name="ellipsis" />
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="dash-vault-context-menu bg-card border-border min-w-[140px] rounded-xl border p-1 shadow-xl">
                    <DropdownMenuItem
                      className="cursor-pointer px-2.5 py-1.5 text-xs"
                      onSelect={() => {
                        openDialog(
                          "rename-vault",
                          document.querySelector<HTMLElement>(
                            "#vault-dropdown-btn"
                          ),
                          {
                            renameVaultId: vault.id,
                            vaultName: vault.name,
                          }
                        );
                      }}
                    >
                      {t("vault.context.rename")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive cursor-pointer px-2.5 py-1.5 text-xs"
                      onSelect={() => removeVault(vault)}
                    >
                      {t("vault.context.remove")}
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
            </div>
          ))}
        </div>
        <DropdownMenuSeparator className="dash-vault-separator bg-border my-1" />
        <DropdownMenuItem
          id="vault-new-btn"
          className="dash-vault-item cursor-pointer gap-1.5 rounded-lg px-2.5 py-2 text-xs"
          onSelect={() =>
            openCreateVault(
              document.querySelector<HTMLElement>("#vault-dropdown-btn")
            )
          }
        >
          <Icon name="plus" />
          {t("vault.selector.newVault")}
        </DropdownMenuItem>
        <DropdownMenuItem
          id="vault-import-btn"
          className="dash-vault-item cursor-pointer gap-1.5 rounded-lg px-2.5 py-2 text-xs"
          onSelect={() =>
            openImportVault(
              document.querySelector<HTMLElement>("#vault-dropdown-btn")
            )
          }
        >
          <Icon name="folder" />
          {t("vault.selector.importVault")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
);

interface DashboardSidebarProps {
  sidebarOpen: boolean;
  menu: string | null;
  setMenu: React.Dispatch<React.SetStateAction<string | null>>;
  loadVaults: () => void;
  activeVault: VaultListEntry | null;
  vaults: VaultListEntry[];
  switchVault: (vault: VaultListEntry) => void;
  openDialog: (
    kind: Exclude<DialogKind, null>,
    trigger?: HTMLElement | null,
    initial?: Partial<DialogForm>
  ) => void;
  removeVault: (vault: VaultListEntry) => void;
  openCreateVault: (trigger?: HTMLElement | null) => void;
  openImportVault: (trigger?: HTMLElement | null) => void;
  projectsCount: number;
  navigate: (page: "settings" | "logs") => void;
  syncAt: number;
  now: number;
  dialogStateRef: React.MutableRefObject<DialogKind>;
}

export const DashboardSidebar = ({
  sidebarOpen,
  menu,
  setMenu,
  loadVaults,
  activeVault,
  vaults,
  switchVault,
  openDialog,
  removeVault,
  openCreateVault,
  openImportVault,
  projectsCount,
  navigate,
  syncAt,
  now,
  dialogStateRef,
}: DashboardSidebarProps) => (
  <aside
    className={cn(
      nativeWindowStyles.sidebar,
      "dash-index bg-card border-border relative z-50 flex shrink-0 flex-col border-r transition-[width,transform] duration-200 ease-out max-[860px]:fixed max-[860px]:inset-y-0 max-[860px]:left-0 max-[860px]:z-50 max-[860px]:shadow-2xl",
      sidebarOpen
        ? "w-[var(--ui-sidebar-width)] p-3 max-[860px]:w-[var(--ui-sidebar-width)] max-[860px]:translate-x-0"
        : "is-collapsed items-center p-2 max-[860px]:-translate-x-full min-[861px]:w-[64px]"
    )}
    id="indexPanel"
    aria-label={t("dashboard.a11y.indexLabel")}
  >
    <div
      className={cn(
        "dash-brand flex items-center gap-2",
        sidebarOpen ? "mb-3 px-1 py-0.5" : "mb-1 flex-col px-0 py-0.5"
      )}
    >
      <img src={logoUrl} alt="" className="size-8 shrink-0 rounded-lg" />
      {sidebarOpen && (
        <span className="text-foreground flex-1 truncate text-sm font-semibold tracking-tight">
          KeyHarbor
        </span>
      )}
    </div>
    {!sidebarOpen && <div className="border-border/60 my-1 w-7 border-t" />}
    <VaultSwitcher
      sidebarOpen={sidebarOpen}
      menu={menu}
      setMenu={setMenu}
      loadVaults={loadVaults}
      activeVault={activeVault}
      vaults={vaults}
      switchVault={switchVault}
      openDialog={openDialog}
      removeVault={removeVault}
      openCreateVault={openCreateVault}
      openImportVault={openImportVault}
      dialogStateRef={dialogStateRef}
    />
    {!sidebarOpen && <div className="border-border/60 my-1 w-7 border-t" />}
    <nav
      className={cn(
        "dash-nav my-1 flex flex-col gap-1",
        sidebarOpen ? "w-full" : "w-full items-center"
      )}
      aria-label={t("dashboard.a11y.primaryNav")}
    >
      <Button
        variant="ghost"
        size="sm"
        type="button"
        className={cn(
          nativeWindowStyles.selectedNavigation,
          "bg-primary/10 text-primary hover:bg-primary/15 flex rounded-lg font-semibold transition-colors",
          sidebarOpen
            ? "h-9 w-full items-center justify-start gap-2.5 px-2.5 text-sm"
            : "relative size-10 items-center justify-center p-0"
        )}
        aria-current="page"
        aria-label={`${t("dashboard.sidebar.navProjects")} (${projectsCount})`}
        title={`${t("dashboard.sidebar.navProjects")} (${projectsCount})`}
      >
        <Icon name="folder" className={sidebarOpen ? "size-4" : "size-4.5"} />
        {sidebarOpen && (
          <>
            <span className="flex-1 text-left">
              {t("dashboard.sidebar.navProjects")}
            </span>
            <span className="dash-nav-count bg-primary/15 text-primary rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold">
              {projectsCount}
            </span>
          </>
        )}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        type="button"
        id="navActivity"
        className={cn(
          "text-muted-foreground hover:text-foreground hover:bg-secondary flex rounded-lg font-medium transition-colors",
          sidebarOpen
            ? "h-9 w-full items-center justify-start gap-2.5 px-2.5 text-sm"
            : "size-10 items-center justify-center p-0"
        )}
        title={t("dashboard.sidebar.navActivity")}
        aria-label={t("dashboard.sidebar.navActivity")}
        onClick={() => navigate("logs")}
      >
        <Icon name="clock" className={sidebarOpen ? "size-4" : "size-4.5"} />
        {sidebarOpen && (
          <span className="flex-1 text-left">
            {t("dashboard.sidebar.navActivity")}
          </span>
        )}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        type="button"
        id="navSettings"
        className={cn(
          "text-muted-foreground hover:text-foreground hover:bg-secondary flex rounded-lg font-medium transition-colors",
          sidebarOpen
            ? "h-9 w-full items-center justify-start gap-2.5 px-2.5 text-sm"
            : "size-10 items-center justify-center p-0"
        )}
        title={t("dashboard.sidebar.navSettings")}
        aria-label={t("dashboard.sidebar.navSettings")}
        onClick={() => navigate("settings")}
      >
        <Icon name="settings" className={sidebarOpen ? "size-4" : "size-4.5"} />
        {sidebarOpen && (
          <span className="flex-1 text-left">
            {t("dashboard.sidebar.navSettings")}
          </span>
        )}
      </Button>
    </nav>
    <div
      className={cn(
        "dash-sync border-border/50 bg-secondary/30 text-muted-foreground mt-auto flex items-center rounded-xl border transition-colors",
        sidebarOpen ? "gap-2.5 p-2 text-xs" : "size-8 justify-center p-0"
      )}
      title={`${t("dashboard.sidebar.unlocked")} — ${t(
        "dashboard.sidebar.synced",
        {
          time: formatAccessTime(syncAt, now),
        }
      )}`}
    >
      <span
        className="dash-sync-dot bg-success size-2 shrink-0 animate-pulse rounded-full"
        aria-hidden="true"
      />
      {sidebarOpen ? (
        <span className="dash-sync-text truncate">
          {t("dashboard.sidebar.unlocked")}
          <small
            id="syncLabel"
            className="text-muted-foreground/80 block text-xs"
          >
            {t("dashboard.sidebar.synced", {
              time: formatAccessTime(syncAt, now),
            })}
          </small>
        </span>
      ) : (
        <span id="syncLabel" className="sr-only">
          {t("dashboard.sidebar.synced", {
            time: formatAccessTime(syncAt, now),
          })}
        </span>
      )}
    </div>
  </aside>
);
