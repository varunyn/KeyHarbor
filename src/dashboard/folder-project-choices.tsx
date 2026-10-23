import type { ProjectRecord } from "../project/bridge";
import type { FolderImportChoice } from "../project/folder-import-types";
import { i18n } from "../renderer/i18n";
import { Checkbox } from "../renderer/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "../renderer/ui/command";
import { Input } from "../renderer/ui/input";
import { ProjectName } from "../renderer/ui/project-name";
import { cn } from "../renderer/ui/utils";

const t = (key: string, vars?: Record<string, string | number>) =>
  i18n.t(`dashboard.folderImport.${key}`, vars);

export const FolderProjectChoices = ({
  folders,
  names,
  projects,
  busy,
  onToggle,
  onName,
}: {
  folders: FolderImportChoice[];
  names: Record<string, string>;
  projects: ProjectRecord[];
  busy: boolean;
  onToggle: (folder: FolderImportChoice) => void;
  onName: (id: string, name: string) => void;
}) => (
  <fieldset className="m-0 min-w-0 space-y-2 border-0 p-0" disabled={busy}>
    <legend className="text-foreground mb-2 text-sm font-medium">
      {t("folders")}
    </legend>
    {folders.map((folder) => {
      const selected = Object.hasOwn(names, folder.id);
      const existing = projects.some(
        (project) => project.name === names[folder.id]?.trim()
      );
      return (
        <div
          key={folder.id}
          className={cn(
            "border-border rounded-lg border p-3",
            selected && "border-primary/50 bg-primary/5"
          )}
        >
          <div className="flex items-center gap-3">
            <Checkbox
              id={`folder-choice-${folder.id}`}
              checked={selected}
              onCheckedChange={() => onToggle(folder)}
            />
            <label
              htmlFor={`folder-choice-${folder.id}`}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"
            >
              <ProjectName
                name={folder.suggestedName}
                compact
                className="text-foreground flex-1 text-sm font-medium"
              />
              <span className="text-muted-foreground shrink-0 text-xs">
                {t("fileCount", { count: folder.fileCount })}
              </span>
            </label>
          </div>
          {selected && (
            <div className="mt-3 space-y-2 pl-7">
              <label
                htmlFor={`folder-name-${folder.id}`}
                className="text-foreground text-xs font-medium"
              >
                {t("projectName")}
              </label>
              <Input
                id={`folder-name-${folder.id}`}
                value={names[folder.id]}
                maxLength={256}
                onChange={(event) => onName(folder.id, event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                {t(existing ? "existingProjectHint" : "newProjectHint")}
              </p>
              {projects.length > 0 && (
                <details className="text-muted-foreground text-xs">
                  <summary className="focus-visible:outline-ring cursor-pointer rounded py-1 focus-visible:outline-2">
                    {t("otherProject")}
                  </summary>
                  <Command className="border-border mt-2 overflow-hidden rounded-lg border">
                    <CommandInput placeholder={t("search")} />
                    <CommandList>
                      <CommandEmpty>{t("empty")}</CommandEmpty>
                      {projects.map((project) => (
                        <CommandItem
                          key={project.name}
                          value={project.name}
                          onSelect={() => onName(folder.id, project.name)}
                        >
                          <ProjectName
                            name={project.name}
                            compact
                            className="flex-1"
                          />
                        </CommandItem>
                      ))}
                    </CommandList>
                  </Command>
                </details>
              )}
            </div>
          )}
        </div>
      );
    })}
  </fieldset>
);
