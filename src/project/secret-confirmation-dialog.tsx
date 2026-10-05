import { i18n } from "../renderer/i18n";
import { Button } from "../renderer/ui/button";
import { ModalFrame, ModalTitle } from "./components";
import { DialogCloseButton } from "./dialog-close-button";

const t = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars);

interface SecretConfirmationDialogProps {
  action: "delete" | "rotate";
  actionKey: string;
  contextLabel: string;
  actionBusy: boolean;
  closeModal: () => void;
  onConfirm: () => Promise<void>;
}
export const SecretConfirmationDialog = ({
  action,
  actionKey,
  contextLabel,
  actionBusy,
  closeModal,
  onConfirm,
}: SecretConfirmationDialogProps) => (
  <ModalFrame
    id={`${action}ModalOverlay`}
    initialFocusId={`${action}CancelBtn`}
    onClose={closeModal}
  >
    <div className="modal-header">
      <ModalTitle>
        {t(`project.${action}Modal.title`, { key: actionKey })}
      </ModalTitle>
    </div>
    <p className="environment-context">{contextLabel}</p>
    <p className="modal-sub">{t(`project.${action}Modal.body`)}</p>
    <div className="modal-actions">
      <DialogCloseButton id={`${action}CancelBtn`} onClose={closeModal} />
      <Button
        variant={action === "delete" ? "destructive" : "default"}
        type="button"
        id={`${action}ConfirmBtn`}
        disabled={actionBusy}
        onClick={onConfirm}
      >
        {t(`project.${action}Modal.confirm`)}
      </Button>
    </div>
  </ModalFrame>
);
