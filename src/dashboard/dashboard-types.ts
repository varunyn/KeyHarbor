export type ViewMode = "grid" | "list";
export type SortMode = "recent" | "name" | "secrets";
export type DialogKind =
  | "project"
  | "create-vault"
  | "import-vault"
  | "rename-vault"
  | null;

export interface DialogForm {
  projectName: string;
  vaultName: string;
  folderPath: string;
  password: string;
  passwordConfirm: string;
  renameVaultId: string;
  error: string;
}

export type LoadState = "loading" | "ready" | "error";
export type AccessTimes = Record<string, number>;

export const blankForm = (): DialogForm => ({
  error: "",
  folderPath: "",
  password: "",
  passwordConfirm: "",
  projectName: "",
  renameVaultId: "",
  vaultName: "",
});
