import { i18n } from "../renderer/i18n";
import { Button } from "../renderer/ui/button";
import { Input } from "../renderer/ui/input";
import { Icon, ModalFrame, ModalTitle } from "./components";
import { DialogCloseButton } from "./dialog-close-button";

const t = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars);

interface RawExportDialogProps {
  contextLabel: string;
  fieldErrors: Record<string, string>;
  rawPassword: string;
  actionBusy: boolean;
  closeModal: () => void;
  onPasswordChange: (password: string) => void;
  exportRaw: () => Promise<void>;
}

export const RawExportDialog = ({
  contextLabel,
  fieldErrors,
  rawPassword,
  actionBusy,
  closeModal,
  onPasswordChange,
  exportRaw,
}: RawExportDialogProps) => (
  <ModalFrame id="rawExportModalOverlay" onClose={closeModal}>
    <div className="modal-header">
      <ModalTitle>{t("project.rawExportModal.title")}</ModalTitle>
    </div>
    <p className="environment-context">{contextLabel}</p>
    <div className="modal-warning">
      <Icon name="circle-alert" />
      <span>{t("project.rawExportModal.body")}</span>
    </div>
    <div
      className={`sl-field${fieldErrors.password ? " invalid" : ""}`}
      id="fieldRawPassword"
    >
      <label htmlFor="rawPassword">
        {t("project.rawExportModal.passwordLabel")}
      </label>
      <Input
        type="password"
        id="rawPassword"
        autoComplete="current-password"
        placeholder={t("project.rawExportModal.passwordPlaceholder")}
        value={rawPassword}
        onChange={(event) => onPasswordChange(event.target.value)}
      />
      <p className="sl-field-error" id="rawPasswordError">
        {fieldErrors.password}
      </p>
    </div>
    <div className="modal-actions">
      <DialogCloseButton onClose={closeModal} />
      <Button
        variant="destructive"
        type="button"
        id="rawExportConfirmBtn"
        disabled={actionBusy}
        onClick={exportRaw}
      >
        {t("project.rawExportModal.confirm")}
      </Button>
    </div>
  </ModalFrame>
);
