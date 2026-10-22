import { Clock, Folder, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect } from "react";

import logoUrl from "../assets/icon.png";
import { useRendererTranslation } from "./providers";
import { Button } from "./ui/button";
import { AppTopBar, CrumbSeparator, crumbsClass } from "./ui/nav-bar";
import { SidebarToggle } from "./ui/sidebar-toggle";
import { cn } from "./ui/utils";
import { closeNarrowSidebar, useSidebarState } from "./use-sidebar-state";
import { nativeWindowStyles } from "./window-chrome";

const navigation = [
  {
    href: "dashboard.html",
    icon: Folder,
    label: "dashboard.sidebar.navProjects",
    page: "projects",
  },
  {
    href: "logs.html",
    icon: Clock,
    label: "dashboard.sidebar.navActivity",
    page: "activity",
  },
  {
    href: "settings.html",
    icon: Settings,
    label: "dashboard.sidebar.navSettings",
    page: "settings",
  },
] as const;

export const WorkspaceShell = ({
  activePage,
  title,
  actions,
  children,
  searchInputId,
}: {
  activePage: "projects" | "activity" | "settings";
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  searchInputId?: string;
}) => {
  const { t } = useRendererTranslation();
  const { open, toggleSidebar, closeSidebar } = useSidebarState();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        document.querySelector('[role="dialog"], [role="alertdialog"]')
      ) {
        return;
      }
      if (event.key === "Escape") {
        closeNarrowSidebar();
      } else if (
        searchInputId &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        document
          .querySelector<HTMLElement>(`#${CSS.escape(searchInputId)}`)
          ?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchInputId]);
  return (
    <div
      className={cn(
        "bg-background text-foreground flex h-dvh overflow-hidden font-sans",
        nativeWindowStyles.canvas
      )}
    >
      <aside
        id="indexPanel"
        aria-label={t("dashboard.a11y.indexLabel")}
        className={cn(
          nativeWindowStyles.sidebar,
          "bg-card border-border relative z-50 flex h-full shrink-0 flex-col border-r transition-[width,transform] duration-200 ease-out max-[860px]:fixed max-[860px]:inset-y-0 max-[860px]:left-0 max-[860px]:shadow-2xl",
          open
            ? "w-[var(--ui-sidebar-width)] p-3 max-[860px]:translate-x-0"
            : "items-center p-2 max-[860px]:-translate-x-full min-[861px]:w-[64px]"
        )}
      >
        <div
          className={cn(
            "flex items-center gap-2",
            open ? "mb-3 w-full px-1 py-0.5" : "mb-1 flex-col px-0 py-0.5"
          )}
        >
          <img src={logoUrl} alt="" className="size-8 shrink-0 rounded-lg" />
          {open && (
            <span className="text-foreground flex-1 truncate text-sm font-semibold tracking-tight">
              KeyHarbor
            </span>
          )}
        </div>
        {!open && (
          <div
            className="border-border/60 my-1 w-7 border-t"
            aria-hidden="true"
          />
        )}
        <nav
          aria-label={t("dashboard.a11y.primaryNav")}
          className={cn(
            "my-1 flex w-full flex-col gap-1",
            !open && "items-center"
          )}
        >
          {navigation.map(({ href, icon: Icon, label, page }) => (
            <Button
              key={page}
              variant="ghost"
              size="sm"
              asChild
              className={cn(
                "flex rounded-lg no-underline transition-colors hover:no-underline",
                open
                  ? "h-9 w-full justify-start gap-2.5 px-2.5 text-sm"
                  : "relative size-10 justify-center p-0",
                activePage === page
                  ? cn(
                      "bg-primary/10 text-primary hover:bg-primary/15 font-semibold",
                      nativeWindowStyles.selectedNavigation
                    )
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary font-medium"
              )}
            >
              <a
                href={href}
                title={t(label)}
                aria-label={t(label)}
                aria-current={activePage === page ? "page" : undefined}
              >
                <Icon
                  className={open ? "size-4" : "size-4.5"}
                  aria-hidden="true"
                />
                {open && (
                  <span className="flex-1 truncate text-left">{t(label)}</span>
                )}
              </a>
            </Button>
          ))}
        </nav>
      </aside>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-xs min-[861px]:hidden"
        hidden={!open}
        aria-label={t("project.sidebar.collapse")}
        onClick={closeSidebar}
      />
      <main className="bg-background flex min-w-0 flex-1 flex-col overflow-hidden">
        <AppTopBar
          left={
            <>
              <SidebarToggle expanded={open} onToggle={toggleSidebar} />
              <nav
                className={crumbsClass}
                aria-label={t("dashboard.a11y.crumbsLabel")}
              >
                <span className="shrink-0">{t("dashboard.crumbsVault")}</span>
                <CrumbSeparator />
                <span className="text-foreground truncate" aria-current="page">
                  {title}
                </span>
              </nav>
            </>
          }
          right={actions}
        />
        {children}
      </main>
    </div>
  );
};
