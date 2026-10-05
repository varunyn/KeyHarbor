import { i18n } from "../renderer/i18n";
import { Button } from "../renderer/ui/button";
import { Input } from "../renderer/ui/input";
import type { EnvironmentSummary } from "./bridge";

const t = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars);

interface ManagerFormProps {
  alternatives: EnvironmentSummary[];
  busy: boolean;
  current: EnvironmentSummary | undefined;
  error: string;
  name: string;
  onClose: () => void;
  onCreate: () => void;
  onDelete: () => void;
  onNameChange: (name: string) => void;
  onRename: () => void;
  onReplacementChange: (environmentId: string) => void;
  replacementId: string;
}

export const ManagerForm = ({
  alternatives,
  busy,
  current,
  error,
  name,
  onClose,
  onCreate,
  onDelete,
  onNameChange,
  onRename,
  onReplacementChange,
  replacementId,
}: ManagerFormProps) => (
  <>
    <p className="environment-context">
      {t("project.environments.current", {
        name: current?.name || t("project.environments.unknown"),
      })}
    </p>
    <div className={`sl-field${error ? " invalid" : ""}`}>
      <label htmlFor="environmentNameInput">
        {t("project.environments.nameLabel")}
      </label>
      <Input
        id="environmentNameInput"
        value={name}
        placeholder={t("project.environments.namePlaceholder")}
        autoComplete="off"
        onChange={(event) => onNameChange(event.target.value)}
      />
      <p className="sl-field-error" role="alert">
        {error}
      </p>
    </div>
    <div className="environment-management-actions">
      <Button
        variant="default"
        type="button"
        disabled={busy || !name.trim()}
        onClick={onCreate}
      >
        {t("project.environments.create")}
      </Button>
      <Button
        variant="secondary"
        type="button"
        disabled={busy || !name.trim() || !current}
        onClick={onRename}
      >
        {t("project.environments.rename")}
      </Button>
    </div>
    {current?.isDefault && alternatives.length > 0 && (
      <div className="sl-field environment-replacement-field">
        <label htmlFor="replacementEnvironment">
          {t("project.environments.replacementLabel")}
        </label>
        <select
          id="replacementEnvironment"
          value={replacementId}
          onChange={(event) => onReplacementChange(event.target.value)}
        >
          {alternatives.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
        <p className="environment-warning">
          {t("project.environments.replacementWarning", {
            name:
              alternatives.find((entry) => entry.id === replacementId)?.name ||
              "—",
          })}
        </p>
      </div>
    )}
    <p className="modal-sub environment-delete-details">
      {current
        ? t("project.environments.deleteDetails", {
            count: current.secretCount,
            name: current.name,
          })
        : ""}
    </p>
    {alternatives.length === 0 && (
      <p className="environment-warning">
        {t("project.environments.lastEnvironment")}
      </p>
    )}
    <div className="modal-actions">
      <Button
        variant="secondary"
        type="button"
        disabled={busy}
        onClick={onClose}
      >
        {t("common.close")}
      </Button>
      <Button
        variant="destructive"
        type="button"
        disabled={
          busy ||
          alternatives.length === 0 ||
          (Boolean(current?.isDefault) && !replacementId)
        }
        onClick={onDelete}
      >
        {t("project.environments.delete")}
      </Button>
    </div>
  </>
);

interface DeleteConfirmationProps {
  alternatives: EnvironmentSummary[];
  busy: boolean;
  canDelete: boolean;
  current: EnvironmentSummary | undefined;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
  replacementId: string;
}

export const EnvironmentDeleteConfirmation = ({
  alternatives,
  busy,
  canDelete,
  current,
  error,
  onCancel,
  onConfirm,
  replacementId,
}: DeleteConfirmationProps) => {
  const defaultWarning = current?.isDefault
    ? ` ${t("project.environments.omittedSelectorWarning", { name: alternatives.find((entry) => entry.id === replacementId)?.name || "" })}`
    : "";
  return (
    <>
      <p className="environment-warning">
        {t("project.environments.deleteConfirm", {
          count: current?.secretCount ?? 0,
          defaultWarning,
          name: current?.name ?? "",
        })}
      </p>
      <div className={error ? "sl-field invalid" : "sl-field"}>
        <p className="sl-field-error" role="alert">
          {error}
        </p>
      </div>
      <div className="modal-actions">
        <Button
          variant="secondary"
          id="environmentDeleteCancelButton"
          type="button"
          disabled={busy}
          onClick={onCancel}
        >
          {t("common.cancel")}
        </Button>
        <Button
          variant="destructive"
          id="environmentDeleteConfirmButton"
          type="button"
          disabled={busy || !canDelete}
          onClick={onConfirm}
        >
          {t("project.environments.delete")}
        </Button>
      </div>
    </>
  );
};
