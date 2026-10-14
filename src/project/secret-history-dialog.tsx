import { i18n } from "../renderer/i18n";
import { Button } from "../renderer/ui/button";
import type { SecretHistory } from "./bridge";
import { ModalFrame, ModalTitle } from "./components";
import { DialogCloseButton } from "./dialog-close-button";
import { mask, relative } from "./secret-presentation";

const t = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars);
interface SecretHistoryDialogProps {
  contextLabel: string;
  historyLoading: boolean;
  history: SecretHistory | null;
  historyShown: Record<number, boolean>;
  actionBusy: boolean;
  restoreArmed: number | null;
  closeModal: () => void;
  onToggle: (index: number) => void;
  restoreVersion: (index: number) => Promise<void>;
}

const SecretHistoryList = ({
  historyLoading,
  history,
  historyShown,
  actionBusy,
  restoreArmed,
  onToggle,
  restoreVersion,
}: Omit<SecretHistoryDialogProps, "contextLabel" | "closeModal">) => {
  if (historyLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <output className="border-primary size-6 animate-spin rounded-full border-2 border-t-transparent" />
      </div>
    );
  }
  if (!history) {
    return (
      <div className="text-muted-foreground flex items-center justify-center p-8 text-xs">
        <p>{t("project.history.failedToLoad")}</p>
      </div>
    );
  }
  if (history.history.length === 0) {
    return (
      <div className="text-muted-foreground flex items-center justify-center p-8 text-xs">
        <p>{t("project.history.noHistory")}</p>
      </div>
    );
  }
  return (
    <>
      {[
        {
          changedAt: history.current.changedAt,
          current: true,
          index: -1,
          label: t("project.history.currentVersion"),
          value: history.current.value,
        },
        ...history.history.map((entry, index) => ({
          changedAt: entry.changedAt,
          current: false,
          index,
          label: t("project.history.versionNumber", {
            number: history.totalVersions - 1 - index,
          }),
          value: entry.value,
        })),
      ].map((row, index) => (
        <div
          className={`space-y-2 p-3.5 text-xs${row.current ? " bg-primary/5" : ""}`}
          key={`${row.index}:${row.changedAt}`}
        >
          <div className="flex items-center justify-between font-medium">
            <strong className="text-foreground">{row.label}</strong>
            <time className="text-muted-foreground font-mono">
              {relative(row.changedAt)}
            </time>
          </div>
          <div className="text-muted-foreground bg-secondary/50 border-border/50 rounded-lg border p-2.5 font-mono text-xs break-all select-text">
            {historyShown[index] ? String(row.value ?? "") : mask(row.value)}
          </div>
          <div className="flex items-center gap-3 pt-1">
            <Button
              variant="link"
              type="button"
              className="text-primary h-auto p-0 text-xs hover:underline"
              data-toggle
              onClick={() => onToggle(index)}
            >
              {t(
                historyShown[index]
                  ? "project.history.hide"
                  : "project.history.show"
              )}
            </Button>
            {!row.current && (
              <Button
                variant="link"
                type="button"
                className="text-destructive h-auto p-0 text-xs hover:underline"
                data-restore
                disabled={actionBusy}
                onClick={() => restoreVersion(row.index)}
              >
                {t(
                  restoreArmed === row.index
                    ? "project.history.restoreConfirm"
                    : "project.history.restore"
                )}
              </Button>
            )}
          </div>
        </div>
      ))}
    </>
  );
};

export const SecretHistoryDialog = ({
  contextLabel,
  historyLoading,
  history,
  historyShown,
  actionBusy,
  restoreArmed,
  closeModal,
  onToggle,
  restoreVersion,
}: SecretHistoryDialogProps) => (
  <ModalFrame id="historyModalOverlay" onClose={closeModal}>
    <div className="mb-4">
      <ModalTitle>{t("project.history.title")}</ModalTitle>
      <p className="text-muted-foreground mt-1 font-mono text-xs">
        {contextLabel}
      </p>
    </div>
    <div
      className="border-border divide-border/60 bg-card mb-6 max-h-[340px] divide-y overflow-y-auto rounded-xl border"
      id="historyList"
    >
      <SecretHistoryList
        historyLoading={historyLoading}
        history={history}
        historyShown={historyShown}
        actionBusy={actionBusy}
        restoreArmed={restoreArmed}
        onToggle={onToggle}
        restoreVersion={restoreVersion}
      />
    </div>
    <div className="border-border flex justify-end gap-2 border-t pt-3">
      <DialogCloseButton onClose={closeModal} label="common.close" />
    </div>
  </ModalFrame>
);
