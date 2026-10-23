import Folder from "lucide-react/dist/esm/icons/folder.mjs";
import { useEffect, useRef, useState } from "react";

import type { ProjectRecord } from "../project/bridge";
import type {
  FolderDiscovery,
  FolderImportChoice,
  FolderImportSelection,
} from "../project/folder-import-types";
import { runWithCleanup } from "../renderer/async-operation";
import { i18n } from "../renderer/i18n";
import { Button } from "../renderer/ui/button";
import { Dialog, DialogContent, DialogTitle } from "../renderer/ui/dialog";
import { cn } from "../renderer/ui/utils";
import { FolderProjectChoices } from "./folder-project-choices";

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
  const [names, setNames] = useState<Record<string, string>>({});
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
    setNames({});
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
              const [only] = result.discovery.folders;
              if (result.discovery.folders.length === 1 && only) {
                setNames({ [only.id]: only.suggestedName });
              }
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

  const selected =
    discovery?.folders.filter((entry) => Object.hasOwn(names, entry.id)) ?? [];
  const toggleFolder = (entry: FolderImportChoice) => {
    setNames((current) => {
      if (Object.hasOwn(current, entry.id)) {
        return Object.fromEntries(
          Object.entries(current).filter(([id]) => id !== entry.id)
        );
      }
      return { ...current, [entry.id]: entry.suggestedName };
    });
    setError("");
  };

  const start = async () => {
    if (
      !selected.length ||
      pending.current ||
      selected.some((entry) => !names[entry.id]?.trim())
    ) {
      return;
    }
    if (
      new Set(selected.map((entry) => (names[entry.id] ?? "").trim())).size !==
      selected.length
    ) {
      setError(t("distinctProjects"));
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    await runWithCleanup(
      async () => {
        try {
          const refreshed = await window.keyharbor.projects.get();
          if (!live.current) {
            return;
          }
          if (!refreshed.success) {
            setError(t("failed"));
            return;
          }
          let available = refreshed.data;
          const selections: FolderImportSelection[] = [];
          for (const entry of selected) {
            const name = (names[entry.id] ?? "").trim();
            let destination = available.find(
              (project) => project.name === name
            );
            if (!destination) {
              // Projects are created serially so a retry can reuse any completed creation.
              // eslint-disable-next-line no-await-in-loop
              const created = await window.keyharbor.projects.create(name);
              if (!live.current) {
                return;
              }
              if (!created.success) {
                setError(t("createFailed"));
                return;
              }
              // eslint-disable-next-line no-await-in-loop
              const updated = await window.keyharbor.projects.get();
              if (!live.current) {
                return;
              }
              if (!updated.success) {
                setError(t("createFailed"));
                return;
              }
              available = updated.data;
              destination = available.find((project) => project.name === name);
            }
            if (!destination) {
              setError(t("createFailed"));
              return;
            }
            selections.push({
              choiceId: entry.id,
              target: {
                environmentId: destination.defaultEnvironmentId,
                projectName: destination.name,
              },
            });
          }
          const result =
            await window.keyharbor.secrets.importFolderStageChoices(selections);
          if (!live.current) {
            return;
          }
          if (!result.success) {
            setError(t("failed"));
            return;
          }
          const [first] = selections;
          if (first) {
            window.location.assign(
              `project.html?name=${encodeURIComponent(first.target.projectName)}&importFolder=1`
            );
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
          <DialogTitle>{t("dialogTitle")}</DialogTitle>
          <p className="text-muted-foreground text-sm break-all">
            {folder?.name}
          </p>
          <p className="text-muted-foreground text-xs">
            {t(busy && !discovery ? "scanning" : "folderHint")}
          </p>
          {discovery?.limited && (
            <output className="text-warning block text-xs">
              {t("limited")}
            </output>
          )}
          {discovery?.folders.length === 0 && (
            <p className="text-muted-foreground text-sm">{t("noFolders")}</p>
          )}
          <form
            className="min-w-0 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void start();
            }}
          >
            {discovery && discovery.folders.length > 0 && (
              <div className="max-h-[50dvh] overflow-y-auto overscroll-contain pr-1">
                <FolderProjectChoices
                  folders={discovery.folders}
                  names={names}
                  projects={projects}
                  busy={busy}
                  onToggle={toggleFolder}
                  onName={(id, name) =>
                    setNames((current) => ({ ...current, [id]: name }))
                  }
                />
              </div>
            )}
            <div className="border-border flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <span className="text-muted-foreground text-xs">
                {t("selected", { count: selected.length })}
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setFolder(null)}
                >
                  {i18n.t("common.cancel")}
                </Button>
                <Button
                  type="submit"
                  disabled={
                    busy ||
                    !selected.length ||
                    selected.some((entry) => !names[entry.id]?.trim())
                  }
                >
                  {t(busy ? "opening" : "continue")}
                </Button>
              </div>
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
