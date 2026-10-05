import { useState } from "react";

import { i18n } from "../renderer/i18n";
import { Button } from "../renderer/ui/button";
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
  projectName: string;
  vaultInstanceId: string | null;
  lifetimeRevision: number;
  target: EnvironmentTarget | null;
  environments: EnvironmentSummary[];
  disabled?: boolean;
  onSelect: (environmentId: string) => void;
  onStructureChanged: (preferredEnvironmentId?: string) => Promise<void>;
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
        type="button"
        className="sl-btn sl-btn-secondary environment-manage-button"
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
          <div className="modal-header">
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
        className="environment-tabs"
        aria-label={t("project.environments.selectorLabel")}
      >
        {environments.map((environment) => (
          <Button
            variant="ghost"
            type="button"
            key={environment.id}
            aria-pressed={environment.id === target?.environmentId}
            disabled={disabled || busy}
            title={environment.name}
            onClick={() => onSelect(environment.id)}
          >
            {environment.name}
          </Button>
        ))}
      </fieldset>
      <label className="environment-picker-label" htmlFor="environmentPicker">
        <span>{t("project.environments.label")}</span>
        <select
          id="environmentPicker"
          aria-label={t("project.environments.selectorLabel")}
          value={target?.environmentId ?? ""}
          disabled={!environments.length || disabled || busy}
          onChange={(event) => onSelect(event.target.value)}
        >
          {environments.map((environment) => (
            <option key={environment.id} value={environment.id}>
              {environment.name}
              {environment.isDefault
                ? ` · ${t("project.environments.default")}`
                : ""}
            </option>
          ))}
        </select>
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
