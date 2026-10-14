import logoUrl from "../assets/icon.png";
import { i18n } from "../renderer/i18n";
import { Button } from "../renderer/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../renderer/ui/dropdown-menu";
import { cn } from "../renderer/ui/utils";
import type { ProjectRecord } from "./bridge";
import { Icon } from "./components";
import { relative } from "./secret-presentation";

export type ProjectView = "all" | "attention" | "recent" | "favorites";
interface ProjectSidebarProps {
  indexOpen: boolean;
  onToggle: () => void;
  nav: (href: string) => void;
  view: ProjectView;
  setView: (view: ProjectView) => void;
  totalCount: number;
  attention: number;
  favoriteCount: number;
  syncAt: number;
}
const t = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars);
const viewItems = [
  { icon: "list", label: "project.sidebar.viewAll", value: "all" },
  {
    icon: "circle-alert",
    label: "project.sidebar.viewAttention",
    value: "attention",
  },
  { icon: "clock", label: "project.sidebar.viewRecent", value: "recent" },
  { icon: "star", label: "project.sidebar.viewFavorites", value: "favorites" },
] as const;
export const ProjectSidebar = ({
  indexOpen,
  onToggle,
  nav,
  view,
  setView,
  totalCount,
  attention,
  favoriteCount,
  syncAt,
}: ProjectSidebarProps) => {
  const viewCounts = {
    all: totalCount,
    attention,
    favorites: favoriteCount,
    recent: null,
  };
  return (
    <aside
      className={cn(
        "bg-card/60 border-border secrets-index flex h-full shrink-0 flex-col border-r p-3 transition-all",
        indexOpen ? "is-expanded w-[232px]" : "is-collapsed w-[80px]"
      )}
      id="indexPanel"
      aria-label={t("project.a11y.indexLabel")}
    >
      <div className="secrets-brand mb-2 flex items-center gap-3 px-2 py-3">
        <img src={logoUrl} alt="" className="size-8 shrink-0 rounded-lg" />
        <span className="text-foreground sidebar-brand-label flex-1 truncate text-sm font-semibold tracking-tight">
          KeyHarbor
        </span>
        <Button
          variant="ghost"
          size="icon"
          type="button"
          className="text-muted-foreground hover:text-foreground sidebar-expand-toggle size-7 shrink-0 rounded-lg"
          aria-label={t(
            indexOpen ? "project.sidebar.collapse" : "project.sidebar.expand"
          )}
          title={t(
            indexOpen ? "project.sidebar.collapse" : "project.sidebar.expand"
          )}
          aria-expanded={indexOpen}
          aria-controls="indexPanel"
          onClick={onToggle}
        >
          <Icon name={indexOpen ? "arrow-left" : "arrow-right"} />
        </Button>
      </div>
      <nav
        className="secrets-nav mb-4 space-y-1"
        aria-label={t("project.a11y.primaryNav")}
      >
        <Button
          variant="secondary"
          size="sm"
          type="button"
          className="bg-secondary text-foreground h-8 w-full justify-start gap-2.5 px-2.5 text-xs font-medium"
          aria-current="page"
          title={t("project.sidebar.navSecrets")}
        >
          <Icon name="key" />
          <span>{t("project.sidebar.navSecrets")}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          className="text-muted-foreground hover:text-foreground h-8 w-full justify-start gap-2.5 px-2.5 text-xs font-medium"
          id="navActivity"
          title={t("project.sidebar.navActivity")}
          onClick={() => nav("logs.html")}
        >
          <Icon name="clock" />
          <span>{t("project.sidebar.navActivity")}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          className="text-muted-foreground hover:text-foreground h-8 w-full justify-start gap-2.5 px-2.5 text-xs font-medium"
          id="navSettings"
          title={t("project.sidebar.navSettings")}
          onClick={() => nav("settings.html")}
        >
          <Icon name="settings" />
          <span>{t("project.sidebar.navSettings")}</span>
        </Button>
      </nav>
      <p className="text-muted-foreground secrets-index-label mb-1.5 px-2.5 text-[10px] font-semibold tracking-wider uppercase">
        {t("project.sidebar.viewsLabel")}
      </p>
      <section
        className="secrets-views flex-1 space-y-1"
        id="viewsList"
        aria-label={t("project.a11y.viewsLabel")}
      >
        {viewItems.map(({ value: item, label, icon }) => {
          const count = viewCounts[item];
          const isSelected = view === item;
          return (
            <Button
              variant={isSelected ? "secondary" : "ghost"}
              size="sm"
              type="button"
              key={item}
              className={cn(
                "h-8 w-full justify-start gap-2.5 px-2.5 text-xs font-medium",
                isSelected
                  ? "bg-primary/10 text-primary font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
              aria-pressed={isSelected}
              title={t(label)}
              aria-label={t(label)}
              onClick={() => setView(item)}
            >
              <Icon name={icon} />
              <span className="view-label flex-1 truncate text-left">
                {t(label)}
              </span>
              {count !== null && (
                <span className="view-count py-0.2 bg-secondary text-muted-foreground rounded-md px-1.5 font-mono text-[11px]">
                  {count}
                </span>
              )}
            </Button>
          );
        })}
      </section>
      <div className="border-border/50 text-muted-foreground secrets-sync flex items-center gap-2 border-t px-2 py-3 text-xs">
        <span
          className="secrets-sync-dot size-2 shrink-0 rounded-full bg-emerald-400"
          aria-hidden="true"
        />
        <span
          id="syncLabel"
          className="sidebar-sync-label truncate text-[11px]"
        >
          {t("project.sidebar.synced", {
            time: relative(new Date(syncAt).toISOString()),
          })}
        </span>
      </div>
    </aside>
  );
};

export const ProjectSwitcher = ({
  menu,
  setMenu,
  projectName,
  switcherProjects,
  nav,
}: {
  menu: string | null;
  setMenu: (menu: string | null) => void;
  projectName: string;
  switcherProjects: ProjectRecord[];
  nav: (href: string) => void;
}) => (
  <DropdownMenu
    open={menu === "switcher"}
    onOpenChange={(open) => setMenu(open ? "switcher" : null)}
  >
    <div className="dropdown relative" id="switcherDropdown">
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          type="button"
          className="border-border/60 bg-card/60 hover:bg-secondary secrets-switcher flex h-9 items-center gap-2 rounded-lg border px-3 text-left"
          id="switcherBtn"
          aria-expanded={menu === "switcher"}
        >
          <span className="flex flex-col text-left">
            <small className="text-muted-foreground font-mono text-[10px] leading-none uppercase">
              {t("project.sidebar.projectLabel")}
            </small>
            <strong
              id="switcherName"
              className="text-foreground max-w-[140px] truncate text-xs leading-tight font-semibold"
            >
              {projectName || "–"}
            </strong>
          </span>
          <Icon name="chevron-down" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="bg-card border-border min-w-[200px] rounded-xl border p-1 shadow-xl"
        id="switcherMenu"
        align="start"
      >
        {switcherProjects.map((project) => (
          <DropdownMenuItem
            className="hover:bg-secondary flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs"
            key={project.name}
            onSelect={() =>
              nav(`project.html?name=${encodeURIComponent(project.name)}`)
            }
          >
            <span className="item-text truncate">{project.name}</span>
          </DropdownMenuItem>
        ))}
        {switcherProjects.length > 0 && (
          <DropdownMenuSeparator className="border-border my-1 border-t" />
        )}
        <DropdownMenuItem
          className="hover:bg-secondary flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs"
          onSelect={() => nav("dashboard.html")}
        >
          <span className="item-text">{t("project.sidebar.allProjects")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </div>
  </DropdownMenu>
);
