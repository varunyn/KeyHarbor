import { i18n } from "../renderer/i18n";
import { Button } from "../renderer/ui/button";
import { Input } from "../renderer/ui/input";
import { Textarea } from "../renderer/ui/textarea";
import { Icon, ModalFrame, ModalTitle } from "./components";
import { DialogCloseButton } from "./dialog-close-button";

const t = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars);
export interface SecretDraft {
  description: string;
  expires: string;
  key: string;
  mode: "new" | "edit";
  name: string;
  originalExpiry: string | null;
  originalExpiryDate: string;
  tags: string;
  value: string;
}
interface SecretEditorDialogProps {
  secretDraft: SecretDraft;
  setSecretDraft: (draft: SecretDraft) => void;
  fieldErrors: Record<string, string>;
  actionBusy: boolean;
  contextLabel: string;
  closeModal: () => void;
  onGenerate: () => void;
  saveSecret: () => Promise<void>;
}

export const SecretEditorDialog = ({
  secretDraft,
  setSecretDraft,
  fieldErrors,
  actionBusy,
  contextLabel,
  closeModal,
  onGenerate,
  saveSecret,
}: SecretEditorDialogProps) => (
  <ModalFrame
    id="secretModalOverlay"
    initialFocusId="secretName"
    onClose={closeModal}
  >
    <div className="modal-header">
      <ModalTitle>
        {t(
          secretDraft.mode === "new"
            ? "project.secretForm.titleNew"
            : "project.secretForm.titleEdit"
        )}
      </ModalTitle>
    </div>
    <p className="environment-context">{contextLabel}</p>
    <div
      className={`sl-field${fieldErrors.name ? " invalid" : ""}`}
      id="fieldName"
    >
      <label htmlFor="secretName">{t("project.secretForm.nameLabel")}</label>
      <Input
        id="secretName"
        type="text"
        autoComplete="off"
        spellCheck={false}
        placeholder={t("project.secretForm.namePlaceholder")}
        value={secretDraft.name}
        onChange={(event) =>
          setSecretDraft({ ...secretDraft, name: event.target.value })
        }
      />
      <p className="sl-field-error" id="secretNameError">
        {fieldErrors.name}
      </p>
    </div>
    <div
      className={`sl-field${fieldErrors.value ? " invalid" : ""}`}
      id="fieldValue"
    >
      <label htmlFor="secretValue">{t("project.secretForm.valueLabel")}</label>
      <div className="sl-value-row">
        <Textarea
          id="secretValue"
          rows={3}
          spellCheck={false}
          placeholder={t("project.secretForm.valuePlaceholder")}
          value={secretDraft.value}
          onChange={(event) =>
            setSecretDraft({ ...secretDraft, value: event.target.value })
          }
        />
        <Button
          variant="secondary"
          type="button"
          size="icon"
          className="shrink-0 self-start"
          id="generateBtn"
          title={t("project.secretForm.generate")}
          onClick={onGenerate}
        >
          <Icon name="key" />
        </Button>
      </div>
      <p className="sl-field-error" id="secretValueError">
        {fieldErrors.value}
      </p>
    </div>
    <div className="sl-field">
      <label htmlFor="secretDesc">
        {t("project.secretForm.descriptionLabel")}
      </label>
      <Input
        id="secretDesc"
        autoComplete="off"
        placeholder={t("project.secretForm.descriptionPlaceholder")}
        value={secretDraft.description}
        onChange={(event) =>
          setSecretDraft({
            ...secretDraft,
            description: event.target.value,
          })
        }
      />
    </div>
    <div className="sl-field">
      <label htmlFor="secretTags">{t("project.secretForm.tagsLabel")}</label>
      <Input
        id="secretTags"
        autoComplete="off"
        spellCheck={false}
        placeholder={t("project.secretForm.tagsPlaceholder")}
        value={secretDraft.tags}
        onChange={(event) =>
          setSecretDraft({ ...secretDraft, tags: event.target.value })
        }
      />
    </div>
    <div className="sl-field">
      <label htmlFor="secretExpires">
        {t("project.secretForm.expiresLabel")}
      </label>
      <Input
        id="secretExpires"
        type="date"
        value={secretDraft.expires}
        onChange={(event) =>
          setSecretDraft({ ...secretDraft, expires: event.target.value })
        }
      />
    </div>
    <div className="modal-actions">
      <DialogCloseButton onClose={closeModal} />
      <Button
        variant="default"
        type="button"
        id="secretSaveBtn"
        disabled={actionBusy}
        onClick={saveSecret}
      >
        {t(
          secretDraft.mode === "new"
            ? "project.secretForm.create"
            : "project.secretForm.save"
        )}
      </Button>
    </div>
  </ModalFrame>
);
