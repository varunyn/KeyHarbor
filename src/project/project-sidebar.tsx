import logoUrl from "../assets/icon.png";
import { i18n } from "../renderer/i18n";
import { Button } from "../renderer/ui/button";
import { cn } from "../renderer/ui/utils";
import { nativeWindowStyles } from "../renderer/window-chrome";
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

const railButtonClass = (indexOpen: boolean, selected: boolean) =>
  cn(
    "flex transition-colors",
    selected
      ? "bg-primary/10 text-primary hover:bg-primary/15 font-semibold"
      : "text-muted-foreground hover:text-foreground hover:bg-secondary font-medium",
    indexOpen
      ? "h-9 w-full items-center justify-start gap-2.5 rounded-lg px-2.5 text-xs"
      : "relative size-10 items-center justify-center rounded-xl p-0"
  );

interface RailButtonProps {
  indexOpen: boolean;
  selected?: boolean;
  icon: string;
  label: string;
  id?: string;
  onClick?: () => void;
  current?: boolean;
}

const RailButton = ({
  indexOpen,
  selected = false,
  icon,
  label,
  id,
  onClick,
  current,
}: RailButtonProps) => (
  <Button
    variant="ghost"
    size="sm"
    type="button"
    className={railButtonClass(indexOpen, selected)}
    id={id}
    aria-current={current ? "page" : undefined}
    aria-pressed={current ? undefined : selected || undefined}
    title={label}
    aria-label={label}
    onClick={onClick}
  >
    <Icon name={icon} className={indexOpen ? "size-4" : "size-4.5"} />
    {indexOpen && <span className="flex-1 text-left">{label}</span>}
  </Button>
);

interface ViewButtonProps {
  indexOpen: boolean;
  icon: string;
  tooltip: string;
  label: string;
  count: number | null;
  selected: boolean;
  onSelect: () => void;
}

const ViewButton = ({
  indexOpen,
  icon,
  tooltip,
  label,
  count,
  selected,
  onSelect,
}: ViewButtonProps) => (
  <Button
    variant="ghost"
    size="sm"
    type="button"
    className={railButtonClass(indexOpen, selected)}
    aria-pressed={selected}
    title={tooltip}
    aria-label={tooltip}
    onClick={onSelect}
  >
    <Icon name={icon} className={indexOpen ? "size-4" : "size-4.5"} />
    {indexOpen ? (
      <>
        <span className="flex-1 truncate text-left">{label}</span>
        {count !== null && (
          <span
            className={cn(
              "rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold",
              selected
                ? "bg-primary/15 text-primary"
                : "bg-secondary text-muted-foreground"
            )}
          >
            {count}
          </span>
        )}
      </>
    ) : (
      count !== null &&
      count > 0 && (
        <span className="bg-primary text-primary-foreground ring-card absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full font-mono text-[10px] font-bold ring-2">
          {count}
        </span>
      )
    )}
  </Button>
);

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
  const viewCounts: Record<ProjectView, number | null> = {
    all: totalCount,
    attention,
    favorites: favoriteCount,
    recent: null,
  };
  const syncedText = t("project.sidebar.synced", {
    time: relative(new Date(syncAt).toISOString()),
  });
  return (
    <aside
      className={cn(
        nativeWindowStyles.sidebar,
        "bg-card border-border relative z-50 flex h-full shrink-0 flex-col border-r transition-[width,transform] duration-200 ease-out max-[860px]:fixed max-[860px]:inset-y-0 max-[860px]:left-0 max-[860px]:z-50 max-[860px]:shadow-2xl",
        indexOpen
          ? "w-[232px] p-3 max-[860px]:translate-x-0"
          : "items-center p-2 max-[860px]:-translate-x-full min-[861px]:w-[64px]"
      )}
      id="indexPanel"
      aria-label={t("project.a11y.indexLabel")}
    >
      <div
        className={cn(
          "flex items-center gap-2",
          indexOpen ? "mb-3 w-full px-1 py-0.5" : "mb-1 flex-col px-0 py-0.5"
        )}
      >
        <img src={logoUrl} alt="" className="size-8 shrink-0 rounded-lg" />
        {indexOpen && (
          <span className="text-foreground flex-1 truncate text-sm font-semibold tracking-tight">
            KeyHarbor
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          type="button"
          className="text-muted-foreground hover:text-foreground size-7 shrink-0 rounded-lg"
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
      {!indexOpen && (
        <div
          className="border-border/60 my-1 w-7 border-t"
          aria-hidden="true"
        />
      )}
      <nav
        className={cn(
          "my-1 flex flex-col gap-1",
          indexOpen ? "w-full" : "w-full items-center"
        )}
        aria-label={t("project.a11y.primaryNav")}
      >
        <RailButton
          indexOpen={indexOpen}
          selected
          icon="key"
          label={t("project.sidebar.navSecrets")}
          current
        />
        <RailButton
          indexOpen={indexOpen}
          icon="clock"
          label={t("project.sidebar.navActivity")}
          id="navActivity"
          onClick={() => nav("logs.html")}
        />
        <RailButton
          indexOpen={indexOpen}
          icon="settings"
          label={t("project.sidebar.navSettings")}
          id="navSettings"
          onClick={() => nav("settings.html")}
        />
      </nav>
      {indexOpen ? (
        <p className="text-muted-foreground mb-1.5 px-2.5 text-[10px] font-semibold tracking-wider uppercase">
          {t("project.sidebar.viewsLabel")}
        </p>
      ) : (
        <div
          className="border-border/60 my-1 w-7 border-t"
          aria-hidden="true"
        />
      )}
      <section
        className={cn(
          "flex flex-col gap-1",
          indexOpen ? "w-full flex-1" : "w-full flex-1 items-center"
        )}
        id="viewsList"
        aria-label={t("project.a11y.viewsLabel")}
      >
        {viewItems.map(({ value: item, label, icon }) => (
          <ViewButton
            key={item}
            indexOpen={indexOpen}
            icon={icon}
            label={t(label)}
            tooltip={
              viewCounts[item] === null
                ? t(label)
                : `${t(label)} (${viewCounts[item]})`
            }
            count={viewCounts[item]}
            selected={view === item}
            onSelect={() => setView(item)}
          />
        ))}
      </section>
      <div
        className={cn(
          "border-border/50 bg-secondary/30 text-muted-foreground mt-auto flex items-center rounded-xl border transition-colors",
          indexOpen ? "gap-2.5 p-2 text-xs" : "size-8 justify-center p-0"
        )}
        title={syncedText}
      >
        <span
          className="bg-success size-2 shrink-0 animate-pulse rounded-full"
          aria-hidden="true"
        />
        {indexOpen ? (
          <span id="syncLabel" className="truncate text-xs">
            {syncedText}
          </span>
        ) : (
          <span id="syncLabel" className="sr-only">
            {syncedText}
          </span>
        )}
      </div>
    </aside>
  );
};
