import { useState } from "react";

import { i18n } from "../renderer/i18n";
import { Button } from "../renderer/ui/button";
import { Select } from "../renderer/ui/select";
import { cn } from "../renderer/ui/utils";
import type { EnvironmentSummary, EnvironmentTarget } from "./bridge";
import { ModalFrame, ModalTitle } from "./components";
import { useEnvironmentLifetime } from "./environment-lifetime";
import {
  EnvironmentDeleteConfirmation,
  ManagerForm,
} from "./environment-manager-form";
import { performEnvironmentMutation } from "./environment-mutation";
import type { EnvironmentMutation } from "./environment-mutation";

const t = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars);

interface EnvironmentControlsProps {
  disabled?: boolean;
  environments: EnvironmentSummary[];
  lifetimeRevision: number;
  onSelect: (environmentId: string) => void;
  onStructureChanged: (preferredEnvironmentId?: string) => Promise<void>;
  projectName: string;
  target: EnvironmentTarget | null;
  vaultInstanceId: string | null;
}

interface ManagerProps {
  alternatives: EnvironmentSummary[];
  busy: boolean;
  current: EnvironmentSummary | undefined;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onStructureChanged: (preferredEnvironmentId?: string) => Promise<void>;
  projectName: string;
  target: EnvironmentTarget | null;
}

const EnvironmentManager = ({
  alternatives,
  busy,
  current,
  disabled,
  onBusyChange,
  onStructureChanged,
  projectName,
  target,
}: ManagerProps) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [replacementId, setReplacementId] = useState("");
  const [error, setError] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { isCurrent, retire } = useEnvironmentLifetime();

  const closeManager = () => {
    if (!busy) {
      setOpen(false);
    }
  };
  const run = (
    execute: EnvironmentMutation["execute"],
    fallbackError: string,
    closeAfterSuccess: boolean
  ) => {
    const operation = retire();
    onBusyChange(true);
    setError("");
    performEnvironmentMutation({
      execute,
      fallbackError,
      isCurrent: () => isCurrent(operation),
      onFailure: setError,
      onSettled: () => onBusyChange(false),
      onSuccess: async (environmentId) => {
        await onStructureChanged(environmentId);
        if (!isCurrent(operation)) {
          return;
        }
        setName("");
        if (closeAfterSuccess) {
          setOpen(false);
        }
      },
    });
  };
  const create = () => {
    if (!name.trim() || busy) {
      return;
    }
    run(
      async () => {
        const result = await window.keyharbor.projects.createEnvironment(
          projectName,
          name
        );
        return result.success
          ? { environmentId: result.environment.id, success: true }
          : result;
      },
      t("project.environments.saveFailed"),
      true
    );
  };
  const rename = () => {
    if (!target || !name.trim() || busy) {
      return;
    }
    run(
      async () => {
        const result = await window.keyharbor.projects.renameEnvironment(
          { ...target },
          name
        );
        return result.success
          ? { environmentId: target.environmentId, success: true }
          : result;
      },
      t("project.environments.saveFailed"),
      false
    );
  };
  const canDelete = Boolean(
    target && current && !busy && alternatives.length > 0
  );
  const replacement = current?.isDefault ? replacementId : undefined;
  const validReplacement =
    !current?.isDefault ||
    alternatives.some((entry) => entry.id === replacementId);
  const requestDelete = () => {
    if (canDelete && validReplacement) {
      setError("");
      setConfirmingDelete(true);
    }
  };
  const remove = () => {
    if (!target || !canDelete || !validReplacement || !confirmingDelete) {
      return;
    }
    run(
      async () => {
        const result = await window.keyharbor.projects.deleteEnvironment(
          { ...target },
          replacement
        );
        return result.success
          ? { environmentId: result.defaultEnvironmentId, success: true }
          : result;
      },
      t("project.environments.deleteFailed"),
      true
    );
  };
  const showManager = () => {
    setName("");
    setError("");
    setConfirmingDelete(false);
    setReplacementId(alternatives[0]?.id ?? "");
    setOpen(true);
  };
  const cancelDelete = () => {
    if (!busy) {
      setConfirmingDelete(false);
      setError("");
    }
  };

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        type="button"
        className="environment-manage-button h-8 px-3 text-xs font-medium"
        onClick={showManager}
        disabled={!target || disabled || busy}
      >
        {t("project.environments.manage")}
      </Button>
      {open && (
        <ModalFrame
          id="environmentManagerOverlay"
          initialFocusId={
            confirmingDelete
              ? "environmentDeleteCancelButton"
              : "environmentNameInput"
          }
          onClose={closeManager}
        >
          <div className="mb-4">
            <ModalTitle>{t("project.environments.manageTitle")}</ModalTitle>
          </div>
          {confirmingDelete ? (
            <EnvironmentDeleteConfirmation
              alternatives={alternatives}
              busy={busy}
              canDelete={canDelete && validReplacement}
              current={current}
              error={error}
              onCancel={cancelDelete}
              onConfirm={remove}
              replacementId={replacementId}
            />
          ) : (
            <ManagerForm
              alternatives={alternatives}
              busy={busy}
              current={current}
              error={error}
              name={name}
              onClose={closeManager}
              onCreate={create}
              onDelete={requestDelete}
              onNameChange={setName}
              onRename={rename}
              onReplacementChange={setReplacementId}
              replacementId={replacementId}
            />
          )}
        </ModalFrame>
      )}
    </>
  );
};

