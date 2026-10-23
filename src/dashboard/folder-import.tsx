import Folder from "lucide-react/dist/esm/icons/folder.mjs";
import { useEffect, useRef, useState } from "react";

import type { ProjectRecord } from "../project/bridge";
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

const t = (key: string) => i18n.t(`dashboard.folderImport.${key}`);

export const HomeFolderImport = ({
  projects,
  onCreateProject,
}: {
  projects: ProjectRecord[];
  onCreateProject: (trigger: HTMLElement) => void;
}) => {
  const [folder, setFolder] = useState<File | null>(null);
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

  const start = async (project?: ProjectRecord) => {
    if (!folder || pending.current || (!project && !name.trim())) {
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
          const result = await window.keyharbor.secrets.importFolderStage(
            {
              environmentId: destination.defaultEnvironmentId,
              projectName: destination.name,
            },
            folder
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
            setFolder(dropped);
            setName(dropped.name);
            setError("");
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
          <DialogTitle>{t("destination")}</DialogTitle>
          <p className="text-muted-foreground truncate text-sm">
            {folder?.name}
          </p>
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
              void start();
            }}
          >
            <label
              htmlFor="folder-project-name"
              className="text-foreground text-xs font-medium"
            >
              {t("newName")}
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
                {t(busy ? "opening" : "create")}
              </Button>
            </div>
          </form>
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
