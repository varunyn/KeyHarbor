import Folder from "lucide-react/dist/esm/icons/folder.mjs";
import { useEffect, useRef, useState } from "react";

import type { ProjectRecord } from "../project/bridge";
import type {
  FolderDiscovery,
  FolderImportChoice,
} from "../project/folder-import-types";
import { runWithCleanup } from "../renderer/async-operation";
import { i18n } from "../renderer/i18n";
import { Button } from "../renderer/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "../renderer/ui/command";
import { Dialog, DialogContent, DialogTitle } from "../renderer/ui/dialog";
import { Input } from "../renderer/ui/input";
import { cn } from "../renderer/ui/utils";

const t = (key: string, vars?: Record<string, string | number>) =>
  i18n.t(`dashboard.folderImport.${key}`, vars);

export const HomeFolderImport = ({
  projects,
  onCreateProject,
}: {
  projects: ProjectRecord[];
  onCreateProject: (trigger: HTMLElement) => void;
}) => {
  const [folder, setFolder] = useState<File | null>(null);
  const [discovery, setDiscovery] = useState<FolderDiscovery | null>(null);
  const [choice, setChoice] = useState<FolderImportChoice | null>(null);
  const [name, setName] = useState("");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const discover = async (dropped: File) => {
    if (pending.current) {
      return;
    }
    pending.current = true;
    setFolder(dropped);
    setDiscovery(null);
    setChoice(null);
    setError("");
    setBusy(true);
    await runWithCleanup(
      async () => {
        try {
          const result =
            await window.keyharbor.secrets.importFolderDiscover(dropped);
          if (live.current) {
            if (result.success) {
              setDiscovery(result.discovery);
            } else {
              setError(t("failed"));
            }
          }
        } catch {
          if (live.current) {
            setError(t("failed"));
          }
        }
      },
      () => {
        pending.current = false;
        if (live.current) {
          setBusy(false);
        }
      }
    );
  };

  const matchingProject = projects.find(
    (project) => project.name === name.trim()
  );

  const submitLabel = matchingProject ? "reviewExisting" : "create";

  const start = async (project?: ProjectRecord) => {
    if (!choice || pending.current || (!project && !name.trim())) {
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    await runWithCleanup(
      async () => {
        try {
          let destination = project;
          if (!destination) {
            const created = await window.keyharbor.projects.create(name.trim());
            if (!created.success) {
              setError(t("createFailed"));
              return;
            }
            if (!live.current) {
              return;
            }
            const refreshed = await window.keyharbor.projects.get();
            destination = refreshed.success
              ? refreshed.data.find((entry) => entry.name === name.trim())
              : undefined;
          }
          if (!live.current) {
            return;
          }
          if (!destination) {
            setError(t("createFailed"));
            return;
          }
          const result = await window.keyharbor.secrets.importFolderStageChoice(
            {
              environmentId: destination.defaultEnvironmentId,
              projectName: destination.name,
            },
            choice.id
          );
          if (!live.current) {
            return;
          }
          if (!result.success) {
            setError(t("failed"));
            return;
          }
          window.location.assign(
            `project.html?name=${encodeURIComponent(destination.name)}&importFolder=1`
          );
        } catch {
          if (live.current) {
            setError(t("failed"));
          }
        }
      },
      () => {
        pending.current = false;
        if (live.current) {
          setBusy(false);
        }
      }
    );
  };

  return (
    <>
      <div
        id="home-folder-drop"
        aria-label={t("heading")}
        className={cn(
          "border-border bg-card/50 my-4 flex flex-wrap items-center gap-3 rounded-xl border border-dashed p-6 transition-colors",
          dragging && "border-primary bg-primary/10"
        )}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = busy ? "none" : "copy";
          setDragging(!busy);
        }}
        onDragLeave={(event) => {
          if (
            !(event.relatedTarget instanceof Node) ||
            !event.currentTarget.contains(event.relatedTarget)
          ) {
            setDragging(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragging(false);
          const [dropped] = event.dataTransfer.files;
          if (!busy && dropped) {
            void discover(dropped);
          }
        }}
      >
        <Folder
          aria-hidden="true"
          className="text-muted-foreground size-5 shrink-0"
        />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-foreground text-sm font-medium">
            {t(dragging ? "active" : "heading")}
          </p>
          <p className="text-muted-foreground text-xs">{t("hint")}</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={(event) => onCreateProject(event.currentTarget)}
        >
          {i18n.t("dashboard.addProject")}
        </Button>
      </div>
      <Dialog
        open={Boolean(folder)}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setFolder(null);
          }
        }}
      >
        <DialogContent
          className="max-w-[440px]"
          closeLabel={i18n.t("common.close")}
        >
          <DialogTitle>
            {t(choice ? "destination" : "chooseFolder")}
          </DialogTitle>
          <p className="text-muted-foreground truncate text-sm">
            {folder?.name}
          </p>
          {!choice && (
            <div className="space-y-3">
              <p className="text-muted-foreground text-xs">
                {t(busy ? "scanning" : "folderHint")}
              </p>
              {discovery?.limited && (
                <output className="text-warning block text-xs">
                  {t("limited")}
                </output>
              )}
              {discovery?.folders.length === 0 && (
                <p className="text-muted-foreground text-sm">
                  {t("noFolders")}
                </p>
              )}
              <div className="space-y-2">
                {discovery?.folders.map((entry) => (
                  <Button
                    key={entry.id}
                    type="button"
                    variant="secondary"
                    className="h-auto w-full justify-start gap-3 py-3 text-left"
                    disabled={busy}
                    onClick={() => {
                      setChoice(entry);
                      setName(entry.suggestedName);
                      setError("");
                    }}
                  >
                    <Folder aria-hidden="true" className="size-4 shrink-0" />
                    <span className="min-w-0 space-y-1">
                      <span className="block break-all whitespace-normal">
                        {entry.suggestedName}
                      </span>
                      <span className="text-muted-foreground block text-xs">
                        {t("fileCount", { count: entry.fileCount })}
                        {projects.some(
                          (project) => project.name === entry.suggestedName
                        )
                          ? ` · ${t("existing")}`
                          : ""}
                      </span>
                    </span>
                  </Button>
                ))}
              </div>
            </div>
          )}
          {choice && (
            <>
              <p className="text-foreground text-sm break-all">
                {choice.suggestedName}
              </p>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setChoice(null);
                  setError("");
                }}
              >
                {i18n.t("common.back")}
              </Button>
              <p className="text-muted-foreground text-xs">{t("reviewHint")}</p>
              <Command className="border-border overflow-hidden rounded-lg border">
                <CommandInput placeholder={t("search")} disabled={busy} />
                <CommandList>
                  <CommandEmpty>{t("empty")}</CommandEmpty>
                  {projects.map((project) => (
                    <CommandItem
                      key={project.name}
                      value={project.name}
                      disabled={busy}
                      onSelect={() => {
                        void start(project);
                      }}
                    >
                      <Folder aria-hidden="true" className="size-4 shrink-0" />
                      <span className="truncate">{project.name}</span>
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
              <form
                className="border-border space-y-2 border-t pt-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void start(matchingProject);
                }}
              >
                <label
                  htmlFor="folder-project-name"
                  className="text-foreground text-xs font-medium"
                >
                  {t(matchingProject ? "projectName" : "newName")}
                </label>
                <Input
                  id="folder-project-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={busy}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setFolder(null)}
                  >
                    {i18n.t("common.cancel")}
                  </Button>
                  <Button type="submit" disabled={busy || !name.trim()}>
                    {t(busy ? "opening" : submitLabel)}
                  </Button>
                </div>
              </form>
            </>
          )}
          {error && (
            <p role="alert" className="text-destructive text-xs">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
