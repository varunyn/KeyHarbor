import { i18n } from "../renderer/i18n";
import { Button } from "../renderer/ui/button";
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
    <div className="modal-header">
      <ModalTitle>
        {t("project.duplicateModal.title", { key: actionKey })}
      </ModalTitle>
    </div>
    <p className="environment-context">{contextLabel}</p>
    <div className={`sl-field${fieldErrors.duplicate ? " invalid" : ""}`}>
      <label htmlFor="duplicateTarget">
        {t("project.duplicateModal.targetLabel")}
      </label>
      <select
        id="duplicateTarget"
        value={duplicateTarget}
        onChange={(event) => onProjectChange(event.target.value)}
      >
        {otherProjects.map((project) => (
          <option key={project.name} value={project.name}>
            {project.name}
          </option>
        ))}
      </select>
      <div className="sl-field">
        <label htmlFor="duplicateEnvironment">
          {t("project.duplicateModal.environmentLabel")}
        </label>
        <select
          id="duplicateEnvironment"
          value={duplicateEnvironmentId}
          disabled={!duplicateEnvironments.length || actionBusy}
          onChange={(event) => setDuplicateEnvironmentId(event.target.value)}
        >
          {duplicateEnvironments.map((environment) => (
            <option key={environment.id} value={environment.id}>
              {environment.name}
              {environment.isDefault
                ? ` · ${t("project.environments.default")}`
                : ""}
            </option>
          ))}
        </select>
      </div>
      <p className="sl-field-error" id="duplicateError">
        {fieldErrors.duplicate}
      </p>
    </div>
    <div className="modal-actions">
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
