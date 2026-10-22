import { useRendererTranslation } from "../renderer/providers";
import { AppTopBar, CrumbSeparator, crumbsClass } from "../renderer/ui/nav-bar";
import { SidebarToggle } from "../renderer/ui/sidebar-toggle";
import { cn } from "../renderer/ui/utils";
import type { ProjectRecord } from "./bridge";
import { Icon } from "./components";
import { ProjectSwitcher } from "./project-switcher";

interface ProjectTopbarProps {
  indexOpen: boolean;
  onToggleIndex: () => void;
  projectName: string;
  projects: ProjectRecord[];
  menu: string | null;
  setMenu: (menu: string | null) => void;
  nav: (destination: string) => void;
  vaultLabel: string;
}

export const ProjectTopbar = ({
  indexOpen,
  onToggleIndex,
  projectName,
  projects,
  menu,
  setMenu,
  nav,
  vaultLabel,
}: ProjectTopbarProps) => {
  const { t } = useRendererTranslation();
  return (
    <AppTopBar
      id="projectTopbar"
      ariaLabel={t("project.a11y.crumbsLabel")}
      className="secrets-topbar border-border/40 px-6"
      left={
        <>
          <SidebarToggle expanded={indexOpen} onToggle={onToggleIndex} />
          <nav
            className={cn(crumbsClass, "secrets-crumbs")}
            aria-label={t("project.a11y.crumbsLabel")}
          >
            <a
              className="text-muted-foreground hover:text-foreground secrets-back-link focus-visible:outline-ring inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-1 font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
              href="dashboard.html"
            >
              <Icon name="arrow-left" />
              <span>{t("dashboard.title")}</span>
            </a>
            <CrumbSeparator />
            <span id="crumbProject" className="flex min-w-0 items-center">
              <ProjectSwitcher
                menu={menu}
                setMenu={setMenu}
                projectName={projectName}
                projects={projects}
                nav={nav}
              />
            </span>
          </nav>
        </>
      }
      right={
        <span
          className="text-muted-foreground secrets-local-state flex shrink-0 items-center gap-1.5 text-xs"
          title={vaultLabel || t("project.header.localVault")}
        >
          <Icon name="lock" />
          <span className="max-w-[180px] truncate max-[860px]:sr-only">
            {vaultLabel || t("project.header.localVault")}
          </span>
        </span>
      }
    />
  );
};
