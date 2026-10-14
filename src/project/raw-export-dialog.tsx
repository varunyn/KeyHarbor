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
    <div className="mb-4">
      <ModalTitle>{t("project.rawExportModal.title")}</ModalTitle>
      <p className="text-muted-foreground mt-1 font-mono text-xs">
        {contextLabel}
      </p>
    </div>
    <div className="bg-destructive/10 border-destructive/20 text-destructive mb-4 flex items-center gap-2.5 rounded-xl border p-3 text-xs">
      <Icon name="circle-alert" />
      <span>{t("project.rawExportModal.body")}</span>
    </div>
    <div className="mb-6 space-y-1.5" id="fieldRawPassword">
      <label
        htmlFor="rawPassword"
        className="text-foreground block text-xs font-medium"
      >
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
      {fieldErrors.password && (
        <p className="text-destructive mt-1 text-xs" id="rawPasswordError">
          {fieldErrors.password}
        </p>
      )}
    </div>
    <div className="border-border flex justify-end gap-2 border-t pt-3">
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
