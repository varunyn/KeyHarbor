import Folder from "lucide-react/dist/esm/icons/folder.mjs";

import { i18n } from "../renderer/i18n";
import { Button } from "../renderer/ui/button";
import type { EnvironmentSummary, FolderScanSummary } from "./bridge";

const t = (key: string, vars?: Record<string, unknown>) =>
  i18n.t(`project.folderImport.${key}`, vars);

const missingKeysText = (keys: string[] | null) => {
  if (keys === null) {
    return t("templateUnchecked");
  }
  if (keys.length === 0) {
    return t("noMissing");
  }
  return t("missing", { keys: keys.join(", ") });
};

export interface FolderImportControls {
  scan: FolderScanSummary | null;
  environments: EnvironmentSummary[];
  environmentId: string;
  reviewedFileIds: string[];
  onEnvironment: (id: string) => void;
  onScan: (folder?: File) => void;
  onReviewFile: (id: string) => void;
}

export const FolderImportSection = ({
  busy,
  scan,
  environments,
  environmentId,
  reviewedFileIds,
  onEnvironment,
  onScan,
  onReviewFile,
}: FolderImportControls & { busy: boolean }) => (
  <section className="space-y-4" aria-label={t("heading")}>
    <div
      className="border-border bg-secondary/20 rounded-xl border border-dashed p-4"
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = busy ? "none" : "copy";
      }}
      onDrop={(event) => {
        event.preventDefault();
        const [folder] = event.dataTransfer.files;
        if (!busy && folder) {
          onScan(folder);
        }
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-foreground flex items-center gap-2 text-sm font-medium">
            <Folder className="size-4" />
            {scan?.folderName || t("drop")}
          </p>
          <p className="text-muted-foreground text-xs">{t("scanHint")}</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          id="importChooseFolderBtn"
          disabled={busy}
          onClick={() => onScan()}
        >
          {t(busy ? "scanning" : "choose")}
        </Button>
      </div>
    </div>
    {scan && (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <label
            className="text-foreground text-xs font-medium"
            htmlFor="folderImportEnvironment"
          >
            {t("environment")}
          </label>
          <select
            id="folderImportEnvironment"
            className="bg-card text-foreground border-border rounded-md border px-2 py-1.5 text-xs"
            value={environmentId}
            disabled={busy}
            onChange={(event) => onEnvironment(event.target.value)}
          >
            {environments.map((environment) => (
              <option key={environment.id} value={environment.id}>
                {environment.name}
              </option>
            ))}
          </select>
        </div>
        <p className="text-muted-foreground text-xs">{t("targetHint")}</p>
        {scan.limited && (
          <output className="text-warning block text-xs">{t("limited")}</output>
        )}
        {!scan.files.length && (
          <p className="text-muted-foreground py-3 text-xs">{t("empty")}</p>
        )}
        <ul
          className="divide-border space-y-0 divide-y"
          aria-label={t("files")}
        >
          {scan.files.map((file) => (
            <li key={file.id} className="space-y-2 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <code className="text-foreground block text-xs break-all">
                    {file.path}
                  </code>
                  <p className="text-muted-foreground text-xs">
                    {t("keys", { count: file.keyCount })}
                    {file.suggestedEnvironment
                      ? ` · ${t("suggestion", { name: file.suggestedEnvironment })}`
                      : ""}
                  </p>
                  <p
                    className={
                      file.gitStatus === "tracked" ||
                      file.gitStatus === "unignored"
                        ? "text-warning text-xs"
                        : "text-muted-foreground text-xs"
                    }
                  >
                    {t(`git.${file.gitStatus}`)}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={
                    busy || !file.valid || file.keyCount === 0 || !environmentId
                  }
                  onClick={() => onReviewFile(file.id)}
                  aria-label={t("reviewFile", { path: file.path })}
                >
                  {t(
                    reviewedFileIds.includes(file.id) ? "reviewAgain" : "review"
                  )}
                </Button>
              </div>
              {!file.valid && (
                <p className="text-destructive text-xs">{t("invalid")}</p>
              )}
              {file.valid && file.templatePath && (
                <p className="text-muted-foreground text-xs break-words">
                  {t("template", { path: file.templatePath })}
                  {` · ${missingKeysText(file.missingKeys)}`}
                </p>
              )}
              {!file.templatePath && (
                <p className="text-muted-foreground text-xs">
                  {t("noTemplate")}
                </p>
              )}
            </li>
          ))}
        </ul>
        {scan.warnings.length > 0 && (
          <details className="text-muted-foreground text-xs">
            <summary className="cursor-pointer">
              {t("warnings", { count: scan.warnings.length })}
            </summary>
            <ul className="mt-2 space-y-1">
              {scan.warnings.map((warning, index) => (
                <li key={`${warning.path}:${index}`} className="break-all">
                  {warning.path}: {t(`warning.${warning.code}`)}
                </li>
              ))}
            </ul>
          </details>
        )}
      </>
    )}
  </section>
);
