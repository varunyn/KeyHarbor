import {
  Activity,
  AlertCircle,
  ArrowRight,
  ChevronDown,
  Clock,
  Database,
  Download,
  Folder,
  Key,
  LayoutGrid,
  List,
  Loader2,
  Lock,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Star,
} from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import logoUrl from "../assets/icon.png";
import type {
  BridgeResult,
  ProjectRecord,
  ProjectStatistics,
  VaultListEntry,
} from "../project/bridge";
import { runWithCleanup as finalizeOperation } from "../renderer/async-operation";
import { i18n } from "../renderer/i18n";
import { mountRenderer } from "../renderer/mount";
import { notificationManager } from "../renderer/notifications";
import {
  RendererProviders,
  useRendererTranslation,
} from "../renderer/providers";
import { Button } from "../renderer/ui/button";
import { useConfirmation } from "../renderer/ui/confirmation";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "../renderer/ui/dropdown-menu";
import { Input } from "../renderer/ui/input";
import { ModalDialog } from "../renderer/ui/modal-dialog";
import { topBarClass } from "../renderer/ui/nav-bar";
import { PasswordInput } from "../renderer/ui/password-input";
import { SidebarToggle } from "../renderer/ui/sidebar-toggle";
import { cn } from "../renderer/ui/utils";
import {
  closeNarrowSidebar,
  useSidebarState,
} from "../renderer/use-sidebar-state";
import { nativeWindowStyles } from "../renderer/window-chrome";
import { HomeFolderImport } from "./folder-import";

type ViewMode = "grid" | "list";
type SortMode = "recent" | "name" | "secrets";
type DialogKind =
  | "project"
  | "create-vault"
  | "import-vault"
  | "rename-vault"
  | null;
interface DialogForm {
  projectName: string;
  vaultName: string;
  folderPath: string;
  password: string;
  passwordConfirm: string;
  renameVaultId: string;
  error: string;
}
type LoadState = "loading" | "ready" | "error";
type AccessTimes = Record<string, number>;

const folderNamePattern = /(?<name>[^/\\]+)[/\\]*$/u;

const blankForm = (): DialogForm => ({
  error: "",
  folderPath: "",
  password: "",
  passwordConfirm: "",
  projectName: "",
  renameVaultId: "",
  vaultName: "",
});
const t = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars);
const isBridgeSuccess = <T extends object>(
  value: BridgeResult<T>
): value is Extract<BridgeResult<T>, { success: true }> => value.success;

const ICON_MAP: Record<
  string,
  React.ComponentType<{
    className?: string;
    "aria-hidden"?: boolean | "true" | "false";
  }>
> = {
  activity: Activity,
  "arrow-right": ArrowRight,
  "chevron-down": ChevronDown,
  "circle-alert": AlertCircle,
  clock: Clock,
  download: Download,
  ellipsis: MoreHorizontal,
  folder: Folder,
  grid: LayoutGrid,
  key: Key,
  list: List,
  lock: Lock,
  plus: Plus,
  search: Search,
  settings: Settings,
  star: Star,
  vault: Database,
};

const Icon = ({
  name,
  className = "",
}: {
  name: string;
  className?: string;
}) => {
  const Comp = ICON_MAP[name];
  if (!Comp) {
    return (
      <span
        className={`lk-icon lk-icon-${name}${className ? ` ${className}` : ""}`}
        aria-hidden="true"
      />
    );
  }
  return (
    <Comp
      className={cn("inline-block size-4 shrink-0 align-middle", className)}
      aria-hidden="true"
    />
  );
};

const MONOGRAM_TONES = [
  "bg-sky-500/15 text-sky-400 border border-sky-500/30",
  "bg-success/15 text-success border border-success/30",
  "bg-warning/15 text-warning border border-warning/30",
  "bg-purple-500/15 text-purple-400 border border-purple-500/30",
  "bg-teal-500/15 text-teal-400 border border-teal-500/30",
  "bg-muted text-muted-foreground border border-border",
];

const monogram = (name: string) => {
  const clean = name.replaceAll(/[^A-Za-z0-9]/gu, "").toUpperCase();
  let hash = 0;
  // Split UTF-16 units to keep existing project colors stable for all names.
  for (const character of name.split("")) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % 4_294_967_296;
  }
  return {
    initials: (clean.slice(0, 2) || "?").padEnd(2, "·"),
    tone: hash % 6,
  };
};

const formatDate = (value: string | undefined, now: number) => {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "—";
  }
  const days = Math.floor((now - date.getTime()) / 86_400_000);
  if (days <= 0) {
    return t("dashboard.time.today");
  }
  if (days === 1) {
    return t("dashboard.time.yesterday");
  }
  if (days < 7) {
    return t("dashboard.time.daysAgo", { count: days });
  }
  if (days < 30) {
    return t("dashboard.time.weeksAgo", { count: Math.floor(days / 7) });
  }
  return date.toLocaleDateString();
};

const formatAccessTime = (timestamp: number, now: number) => {
  const minutes = Math.floor((now - timestamp) / 60_000);
  if (minutes < 1) {
    return t("dashboard.time.justNow");
  }
  if (minutes < 60) {
    return t("dashboard.time.minutesAgo", { count: minutes });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return t("dashboard.time.hoursAgo", { count: hours });
  }
  return formatDate(new Date(timestamp).toISOString(), now);
};

