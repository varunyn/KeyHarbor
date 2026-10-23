import { i18n } from "../renderer/i18n";
import { Button } from "../renderer/ui/button";
import { Input } from "../renderer/ui/input";
import { Select } from "../renderer/ui/select";
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
    <p className="text-muted-foreground mb-4 font-mono text-xs">
      {t("project.environments.current", {
        name: current?.name || t("project.environments.unknown"),
      })}
    </p>
    <div className="mb-3 space-y-1.5">
      <label
        htmlFor="environmentNameInput"
        className="text-foreground block text-xs font-medium"
      >
        {t("project.environments.nameLabel")}
      </label>
      <Input
        id="environmentNameInput"
        value={name}
        placeholder={t("project.environments.namePlaceholder")}
        autoComplete="off"
        onChange={(event) => onNameChange(event.target.value)}
      />
      {error && (
        <p className="text-destructive mt-1 text-xs" role="alert">
          {error}
        </p>
      )}
    </div>
    <div className="mb-4 flex gap-2">
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
      <div className="mb-3 space-y-1.5">
        <label
          htmlFor="replacementEnvironment"
          className="text-foreground block text-xs font-medium"
        >
          {t("project.environments.replacementLabel")}
        </label>
        <Select
          id="replacementEnvironment"
          className="w-full"
          value={replacementId}
          onValueChange={onReplacementChange}
          options={alternatives.map((entry) => ({
            label: entry.name,
            value: entry.id,
          }))}
        />
        <p className="border-warning/20 bg-warning/10 text-warning mt-1 rounded-lg border p-2.5 text-xs">
          {t("project.environments.replacementWarning", {
            name:
              alternatives.find((entry) => entry.id === replacementId)?.name ||
              "—",
          })}
        </p>
      </div>
    )}
    <p className="text-muted-foreground mb-4 text-xs">
      {current
        ? t("project.environments.deleteDetails", {
            count: current.secretCount,
            name: current.name,
          })
        : ""}
    </p>
    {alternatives.length === 0 && (
      <p className="border-warning/20 bg-warning/10 text-warning mb-4 rounded-lg border p-2.5 text-xs">
        {t("project.environments.lastEnvironment")}
      </p>
    )}
    <div className="border-border flex justify-end gap-2 border-t pt-3">
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
      <p className="border-warning/20 bg-warning/10 text-warning mb-4 rounded-lg border p-3 text-xs">
        {t("project.environments.deleteConfirm", {
          count: current?.secretCount ?? 0,
          defaultWarning,
          name: current?.name ?? "",
        })}
      </p>
      {error && (
        <div className="mb-4">
          <p className="text-destructive text-xs" role="alert">
            {error}
          </p>
        </div>
      )}
      <div className="border-border flex justify-end gap-2 border-t pt-3">
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
