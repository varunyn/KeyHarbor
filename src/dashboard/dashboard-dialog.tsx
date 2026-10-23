import type React from "react";

import { Button } from "../renderer/ui/button";
import { Input } from "../renderer/ui/input";
import { ModalDialog } from "../renderer/ui/modal-dialog";
import { PasswordInput } from "../renderer/ui/password-input";
import { t } from "./dashboard-display";
import type { DialogForm, DialogKind } from "./dashboard-types";

const DIALOG_TITLES: Record<NonNullable<DialogKind>, string> = {
  "create-vault": "vault.create.title",
  "import-vault": "vault.import.title",
  project: "dashboard.addProjectModal.title",
  "rename-vault": "vault.rename.title",
};

export const DashboardDialog = ({
  dialog,
  dialogRef,
  form,
  actionBusy,
  onClose,
  onFieldChange,
  onBrowseFolder,
  onSubmitProject,
  onSubmitVaultCreate,
  onSubmitVaultImport,
  onSubmitVaultRename,
}: {
  dialog: DialogKind;
  dialogRef: React.RefObject<HTMLDivElement | null>;
  form: DialogForm;
  actionBusy: string | null;
  onClose: () => void;
  onFieldChange: (field: keyof DialogForm, value: string) => void;
  onBrowseFolder: (target: "create-vault" | "import-vault") => void;
  onSubmitProject: () => void;
  onSubmitVaultCreate: () => void;
  onSubmitVaultImport: () => void;
  onSubmitVaultRename: () => void;
}) => {
  if (!dialog) {
    return null;
  }
  const dialogTitle = t(DIALOG_TITLES[dialog]);
  const fields: Record<NonNullable<DialogKind>, string> = {
    "create-vault": "#vault-create-name",
    "import-vault": "#vault-import-path",
    project: "#project-name",
    "rename-vault": "#vault-rename-input",
  };

  return (
    <ModalDialog
      open
      onClose={onClose}
      contentRef={dialogRef}
      title={dialogTitle}
      className="max-w-[440px]"
      initialFocusSelector={fields[dialog]}
      footer={
        <div className="modal-footer border-border flex justify-end gap-2 border-t pt-3">
          <Button
            variant="secondary"
            type="button"
            className="dh-btn dh-btn-secondary"
            onClick={onClose}
          >
            {t("common.cancel")}
          </Button>
          {dialog === "project" && (
            <Button
              variant="default"
              type="button"
              className="dh-btn dh-btn-primary"
              id="confirm-add-project"
              disabled={actionBusy !== null}
              onClick={onSubmitProject}
            >
              {t("dashboard.addProjectModal.add")}
            </Button>
          )}
          {dialog === "create-vault" && (
            <Button
              variant="default"
              type="button"
              className="dh-btn dh-btn-primary"
              id="vault-create-submit"
              disabled={actionBusy !== null}
              onClick={onSubmitVaultCreate}
            >
              {t("vault.create.submit")}
            </Button>
          )}
          {dialog === "import-vault" && (
            <Button
              variant="default"
              type="button"
              className="dh-btn dh-btn-primary"
              id="vault-import-submit"
              disabled={actionBusy !== null}
              onClick={onSubmitVaultImport}
            >
              {t("vault.import.submit")}
            </Button>
          )}
          {dialog === "rename-vault" && (
            <Button
              variant="default"
              type="button"
              className="dh-btn dh-btn-primary"
              id="vault-rename-submit"
              disabled={actionBusy !== null}
              onClick={onSubmitVaultRename}
            >
              {t("vault.rename.submit")}
            </Button>
          )}
        </div>
      }
    >
      <div className="modal-body space-y-4 py-2">
        {dialog === "project" && (
          <div className="input-group space-y-1.5">
            <label
              htmlFor="project-name"
              id="label-project-name"
              className="text-muted-foreground block text-xs font-medium"
            >
              {t("dashboard.addProjectModal.label")}
            </label>
            <Input
              id="project-name"
              type="text"
              autoComplete="off"
              placeholder={t("dashboard.addProjectModal.placeholder")}
              value={form.projectName}
              onChange={(event) =>
                onFieldChange("projectName", event.target.value)
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  onSubmitProject();
                }
              }}
              className="bg-secondary/50"
            />
          </div>
        )}
        {dialog === "create-vault" && (
          <>
            <div className="input-group space-y-1.5">
              <label
                htmlFor="vault-create-name"
                className="text-muted-foreground block text-xs font-medium"
              >
                {t("vault.create.nameLabel")}
              </label>
              <Input
                id="vault-create-name"
                type="text"
                autoComplete="off"
                placeholder={t("vault.create.namePlaceholder")}
                value={form.vaultName}
                onChange={(event) =>
                  onFieldChange("vaultName", event.target.value)
                }
                className="bg-secondary/50"
              />
            </div>
            <div className="input-group space-y-1.5">
              <label
                htmlFor="vault-create-path"
                className="text-muted-foreground block text-xs font-medium"
              >
                {t("vault.create.pathLabel")}
              </label>
              <div className="input-row flex gap-2">
                <Input
                  id="vault-create-path"
                  type="text"
                  readOnly
                  placeholder={t("vault.create.pathPlaceholder")}
                  value={form.folderPath}
                  className="bg-secondary/50 flex-1"
                />
                <Button
                  variant="secondary"
                  type="button"
                  className="dh-btn dh-btn-secondary"
                  id="vault-create-browse"
                  disabled={actionBusy !== null}
                  onClick={() => onBrowseFolder("create-vault")}
                >
                  {t("vault.create.browse")}
                </Button>
              </div>
            </div>
            <div className="input-group space-y-1.5">
              <label
                htmlFor="vault-create-password"
                className="text-muted-foreground block text-xs font-medium"
              >
                {t("vault.create.passwordLabel")}
              </label>
              <PasswordInput
                id="vault-create-password"
                autoComplete="new-password"
                placeholder={t("vault.create.passwordPlaceholder")}
                value={form.password}
                onChange={(event) =>
                  onFieldChange("password", event.target.value)
                }
                className="bg-secondary/50"
              />
            </div>
            <div className="input-group space-y-1.5">
              <label
                htmlFor="vault-create-confirm"
                className="text-muted-foreground block text-xs font-medium"
              >
                {t("vault.create.confirmLabel")}
              </label>
              <PasswordInput
                id="vault-create-confirm"
                autoComplete="new-password"
                placeholder={t("vault.create.confirmPlaceholder")}
                value={form.passwordConfirm}
                onChange={(event) =>
                  onFieldChange("passwordConfirm", event.target.value)
                }
                className="bg-secondary/50"
              />
            </div>
          </>
        )}
        {dialog === "import-vault" && (
          <>
            <div className="input-group space-y-1.5">
              <label
                htmlFor="vault-import-path"
                className="text-muted-foreground block text-xs font-medium"
              >
                {t("vault.import.pathLabel")}
              </label>
              <div className="input-row flex gap-2">
                <Input
                  id="vault-import-path"
                  type="text"
                  readOnly
                  placeholder={t("vault.import.pathPlaceholder")}
                  value={form.folderPath}
                  className="bg-secondary/50 flex-1"
                />
                <Button
                  variant="secondary"
                  type="button"
                  className="dh-btn dh-btn-secondary"
                  id="vault-import-browse"
                  disabled={actionBusy !== null}
                  onClick={() => onBrowseFolder("import-vault")}
                >
                  {t("vault.import.browse")}
                </Button>
              </div>
            </div>
            <div className="input-group space-y-1.5">
              <label
                htmlFor="vault-import-name"
                className="text-muted-foreground block text-xs font-medium"
              >
                {t("vault.import.nameLabel")}
              </label>
              <Input
                id="vault-import-name"
                type="text"
                autoComplete="off"
                placeholder={t("vault.import.namePlaceholder")}
                value={form.vaultName}
                onChange={(event) =>
                  onFieldChange("vaultName", event.target.value)
                }
                className="bg-secondary/50"
              />
            </div>
            <div className="input-group space-y-1.5">
              <label
                htmlFor="vault-import-password"
                className="text-muted-foreground block text-xs font-medium"
              >
                {t("vault.import.passwordLabel")}
              </label>
              <PasswordInput
                id="vault-import-password"
                autoComplete="current-password"
                placeholder={t("vault.import.passwordPlaceholder")}
                value={form.password}
                onChange={(event) =>
                  onFieldChange("password", event.target.value)
                }
                className="bg-secondary/50"
              />
              <p className="input-desc text-muted-foreground mt-1 text-xs">
                {t("vault.import.passwordDesc")}
              </p>
            </div>
          </>
        )}
        {dialog === "rename-vault" && (
          <div className="input-group space-y-1.5">
            <label
              htmlFor="vault-rename-input"
              className="text-muted-foreground block text-xs font-medium"
            >
              {t("vault.rename.label")}
            </label>
            <Input
              id="vault-rename-input"
              type="text"
              autoComplete="off"
              placeholder={t("vault.rename.placeholder")}
              value={form.vaultName}
              onChange={(event) =>
                onFieldChange("vaultName", event.target.value)
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  onSubmitVaultRename();
                }
              }}
              className="bg-secondary/50"
            />
          </div>
        )}
        <p
          className="modal-error text-destructive mt-1 min-h-[1.25rem] text-xs"
          role="alert"
        >
          {form.error}
        </p>
      </div>
    </ModalDialog>
  );
};