export const EnvironmentControls = ({
  disabled = false,
  ...props
}: EnvironmentControlsProps) => {
  const {
    environments,
    lifetimeRevision,
    onSelect,
    projectName,
    target,
    vaultInstanceId,
  } = props;
  const current = environments.find(
    (entry) => entry.id === target?.environmentId
  );
  const alternatives = environments.filter((entry) => entry.id !== current?.id);
  const scopeKey = JSON.stringify([
    lifetimeRevision,
    vaultInstanceId,
    projectName,
    target?.environmentId,
    current?.name,
  ]);
  const [busyScope, setBusyScope] = useState({ busy: false, scopeKey: "" });
  const busy = busyScope.scopeKey === scopeKey && busyScope.busy;

  return (
    <>
      <fieldset
        className="bg-secondary/60 border-border environment-tabs inline-flex items-center gap-1 rounded-lg border p-1 max-md:hidden"
        aria-label={t("project.environments.selectorLabel")}
      >
        {environments.map((environment) => {
          const isActive = environment.id === target?.environmentId;
          return (
            <Button
              variant={isActive ? "secondary" : "ghost"}
              size="sm"
              type="button"
              key={environment.id}
              className={cn(
                "h-7 rounded-md px-3 text-xs font-medium transition-all",
                isActive
                  ? "bg-primary/10 text-primary font-semibold shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
              aria-pressed={isActive}
              disabled={disabled || busy}
              title={environment.name}
              onClick={() => onSelect(environment.id)}
            >
              {environment.name}
            </Button>
          );
        })}
      </fieldset>
      <label
        className="flex items-center gap-2 text-xs md:hidden"
        htmlFor="environmentPicker"
      >
        <span className="text-muted-foreground">
          {t("project.environments.label")}
        </span>
        <Select
          id="environmentPicker"
          aria-label={t("project.environments.selectorLabel")}
          value={target?.environmentId ?? ""}
          disabled={!environments.length || disabled || busy}
          onValueChange={onSelect}
          options={environments.map((environment) => ({
            label: `${environment.name}${environment.isDefault ? ` · ${t("project.environments.default")}` : ""}`,
            value: environment.id,
          }))}
        />
      </label>
      <EnvironmentManager
        key={scopeKey}
        alternatives={alternatives}
        busy={busy}
        current={current}
        disabled={disabled}
        onBusyChange={(value) => setBusyScope({ busy: value, scopeKey })}
        onStructureChanged={props.onStructureChanged}
        projectName={projectName}
        target={target}
      />
    </>
  );
};
