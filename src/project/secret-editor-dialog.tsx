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
    <div className="mb-4">
      <ModalTitle>
        {t(
          secretDraft.mode === "new"
            ? "project.secretForm.titleNew"
            : "project.secretForm.titleEdit"
        )}
      </ModalTitle>
      <p className="text-muted-foreground mt-1 font-mono text-xs">
        {contextLabel}
      </p>
    </div>
    <div className="mb-6 space-y-4">
      <div className="space-y-1.5" id="fieldName">
        <label
          htmlFor="secretName"
          className="text-foreground block text-xs font-medium"
        >
          {t("project.secretForm.nameLabel")}
        </label>
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
        {fieldErrors.name && (
          <p className="text-destructive mt-1 text-xs" id="secretNameError">
            {fieldErrors.name}
          </p>
        )}
      </div>
      <div className="space-y-1.5" id="fieldValue">
        <label
          htmlFor="secretValue"
          className="text-foreground block text-xs font-medium"
        >
          {t("project.secretForm.valueLabel")}
        </label>
        <div className="flex items-start gap-2">
          <Textarea
            id="secretValue"
            rows={3}
            spellCheck={false}
            className="flex-1 font-mono text-xs"
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
        {fieldErrors.value && (
          <p className="text-destructive mt-1 text-xs" id="secretValueError">
            {fieldErrors.value}
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <label
          htmlFor="secretDesc"
          className="text-foreground block text-xs font-medium"
        >
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
      <div className="space-y-1.5">
        <label
          htmlFor="secretTags"
          className="text-foreground block text-xs font-medium"
        >
          {t("project.secretForm.tagsLabel")}
        </label>
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
      <div className="space-y-1.5">
        <label
          htmlFor="secretExpires"
          className="text-foreground block text-xs font-medium"
        >
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
    </div>
    <div className="border-border flex justify-end gap-2 border-t pt-3">
      <DialogCloseButton onClose={closeModal} />
      <Button
        variant="default"
        type="button"
        id="saveSecretBtn"
        disabled={actionBusy}
        onClick={saveSecret}
      >
        {t("project.secretForm.save")}
      </Button>
    </div>
  </ModalFrame>
);
