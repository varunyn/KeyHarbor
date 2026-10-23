import { useRef, useState } from "react";

import { runWithCleanup } from "../renderer/async-operation";
import { i18n } from "../renderer/i18n";
import { Button } from "../renderer/ui/button";

export const FolderImportNavigation = ({
  scanId,
  remaining,
  busy,
}: {
  scanId: string;
  remaining: number;
  busy: boolean;
}) => {
  const pending = useRef(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState(false);
  const advance = async () => {
    if (pending.current || busy) {
      return;
    }
    pending.current = true;
    setMoving(true);
    setError(false);
    await runWithCleanup(
      async () => {
        try {
          const result =
            await window.keyharbor.secrets.importFolderNext(scanId);
          if (result.success) {
            window.location.assign(
              `project.html?name=${encodeURIComponent(result.target.projectName)}&importFolder=1`
            );
          } else {
            setError(true);
          }
        } catch {
          setError(true);
        }
      },
      () => {
        pending.current = false;
        setMoving(false);
      }
    );
  };
  return (
    <div className="border-border space-y-2 border-t pt-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs">
          {i18n.t("project.folderImport.remainingProjects", {
            count: remaining,
          })}
        </p>
        <Button
          type="button"
          disabled={busy || moving}
          onClick={() => {
            void advance();
          }}
        >
          {i18n.t("project.folderImport.nextProject")}
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        {i18n.t("project.folderImport.nextProjectHint")}
      </p>
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {i18n.t("project.folderImport.nextFailed")}
        </p>
      )}
    </div>
  );
};
