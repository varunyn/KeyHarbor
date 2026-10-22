import Check from "lucide-react/dist/esm/icons/check.mjs";
import ChevronsUpDown from "lucide-react/dist/esm/icons/chevrons-up-down.mjs";
import Folder from "lucide-react/dist/esm/icons/folder.mjs";
import LayoutGrid from "lucide-react/dist/esm/icons/layout-grid.mjs";

import { useRendererTranslation } from "../renderer/providers";
import { Button } from "../renderer/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "../renderer/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../renderer/ui/popover";
import type { ProjectRecord } from "./bridge";

export const ProjectSwitcher = ({
  menu,
  setMenu,
  projectName,
  projects,
  nav,
}: {
  menu: string | null;
  setMenu: (menu: string | null) => void;
  projectName: string;
  projects: ProjectRecord[];
  nav: (href: string) => void;
}) => {
  const { t } = useRendererTranslation();
  return (
    <Popover
      open={menu === "switcher"}
      onOpenChange={(open) => setMenu(open ? "switcher" : null)}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="min-w-0 gap-2 px-2"
          id="switcherBtn"
          aria-label={t("project.sidebar.switchProject", { name: projectName })}
          title={projectName}
        >
          <Folder
            aria-hidden="true"
            className="text-muted-foreground size-4 shrink-0"
          />
          <span className="max-w-[min(220px,40vw)] truncate text-[13px] font-semibold">
            {projectName}
          </span>
          <ChevronsUpDown
            aria-hidden="true"
            className="text-muted-foreground size-3.5 shrink-0"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label={t("project.sidebar.projectLabel")}>
        <Command
          label={t("project.sidebar.searchProjects")}
          defaultValue={projectName}
          loop
        >
          <CommandInput
            aria-label={t("project.sidebar.searchProjects")}
            placeholder={t("project.sidebar.searchProjects")}
          />
          <CommandList>
            <CommandEmpty>{t("project.sidebar.noProjectsFound")}</CommandEmpty>
            {projects.map((project) => (
              <CommandItem
                key={project.name}
                value={project.name}
                onSelect={() => {
                  setMenu(null);
                  if (project.name !== projectName) {
                    nav(
                      `project.html?name=${encodeURIComponent(project.name)}`
                    );
                  }
                }}
              >
                <Folder
                  aria-hidden="true"
                  className="text-muted-foreground size-3.5 shrink-0"
                />
                <span className="flex-1 truncate">{project.name}</span>
                {project.name === projectName && (
                  <Check
                    aria-hidden="true"
                    className="text-primary size-3.5 shrink-0"
                  />
                )}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
        <div className="border-border/60 mt-1 border-t pt-1">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground w-full justify-start gap-2.5 rounded-md px-2 font-normal"
            onClick={() => {
              setMenu(null);
              nav("dashboard.html");
            }}
          >
            <LayoutGrid aria-hidden="true" className="size-3.5" />
            {t("project.sidebar.allProjects")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};
