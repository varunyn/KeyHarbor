import { i18n } from "../renderer/i18n";
import { Button } from "../renderer/ui/button";
import { Select } from "../renderer/ui/select";
import type { ProjectRecord, EnvironmentSummary } from "./bridge";
import { ModalFrame, ModalTitle } from "./components";
import { DialogCloseButton } from "./dialog-close-button";

const t = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars);
interface SecretDuplicateDialogProps {
  actionKey: string;
  contextLabel: string;
  fieldErrors: Record<string, string>;
  duplicateTarget: string;
  duplicateEnvironmentId: string;
  duplicateEnvironments: EnvironmentSummary[];
  otherProjects: ProjectRecord[];
  actionBusy: boolean;
  closeModal: () => void;
  onProjectChange: (name: string) => void;
  setDuplicateEnvironmentId: (id: string) => void;
  duplicateSecret: () => Promise<void>;
}

export const SecretDuplicateDialog = ({
  actionKey,
  contextLabel,
  fieldErrors,
  duplicateTarget,
  duplicateEnvironmentId,
  duplicateEnvironments,
  otherProjects,
  actionBusy,
  closeModal,
  onProjectChange,
  setDuplicateEnvironmentId,
  duplicateSecret,
}: SecretDuplicateDialogProps) => (
  <ModalFrame id="duplicateModalOverlay" onClose={closeModal}>
    <div className="mb-4">
      <ModalTitle>
        {t("project.duplicateModal.title", { key: actionKey })}
      </ModalTitle>
      <p className="text-muted-foreground mt-1 font-mono text-xs">
        {contextLabel}
      </p>
    </div>
    <div className="mb-6 space-y-4">
      <div className="space-y-1.5" id="fieldDuplicateTarget">
        <label
          htmlFor="duplicateTarget"
          className="text-foreground block text-xs font-medium"
        >
          {t("project.duplicateModal.targetLabel")}
        </label>
        <Select
          id="duplicateTarget"
          className="w-full"
          value={duplicateTarget}
          onValueChange={onProjectChange}
          options={otherProjects.map((project) => ({
            label: project.name,
            value: project.name,
          }))}
        />
      </div>
      <div className="space-y-1.5" id="fieldDuplicateEnvironment">
        <label
          htmlFor="duplicateEnvironment"
          className="text-foreground block text-xs font-medium"
        >
          {t("project.duplicateModal.environmentLabel")}
        </label>
        <Select
          id="duplicateEnvironment"
          className="w-full"
          value={duplicateEnvironmentId}
          disabled={!duplicateEnvironments.length || actionBusy}
          onValueChange={setDuplicateEnvironmentId}
          options={duplicateEnvironments.map((environment) => ({
            label: `${environment.name}${environment.isDefault ? ` · ${t("project.environments.default")}` : ""}`,
            value: environment.id,
          }))}
        />
      </div>
      {fieldErrors.duplicate && (
        <p className="text-destructive mt-1 text-xs" id="duplicateError">
          {fieldErrors.duplicate}
        </p>
      )}
    </div>
    <div className="border-border flex justify-end gap-2 border-t pt-3">
      <DialogCloseButton onClose={closeModal} />
      <Button
        variant="default"
        type="button"
        id="duplicateConfirmBtn"
        disabled={!duplicateTarget || !duplicateEnvironmentId || actionBusy}
        onClick={duplicateSecret}
      >
        {t("project.duplicateModal.confirm")}
      </Button>
    </div>
  </ModalFrame>
);
