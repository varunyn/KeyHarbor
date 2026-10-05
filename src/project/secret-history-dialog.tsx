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
      <div className="secrets-state">
        <output className="spinner" />
      </div>
    );
  }
  if (!history) {
    return (
      <div className="secrets-state">
        <p>{t("project.history.failedToLoad")}</p>
      </div>
    );
  }
  if (history.history.length === 0) {
    return (
      <div className="secrets-state">
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
          className={`history-row${row.current ? " current" : ""}`}
          key={`${row.index}:${row.changedAt}`}
        >
          <div className="history-row-head">
            <strong>{row.label}</strong>
            <time>{relative(row.changedAt)}</time>
          </div>
          <div className="history-value">
            {historyShown[index] ? String(row.value ?? "") : mask(row.value)}
          </div>
          <div className="history-row-actions">
            <Button
              variant="link"
              type="button"
              className="link-btn"
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
                className="link-btn"
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
    <div className="modal-header">
      <ModalTitle>{t("project.history.title")}</ModalTitle>
    </div>
    <p className="environment-context">{contextLabel}</p>
    <div className="history-list" id="historyList">
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
    <div className="modal-actions">
      <DialogCloseButton onClose={closeModal} label="common.close" />
    </div>
  </ModalFrame>
);
