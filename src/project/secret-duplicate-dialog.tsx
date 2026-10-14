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
        <select
          id="duplicateTarget"
          className="bg-card border-border text-foreground focus:ring-primary w-full rounded-lg border px-3 py-2 text-xs focus:ring-1 focus:outline-hidden"
          value={duplicateTarget}
          onChange={(event) => onProjectChange(event.target.value)}
        >
          {otherProjects.map((project) => (
            <option key={project.name} value={project.name}>
              {project.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5" id="fieldDuplicateEnvironment">
        <label
          htmlFor="duplicateEnvironment"
          className="text-foreground block text-xs font-medium"
        >
          {t("project.duplicateModal.environmentLabel")}
        </label>
        <select
          id="duplicateEnvironment"
          className="bg-card border-border text-foreground focus:ring-primary w-full rounded-lg border px-3 py-2 text-xs focus:ring-1 focus:outline-hidden disabled:opacity-50"
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
