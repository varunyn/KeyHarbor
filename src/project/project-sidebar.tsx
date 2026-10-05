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
      className={`secrets-index${indexOpen ? " is-expanded" : " is-collapsed"}`}
      id="indexPanel"
      aria-label={t("project.a11y.indexLabel")}
    >
      <div className="secrets-brand">
        <img src={logoUrl} alt="" />
        <span className="sidebar-brand-label">KeyHarbor</span>
        <Button
          variant="ghost"
          type="button"
          className="sidebar-expand-toggle"
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
      <nav className="secrets-nav" aria-label={t("project.a11y.primaryNav")}>
        <Button
          variant="ghost"
          type="button"
          aria-current="page"
          title={t("project.sidebar.navSecrets")}
        >
          <Icon name="key" />
          <span>{t("project.sidebar.navSecrets")}</span>
        </Button>
        <Button
          variant="ghost"
          type="button"
          id="navActivity"
          title={t("project.sidebar.navActivity")}
          onClick={() => nav("logs.html")}
        >
          <Icon name="clock" />
          <span>{t("project.sidebar.navActivity")}</span>
        </Button>
        <Button
          variant="ghost"
          type="button"
          id="navSettings"
          title={t("project.sidebar.navSettings")}
          onClick={() => nav("settings.html")}
        >
          <Icon name="settings" />
          <span>{t("project.sidebar.navSettings")}</span>
        </Button>
      </nav>
      <p className="secrets-index-label">{t("project.sidebar.viewsLabel")}</p>
      <section
        className="secrets-views"
        id="viewsList"
        aria-label={t("project.a11y.viewsLabel")}
      >
        {viewItems.map(({ value: item, label, icon }) => {
          const count = viewCounts[item];
          return (
            <Button
              variant="ghost"
              type="button"
              key={item}
              aria-pressed={view === item}
              title={t(label)}
              aria-label={t(label)}
              onClick={() => setView(item)}
            >
              <Icon name={icon} />
              <span className="view-label">{t(label)}</span>
              {count !== null && <span className="view-count">{count}</span>}
            </Button>
          );
        })}
      </section>
      <div className="secrets-sync">
        <span className="secrets-sync-dot" aria-hidden="true" />
        <span id="syncLabel" className="sidebar-sync-label">
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
    <div className="dropdown" id="switcherDropdown">
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          type="button"
          className="secrets-switcher"
          id="switcherBtn"
          aria-expanded={menu === "switcher"}
        >
          <span className="secrets-switcher-text">
            <small>{t("project.sidebar.projectLabel")}</small>
            <strong id="switcherName">{projectName || "–"}</strong>
          </span>
          <Icon name="chevron-down" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="dropdown-menu"
        id="switcherMenu"
        align="start"
      >
        {switcherProjects.map((project) => (
          <DropdownMenuItem
            className="dropdown-item"
            key={project.name}
            onSelect={() =>
              nav(`project.html?name=${encodeURIComponent(project.name)}`)
            }
          >
            <span className="item-text">{project.name}</span>
          </DropdownMenuItem>
        ))}
        {switcherProjects.length > 0 && (
          <DropdownMenuSeparator className="dropdown-separator" />
        )}
        <DropdownMenuItem
          className="dropdown-item"
          onSelect={() => nav("dashboard.html")}
        >
          <span className="item-text">{t("project.sidebar.allProjects")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </div>
  </DropdownMenu>
);