const isToday = (value?: string) => {
  if (!value) {
    return false;
  }
  const date = new Date(value);
  const today = new Date();
  return (
    Number.isFinite(date.getTime()) &&
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
};

const openProject = (name: string) => {
  window.location.href = `project.html?name=${encodeURIComponent(name)}`;
};

const selectActiveVault = (
  vaults: VaultListEntry[],
  activeVaultId: string | null
) =>
  vaults.find((vault) => vault.id === activeVaultId) ??
  vaults.find((vault) => vault.isActive) ??
  vaults[0] ??
  null;

const collectAccessTimes = (
  nextProjects: ProjectRecord[],
  logResult: BridgeResult<{
    data: { timestamp: string; category: string; message: string }[];
  }>
) => {
  const nextAccess: AccessTimes = Object.create(null) as AccessTimes;
  if (
    isBridgeSuccess<{
      data: { timestamp: string; category: string; message: string }[];
    }>(logResult)
  ) {
    for (const log of logResult.data) {
      if (log.category !== "access") {
        continue;
      }
      const timestamp = Date.parse(log.timestamp);
      if (!Number.isFinite(timestamp)) {
        continue;
      }
      for (const project of nextProjects) {
        const previousAccess = nextAccess[project.name];
        if (
          log.message.includes(`Project: ${project.name}`) &&
          (previousAccess === undefined || timestamp > previousAccess)
        ) {
          nextAccess[project.name] = timestamp;
        }
      }
    }
  }
  return nextAccess;
};

const requireProjectData = (
  result: BridgeResult<{ data: ProjectRecord[] }>
): ProjectRecord[] => {
  if (!isBridgeSuccess<{ data: ProjectRecord[] }>(result)) {
    throw new Error(result.error || "Unable to load projects");
  }
  return result.data;
};

const TONE_CLASSES: Record<string, string> = {
  "text-destructive": "text-destructive",
  "text-warning": "text-warning",
  "tone-amber": "text-warning",
  "tone-red": "text-destructive",
};

const ProjectActions = ({
  project,
  favorite,
  isMenuOpen,
  onToggleFavorite,
  onOpenMenu,
  onDeleteProject,
}: {
  project: ProjectRecord;
  favorite: boolean;
  isMenuOpen: boolean;
  onToggleFavorite: (name: string) => void;
  onOpenMenu: (open: boolean) => void;
  onDeleteProject: (name: string) => void;
}) => (
  <span className="dash-card-actions relative z-10 flex shrink-0 items-center gap-1">
    <Button
      variant="ghost"
      size="icon"
      type="button"
      className={cn(
        "dash-icon-btn text-muted-foreground hover:bg-secondary hover:text-foreground size-8 rounded-lg transition-colors",
        favorite && "is-fav text-warning"
      )}
      aria-pressed={favorite}
      aria-label={t(
        favorite ? "project.removeFromFavorites" : "project.addToFavorites"
      )}
      title={t(
        favorite ? "project.removeFromFavorites" : "project.addToFavorites"
      )}
      onClick={() => onToggleFavorite(project.name)}
    >
      <Icon name="star" />
    </Button>
    <DropdownMenu open={isMenuOpen} onOpenChange={onOpenMenu}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          type="button"
          className="dash-icon-btn text-muted-foreground hover:bg-secondary hover:text-foreground size-8 rounded-lg"
          aria-label={t("dashboard.a11y.menuLabel")}
        >
          <Icon name="ellipsis" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-[140px] p-1"
        onClick={(event) => event.stopPropagation()}
      >
        <DropdownMenuItem
          className="text-destructive focus:text-destructive cursor-pointer rounded-md px-2.5 py-1.5 text-xs"
          onSelect={() => onDeleteProject(project.name)}
        >
          {t("dashboard.deleteProject.deleteBtn")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </span>
);

const ProjectCard = ({
  project,
  access,
  now,
  favorite,
  isMenuOpen,
  onOpenProject,
  onToggleFavorite,
  onOpenMenu,
  onDeleteProject,
}: {
  project: ProjectRecord;
  access?: number;
  now: number;
  favorite: boolean;
  isMenuOpen: boolean;
  onOpenProject: (name: string) => void;
  onToggleFavorite: (name: string) => void;
  onOpenMenu: (open: boolean) => void;
  onDeleteProject: (name: string) => void;
}) => {
  const mark = monogram(project.name);
  const activeToday =
    isToday(project.updatedAt) ||
    (typeof access === "number" &&
      now - access < 86_400_000 &&
      isToday(new Date(access).toISOString()));

  return (
    <article
      className="dash-card group border-border bg-card hover:border-primary/50 relative flex min-h-[220px] cursor-pointer flex-col justify-between rounded-xl border p-5 transition-all duration-150 hover:shadow-md"
      data-list-key={project.name}
    >
      <a
        className="absolute inset-0 z-0 rounded-[inherit]"
        href={`project.html?name=${encodeURIComponent(project.name)}`}
        aria-label={t("dashboard.card.openProject", { name: project.name })}
        onKeyDown={(event) => {
          if (event.key === " ") {
            event.preventDefault();
            onOpenProject(project.name);
          }
        }}
      >
        <span className="sr-only">
          {t("dashboard.card.openProject", { name: project.name })}
        </span>
      </a>
      <div className="dash-card-top mb-2.5 flex items-center gap-3">
        <span
          className={cn(
            "monogram flex size-10 shrink-0 items-center justify-center rounded-lg text-xs font-bold tracking-wider",
            MONOGRAM_TONES[mark.tone]
          )}
          aria-hidden="true"
        >
          {mark.initials}
        </span>
        <span className="dash-card-name text-foreground min-w-0 flex-1 truncate text-base font-semibold">
          {project.name}
        </span>
        <ProjectActions
          project={project}
          favorite={favorite}
          isMenuOpen={isMenuOpen}
          onToggleFavorite={onToggleFavorite}
          onOpenMenu={onOpenMenu}
          onDeleteProject={onDeleteProject}
        />
      </div>
      <p className="dash-card-sub text-muted-foreground mb-3 truncate text-xs">
        {t("dashboard.card.localProject")}
      </p>
      <div className="dash-card-status bg-secondary/60 text-muted-foreground my-2 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs">
        {activeToday ? (
          <span className="active-pill text-success inline-flex items-center gap-1.5 font-medium">
            <span
              className="pill-dot bg-success size-1.5 rounded-full"
              aria-hidden="true"
            />
            {t("dashboard.card.activeToday")}
          </span>
        ) : (
          <>
            <Icon name="key" className="text-primary" />
            <span>{t("dashboard.card.storedLocally")}</span>
          </>
        )}
      </div>
      <div className="dash-card-badges my-2 flex flex-wrap items-center gap-1.5">
        <span className="bg-secondary text-muted-foreground rounded px-2 py-0.5 font-mono text-[11px]">
          {t(
            project.secretCount === 1
              ? "dashboard.secretCountOne"
              : "dashboard.secretCount",
            { count: project.secretCount }
          )}
        </span>
        <span className="bg-secondary text-primary rounded px-2 py-0.5 font-mono text-[11px]">
          {t(
            project.environmentCount === 1
              ? "dashboard.card.environmentOne"
              : "dashboard.card.environments",
            { count: project.environmentCount }
          )}
        </span>
      </div>
      {typeof access === "number" && (
        <p className="dash-card-sub access-line text-muted-foreground mb-2 truncate text-xs tabular-nums">
          {t("dashboard.card.lastAccessed", {
            time: formatAccessTime(access, now),
          })}
        </p>
      )}
      <div className="dash-card-foot border-border text-muted-foreground mt-auto flex items-center justify-between border-t pt-3 text-xs tabular-nums">
        <span>
          {t("dashboard.updated", {
            time: formatDate(project.updatedAt, now),
          })}
        </span>
        <span className="dash-card-open text-muted-foreground group-hover:text-primary inline-flex items-center gap-1 transition-all group-hover:translate-x-0.5">
          {t("dashboard.card.open")}
          <Icon name="arrow-right" />
        </span>
      </div>
    </article>
  );
};

const ProjectRow = ({
  project,
  now,
  favorite,
  isMenuOpen,
  onOpenProject,
  onToggleFavorite,
  onOpenMenu,
  onDeleteProject,
}: {
  project: ProjectRecord;
  now: number;
  favorite: boolean;
  isMenuOpen: boolean;
  onOpenProject: (name: string) => void;
  onToggleFavorite: (name: string) => void;
  onOpenMenu: (open: boolean) => void;
  onDeleteProject: (name: string) => void;
}) => {
  const mark = monogram(project.name);
  return (
    <div
      className="dash-row group bg-card hover:bg-secondary/40 relative flex min-h-[56px] cursor-pointer items-center gap-3 p-3.5 transition-colors"
      data-list-key={project.name}
    >
      <a
        className="absolute inset-0 z-0 rounded-[inherit]"
        href={`project.html?name=${encodeURIComponent(project.name)}`}
        aria-label={t("dashboard.card.openProject", { name: project.name })}
        onKeyDown={(event) => {
          if (event.key === " ") {
            event.preventDefault();
            onOpenProject(project.name);
          }
        }}
      >
        <span className="sr-only">
          {t("dashboard.card.openProject", { name: project.name })}
        </span>
      </a>
      <span
        className={cn(
          "monogram flex size-8 shrink-0 items-center justify-center rounded-md text-xs font-bold tracking-wider",
          MONOGRAM_TONES[mark.tone]
        )}
        aria-hidden="true"
      >
        {mark.initials}
      </span>
      <div className="row-main min-w-0 flex-1">
        <div className="row-name text-foreground truncate text-sm font-semibold">
          {project.name}
        </div>
        <div className="row-sub text-muted-foreground truncate text-xs tabular-nums">
          {t("dashboard.updated", {
            time: formatDate(project.updatedAt, now),
          })}
        </div>
      </div>
      <div className="row-meta text-muted-foreground px-2 text-xs tabular-nums">
        {t(
          project.secretCount === 1
            ? "dashboard.secretCountOne"
            : "dashboard.secretCount",
          project.secretCount === 1 ? undefined : { count: project.secretCount }
        )}
      </div>
      <ProjectActions
        project={project}
        favorite={favorite}
        isMenuOpen={isMenuOpen}
        onToggleFavorite={onToggleFavorite}
        onOpenMenu={onOpenMenu}
        onDeleteProject={onDeleteProject}
      />
    </div>
  );
};

const StatisticsStrip = ({ statistics }: { statistics: ProjectStatistics }) => {
  const expiring = statistics.expiringSecrets > 0;
  let expiryTone = "";
  if (expiring) {
    expiryTone = statistics.hasExpired ? "text-destructive" : "text-warning";
  }
  const expired = statistics.hasExpired;
  const metrics = [
    {
      icon: "folder",
      iconTone: "",
      label: t("dashboard.statistics.totalProjects"),
      tone: "",
      value: statistics.totalProjects,
    },
    {
      icon: "key",
      iconTone: "",
      label: t("dashboard.statistics.totalSecrets"),
      tone: "",
      value: statistics.totalSecrets,
    },
    {
      icon: "clock",
      iconTone: expiryTone,
      label: t(
        expired
          ? "dashboard.statistics.expiringAndExpired"
          : "dashboard.statistics.expiringSecrets"
      ),
      tone: expiryTone,
      value: statistics.expiringSecrets,
    },
    {
      icon: "activity",
      iconTone: "",
      label: t("dashboard.statistics.recentAccess"),
      tone: "",
      value: statistics.recentAccessCount,
    },
  ];
  return (
    <div className="dash-strip-wrap mb-6" id="stripWrap">
      <section
        className="dash-strip grid grid-cols-2 gap-3 lg:grid-cols-4"
        id="overviewStrip"
        aria-label={t("dashboard.statistics.overview")}
      >
        {metrics.map((metric) => (
          <div
            className="dash-metric bg-card border-border/80 flex items-center justify-between rounded-xl border p-4 shadow-xs"
            key={metric.label}
          >
            <div>
              <span className="m-label text-muted-foreground block text-xs">
                {metric.label}
              </span>
              <span
                className={cn(
                  "m-value text-foreground font-mono text-2xl font-semibold tracking-tight",
                  TONE_CLASSES[metric.tone] ?? ""
                )}
              >
                {metric.value}
              </span>
            </div>
            <div
              className={cn(
                "m-icon bg-secondary text-primary flex size-9 items-center justify-center rounded-lg",
                TONE_CLASSES[metric.iconTone] ?? ""
              )}
            >
              <Icon name={metric.icon} />
            </div>
          </div>
        ))}
      </section>
      <p className="dash-stat-note text-muted-foreground mt-2 text-right text-xs">
        {t("dashboard.statistics.scopeLabel")}
      </p>
    </div>
  );
};

const DIALOG_TITLES: Record<NonNullable<DialogKind>, string> = {
  "create-vault": "vault.create.title",
  "import-vault": "vault.import.title",
  project: "dashboard.addProjectModal.title",
  "rename-vault": "vault.rename.title",
};

const DashboardDialog = ({
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

interface DashboardSidebarProps {
  sidebarOpen: boolean;
  menu: string | null;
  setMenu: React.Dispatch<React.SetStateAction<string | null>>;
  loadVaults: () => void;
  activeVault: VaultListEntry | null;
  vaults: VaultListEntry[];
  switchVault: (vault: VaultListEntry) => void;
  openDialog: (
    kind: Exclude<DialogKind, null>,
    trigger?: HTMLElement | null,
    initial?: Partial<DialogForm>
  ) => void;
  removeVault: (vault: VaultListEntry) => void;
  openCreateVault: (trigger?: HTMLElement | null) => void;
  openImportVault: (trigger?: HTMLElement | null) => void;
  projectsCount: number;
  navigate: (page: "settings" | "logs") => void;
  syncAt: number;
  now: number;
  dialogStateRef: React.MutableRefObject<DialogKind>;
}

// eslint-disable-next-line complexity -- Dashboard sidebar renders collapsed and expanded navigation rails with active vault menus.
const DashboardSidebar = ({
  sidebarOpen,
  menu,
  setMenu,
  loadVaults,
  activeVault,
  vaults,
  switchVault,
  openDialog,
  removeVault,
  openCreateVault,
  openImportVault,
  projectsCount,
  navigate,
  syncAt,
  now,
  dialogStateRef,
}: DashboardSidebarProps) => (
  <aside
    className={cn(
      nativeWindowStyles.sidebar,
      "dash-index bg-card border-border relative z-50 flex shrink-0 flex-col border-r transition-[width,transform] duration-200 ease-out max-[860px]:fixed max-[860px]:inset-y-0 max-[860px]:left-0 max-[860px]:z-50 max-[860px]:shadow-2xl",
      sidebarOpen
        ? "w-[var(--ui-sidebar-width)] p-3 max-[860px]:w-[var(--ui-sidebar-width)] max-[860px]:translate-x-0"
        : "is-collapsed items-center p-2 max-[860px]:-translate-x-full min-[861px]:w-[64px]"
    )}
    id="indexPanel"
    aria-label={t("dashboard.a11y.indexLabel")}
  >
    <div
      className={cn(
        "dash-brand flex items-center gap-2",
        sidebarOpen ? "mb-3 px-1 py-0.5" : "mb-1 flex-col px-0 py-0.5"
      )}
    >
      <img src={logoUrl} alt="" className="size-8 shrink-0 rounded-lg" />
      {sidebarOpen && (
        <span className="text-foreground flex-1 truncate text-sm font-semibold tracking-tight">
          KeyHarbor
        </span>
      )}
    </div>
    {!sidebarOpen && <div className="border-border/60 my-1 w-7 border-t" />}
    <div
      className={cn(
        "dash-vault-switcher",
        sidebarOpen ? "mb-2.5 w-full" : "my-1 flex w-full justify-center"
      )}
    >
      <DropdownMenu
        open={menu === "vaults" || menu?.startsWith("vault:")}
        onOpenChange={(open) => {
          if (open) {
            loadVaults();
          }
          setMenu(open ? "vaults" : null);
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            type="button"
            className={cn(
              "dash-vault-btn border-border/70 border transition-colors",
              sidebarOpen
                ? "bg-secondary/50 hover:bg-secondary flex h-auto min-h-[46px] w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left"
                : "bg-secondary/60 hover:bg-secondary text-foreground relative flex size-10 items-center justify-center rounded-xl p-0"
            )}
            id="vault-dropdown-btn"
            title={`${t("dashboard.crumbsVault")}: ${activeVault?.name ?? t("dashboard.vaultDefault")}`}
            aria-label={`${t("dashboard.crumbsVault")}: ${activeVault?.name ?? t("dashboard.vaultDefault")}`}
          >
            {sidebarOpen ? (
              <>
                <span className="dash-vault-text min-w-0 flex-1">
                  <small className="text-muted-foreground block text-[11px] leading-none font-semibold tracking-wider uppercase">
                    {t("dashboard.crumbsVault")}
                  </small>
                  <strong
                    id="vault-dropdown-name"
                    className="text-foreground mt-0.5 block truncate text-sm leading-tight font-semibold"
                  >
                    {activeVault?.name ?? t("dashboard.vaultDefault")}
                  </strong>
                </span>
                <Icon
                  name="chevron-down"
                  className="text-muted-foreground size-3.5 shrink-0"
                />
              </>
            ) : (
              <>
                <Icon name="vault" className="text-foreground size-4.5" />
                <span id="vault-dropdown-name" className="sr-only">
                  {activeVault?.name ?? t("dashboard.vaultDefault")}
                </span>
                <span className="bg-muted-foreground/60 absolute right-1.5 bottom-1.5 size-1.5 rounded-full" />
              </>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align={sidebarOpen ? "start" : "center"}
          side="right"
          sideOffset={8}
          className="dash-vault-menu bg-card border-border min-w-[220px] rounded-xl border p-1.5 shadow-xl"
          id="vault-dropdown-menu"
          onCloseAutoFocus={(event) => {
            if (dialogStateRef.current !== null || !document.hasFocus()) {
              event.preventDefault();
            }
          }}
        >
          <div
            id="vault-dropdown-list"
            className="dash-vault-list max-h-[260px] space-y-0.5 overflow-y-auto"
          >
            {vaults.map((vault) => (
              <div
                key={vault.id}
                className={cn(
                  "vault-dropdown-row group flex min-w-0 items-center rounded-lg",
                  vault.isActive && "active bg-primary/10",
                  vault.status === "offline" && "offline opacity-60"
                )}
              >
                <DropdownMenuItem
                  className={cn(
                    "dash-vault-item min-w-0 flex-1 cursor-pointer rounded-lg px-2.5 py-2 text-xs",
                    vault.isActive && "active text-primary font-medium",
                    vault.status === "offline" && "offline"
                  )}
                  disabled={vault.status === "offline"}
                  onSelect={() => switchVault(vault)}
                >
                  <span className="dropdown-item-left flex min-w-0 flex-1 items-center gap-2">
                    {vault.status === "offline" && (
                      <Icon
                        name="circle-alert"
                        className="dropdown-item-icon status-offline text-warning size-3.5 shrink-0"
                      />
                    )}
                    <span
                      className={cn(
                        "dropdown-item-name truncate",
                        vault.isActive && "active text-primary font-medium"
                      )}
                    >
                      {vault.name}
                    </span>
                  </span>
                </DropdownMenuItem>
                {!vault.isSystem && (
                  <DropdownMenuSub
                    open={menu === `vault:${vault.id}`}
                    onOpenChange={(open) =>
                      setMenu((current) => {
                        if (open) {
                          return `vault:${vault.id}`;
                        }
                        return current === `vault:${vault.id}`
                          ? "vaults"
                          : current;
                      })
                    }
                  >
                    <DropdownMenuSubTrigger
                      className="dropdown-item-context-btn text-muted-foreground hover:text-foreground flex size-8 items-center justify-center rounded-lg p-0"
                      aria-label={`${vault.name} ${t("dashboard.a11y.menuLabel")}`}
                    >
                      <Icon name="ellipsis" />
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="dash-vault-context-menu bg-card border-border min-w-[140px] rounded-xl border p-1 shadow-xl">
                      <DropdownMenuItem
                        className="cursor-pointer px-2.5 py-1.5 text-xs"
                        onSelect={() => {
                          openDialog(
                            "rename-vault",
                            document.querySelector<HTMLElement>(
                              "#vault-dropdown-btn"
                            ),
                            {
                              renameVaultId: vault.id,
                              vaultName: vault.name,
                            }
                          );
                        }}
                      >
                        {t("vault.context.rename")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive cursor-pointer px-2.5 py-1.5 text-xs"
                        onSelect={() => removeVault(vault)}
                      >
                        {t("vault.context.remove")}
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}
              </div>
            ))}
          </div>
          <DropdownMenuSeparator className="dash-vault-separator bg-border my-1" />
          <DropdownMenuItem
            id="vault-new-btn"
            className="dash-vault-item cursor-pointer gap-1.5 rounded-lg px-2.5 py-2 text-xs"
            onSelect={() =>
              openCreateVault(
                document.querySelector<HTMLElement>("#vault-dropdown-btn")
              )
            }
          >
            <Icon name="plus" />
            {t("vault.selector.newVault")}
          </DropdownMenuItem>
          <DropdownMenuItem
            id="vault-import-btn"
            className="dash-vault-item cursor-pointer gap-1.5 rounded-lg px-2.5 py-2 text-xs"
            onSelect={() =>
              openImportVault(
                document.querySelector<HTMLElement>("#vault-dropdown-btn")
              )
            }
          >
            <Icon name="folder" />
            {t("vault.selector.importVault")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    {!sidebarOpen && <div className="border-border/60 my-1 w-7 border-t" />}
    <nav
      className={cn(
        "dash-nav my-1 flex flex-col gap-1",
        sidebarOpen ? "w-full" : "w-full items-center"
      )}
      aria-label={t("dashboard.a11y.primaryNav")}
    >
      <Button
        variant="ghost"
        size="sm"
        type="button"
        className={cn(
          nativeWindowStyles.selectedNavigation,
          "bg-primary/10 text-primary hover:bg-primary/15 flex rounded-lg font-semibold transition-colors",
          sidebarOpen
            ? "h-9 w-full items-center justify-start gap-2.5 px-2.5 text-sm"
            : "relative size-10 items-center justify-center p-0"
        )}
        aria-current="page"
        aria-label={`${t("dashboard.sidebar.navProjects")} (${projectsCount})`}
        title={`${t("dashboard.sidebar.navProjects")} (${projectsCount})`}
      >
        <Icon name="folder" className={sidebarOpen ? "size-4" : "size-4.5"} />
        {sidebarOpen && (
          <>
            <span className="flex-1 text-left">
              {t("dashboard.sidebar.navProjects")}
            </span>
            <span className="dash-nav-count bg-primary/15 text-primary rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold">
              {projectsCount}
            </span>
          </>
        )}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        type="button"
        id="navActivity"
        className={cn(
          "text-muted-foreground hover:text-foreground hover:bg-secondary flex rounded-lg font-medium transition-colors",
          sidebarOpen
            ? "h-9 w-full items-center justify-start gap-2.5 px-2.5 text-sm"
            : "size-10 items-center justify-center p-0"
        )}
        title={t("dashboard.sidebar.navActivity")}
        aria-label={t("dashboard.sidebar.navActivity")}
        onClick={() => navigate("logs")}
      >
        <Icon name="clock" className={sidebarOpen ? "size-4" : "size-4.5"} />
        {sidebarOpen && (
          <span className="flex-1 text-left">
            {t("dashboard.sidebar.navActivity")}
          </span>
        )}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        type="button"
        id="navSettings"
        className={cn(
          "text-muted-foreground hover:text-foreground hover:bg-secondary flex rounded-lg font-medium transition-colors",
          sidebarOpen
            ? "h-9 w-full items-center justify-start gap-2.5 px-2.5 text-sm"
            : "size-10 items-center justify-center p-0"
        )}
        title={t("dashboard.sidebar.navSettings")}
        aria-label={t("dashboard.sidebar.navSettings")}
        onClick={() => navigate("settings")}
      >
        <Icon name="settings" className={sidebarOpen ? "size-4" : "size-4.5"} />
        {sidebarOpen && (
          <span className="flex-1 text-left">
            {t("dashboard.sidebar.navSettings")}
          </span>
        )}
      </Button>
    </nav>
    <div
      className={cn(
        "dash-sync border-border/50 bg-secondary/30 text-muted-foreground mt-auto flex items-center rounded-xl border transition-colors",
        sidebarOpen ? "gap-2.5 p-2 text-xs" : "size-8 justify-center p-0"
      )}
      title={`${t("dashboard.sidebar.unlocked")} — ${t(
        "dashboard.sidebar.synced",
        {
          time: formatAccessTime(syncAt, now),
        }
      )}`}
    >
      <span
        className="dash-sync-dot bg-success size-2 shrink-0 animate-pulse rounded-full"
        aria-hidden="true"
      />
      {sidebarOpen ? (
        <span className="dash-sync-text truncate">
          {t("dashboard.sidebar.unlocked")}
          <small
            id="syncLabel"
            className="text-muted-foreground/80 block text-xs"
          >
            {t("dashboard.sidebar.synced", {
              time: formatAccessTime(syncAt, now),
            })}
          </small>
        </span>
      ) : (
        <span id="syncLabel" className="sr-only">
          {t("dashboard.sidebar.synced", {
            time: formatAccessTime(syncAt, now),
          })}
        </span>
      )}
    </div>
  </aside>
);

const App = () => {
  useRendererTranslation();
  const { confirm, confirmationDialog, cancelConfirmation } = useConfirmation();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const projectsRef = useRef<ProjectRecord[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [statistics, setStatistics] = useState<ProjectStatistics | null>(null);
  const [showStatistics, setShowStatistics] = useState(true);
  const [accessTimes, setAccessTimes] = useState<AccessTimes>({});
  const [vaults, setVaults] = useState<VaultListEntry[]>([]);
  const vaultsRef = useRef<VaultListEntry[]>([]);
  const [activeVaultId, setActiveVaultId] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [menu, setMenu] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [form, setForm] = useState<DialogForm>(blankForm);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [cliInstalled, setCliInstalled] = useState(false);
  const [cliReady, setCliReady] = useState(false);
  const { open: sidebarOpen, toggleSidebar, closeSidebar } = useSidebarState();
  const [projectFilter, setProjectFilter] = useState<"all" | "starred">("all");
  const [syncAt, setSyncAt] = useState(Date.now);
  const [now, setNow] = useState(Date.now);
  const dialogStateRef = useRef<DialogKind>(null);
  const modalFocusEpochRef = useRef(0);
  const appRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const activeVaultRef = useRef<string | null>(null);
  const sessionTransitionRef = useRef(-1);
  const contextEpochRef = useRef(0);
  const pendingSwitchVaultRef = useRef<string | null>(null);
  const pageHiddenRef = useRef(false);
  const sessionActiveRef = useRef(true);
  const readEpochRef = useRef(0);
  const actionEpochRef = useRef(0);
  const actionPendingRef = useRef(false);
  const refreshRef = useRef<() => Promise<void>>(async () => {
    /* Refresh is installed after the callback is created. */
  });
  const settingsWarningRef = useRef(false);
  const mountedRef = useRef(true);

  const activeVault = selectActiveVault(vaults, activeVaultId);
  const visibleProjects = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const filtered = projects.filter(
      (project) =>
        (!query || project.name.toLocaleLowerCase().includes(query)) &&
        (projectFilter === "all" || favorites.includes(project.name))
    );
    const byName = (left: ProjectRecord, right: ProjectRecord) =>
      left.name.localeCompare(right.name);
    filtered.sort((left, right) => {
      if (sortMode === "name") {
        return byName(left, right);
      }
      if (sortMode === "secrets") {
        return right.secretCount - left.secretCount || byName(left, right);
      }
      return (
        Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || "") ||
        byName(left, right)
      );
    });
    filtered.sort(
      (left, right) =>
        Number(favorites.includes(right.name)) -
        Number(favorites.includes(left.name))
    );
    return filtered;
  }, [favorites, projects, projectFilter, search, sortMode]);

  const isCurrentRead = useCallback(
    (epoch: number, vaultId: string | null) =>
      mountedRef.current &&
      !pageHiddenRef.current &&
      sessionActiveRef.current &&
      readEpochRef.current === epoch &&
      activeVaultRef.current === vaultId,
    []
  );

  const isCurrentContext = useCallback(
    (epoch: number, vaultId: string | null) =>
      mountedRef.current &&
      !pageHiddenRef.current &&
      sessionActiveRef.current &&
      contextEpochRef.current === epoch &&
      activeVaultRef.current === vaultId,
    []
  );

  const loadVaults = useCallback(async () => {
    const requestVaultId = activeVaultRef.current;
    let result: Awaited<ReturnType<typeof window.keyharbor.vault.list>>;
    try {
      result = await window.keyharbor.vault.list();
    } catch {
      return;
    }
    if (!isBridgeSuccess<{ data: VaultListEntry[] }>(result)) {
      return;
    }
    if (
      !mountedRef.current ||
      !sessionActiveRef.current ||
      activeVaultRef.current !== requestVaultId
    ) {
      return;
    }
    vaultsRef.current = result.data;
    setVaults(result.data);
    const active =
      result.data.find((vault) => vault.isActive) ??
      result.data.find((vault) => vault.id === "system") ??
      result.data[0] ??
      null;
    if (active) {
      const changed = activeVaultRef.current !== active.id;
      if (changed) {
        contextEpochRef.current += 1;
        projectsRef.current = [];
        setProjects([]);
        setFavorites([]);
        setStatistics(null);
        setAccessTimes({});
        setLoadState("loading");
      }
      activeVaultRef.current = active.id;
      setActiveVaultId(active.id);
      if (changed) {
        refreshRef.current();
      }
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!sessionActiveRef.current) {
      return;
    }
    readEpochRef.current += 1;
    const epoch = readEpochRef.current;
    const vaultId = activeVaultRef.current;
    setLoadState((previous) => (previous === "ready" ? "ready" : "loading"));
    try {
      const [projectResult, favoriteResult, logResult, settings] =
        await Promise.all([
          window.keyharbor.projects.get(),
          window.keyharbor.favorites.get(),
          window.keyharbor.logs.get(),
          window.keyharbor.settings.get(),
        ]);
      if (!isCurrentRead(epoch, vaultId)) {
        return;
      }
      const nextProjects = requireProjectData(projectResult);
      const nextFavorites = isBridgeSuccess<{ data: { projects: string[] } }>(
        favoriteResult
      )
        ? favoriteResult.data.projects
        : [];
      const nextAccess = collectAccessTimes(nextProjects, logResult);
      projectsRef.current = nextProjects;
      setProjects(nextProjects);
      setFavorites(nextFavorites);
      setAccessTimes(nextAccess);
      setShowStatistics(settings.showStatistics !== false);
      if (!settingsWarningRef.current && settings.__loadStatus === "reset") {
        settingsWarningRef.current = true;
        notificationManager.error(t("settings.notifications.resetDueToError"));
      } else if (
        !settingsWarningRef.current &&
        settings.__loadStatus === "repaired"
      ) {
        settingsWarningRef.current = true;
        notificationManager.success(t("settings.notifications.repaired"));
      }
      if (settings.showStatistics === false) {
        setStatistics(null);
      } else {
        const statResult = await window.keyharbor.statistics.get();
        if (!isCurrentRead(epoch, vaultId)) {
          return;
        }
        setStatistics(
          isBridgeSuccess<{ data: ProjectStatistics }>(statResult)
            ? statResult.data
            : null
        );
      }
      setSyncAt(Date.now());
      setLoadState("ready");
    } catch {
      if (!isCurrentRead(epoch, vaultId)) {
        return;
      }
      setLoadState("error");
      notificationManager.error(t("dashboard.notifications.failedToLoad"));
    }
  }, [isCurrentRead]);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  const closeMenus = useCallback(() => setMenu(null), []);
  const closeDialog = useCallback((preserveAction = false) => {
    if (!preserveAction) {
      actionEpochRef.current += 1;
      actionPendingRef.current = false;
      setActionBusy(null);
    }
    setForm(blankForm());
    dialogStateRef.current = null;
    setDialog(null);
    modalFocusEpochRef.current += 1;
    const focusEpoch = modalFocusEpochRef.current;
    const trigger = returnFocusRef.current;
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => {
        if (
          !mountedRef.current ||
          pageHiddenRef.current ||
          !sessionActiveRef.current ||
          focusEpoch !== modalFocusEpochRef.current ||
          dialogStateRef.current !== null
        ) {
          return;
        }
        const visible =
          trigger?.isConnected &&
          trigger.getClientRects().length > 0 &&
          !trigger.hasAttribute("disabled");
        const fallback = document.querySelector<HTMLElement>(
          "#vault-dropdown-btn"
        );
        (visible ? trigger : fallback)?.focus();
      })
    );
  }, []);
  const openDialog = useCallback(
    (
      kind: Exclude<DialogKind, null>,
      trigger?: HTMLElement | null,
      initial?: Partial<DialogForm>
    ) => {
      closeMenus();
      modalFocusEpochRef.current += 1;
      returnFocusRef.current =
        trigger ??
        (document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null);
      setForm({ ...blankForm(), ...initial });
      dialogStateRef.current = kind;
      setDialog(kind);
    },
    [closeMenus]
  );
  const returnFocusToVaultSwitcher = useCallback(() => {
    modalFocusEpochRef.current += 1;
    const focusEpoch = modalFocusEpochRef.current;
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => {
        if (
          !mountedRef.current ||
          pageHiddenRef.current ||
          !sessionActiveRef.current ||
          focusEpoch !== modalFocusEpochRef.current ||
          dialogStateRef.current !== null
        ) {
          return;
        }
        document.querySelector<HTMLElement>("#vault-dropdown-btn")?.focus();
      })
    );
  }, []);

  const runAction = useCallback(
    async <T,>(
      name: string,
      action: () => Promise<T>,
      onResult: (
        value: T,
        epoch: number,
        vaultId: string | null
      ) => Promise<void>,
      allowVaultChange = false
    ) => {
      if (actionPendingRef.current) {
        return;
      }
      actionPendingRef.current = true;
      actionEpochRef.current += 1;
      const epoch = actionEpochRef.current;
      const vaultId = activeVaultRef.current;
      const contextEpoch = contextEpochRef.current;
      setActionBusy(name);
      await finalizeOperation(
        async () => {
          try {
            const result = await action();
            if (
              !mountedRef.current ||
              epoch !== actionEpochRef.current ||
              !sessionActiveRef.current ||
              (!allowVaultChange && !isCurrentContext(contextEpoch, vaultId))
            ) {
              return;
            }
            await onResult(result, epoch, vaultId);
          } catch {
            if (
              mountedRef.current &&
              epoch === actionEpochRef.current &&
              sessionActiveRef.current &&
              (allowVaultChange || isCurrentContext(contextEpoch, vaultId))
            ) {
              notificationManager.error(
                t("dashboard.notifications.failedToLoad")
              );
            }
          }
        },
        () => {
          if (mountedRef.current && epoch === actionEpochRef.current) {
            actionPendingRef.current = false;
            setActionBusy(null);
          }
        }
      );
    },
    [isCurrentContext]
  );

  useEffect(() => {
    mountedRef.current = true;
    let disposed = false;
    const initialize = async () => {
      await i18n.init();
      if (disposed || pageHiddenRef.current) {
        return;
      }
      document.title = `KeyHarbor — ${t("dashboard.title")}`;
      let snapshot: Awaited<
        ReturnType<typeof window.keyharbor.vault.sessionSnapshot>
      >;
      try {
        snapshot = await window.keyharbor.vault.sessionSnapshot();
      } catch {
        if (!disposed) {
          setLoadState("error");
          notificationManager.error(t("dashboard.notifications.failedToLoad"));
        }
        return;
      }
      if (disposed || pageHiddenRef.current) {
        return;
      }
      if (snapshot.transitionId < sessionTransitionRef.current) {
        return;
      }
      sessionTransitionRef.current = snapshot.transitionId;
      sessionActiveRef.current = snapshot.state === "active";
      if (!sessionActiveRef.current) {
        await window.keyharbor.navigate("lock");
        return;
      }
      if (snapshot.activeVaultId) {
        activeVaultRef.current = snapshot.activeVaultId;
        setActiveVaultId(snapshot.activeVaultId);
      }
      await Promise.all([loadVaults(), refreshRef.current()]);
      const initialContextEpoch = contextEpochRef.current;
      const initialVaultId = activeVaultRef.current;
      try {
        const cli = await window.keyharbor.cli.check();
        if (
          !disposed &&
          isCurrentContext(initialContextEpoch, initialVaultId)
        ) {
          setCliInstalled(cli.installed);
          setCliReady(true);
        }
      } catch {
        if (
          !disposed &&
          isCurrentContext(initialContextEpoch, initialVaultId)
        ) {
          setCliReady(true);
        }
      }
    };
    initialize();

    const unsubscribeSession = window.keyharbor.vault.onSessionStateChanged(
      (snapshot) => {
        if (snapshot.transitionId < sessionTransitionRef.current) {
          return;
        }
        sessionTransitionRef.current = snapshot.transitionId;
        const active = snapshot.state === "active";
        sessionActiveRef.current = active;
        if (!active) {
          cancelConfirmation();
          contextEpochRef.current += 1;
          readEpochRef.current += 1;
          actionEpochRef.current += 1;
          actionPendingRef.current = false;
          setActionBusy(null);
          setMenu(null);
          setForm(blankForm());
          dialogStateRef.current = null;
          setDialog(null);
          pendingSwitchVaultRef.current = null;
          if (snapshot.state === "locked") {
            window.keyharbor.navigate("lock");
          }
          return;
        }
        if (
          snapshot.activeVaultId &&
          snapshot.activeVaultId !== activeVaultRef.current
        ) {
          cancelConfirmation();
          if (pendingSwitchVaultRef.current !== snapshot.activeVaultId) {
            contextEpochRef.current += 1;
          }
          activeVaultRef.current = snapshot.activeVaultId;
          setActiveVaultId(snapshot.activeVaultId);
          projectsRef.current = [];
          setProjects([]);
          setFavorites([]);
          setStatistics(null);
          setAccessTimes({});
          setLoadState("loading");
          setForm(blankForm());
          dialogStateRef.current = null;
          setDialog(null);
          loadVaults();
          refreshRef.current();
        }
      }
    );
    const unsubscribeSynced = window.keyharbor.vault.onVaultDataSynced(() => {
      if (document.visibilityState === "visible") {
        refreshRef.current();
      }
    });
    const unsubscribeFocus = window.keyharbor.onWindowFocusChanged(
      (focused) => {
        if (focused) {
          refreshRef.current();
        } else {
          setMenu(null);
        }
      }
    );
    const onFocus = () => {
      if (document.visibilityState === "visible") {
        refreshRef.current();
      }
    };
    const onBrowserSync = () => {
      if (document.visibilityState === "visible") {
        refreshRef.current();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        refreshRef.current();
      }
    };
    const onPageHide = () => {
      cancelConfirmation();
      pageHiddenRef.current = true;
      contextEpochRef.current += 1;
      readEpochRef.current += 1;
      actionEpochRef.current += 1;
      actionPendingRef.current = false;
      sessionActiveRef.current = false;
      dialogStateRef.current = null;
      setForm(blankForm());
      setDialog(null);
      setActionBusy(null);
      setMenu(null);
    };
    const onPageShow = async () => {
      if (!pageHiddenRef.current) {
        return;
      }
      pageHiddenRef.current = false;
      try {
        const snapshot = await window.keyharbor.vault.sessionSnapshot();
        if (!mountedRef.current || pageHiddenRef.current) {
          return;
        }
        if (snapshot.transitionId < sessionTransitionRef.current) {
          return;
        }
        sessionTransitionRef.current = Math.max(
          sessionTransitionRef.current,
          snapshot.transitionId
        );
        sessionActiveRef.current = snapshot.state === "active";
        if (!sessionActiveRef.current) {
          window.keyharbor.navigate("lock");
          return;
        }
        if (snapshot.activeVaultId) {
          activeVaultRef.current = snapshot.activeVaultId;
          setActiveVaultId(snapshot.activeVaultId);
        }
        contextEpochRef.current += 1;
        loadVaults();
        refreshRef.current();
      } catch {
        // A snapshot failure leaves the session unchanged; the next event can retry.
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLocaleLowerCase() === "k"
      ) {
        event.preventDefault();
        if (!dialogStateRef.current) {
          searchRef.current?.focus();
        }
      }
      if (
        event.key === "Escape" &&
        !dialogStateRef.current &&
        !event.defaultPrevented
      ) {
        closeMenus();
        closeNarrowSidebar();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const { target } = event;
      if (
        target instanceof Element &&
        !target.closest(
          '[data-slot="dropdown-menu-content"], [data-slot="dialog-content"]'
        ) &&
        appRef.current &&
        !appRef.current.contains(target)
      ) {
        setMenu(null);
      }
    };
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        refreshRef.current();
      }
    }, 10_000);
    const clockTimer = window.setInterval(() => setNow(Date.now()), 30_000);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", closeMenus);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("keyharbor:vault-data-synced", onBrowserSync);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      mountedRef.current = false;
      sessionActiveRef.current = false;
      readEpochRef.current += 1;
      actionEpochRef.current += 1;
      unsubscribeSession();
      unsubscribeSynced();
      unsubscribeFocus();
      window.clearInterval(poll);
      window.clearInterval(clockTimer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", closeMenus);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("keyharbor:vault-data-synced", onBrowserSync);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [cancelConfirmation, closeMenus, isCurrentContext, loadVaults]);

  useEffect(() => {
    if (!appRef.current) {
      return;
    }
    const root = appRef.current;
    const onMouseDown = (event: MouseEvent) => {
      const { target } = event;
      if (!(target instanceof Element)) {
        return;
      }
      if (!target.closest('.dropdown, [data-slot="button"]')) {
        setMenu(null);
      }
    };
    root.addEventListener("mousedown", onMouseDown);
    return () => root.removeEventListener("mousedown", onMouseDown);
  }, []);

  const toggleFavorite = async (name: string) => {
    await runAction(
      "favorite",
      () => window.keyharbor.favorite.toggleProject(name),
      async (result, epoch, vaultId) => {
        if (!isBridgeSuccess<{ added: boolean }>(result)) {
          return;
        }
        const contextEpoch = contextEpochRef.current;
        await refreshRef.current();
        if (
          !mountedRef.current ||
          epoch !== actionEpochRef.current ||
          !isCurrentContext(contextEpoch, vaultId)
        ) {
          return;
        }
        notificationManager.success(
          t(
            result.added
              ? "dashboard.notifications.favoriteAdded"
              : "dashboard.notifications.favoriteRemoved"
          )
        );
      }
    );
  };

  const deleteProject = async (name: string) => {
    const confirmationActionEpoch = actionEpochRef.current;
    const confirmationContextEpoch = contextEpochRef.current;
    const confirmationVaultId = activeVaultRef.current;
    const confirmed = await confirm({
      confirmLabel: t("dashboard.deleteProject.deleteBtn"),
      description: t("dashboard.deleteProject.confirm", { name }),
      title: t("dashboard.deleteProject.deleteBtn"),
      variant: "destructive",
    });
    if (
      !confirmed ||
      confirmationActionEpoch !== actionEpochRef.current ||
      !isCurrentContext(confirmationContextEpoch, confirmationVaultId) ||
      !projectsRef.current.some((project) => project.name === name)
    ) {
      return;
    }
    await runAction(
      "delete-project",
      () => window.keyharbor.projects.delete(name),
      async (result, epoch, vaultId) => {
        if (!isBridgeSuccess(result)) {
          notificationManager.error(
            t("dashboard.notifications.failedToDelete")
          );
          return;
        }
        const contextEpoch = contextEpochRef.current;
        await refreshRef.current();
        if (
          mountedRef.current &&
          epoch === actionEpochRef.current &&
          isCurrentContext(contextEpoch, vaultId)
        ) {
          notificationManager.success(
            t("dashboard.notifications.projectDeleted", { name })
          );
        }
      }
    );
  };

  const submitProject = async () => {
    const name = form.projectName.trim();
    if (!name) {
      notificationManager.error(t("dashboard.notifications.enterName"));
      return;
    }
    if (projects.some((project) => project.name === name)) {
      notificationManager.error(t("dashboard.notifications.projectExists"));
      return;
    }
    await runAction(
      "create-project",
      () => window.keyharbor.projects.create(name),
      async (result, epoch, vaultId) => {
        if (!isBridgeSuccess(result)) {
          notificationManager.error(
            t("dashboard.notifications.failedToCreate")
          );
          return;
        }
        const contextEpoch = contextEpochRef.current;
        closeDialog(true);
        await refreshRef.current();
        if (
          mountedRef.current &&
          epoch === actionEpochRef.current &&
          isCurrentContext(contextEpoch, vaultId)
        ) {
          notificationManager.success(
            t("dashboard.notifications.projectCreated", { name })
          );
        }
      }
    );
  };

  const switchVault = async (vault: VaultListEntry) => {
    closeMenus();
    if (vault.isActive) {
      return;
    }
    if (vault.status === "offline") {
      notificationManager.error(t("vault.notifications.offlineVault"));
      return;
    }
    pendingSwitchVaultRef.current = vault.id;
    await finalizeOperation(
      async () => {
        await runAction(
          "switch-vault",
          () => window.keyharbor.vault.switch(vault.id),
          async (result, actionEpoch) => {
            if (!isBridgeSuccess(result)) {
              notificationManager.error(
                t("vault.notifications.failedToSwitch")
              );
              return;
            }
            const snapshot = await window.keyharbor.vault.sessionSnapshot();
            if (
              !mountedRef.current ||
              pageHiddenRef.current ||
              !sessionActiveRef.current ||
              actionEpoch !== actionEpochRef.current ||
              snapshot.state !== "active" ||
              snapshot.activeVaultId !== vault.id
            ) {
              return;
            }
            if (activeVaultRef.current !== vault.id) {
              contextEpochRef.current += 1;
            }
            activeVaultRef.current = vault.id;
            setActiveVaultId(vault.id);
            projectsRef.current = [];
            setProjects([]);
            setFavorites([]);
            setStatistics(null);
            setAccessTimes({});
            setLoadState("loading");
            const switchContextEpoch = contextEpochRef.current;
            readEpochRef.current += 1;
            await loadVaults();
            if (
              !isCurrentContext(switchContextEpoch, vault.id) ||
              actionEpoch !== actionEpochRef.current
            ) {
              return;
            }
            await refreshRef.current();
            if (
              !isCurrentContext(switchContextEpoch, vault.id) ||
              actionEpoch !== actionEpochRef.current
            ) {
              return;
            }
            notificationManager.success(
              t("vault.notifications.switched", { name: vault.name })
            );
          },
          true
        );
      },
      () => {
        if (pendingSwitchVaultRef.current === vault.id) {
          pendingSwitchVaultRef.current = null;
        }
      }
    );
  };

  const browseFolder = async (kind: "create-vault" | "import-vault") => {
    const epoch = actionEpochRef.current;
    const vaultId = activeVaultRef.current;
    try {
      const result = await window.keyharbor.dialog.selectFolder();
      if (
        !mountedRef.current ||
        !sessionActiveRef.current ||
        epoch !== actionEpochRef.current ||
        vaultId !== activeVaultRef.current ||
        dialog !== kind ||
        !result.success ||
        !result.data
      ) {
        return;
      }
      const path = result.data;
      const folderName = path.match(folderNamePattern)?.groups?.name || "";
      setForm((current) => ({
        ...current,
        error: "",
        folderPath: path,
        vaultName:
          kind === "import-vault" && !current.vaultName && folderName !== "lkv"
            ? folderName
            : current.vaultName,
      }));
    } catch {
      if (
        mountedRef.current &&
        sessionActiveRef.current &&
        epoch === actionEpochRef.current &&
        vaultId === activeVaultRef.current &&
        dialogStateRef.current === kind
      ) {
        setForm((current) => ({
          ...current,
          error: t("vault.notifications.failedToCreate"),
        }));
      }
    }
  };

  const submitVaultCreate = async () => {
    const name = form.vaultName.trim();
    const folderPath = form.folderPath.trim();
    if (!name) {
      setForm((current) => ({
        ...current,
        error: t("vault.notifications.nameRequired"),
      }));
      return;
    }
    if (!folderPath) {
      setForm((current) => ({
        ...current,
        error: t("vault.notifications.pathRequired"),
      }));
      return;
    }
    if (form.password !== form.passwordConfirm) {
      setForm((current) => ({
        ...current,
        error: t("vault.notifications.passwordMismatch"),
      }));
      return;
    }
    const { password } = form;
    await runAction(
      "create-vault",
      () => window.keyharbor.vault.create(name, folderPath, password),
      async (result, epoch, vaultId) => {
        if (!isBridgeSuccess(result)) {
          setForm((current) => ({
            ...current,
            error: result.error || t("vault.notifications.failedToCreate"),
          }));
          return;
        }
        closeDialog(true);
        await loadVaults();
        if (
          mountedRef.current &&
          sessionActiveRef.current &&
          epoch === actionEpochRef.current &&
          vaultId === activeVaultRef.current
        ) {
          notificationManager.success(
            t("vault.notifications.created", { name })
          );
        }
      }
    );
  };

  const submitVaultImport = async () => {
    const name = form.vaultName.trim();
    const folderPath = form.folderPath.trim();
    if (!folderPath) {
      setForm((current) => ({
        ...current,
        error: t("vault.notifications.pathRequired"),
      }));
      return;
    }
    if (!name) {
      setForm((current) => ({
        ...current,
        error: t("vault.notifications.nameRequired"),
      }));
      return;
    }
    if (!form.password) {
      setForm((current) => ({
        ...current,
        error: t("vault.notifications.passwordRequired"),
      }));
      return;
    }
    const { password } = form;
    await runAction(
      "import-vault",
      () => window.keyharbor.vault.import(name, folderPath, password),
      async (result, epoch, vaultId) => {
        if (!isBridgeSuccess(result)) {
          setForm((current) => ({
            ...current,
            error: result.error || t("vault.notifications.failedToImport"),
          }));
          return;
        }
        closeDialog(true);
        await loadVaults();
        if (
          mountedRef.current &&
          sessionActiveRef.current &&
          epoch === actionEpochRef.current &&
          vaultId === activeVaultRef.current
        ) {
          notificationManager.success(
            t("vault.notifications.imported", { name })
          );
        }
      }
    );
  };

  const submitVaultRename = async () => {
    const name = form.vaultName.trim();
    if (!name) {
      setForm((current) => ({
        ...current,
        error: t("vault.notifications.nameRequired"),
      }));
      return;
    }
    await runAction(
      "rename-vault",
      () => window.keyharbor.vault.rename(form.renameVaultId, name),
      async (result, epoch, vaultId) => {
        if (!isBridgeSuccess(result)) {
          setForm((current) => ({
            ...current,
            error: result.error || t("vault.notifications.failedToRename"),
          }));
          return;
        }
        closeDialog(true);
        await loadVaults();
        if (
          mountedRef.current &&
          sessionActiveRef.current &&
          epoch === actionEpochRef.current &&
          vaultId === activeVaultRef.current
        ) {
          notificationManager.success(
            t("vault.notifications.renamed", { name })
          );
        }
      }
    );
  };

  const removeVault = async (vault: VaultListEntry) => {
    const confirmationActionEpoch = actionEpochRef.current;
    const confirmationContextEpoch = contextEpochRef.current;
    const confirmationVaultId = activeVaultRef.current;
    const confirmationTargetId = vault.id;
    const confirmed = await confirm({
      confirmLabel: t("vault.context.remove"),
      description: t("vault.remove.confirm", { name: vault.name }),
      title: t("vault.context.remove"),
      variant: "destructive",
    });
    const contextIsCurrent = isCurrentContext(
      confirmationContextEpoch,
      confirmationVaultId
    );
    if (!confirmed) {
      if (contextIsCurrent) {
        returnFocusToVaultSwitcher();
      }
      return;
    }
    if (
      confirmationActionEpoch !== actionEpochRef.current ||
      !contextIsCurrent ||
      !vaultsRef.current.some(
        (candidate) => candidate.id === confirmationTargetId
      )
    ) {
      if (contextIsCurrent) {
        returnFocusToVaultSwitcher();
      }
      return;
    }
    await runAction(
      "remove-vault",
      () => window.keyharbor.vault.remove(vault.id),
      async (result, epoch) => {
        if (!isBridgeSuccess(result)) {
          notificationManager.error(
            result.error || t("vault.notifications.failedToRemove")
          );
          returnFocusToVaultSwitcher();
          return;
        }
        await loadVaults();
        const refreshedVaultId = activeVaultRef.current;
        const refreshedContextEpoch = contextEpochRef.current;
        await refreshRef.current();
        if (
          mountedRef.current &&
          epoch === actionEpochRef.current &&
          isCurrentContext(refreshedContextEpoch, refreshedVaultId)
        ) {
          notificationManager.success(
            t("vault.notifications.removed", { name: vault.name })
          );
          returnFocusToVaultSwitcher();
        }
      }
    );
  };

  const handleCli = async (action: "install" | "uninstall") => {
    if (action === "uninstall") {
      const confirmationActionEpoch = actionEpochRef.current;
      const confirmationContextEpoch = contextEpochRef.current;
      const confirmationVaultId = activeVaultRef.current;
      const confirmed = await confirm({
        confirmLabel: t("dashboard.uninstallCli"),
        description: t("dashboard.confirmUninstallCli"),
        title: t("dashboard.uninstallCli"),
        variant: "destructive",
      });
      if (
        !confirmed ||
        confirmationActionEpoch !== actionEpochRef.current ||
        !isCurrentContext(confirmationContextEpoch, confirmationVaultId)
      ) {
        return;
      }
    }
    await runAction(
      `cli-${action}`,
      () =>
        action === "install"
          ? window.keyharbor.cli.install()
          : window.keyharbor.cli.uninstall(),
      async (result, epoch, vaultId) => {
        if (isBridgeSuccess<{ message: string }>(result)) {
          notificationManager.success(result.message);
          const contextEpoch = contextEpochRef.current;
          try {
            const status = await window.keyharbor.cli.check();
            if (
              epoch === actionEpochRef.current &&
              isCurrentContext(contextEpoch, vaultId)
            ) {
              setCliInstalled(status.installed);
              setCliReady(true);
            }
          } catch {
            if (
              epoch === actionEpochRef.current &&
              isCurrentContext(contextEpoch, vaultId)
            ) {
              setCliReady(true);
            }
          }
        } else {
          notificationManager.error(
            result.error ||
              t("dashboard.notifications.cliInstallFailed", {
                action,
                error: "",
              })
          );
        }
      }
    );
  };

  const lock = async () => {
    if (actionPendingRef.current) {
      return;
    }
    actionPendingRef.current = true;
    actionEpochRef.current += 1;
    const actionEpoch = actionEpochRef.current;
    const contextEpoch = contextEpochRef.current;
    const vaultId = activeVaultRef.current;
    readEpochRef.current += 1;
    setMenu(null);
    modalFocusEpochRef.current += 1;
    dialogStateRef.current = null;
    setDialog(null);
    setForm(blankForm());
    await finalizeOperation(
      async () => {
        try {
          const result = await window.keyharbor.vault.lock();
          if (
            actionEpoch === actionEpochRef.current &&
            isCurrentContext(contextEpoch, vaultId) &&
            !isBridgeSuccess(result)
          ) {
            notificationManager.error(
              result.error ||
                t("dashboard.notifications.lockError", { error: "" })
            );
          }
        } catch (error) {
          if (
            actionEpoch === actionEpochRef.current &&
            isCurrentContext(contextEpoch, vaultId)
          ) {
            notificationManager.error(
              t("dashboard.notifications.lockError", {
                error: error instanceof Error ? error.message : "",
              })
            );
          }
        }
      },
      () => {
        actionPendingRef.current = false;
      }
    );
  };

  const navigate = (page: "settings" | "logs") => {
    setMenu(null);
    window.location.href = `${page}.html`;
  };
  const setField = (field: keyof DialogForm, value: string) =>
    setForm((current) => ({
      ...current,
      [field]: value,
      error: field === "error" ? value : "",
    }));

  const projectState = () => {
    if (loadState === "loading") {
      return (
        <div className="dash-state flex flex-col items-center justify-center gap-3 py-20 text-center">
          <Loader2
            className="text-primary size-8 animate-spin"
            aria-label={t("common.loading")}
          />
        </div>
      );
    }
    if (loadState === "error") {
      return (
        <div className="dash-state flex flex-col items-center justify-center gap-3 py-16 text-center">
          <Icon name="circle-alert" className="text-destructive size-10" />
          <h2 className="text-foreground text-base font-semibold">
            {t("dashboard.notifications.failedToLoad")}
          </h2>
          <p className="text-muted-foreground max-w-sm text-xs">
            {t("dashboard.emptyState.noResultsBody")}
          </p>
          <Button
            variant="secondary"
            type="button"
            className="dh-btn dh-btn-secondary mt-2"
            onClick={() => refresh()}
          >
            {t("project.retry")}
          </Button>
        </div>
      );
    }
    if (!visibleProjects.length) {
      return (
        <div className="dash-state flex flex-col items-center justify-center gap-3 py-16 text-center">
          <Icon name="folder" className="text-muted-foreground/60 size-10" />
          <h2 className="text-foreground text-base font-semibold">
            {projects.length
              ? t("dashboard.emptyState.title")
              : t("dashboard.emptyState.emptyTitle")}
          </h2>
          <p className="text-muted-foreground max-w-sm text-xs">
            {projects.length
              ? t("dashboard.emptyState.noResultsBody")
              : t("dashboard.emptyState.emptyBody")}
          </p>
          {projects.length ? (
            <Button
              variant="secondary"
              type="button"
              className="dh-btn dh-btn-secondary mt-2"
              onClick={() => {
                setSearch("");
                setProjectFilter("all");
                searchRef.current?.focus();
              }}
            >
              {t("dashboard.emptyState.clearSearch")}
            </Button>
          ) : (
            <Button
              variant="default"
              type="button"
              className="dh-btn dh-btn-primary mt-2 gap-1.5"
              onClick={(event) => openDialog("project", event.currentTarget)}
            >
              <Icon name="plus" />
              {t("dashboard.addProject")}
            </Button>
          )}
        </div>
      );
    }
    if (viewMode === "grid") {
      return (
        <div className="dash-grid grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visibleProjects.map((project) => (
            <ProjectCard
              key={project.name}
              project={project}
              access={accessTimes[project.name]}
              now={now}
              favorite={favorites.includes(project.name)}
              isMenuOpen={menu === `project:${project.name}`}
              onOpenProject={openProject}
              onToggleFavorite={toggleFavorite}
              onOpenMenu={(open) =>
                setMenu(open ? `project:${project.name}` : null)
              }
              onDeleteProject={(name) => {
                closeMenus();
                deleteProject(name);
              }}
            />
          ))}
        </div>
      );
    }
    return (
      <div className="dash-list border-border divide-border bg-card flex flex-col divide-y overflow-hidden rounded-xl border shadow-xs">
        {visibleProjects.map((project) => (
          <ProjectRow
            key={project.name}
            project={project}
            now={now}
            favorite={favorites.includes(project.name)}
            isMenuOpen={menu === `project:${project.name}`}
            onOpenProject={openProject}
            onToggleFavorite={toggleFavorite}
            onOpenMenu={(open) =>
              setMenu(open ? `project:${project.name}` : null)
            }
            onDeleteProject={(name) => {
              closeMenus();
              deleteProject(name);
            }}
          />
        ))}
      </div>
    );
  };

  const cliActionLabel = () => {
    if (actionBusy === "cli-install") {
      return t("dashboard.installing");
    }
    if (actionBusy === "cli-uninstall") {
      return t("dashboard.uninstalling");
    }
    return t(
      cliReady && cliInstalled
        ? "dashboard.uninstallCli"
        : "dashboard.installCli"
    );
  };

  const openCreateVault = (trigger?: HTMLElement | null) =>
    openDialog("create-vault", trigger);
  const openImportVault = (trigger?: HTMLElement | null) =>
    openDialog("import-vault", trigger);

  return (
    <div
      className={cn(
        "dash-app bg-background text-foreground flex h-dvh overflow-hidden font-sans",
        nativeWindowStyles.canvas
      )}
      ref={appRef}
    >
      <DashboardSidebar
        sidebarOpen={sidebarOpen}
        menu={menu}
        setMenu={setMenu}
        loadVaults={loadVaults}
        activeVault={activeVault}
        vaults={vaults}
        switchVault={switchVault}
        openDialog={openDialog}
        removeVault={removeVault}
        openCreateVault={openCreateVault}
        openImportVault={openImportVault}
        projectsCount={projects.length}
        navigate={navigate}
        syncAt={syncAt}
        now={now}
        dialogStateRef={dialogStateRef}
      />
      <button
        type="button"
        className={cn(
          "dash-sidebar-scrim fixed inset-0 z-40 bg-black/50 backdrop-blur-xs transition-opacity min-[861px]:hidden",
          sidebarOpen ? "block opacity-100" : "hidden opacity-0"
        )}
        hidden={!sidebarOpen}
        aria-label={t("project.sidebar.collapse")}
        onClick={closeSidebar}
      />
      <main className="dash-main bg-background flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className={cn("dash-topbar", topBarClass)}>
          <div className="flex min-w-0 shrink-0 items-center gap-3">
            <SidebarToggle expanded={sidebarOpen} onToggle={toggleSidebar} />
            <nav
              className="dash-crumbs text-muted-foreground flex min-w-0 items-center gap-2 text-[13px]"
              aria-label={t("dashboard.a11y.crumbsLabel")}
            >
              <span className="shrink-0">{t("dashboard.crumbsVault")}</span>
              <span aria-hidden="true" className="opacity-40">
                /
              </span>
              <span aria-current="page" className="text-foreground truncate">
                {t("dashboard.title")}
              </span>
            </nav>
          </div>
          <div className="dash-search relative mx-auto max-w-[420px] min-w-[120px] flex-1">
            <Icon
              name="search"
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
            />
            <Input
              ref={searchRef}
              type="search"
              id="search-input"
              placeholder={t("dashboard.searchPlaceholder")}
              aria-label={t("dashboard.a11y.searchLabel")}
              autoComplete="off"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="bg-secondary/50 border-border h-10 pr-14 pl-9 text-[13px]"
            />
            <kbd className="dash-search-kbd text-muted-foreground border-border/80 bg-background/50 pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded border px-1.5 py-0.5 font-mono text-[10px]">
              ⌘K
            </kbd>
          </div>
          <div className="dash-toolbar flex shrink-0 items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              type="button"
              className="dh-btn dh-btn-secondary h-10 gap-2 px-4 text-[13px] font-medium"
              id="lock-btn"
              disabled={actionBusy !== null}
              onClick={() => lock()}
            >
              <Icon name="lock" />
              <span>{t("dashboard.lock")}</span>
            </Button>
            <DropdownMenu
              open={menu === "actions"}
              onOpenChange={(open) => setMenu(open ? "actions" : null)}
            >
              <DropdownMenuTrigger asChild>
                <Button
                  variant="secondary"
                  size="icon"
                  type="button"
                  className="dh-btn-icon size-10"
                  id="settings-dropdown-btn"
                  aria-label={t("dashboard.a11y.menuLabel")}
                >
                  <Icon name="ellipsis" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="bg-card border-border min-w-[200px] rounded-xl border p-1.5 shadow-xl"
              >
                <DropdownMenuItem
                  id="install-cli-btn"
                  className="hover:bg-secondary flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px]"
                  disabled={!cliReady || actionBusy !== null}
                  onSelect={() =>
                    handleCli(cliInstalled ? "uninstall" : "install")
                  }
                >
                  <Icon name="download" className="text-muted-foreground" />
                  <span>{cliActionLabel()}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  id="settings-btn"
                  className="hover:bg-secondary flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px]"
                  onSelect={() => navigate("settings")}
                >
                  <Icon name="settings" className="text-muted-foreground" />
                  <span>{t("dashboard.settings")}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="default"
              size="sm"
              type="button"
              className="dh-btn dh-btn-primary h-10 gap-2 px-4 text-[13px] font-medium"
              id="add-project-btn"
              aria-label={t("dashboard.addProject")}
              title={t("dashboard.addProject")}
              disabled={actionBusy !== null}
              onClick={(event) => openDialog("project", event.currentTarget)}
            >
              <Icon name="plus" />
              <span className="btn-label-collapsible max-[860px]:hidden">
                {t("dashboard.addProject")}
              </span>
            </Button>
          </div>
        </header>
        <div className="dash-canvas flex-1 space-y-6 overflow-y-auto p-6 lg:p-8">
          <div className="dash-heading space-y-1">
            <h1 className="text-foreground text-2xl font-semibold tracking-tight">
              {t("dashboard.title")}
            </h1>
            <p className="dash-subtitle text-muted-foreground text-xs">
              {t("dashboard.subtitle")}
            </p>
          </div>
          {showStatistics && statistics && (
            <StatisticsStrip statistics={statistics} />
          )}
          <section
            className="dash-section space-y-4"
            aria-label={t("dashboard.a11y.sectionLabel")}
          >
            <div className="dash-section-head mb-4 flex flex-wrap items-center gap-3">
              <fieldset
                className="dash-filters m-0 flex min-w-0 items-center gap-2 border-0 p-0"
                aria-label={t("dashboard.filters.label")}
              >
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  className={cn(
                    "h-8 px-3 text-xs",
                    projectFilter === "all" &&
                      "bg-primary/10 text-primary border-primary/20"
                  )}
                  aria-pressed={projectFilter === "all"}
                  onClick={() => setProjectFilter("all")}
                >
                  {t("dashboard.filters.all", { count: projects.length })}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  className={cn(
                    "h-8 gap-1.5 px-3 text-xs",
                    projectFilter === "starred" &&
                      "bg-primary/10 text-primary border-primary/20"
                  )}
                  aria-pressed={projectFilter === "starred"}
                  onClick={() => setProjectFilter("starred")}
                >
                  <Icon name="star" />
                  {t("dashboard.filters.starred", {
                    count: projects.filter((project) =>
                      favorites.includes(project.name)
                    ).length,
                  })}
                </Button>
              </fieldset>
              <span className="spacer flex-1" />
              <div className="dash-seg bg-secondary/80 border-border inline-flex gap-0.5 rounded-lg border p-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  className={cn(
                    "text-muted-foreground size-7 rounded-md",
                    viewMode === "grid" &&
                      "bg-card text-foreground font-medium shadow-xs"
                  )}
                  id="viewGridBtn"
                  aria-label={t("dashboard.viewToggle.grid")}
                  aria-pressed={viewMode === "grid"}
                  onClick={() => setViewMode("grid")}
                >
                  <Icon name="grid" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  className={cn(
                    "text-muted-foreground size-7 rounded-md",
                    viewMode === "list" &&
                      "bg-card text-foreground font-medium shadow-xs"
                  )}
                  id="viewListBtn"
                  aria-label={t("dashboard.viewToggle.list")}
                  aria-pressed={viewMode === "list"}
                  onClick={() => setViewMode("list")}
                >
                  <Icon name="list" />
                </Button>
              </div>
              <DropdownMenu
                open={menu === "sort"}
                onOpenChange={(open) => setMenu(open ? "sort" : null)}
              >
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    className="h-8 gap-1.5 px-3 text-xs"
                    id="sortBtn"
                    aria-label={t("dashboard.a11y.sortLabel")}
                  >
                    <span id="sortLabel">
                      {t(`dashboard.sort.${sortMode}`)}
                    </span>
                    <Icon name="chevron-down" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  id="sortMenu"
                  className="bg-card border-border min-w-[180px] rounded-xl border p-1.5 shadow-xl"
                >
                  <DropdownMenuRadioGroup
                    value={sortMode}
                    onValueChange={(value) => setSortMode(value as SortMode)}
                  >
                    {(["recent", "name", "secrets"] as const).map((sort) => (
                      <DropdownMenuRadioItem
                        key={sort}
                        value={sort}
                        className="cursor-pointer py-2 pr-2.5 pl-8 text-[13px]"
                      >
                        {t(`dashboard.sort.${sort}`)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div id="projects-container">{projectState()}</div>
          </section>
          {loadState === "ready" && (
            <HomeFolderImport
              key={activeVaultId}
              projects={projects}
              onCreateProject={(trigger) => openDialog("project", trigger)}
            />
          )}
        </div>
        <footer className="dash-footer bg-card/90 border-border text-muted-foreground fixed right-4 bottom-3 z-20 flex items-center gap-3 rounded-lg border px-3 py-1.5 text-xs shadow-sm backdrop-blur-xs">
          <span>
            <kbd className="bg-secondary/80 border-border rounded border px-1 py-0.5 font-mono text-[10px]">
              Enter
            </kbd>{" "}
            {t("dashboard.card.open")}
          </span>
          <span>
            <kbd className="bg-secondary/80 border-border rounded border px-1 py-0.5 font-mono text-[10px]">
              ⌘K / Ctrl+K
            </kbd>{" "}
            {t("dashboard.a11y.searchLabel")}
          </span>
          <span className="dash-footer-local hidden items-center gap-1.5 min-[1001px]:inline-flex">
            <span
              className="dash-sync-dot bg-success size-1.5 rounded-full"
              aria-hidden="true"
            />
            {t("dashboard.card.storedLocally")}
          </span>
        </footer>
      </main>
      <DashboardDialog
        dialog={dialog}
        dialogRef={dialogRef}
        form={form}
        actionBusy={actionBusy}
        onClose={closeDialog}
        onFieldChange={setField}
        onBrowseFolder={browseFolder}
        onSubmitProject={submitProject}
        onSubmitVaultCreate={submitVaultCreate}
        onSubmitVaultImport={submitVaultImport}
        onSubmitVaultRename={submitVaultRename}
      />
      {confirmationDialog}
    </div>
  );
};

const rootNode = document.querySelector<HTMLElement>("#dashboard-root");
if (!rootNode) {
  throw new Error("Missing Dashboard root element");
}
mountRenderer(
  rootNode,
  <RendererProviders>
    <App />
  </RendererProviders>
);
