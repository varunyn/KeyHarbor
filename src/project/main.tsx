import React, {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";

import { runWithCleanup } from "../renderer/async-operation";
import { i18n } from "../renderer/i18n";
import { mountRenderer } from "../renderer/mount";
import { notificationManager } from "../renderer/notifications";
import {
  RendererProviders,
  useRendererTranslation,
} from "../renderer/providers";
import { ActionMenu } from "../renderer/ui/action-menu";
import { Button } from "../renderer/ui/button";
import { cn } from "../renderer/ui/utils";
import { useSidebarState } from "../renderer/use-sidebar-state";
import { useTimedClipboard } from "../renderer/use-timed-clipboard";
import { nativeWindowStyles } from "../renderer/window-chrome";
import type {
  ActivityLog,
  ConfigurationResult,
  EnvironmentSummary,
  EnvironmentTarget,
  FolderScanSummary,
  ImportDecision,
  ImportOccurrence,
  ProjectRecord,
  ReviewTarget,
  SecretHistory,
  SecretRecord,
} from "./bridge";
import {
  ConfigurationReviewDialog,
  Icon,
  ImportReviewDialog,
  Inspector,
  SecretTable,
} from "./components";
import type { ConfigDraft, ImportRow } from "./components";
import { EnvironmentControls } from "./environment-controls";
import { useEnvironmentLifetime } from "./environment-lifetime";
import { environmentUsageFor } from "./environment-usage";
import type { Modal } from "./project-screen-reducer";
import { ProjectSidebar } from "./project-sidebar";
import { ProjectToolbar } from "./project-toolbar";
import { ProjectTopbar } from "./project-topbar";
import { RawExportDialog } from "./raw-export-dialog";
import {
  useConfigurationReviewState,
  useImportReviewState,
} from "./review-state";
import { SecretConfirmationDialog } from "./secret-confirmation-dialog";
import { SecretDuplicateDialog } from "./secret-duplicate-dialog";
import { SecretEditorDialog } from "./secret-editor-dialog";
import type { SecretDraft } from "./secret-editor-dialog";
import { SecretHistoryDialog } from "./secret-history-dialog";
import { deriveType, relative, statusFor } from "./secret-presentation";
import type { Entry } from "./secret-presentation";
import { useProjectScreenState } from "./use-project-screen-state";

type ConfigurationChecklist = Extract<
  ConfigurationResult,
  { success: true; configured: true }
>;

const failOperation: (error: Error) => never = (error) => {
  throw error;
};

const t = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars);
const configuredChecklistFor = (
  result: ConfigurationResult | { state: "loading" | "unavailable" } | null
): ConfigurationChecklist | null =>
  result && "configured" in result && result.success && result.configured
    ? result
    : null;
const environmentContextLabelFor = (
  environmentName: string | undefined,
  projectName: string
) =>
  t("project.environments.context", {
    environment: environmentName || t("project.environments.unknown"),
    project: projectName,
  });
const importTargetLabelFor = (
  target: ReviewTarget | null,
  environmentName: string | undefined,
  projectName: string,
  vaultName: string
) =>
  t("project.importReview.target", {
    environment:
      target?.environmentName ||
      environmentName ||
      t("project.environments.unknown"),
    project: target?.projectName || projectName,
    vault:
      target?.vaultName || vaultName || t("project.importReview.unknownVault"),
  });
const configurationTargetLabelFor = (
  reviewTarget: ConfigDraft["target"] | null,
  configDraft: ConfigDraft | null,
  currentEnvironmentName: string | undefined,
  projectName: string,
  vaultName: string
) => {
  const resolvedTarget =
    reviewTarget || (configDraft ? configDraft.target : null);
  return t("project.configuration.target", {
    environment:
      resolvedTarget?.environmentName ||
      currentEnvironmentName ||
      t("project.environments.unknown"),
    project: resolvedTarget?.projectName || projectName,
    vault:
      resolvedTarget?.vaultName ||
      vaultName ||
      t("project.configuration.currentVault"),
  });
};
const projectStateEnvironmentFor = (environmentName?: string) =>
  environmentName || t("project.environments.unknown");
const vaultSubtitleFor = (vaultName: string) =>
  vaultName ? t("project.header.vaultSubtitle", { vault: vaultName }) : "";
const secretCountLabelFor = (count: number) =>
  count === 1
    ? t("project.summary.secretsOne")
    : t("project.summary.secrets", { count });
const fetchImportPreview = (
  target: EnvironmentTarget,
  input: {
    source: "folder" | "file" | "text";
    text: string;
    fileContent: string;
    scanId: string | null;
    fileId?: string;
    forceDialog: boolean;
  }
) => {
  if (input.source === "folder" && input.fileId && input.scanId) {
    return window.keyharbor.secrets.importFolderPreview(
      target,
      input.scanId,
      input.fileId
    );
  }
  if (
    input.source === "text" ||
    (!input.forceDialog && input.fileContent.length > 0)
  ) {
    return window.keyharbor.secrets.importPreview(target, {
      content: input.source === "text" ? input.text : input.fileContent,
      source: "text",
    });
  }
  return window.keyharbor.secrets.importPreview(target, { source: "file" });
};
const importFileLabel = (
  source: string,
  scan: FolderScanSummary | null,
  fileId: string | null,
  fileName: string | null
) => {
  if (source === "folder") {
    return scan?.files.find((file) => file.id === fileId)?.path || null;
  }
  return fileName;
};
const inspectorClassFor = (open: boolean, selected: string | null) =>
  open && selected ? "is-open" : "";
const selectedSecretFor = (
  secrets: Record<string, SecretRecord>,
  selected: string | null
) =>
  selected && Object.hasOwn(secrets, selected) ? secrets[selected] : undefined;

const isSearchShortcut = (event: KeyboardEvent, field: boolean) =>
  (event.key === "/" && !field) ||
  ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k");

const revealSeconds = 30;
const validKey = (name: string) =>
  /^[A-Za-z0-9._-]+$/u.test(name) && !/[=\s]/u.test(name);
const own = (object: object, key: PropertyKey) => Object.hasOwn(object, key);
const exportProjectBackup = async (
  projectName: string,
  isFresh: () => boolean
) => {
  try {
    const result = await window.keyharbor.projects.backup(projectName);
    if (!isFresh()) {
      return false;
    }
    if (!result.success) {
      if (!result.cancelled) {
        notificationManager.show(
          result.error || t("project.notifications.failedToExport"),
          "error"
        );
      }
      return false;
    }
    notificationManager.show(
      t("project.exportMenu.exported", { path: result.path }),
      "success"
    );
    return true;
  } catch (error) {
    if (isFresh()) {
      notificationManager.show(
        error instanceof Error
          ? error.message
          : t("project.notifications.failedToExport"),
        "error"
      );
    }
    return false;
  }
};
const generateValue = (length: number) => {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
};

const countImportRows = (rows: ImportRow[]) => {
  const counts = { add: 0, pending: 0, replace: 0, skip: 0 };
  for (const row of rows) {
    if (row.duplicate && !row.choice?.explicit) {
      counts.pending += 1;
    } else {
      const action = row.choice?.action || "skip";
      counts[action] += 1;
    }
  }
  return counts;
};

const expiresAtFor = (
  mode: SecretDraft["mode"],
  expires: string,
  originalExpiryDate: string,
  originalExpiry: string | null
) => {
  if (mode === "edit" && expires === originalExpiryDate) {
    return originalExpiry;
  }
  return expires ? new Date(`${expires}T23:59:59`).toISOString() : null;
};

interface ProjectStateProps {
  environmentState: "loading" | "ready" | "error";
  loadState: "loading" | "ready" | "error";
  hasEntries: boolean;
  environmentName: string;
  projectName: string;
  targetAvailable: boolean;
  loadEnvironments: () => void;
  loadSecrets: () => void;
  openSecret: () => void;
}

const LoadingState = ({ label }: { label: string }) => (
  <div className="text-muted-foreground flex flex-col items-center justify-center gap-3 p-12 text-center text-xs">
    <output
      className="border-primary size-6 animate-spin rounded-full border-2 border-t-transparent"
      aria-label={label}
    />
    <p>{label}</p>
  </div>
);

const ErrorState = ({ label, retry }: { label: string; retry: () => void }) => (
  <div className="bg-destructive/10 border-destructive/20 text-destructive secrets-error-card mx-auto flex max-w-sm flex-col items-center justify-center gap-3 rounded-2xl border p-8 text-center">
    <Icon name="circle-alert" />
    <h2 className="text-sm font-semibold">{label}</h2>
    <Button variant="secondary" size="sm" type="button" onClick={retry}>
      {t("project.retry")}
    </Button>
  </div>
);

const ProjectState = ({
  environmentState,
  loadState,
  hasEntries,
  environmentName,
  projectName,
  targetAvailable,
  loadEnvironments,
  loadSecrets,
  openSecret,
}: ProjectStateProps) => {
  let content: React.ReactNode;
  if (environmentState === "loading") {
    content = <LoadingState label={t("project.environments.loading")} />;
  } else if (environmentState === "error") {
    content = (
      <ErrorState
        label={t("project.environments.loadFailed")}
        retry={loadEnvironments}
      />
    );
  } else if (loadState === "loading") {
    content = <LoadingState label={t("project.loadingSecrets")} />;
  } else if (loadState === "error") {
    content = <ErrorState label={t("project.loadError")} retry={loadSecrets} />;
  } else if (hasEntries) {
    content = (
      <>
        <Icon name="search" />
        <h2 className="text-foreground text-sm font-semibold">
          {t("project.emptyState.title")}
        </h2>
        <p className="text-muted-foreground text-xs">
          {t("project.table.noResults")}
        </p>
      </>
    );
  } else {
    content = (
      <>
        <Icon name="key" />
        <h2 className="text-foreground text-sm font-semibold">
          {t("project.emptyState.title")}
        </h2>
        <p className="text-muted-foreground max-w-sm text-xs">
          {t("project.environments.emptyState", {
            environment: environmentName,
            project: projectName,
          })}
        </p>
        <Button
          variant="default"
          size="sm"
          type="button"
          disabled={!targetAvailable}
          onClick={openSecret}
        >
          <Icon name="plus" />
          <span>{t("project.newSecret")}</span>
        </Button>
      </>
    );
  }
  return (
    <div className="text-muted-foreground secrets-state flex flex-col items-center justify-center gap-3 p-12 text-center text-xs">
      {content}
    </div>
  );
};

const ProjectSummary = ({
  entryCount,
  attention,
  updatedAt,
}: {
  entryCount: number;
  attention: number;
  updatedAt: string | null;
}) => (
  <div
    className="border-border/30 text-muted-foreground secrets-footing flex items-center gap-3 border-b px-6 py-2 text-xs"
    id="footing"
    aria-live="polite"
  >
    <span>{secretCountLabelFor(entryCount)}</span>
    <span
      className={cn(
        "font-medium",
        attention > 0 ? "text-warning" : "text-muted-foreground"
      )}
    >
      {t("project.summary.needsAttention", { count: attention })}
    </span>
    {updatedAt && (
      <>
        <span className="opacity-40" aria-hidden="true">
          ·
        </span>
        <span>
          {t("project.summary.updated", { time: relative(updatedAt) })}
        </span>
      </>
    )}
  </div>
);

interface ConfigurationPanelProps {
  result: ConfigurationResult | { state: "loading" | "unavailable" } | null;
  checklist: ConfigurationChecklist | null;
  targetAvailable: boolean;
  open: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onSecret: (key: string, mode: "new" | "edit") => void;
}

const configurationSummaryFor = (
  result: ConfigurationPanelProps["result"],
  checklist: ConfigurationChecklist | null
) => {
  if (!result || ("state" in result && result.state === "loading")) {
    return t("project.configuration.loading");
  }
  if (
    ("state" in result && result.state === "unavailable") ||
    ("success" in result && !result.success)
  ) {
    return t("project.configuration.unavailable");
  }
  if (checklist) {
    return t("project.configuration.readySummary", {
      ready: checklist.counts.ready,
      required: checklist.counts.required,
    });
  }
  return t("project.configuration.notConfigured");
};

const configurationActionFor = (
  result: ConfigurationPanelProps["result"],
  checklist: ConfigurationChecklist | null
) => {
  if (result && "state" in result && result.state === "unavailable") {
    return t("project.retry");
  }
  return checklist
    ? t("project.configuration.updateAction")
    : t("project.configuration.setAction");
};

const ConfigurationPanel = ({
  result,
  checklist,
  targetAvailable,
  open,
  onOpen,
  onToggle,
  onSecret,
}: ConfigurationPanelProps) => {
  const statusCounts = checklist?.counts;
  const configurationSummaryText = configurationSummaryFor(result, checklist);
  const configurationActionText = configurationActionFor(result, checklist);
  const showUnavailableHint =
    result && "state" in result && result.state === "unavailable";
  return (
    <section
      className="bg-card border-border configuration-panel mx-6 mt-4 rounded-xl border p-4 shadow-xs"
      id="configurationPanel"
      aria-labelledby="configurationHeading"
    >
      <div className="configuration-panel-head flex flex-wrap items-center justify-between gap-4">
        <div className="configuration-overview space-y-1">
          <h2
            id="configurationHeading"
            className="text-muted-foreground text-xs font-semibold tracking-wider uppercase"
          >
            {t("project.configuration.heading")}
          </h2>
          <output
            id="configurationSummaryText"
            className="text-foreground block text-xs font-medium"
            aria-live="polite"
          >
            {configurationSummaryText}
          </output>
          {checklist && statusCounts && (
            <p
              className="text-muted-foreground configuration-breakdown text-xs"
              id="configurationBreakdown"
            >
              {t("project.configuration.breakdown", {
                empty: statusCounts.empty,
                expired: statusCounts.expired,
                missing: statusCounts.missing,
              })}
            </p>
          )}
        </div>
        <div className="configuration-panel-actions flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            type="button"
            className="h-8 px-3 text-xs font-medium"
            id="configurationAction"
            disabled={!targetAvailable}
            onClick={onOpen}
          >
            {configurationActionText}
          </Button>
          {checklist && (
            <Button
              variant="ghost"
              size="icon"
              type="button"
              className="size-8"
              id="configurationToggle"
              aria-expanded={open}
              aria-controls="configurationChecklist"
              aria-label={t(
                `project.configuration.${open ? "hideChecklist" : "showChecklist"}`
              )}
              title={t(
                `project.configuration.${open ? "hideChecklist" : "showChecklist"}`
              )}
              onClick={onToggle}
            >
              <Icon name="chevron-down" />
            </Button>
          )}
        </div>
      </div>
      {showUnavailableHint && (
        <p className="text-destructive mt-2 text-xs" id="configurationError">
          {t("project.configuration.retryHint")}
        </p>
      )}
      {checklist && (
        <ul
          className="border-border/40 divide-border/30 configuration-checklist mt-3 divide-y border-t pt-3"
          id="configurationChecklist"
          aria-label={t("project.configuration.heading")}
          hidden={!open}
        >
          {checklist.entries.map((entry) => (
            <li
              className="flex items-center justify-between py-2 text-xs"
              key={entry.key}
            >
              <code className="text-foreground font-mono font-medium">
                {entry.key}
              </code>
              <span
                className="bg-secondary text-muted-foreground rounded-md px-2 py-0.5 text-[11px]"
                data-status={entry.status}
              >
                {t(
                  `project.configuration.status.${entry.status.toLowerCase()}`
                )}
              </span>
              {entry.status === "Ready" ? (
                <span />
              ) : (
                <Button
                  variant="link"
                  size="sm"
                  type="button"
                  className="text-primary h-auto p-0 text-xs hover:underline"
                  aria-label={t(
                    entry.status === "Missing"
                      ? "project.configuration.addKey"
                      : "project.configuration.editKey",
                    { key: entry.key }
                  )}
                  onClick={() =>
                    onSecret(
                      entry.key,
                      entry.status === "Missing" ? "new" : "edit"
                    )
                  }
                >
                  {t(
                    entry.status === "Missing"
                      ? "project.configuration.addSecret"
                      : "project.configuration.editSecret"
                  )}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

type InspectorAction = "rotate" | "history" | "duplicate" | "delete";

interface InspectorPanelProps {
  selected: string | null;
  inspectorOpen: boolean;
  activeEntry: SecretRecord | undefined;
  menu: string | null;
  vaultName: string;
  history: SecretHistory | null;
  historyKey: string | null;
  usage: ReturnType<typeof environmentUsageFor>;
  reveal: { key: string; remaining: number } | null;
  onMenuOpenChange: (open: boolean) => void;
  onAction: (action: InspectorAction) => void;
  onClose: () => void;
  onCopy: () => void;
  onReveal: () => void;
}

const InspectorPanel = ({
  selected,
  inspectorOpen,
  activeEntry,
  menu,
  vaultName,
  history,
  historyKey,
  usage,
  reveal,
  onMenuOpenChange,
  onAction,
  onClose,
  onCopy,
  onReveal,
}: InspectorPanelProps) => (
  <aside
    className={cn(
      nativeWindowStyles.inspector,
      "border-border bg-card/40 secrets-inspector flex h-full w-[360px] shrink-0 flex-col border-l",
      inspectorClassFor(inspectorOpen, selected)
    )}
    id="inspector"
    aria-label={t("project.a11y.inspectorLabel")}
  >
    <div className="border-border/40 inspector-head flex items-center gap-3 border-b p-4">
      <span
        className="bg-secondary/80 border-border text-primary type-icon flex size-8 shrink-0 items-center justify-center rounded-lg border"
        id="inspectorIcon"
      >
        <Icon
          name={
            activeEntry &&
            deriveType(selected || "", activeEntry.value) === "secret"
              ? "lock"
              : "file-text"
          }
        />
      </span>
      <div className="inspector-title min-w-0 flex-1">
        <h2
          id="inspectorName"
          className="text-foreground truncate font-mono text-sm font-semibold"
        >
          {selected || "–"}
        </h2>
        <p id="inspectorSub" className="text-muted-foreground truncate text-xs">
          {activeEntry
            ? `${t(deriveType(selected || "", activeEntry.value) === "secret" ? "project.inspector.secretIn" : "project.inspector.configIn")} · ${relative(activeEntry.updatedAt)}`
            : t("project.inspector.noSelection")}
        </p>
      </div>
      <ActionMenu
        open={menu === "inspector"}
        onOpenChange={onMenuOpenChange}
        items={[
          {
            label: t("project.inspector.rotateSecret"),
            onSelect: () => onAction("rotate"),
          },
          {
            label: t("project.viewHistory"),
            onSelect: () => onAction("history"),
          },
          {
            label: t("project.inspector.duplicateToProject"),
            onSelect: () => onAction("duplicate"),
          },
          { separator: true },
          {
            destructive: true,
            label: t("project.deleteSecret"),
            onSelect: () => onAction("delete"),
          },
        ]}
      >
        <Button
          variant="ghost"
          size="icon"
          type="button"
          className="text-muted-foreground hover:text-foreground row-action size-7 rounded-md"
          id="inspectorMenuBtn"
          aria-expanded={menu === "inspector"}
        >
          <Icon name="ellipsis" className="size-3.5" />
          <span className="sr-only">
            {t("project.inspector.secretActions")}
          </span>
        </Button>
      </ActionMenu>
      <Button
        variant="ghost"
        size="icon"
        type="button"
        className="text-muted-foreground hover:text-foreground row-action size-7 rounded-md"
        id="inspectorClose"
        onClick={onClose}
      >
        <Icon name="x" className="size-3.5" />
        <span className="sr-only">{t("project.inspector.close")}</span>
      </Button>
    </div>
    <div
      className="inspector-body min-h-0 flex-1 overflow-y-auto p-4"
      id="inspectorBody"
    >
      {activeEntry && selected ? (
        <Inspector
          entry={activeEntry}
          type={deriveType(selected, activeEntry.value)}
          vaultName={vaultName}
          history={historyKey === selected ? history : null}
          usage={usage}
          reveal={reveal?.key === selected ? reveal : null}
          onCopy={onCopy}
          onReveal={onReveal}
        />
      ) : (
        <div className="text-muted-foreground inspector-empty flex h-full items-center justify-center text-xs italic">
          {t("project.inspector.noSelection")}
        </div>
      )}
    </div>
  </aside>
);

interface ProjectDialogsProps {
  modal: Modal;
  secretEditor: React.ComponentProps<typeof SecretEditorDialog>;
  deleteConfirmation: React.ComponentProps<typeof SecretConfirmationDialog>;
  rotateConfirmation: React.ComponentProps<typeof SecretConfirmationDialog>;
  duplicate: React.ComponentProps<typeof SecretDuplicateDialog>;
  configuration: Omit<
    React.ComponentProps<typeof ConfigurationReviewDialog>,
    "draft"
  > & { draft: ConfigDraft | null };
  importProps: React.ComponentProps<typeof ImportReviewDialog>;
  rawExport: React.ComponentProps<typeof RawExportDialog>;
  history: React.ComponentProps<typeof SecretHistoryDialog>;
}

const ProjectDialogs = ({
  modal,
  secretEditor,
  deleteConfirmation,
  rotateConfirmation,
  duplicate,
  configuration,
  importProps,
  rawExport,
  history,
}: ProjectDialogsProps) => (
  <>
    {modal === "secret" && <SecretEditorDialog {...secretEditor} />}
    {modal === "delete" && <SecretConfirmationDialog {...deleteConfirmation} />}
    {modal === "rotate" && <SecretConfirmationDialog {...rotateConfirmation} />}
    {modal === "duplicate" && <SecretDuplicateDialog {...duplicate} />}
    {modal === "configuration" && configuration.draft && (
      <ConfigurationReviewDialog
        {...configuration}
        draft={configuration.draft}
      />
    )}
    {modal === "import" && <ImportReviewDialog {...importProps} />}
    {modal === "raw" && <RawExportDialog {...rawExport} />}
    {modal === "history" && <SecretHistoryDialog {...history} />}
  </>
);

const ProjectApp = () => {
  useRendererTranslation();
  const projectName =
    new URLSearchParams(window.location.search).get("name") || "";
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [environmentSummaries, setEnvironmentSummaries] = useState<
    EnvironmentSummary[]
  >([]);
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<
    string | null
  >(null);
  const [environmentState, setEnvironmentState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [environmentLifetimeRevision, setEnvironmentLifetimeRevision] =
    useState(0);
  // Canonical desktop target. Metadata must confirm the Environment ID first;
  // a Project default alone is never enough to enable target actions.
  const hasSelectedEnvironment = environmentSummaries.some(
    (entry) => entry.id === selectedEnvironmentId
  );
  const target = useMemo<EnvironmentTarget | null>(() => {
    const environmentId = selectedEnvironmentId;
    return environmentId && projectName && hasSelectedEnvironment
      ? { environmentId, projectName }
      : null;
  }, [hasSelectedEnvironment, projectName, selectedEnvironmentId]);
  const currentEnvironment = environmentSummaries.find(
    (entry) => entry.id === target?.environmentId
  );
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [inspectorHistory, setInspectorHistory] =
    useState<SecretHistory | null>(null);
  const [inspectorHistoryKey, setInspectorHistoryKey] = useState<string | null>(
    null
  );
  const [secrets, setSecrets] = useState<Record<string, SecretRecord>>({});
  const [vaultName, setVaultName] = useState("");
  const [vaultInstanceId, setVaultInstanceId] = useState<string | null>(null);
  const [projectUpdated, setProjectUpdated] = useState<string | null>(null);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const environmentId = target?.environmentId ?? "";
  const {
    actionBusy,
    actionKey,
    checklistOpen,
    clearRestoreArmed,
    closeModal: reducerCloseModal,
    duplicateEnvironmentId,
    duplicateEnvironments,
    duplicateTarget,
    fieldErrors,
    filterStatus,
    filterType,
    history,
    historyLoading,
    historyShown,
    inspectorOpen,
    menu,
    modal,
    overlayMode,
    rawPassword,
    restoreArmed,
    retireSensitiveState: reducerRetireSensitiveState,
    reveal,
    search,
    secretDraft,
    secretLoaded,
    selected,
    sessionLocked,
    setActionBusy,
    setActionKey,
    setDuplicateEnvironmentId,
    setDuplicateEnvironments,
    setDuplicateTarget,
    setFieldErrors,
    setFilterStatus,
    setFilterType,
    setHistory,
    setHistoryLoading,
    setHistoryShown,
    setInspectorOpen,
    setMenu,
    setModal,
    setOverlayMode,
    setRawPassword,
    setRestoreArmed,
    setReveal,
    setRowMenu,
    setSearch,
    setSecretDraft,
    setSelected,
    setView,
    tickReveal,
    toggleChecklist,
    toggleHistoryShown,
    view,
  } = useProjectScreenState();
  const { open: indexOpen, toggleSidebar, closeSidebar } = useSidebarState();
  const [syncAt, setSyncAt] = useState(() => Date.now());
  const [statusClock, setStatusClock] = useState(() => Date.now());
  const [configResult, setConfigResult] = useState<
    ConfigurationResult | { state: "loading" | "unavailable" } | null
  >({ state: "loading" });
  const configurationFlow = useConfigurationReviewState();
  const {
    draft: configDraft,
    setDraft: setConfigDraft,
    handle: configHandleRef,
    pending: configPendingRef,
    epoch: dialogEpochRef,
  } = configurationFlow;
  const importFlow = useImportReviewState();
  const {
    folderScan: importFolderScan,
    setFolderScan: setImportFolderScan,
    folderScanRef: importFolderScanRef,
    folderEnvironmentId: importFolderEnvironmentId,
    setFolderEnvironmentId: setImportFolderEnvironmentId,
    folderFileId: importFolderFileId,
    setFolderFileId: setImportFolderFileId,
    reviewedFileIds: importReviewedFileIds,
    setReviewedFileIds: setImportReviewedFileIds,
    source: importSource,
    setSource: setImportSource,
    text: importText,
    setText: setImportText,
    fileName: importFileName,
    setFileName: setImportFileName,
    fileContent: importFileContent,
    setFileContent: setImportFileContent,
    rows: importRows,
    setRows: setImportRows,
    handle: importHandle,
    setHandle: setImportHandle,
    target: importTarget,
    setTarget: setImportTarget,
    diagnostics: importDiagnostics,
    setDiagnostics: setImportDiagnostics,
    busy: importBusy,
    setBusy: setImportBusy,
    committing: importCommitting,
    setCommitting: setImportCommitting,
    reveals: importReveals,
    setReveals: setImportReveals,
    handleRef: importHandleRef,
    pending: importPendingRef,
    epoch: importEpochRef,
    revealEpoch: importRevealEpochRef,
  } = importFlow;

  const { clearClipboard, copyWithAutoClear } = useTimedClipboard();
  const restoreTimer = useRef<number | null>(null);
  const sessionActive = useRef(true);
  const [sessionIsActive, setSessionIsActive] = useState(true);
  const {
    capture: captureEnvironmentLifetime,
    isCurrent: isEnvironmentLifetimeCurrent,
    retire: retireEnvironmentLifetime,
  } = useEnvironmentLifetime();
  const sensitiveEpoch = useRef(0);
  const loadEpoch = useRef(0);
  const favoritesEpoch = useRef(0);
  const configReadEpoch = useRef(0);
  const historyEpoch = useRef(0);
  const duplicateEnvironmentEpoch = useRef(0);
  const actionEpoch = useRef(0);
  const actionPending = useRef(false);
  const entries = useMemo<Entry[]>(
    () =>
      Object.entries(secrets).map(([key, secret]) => {
        const type = deriveType(key, secret.value);
        return {
          key,
          secret,
          status: statusFor(secret, type, statusClock),
          type,
        };
      }),
    [secrets, statusClock]
  );
  const attention = useMemo(
    () =>
      entries.filter(
        (entry) => entry.status === "expired" || entry.status === "rotate"
      ).length,
    [entries]
  );
  const visible = useMemo(() => {
    const result = entries.filter((entry) => {
      if (filterType !== "all" && entry.type !== filterType) {
        return false;
      }
      if (
        filterStatus === "healthy" &&
        !["healthy", "config"].includes(entry.status)
      ) {
        return false;
      }
      if (
        filterStatus === "attention" &&
        !["expired", "rotate"].includes(entry.status)
      ) {
        return false;
      }
      if (
        view === "attention" &&
        !["expired", "rotate"].includes(entry.status)
      ) {
        return false;
      }
      if (view === "favorites" && !favorites.includes(entry.key)) {
        return false;
      }
      return (
        !search || entry.key.toLowerCase().includes(search.trim().toLowerCase())
      );
    });
    result.sort((a, b) => {
      if (view === "recent") {
        return (
          Date.parse(b.secret.updatedAt || "") -
            Date.parse(a.secret.updatedAt || "") || a.key.localeCompare(b.key)
        );
      }
      if (view === "attention") {
        const priority = { expired: 0, rotate: 1 };
        return (
          (priority[a.status as "expired" | "rotate"] ?? 2) -
            (priority[b.status as "expired" | "rotate"] ?? 2) ||
          a.key.localeCompare(b.key)
        );
      }
      return (
        Number(favorites.includes(a.key)) * -1 +
          Number(favorites.includes(b.key)) || a.key.localeCompare(b.key)
      );
    });
    return result;
  }, [entries, filterType, filterStatus, view, favorites, search]);

  const refreshConfiguration = useCallback(async () => {
    const operationTarget = target;
    if (!sessionActive.current || !operationTarget) {
      return;
    }
    const lifetime = captureEnvironmentLifetime();
    configReadEpoch.current += 1;
    const op = configReadEpoch.current;
    setConfigResult((current) => current || { state: "loading" });
    try {
      const result =
        await window.keyharbor.projects.configurationGet(operationTarget);
      if (
        configReadEpoch.current === op &&
        isEnvironmentLifetimeCurrent(lifetime)
      ) {
        setConfigResult(result);
      }
    } catch {
      if (
        configReadEpoch.current === op &&
        isEnvironmentLifetimeCurrent(lifetime)
      ) {
        setConfigResult({ state: "unavailable" });
      }
    }
  }, [target, captureEnvironmentLifetime, isEnvironmentLifetimeCurrent]);
  const loadSecrets = useCallback(
    async (initial = false) => {
      const operationTarget = target;
      if (!sessionActive.current || !operationTarget) {
        return;
      }
      const lifetime = captureEnvironmentLifetime();
      loadEpoch.current += 1;
      const op = loadEpoch.current;
      if (initial) {
        setLoadState("loading");
      }
      try {
        const result = await window.keyharbor.secrets.getAll(operationTarget);
        if (
          loadEpoch.current !== op ||
          !isEnvironmentLifetimeCurrent(lifetime)
        ) {
          return;
        }
        if (!result.success) {
          failOperation(new Error(result.error || "load failed"));
        }
        const data = result.data || {};
        setSecrets(data);
        setLoadState("ready");
        setSyncAt(Date.now());
        void refreshConfiguration();
        const shouldOpenInspector = Boolean(
          initial &&
          !window.matchMedia("(max-width: 1100px)").matches &&
          Object.keys(data).length
        );
        secretLoaded(data, shouldOpenInspector);
      } catch {
        if (
          loadEpoch.current === op &&
          isEnvironmentLifetimeCurrent(lifetime)
        ) {
          setLoadState("error");
          setConfigResult({ state: "unavailable" });
          notificationManager.show(
            t("project.notifications.failedToLoad"),
            "error"
          );
        }
      }
    },
    [
      captureEnvironmentLifetime,
      isEnvironmentLifetimeCurrent,
      refreshConfiguration,
      secretLoaded,
      target,
    ]
  );
  const loadEnvironmentSummaries = useCallback(async () => {
    const lifetime = captureEnvironmentLifetime();
    setEnvironmentState("loading");
    try {
      const result = await window.keyharbor.projects.environments(projectName);
      if (!isEnvironmentLifetimeCurrent(lifetime) || !sessionActive.current) {
        return [];
      }
      if (!result.success || result.data.length === 0) {
        failOperation(new Error("Environment metadata is unavailable"));
      }
      setEnvironmentSummaries(result.data);
      setSelectedEnvironmentId((current) =>
        current && result.data.some((entry) => entry.id === current)
          ? current
          : (result.data.find((entry) => entry.isDefault)?.id ??
            result.data[0]?.id ??
            null)
      );
      setEnvironmentState("ready");
      return result.data;
    } catch {
      if (isEnvironmentLifetimeCurrent(lifetime) && sessionActive.current) {
        setEnvironmentSummaries([]);
        setSelectedEnvironmentId(null);
        setEnvironmentState("error");
        setLoadState("error");
      }
    }
    return [];
  }, [captureEnvironmentLifetime, isEnvironmentLifetimeCurrent, projectName]);
  const loadDuplicateEnvironments = useCallback(
    async (destinationProject: string) => {
      const lifetime = captureEnvironmentLifetime();
      duplicateEnvironmentEpoch.current += 1;
      const operation = duplicateEnvironmentEpoch.current;
      setDuplicateEnvironments([]);
      setDuplicateEnvironmentId("");
      if (!destinationProject) {
        return;
      }
      const result =
        await window.keyharbor.projects.environments(destinationProject);
      if (
        duplicateEnvironmentEpoch.current !== operation ||
        !isEnvironmentLifetimeCurrent(lifetime) ||
        !sessionActive.current
      ) {
        return;
      }
      if (!result.success) {
        return;
      }
      setDuplicateEnvironments(result.data);
      setDuplicateEnvironmentId(
        result.data.find((entry) => entry.isDefault)?.id ??
          result.data[0]?.id ??
          ""
      );
    },
    [
      captureEnvironmentLifetime,
      isEnvironmentLifetimeCurrent,
      setDuplicateEnvironmentId,
      setDuplicateEnvironments,
    ]
  );
  // Secret favorites are scoped to Project -> Environment ID, so identical keys in
  // different Environments stay distinguishable.
  const loadFavorites = useCallback(async () => {
    const lifetime = captureEnvironmentLifetime();
    favoritesEpoch.current += 1;
    const op = favoritesEpoch.current;
    try {
      const result = await window.keyharbor.favorites.get();
      if (
        favoritesEpoch.current === op &&
        isEnvironmentLifetimeCurrent(lifetime) &&
        result.success
      ) {
        setFavorites(result.data.secrets?.[projectName]?.[environmentId] || []);
      }
    } catch {
      if (
        favoritesEpoch.current === op &&
        isEnvironmentLifetimeCurrent(lifetime)
      ) {
        setFavorites([]);
      }
    }
  }, [
    projectName,
    environmentId,
    captureEnvironmentLifetime,
    isEnvironmentLifetimeCurrent,
  ]);
  const retireConfig = useCallback(async () => {
    const handle = configHandleRef.current;
    configHandleRef.current = null;
    if (handle) {
      try {
        await window.keyharbor.projects.configurationDiscard(handle);
      } catch {
        /* main process retires expired handles */
      }
    }
  }, [configHandleRef]);
  const retireImport = useCallback(
    async (includeFolder = true) => {
      const handles = [importHandleRef.current];
      importHandleRef.current = null;
      if (includeFolder) {
        handles.push(importFolderScanRef.current);
        importFolderScanRef.current = null;
        setImportFolderScan(null);
        setImportFolderFileId(null);
        setImportReviewedFileIds([]);
      }
      for (const handle of handles) {
        if (handle) {
          try {
            // Reviews and scans are retired in order; each handle owns main-process state.
            // eslint-disable-next-line no-await-in-loop
            await window.keyharbor.secrets.importDiscard(handle);
          } catch {
            /* Main process also retires handles on navigation and lock. */
          }
        }
      }
    },
    [
      importHandleRef,
      importFolderScanRef,
      setImportFolderScan,
      setImportFolderFileId,
      setImportReviewedFileIds,
    ]
  );
  const clearImportState = useCallback(() => {
    importEpochRef.current += 1;
    importRevealEpochRef.current += 1;
    importPendingRef.current = false;
    void retireImport();
    setImportRows([]);
    setImportHandle(null);
    setImportTarget(null);
    setImportDiagnostics([]);
    setImportBusy(false);
    setImportCommitting(false);
    setImportReveals({});
    setDuplicateEnvironmentId("");
    setDuplicateEnvironments([]);
    setImportText("");
    setImportFileName(null);
    setImportFileContent("");
  }, [
    retireImport,
    importRevealEpochRef,
    setImportTarget,
    importPendingRef,
    importEpochRef,
    setImportRows,
    setImportDiagnostics,
    setImportBusy,
    setImportReveals,
    setImportText,
    setImportFileName,
    setImportFileContent,
    setImportHandle,
    setImportCommitting,
    setDuplicateEnvironmentId,
    setDuplicateEnvironments,
  ]);
  const closeModal = useCallback(() => {
    actionEpoch.current += 1;
    actionPending.current = false;
    if (modal === "history") {
      historyEpoch.current += 1;
      if (restoreTimer.current) {
        window.clearTimeout(restoreTimer.current);
      }
      restoreTimer.current = null;
    }
    if (modal === "duplicate") {
      duplicateEnvironmentEpoch.current += 1;
    }
    if (modal === "configuration") {
      dialogEpochRef.current += 1;
      configPendingRef.current = false;
      void retireConfig();
      setConfigDraft(null);
    }
    if (modal === "import") {
      clearImportState();
    }
    reducerCloseModal();
  }, [
    clearImportState,
    configPendingRef,
    dialogEpochRef,
    modal,
    reducerCloseModal,
    retireConfig,
    setConfigDraft,
  ]);
  const retireTargetLifetime = useCallback(() => {
    retireEnvironmentLifetime();
    setEnvironmentLifetimeRevision((revision) => revision + 1);
    sensitiveEpoch.current += 1;
    loadEpoch.current += 1;
    favoritesEpoch.current += 1;
    duplicateEnvironmentEpoch.current += 1;
    configReadEpoch.current += 1;
    dialogEpochRef.current += 1;
    importEpochRef.current += 1;
    importRevealEpochRef.current += 1;
    historyEpoch.current += 1;
    actionEpoch.current += 1;
    actionPending.current = false;
    configPendingRef.current = false;
    importPendingRef.current = false;
    closeModal();
    void retireConfig();
    void retireImport();
    setSecrets({});
    setFavorites([]);
    setInspectorHistory(null);
    setInspectorHistoryKey(null);
    setConfigDraft(null);
    setImportRows([]);
    setImportHandle(null);
    setImportTarget(null);
    setImportText("");
    setImportFileName(null);
    setImportFileContent("");
    setImportReveals({});
    reducerRetireSensitiveState();
    setLoadState("loading");
  }, [
    closeModal,
    configPendingRef,
    dialogEpochRef,
    importEpochRef,
    importPendingRef,
    importRevealEpochRef,
    reducerRetireSensitiveState,
    retireConfig,
    retireEnvironmentLifetime,
    retireImport,
    setConfigDraft,
    setImportFileContent,
    setImportFileName,
    setImportHandle,
    setImportReveals,
    setImportRows,
    setImportTarget,
    setImportText,
  ]);
  const beginAction = useCallback(() => {
    if (actionPending.current || !sessionActive.current) {
      return null;
    }
    actionPending.current = true;
    setActionBusy(true);
    actionEpoch.current += 1;
    return actionEpoch.current;
  }, [setActionBusy]);
  const finishAction = useCallback(
    (operation: number) => {
      if (actionEpoch.current !== operation) {
        return false;
      }
      actionPending.current = false;
      setActionBusy(false);
      return true;
    },
    [setActionBusy]
  );
  const openConfig = useCallback(() => {
    dialogEpochRef.current += 1;
    setConfigDraft({
      busy: false,
      changes: null,
      duplicateNames: 0,
      entries: [],
      handle: null,
      message: "",
      removed: [],
      source: "text",
      step: "input",
      target: null,
      text: "",
    });
    setModal("configuration");
  }, [dialogEpochRef, setConfigDraft, setModal]);
  const showNotice = (
    key: string,
    kind = "success",
    vars?: Record<string, unknown>
  ) => notificationManager.show(t(key, vars), kind);

  const initializeProject = useEffectEvent(
    async (initialProjectName: string, isLive: () => boolean) => {
      const ok = await i18n.init();
      if (!isLive()) {
        return;
      }
      if (!ok) {
        notificationManager.show("Failed to load translations", "error");
      }
      document.title = `KeyHarbor — ${initialProjectName}`;
      if (!initialProjectName) {
        notificationManager.show(t("project.notifications.noProject"), "error");
        setLoadState("error");
        return;
      }
      const [projectResult, vaultResult, logResult] = await Promise.allSettled([
        window.keyharbor.projects.get(),
        window.keyharbor.vault.list(),
        window.keyharbor.logs.get(),
      ]);
      if (!isLive() || !sessionActive.current) {
        return;
      }
      if (projectResult.status === "fulfilled" && projectResult.value.success) {
        setProjects(projectResult.value.data);
        setProjectUpdated(
          projectResult.value.data.find((p) => p.name === initialProjectName)
            ?.updatedAt || null
        );
      }
      if (vaultResult.status === "fulfilled" && vaultResult.value.success) {
        const active =
          vaultResult.value.data.find((vault) => vault.isActive) ||
          vaultResult.value.data[0];
        if (active) {
          setVaultName(active.name);
        }
      }
      const identityLifetime = captureEnvironmentLifetime();
      const instanceResult = await window.keyharbor.vault.instanceIdentity();
      if (
        isLive() &&
        isEnvironmentLifetimeCurrent(identityLifetime) &&
        instanceResult.success
      ) {
        setVaultInstanceId(instanceResult.data.vaultInstanceId);
      }
      if (logResult.status === "fulfilled" && logResult.value.success) {
        setLogs(logResult.value.data);
      }
      await loadEnvironmentSummaries();
      await loadFavorites();
      if (!isLive()) {
        return;
      }
      await loadSecrets(true);
    }
  );

  useEffect(() => {
    let live = true;
    void (async () => {
      await Promise.resolve();
      if (live) {
        await initializeProject(projectName, () => live);
      }
    })();
    return () => {
      live = false;
      sensitiveEpoch.current += 1;
      loadEpoch.current += 1;
      favoritesEpoch.current += 1;
      duplicateEnvironmentEpoch.current += 1;
      configReadEpoch.current += 1;
      dialogEpochRef.current += 1;
      importEpochRef.current += 1;
      historyEpoch.current += 1;
      actionEpoch.current += 1;
      actionPending.current = false;
      configPendingRef.current = false;
      importPendingRef.current = false;
      void retireConfig();
      void retireImport();
      setReveal(null);
      void clearClipboard();
      if (restoreTimer.current) {
        window.clearTimeout(restoreTimer.current);
      }
    };
  }, [
    projectName,
    retireConfig,
    importEpochRef,
    dialogEpochRef,
    importPendingRef,
    configPendingRef,
    clearClipboard,
    retireImport,
    setReveal,
  ]);

  useEffect(() => {
    if (
      !target ||
      !environmentSummaries.some((entry) => entry.id === target.environmentId)
    ) {
      return;
    }
    let live = true;
    void (async () => {
      await Promise.resolve();
      if (live) {
        await loadFavorites();
        if (live) {
          await loadSecrets(true);
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [target, environmentSummaries, loadFavorites, loadSecrets]);

  const retireSensitiveState = useEffectEvent(() => {
    retireEnvironmentLifetime();
    setEnvironmentLifetimeRevision((revision) => revision + 1);
    sensitiveEpoch.current += 1;
    loadEpoch.current += 1;
    favoritesEpoch.current += 1;
    duplicateEnvironmentEpoch.current += 1;
    configReadEpoch.current += 1;
    dialogEpochRef.current += 1;
    importEpochRef.current += 1;
    importRevealEpochRef.current += 1;
    historyEpoch.current += 1;
    actionEpoch.current += 1;
    actionPending.current = false;
    setActionBusy(false);
    configPendingRef.current = false;
    importPendingRef.current = false;
    closeModal();
    void retireConfig();
    void retireImport();
    setSecrets({});
    setFavorites([]);
    setDuplicateEnvironmentId("");
    setDuplicateEnvironments([]);
    setLogs([]);
    setVaultInstanceId(null);
    setInspectorHistory(null);
    setInspectorHistoryKey(null);
    setImportReveals({});
    setConfigDraft(null);
    setImportRows([]);
    setImportHandle(null);
    setImportTarget(null);
    setImportText("");
    setModal(null);
    setInspectorOpen(false);
    sessionLocked();
    setLoadState("loading");
    void clearClipboard();
    if (restoreTimer.current) {
      window.clearTimeout(restoreTimer.current);
      restoreTimer.current = null;
    }
  });
  useEffect(() => {
    const offSession = window.keyharbor.vault.onSessionStateChanged(
      (snapshot) => {
        if (snapshot.state === "active") {
          sessionActive.current = true;
          setSessionIsActive(true);
          const identityLifetime = captureEnvironmentLifetime();
          void (async () => {
            const result = await window.keyharbor.vault.instanceIdentity();
            if (
              result.success &&
              isEnvironmentLifetimeCurrent(identityLifetime)
            ) {
              setVaultInstanceId(result.data.vaultInstanceId);
            }
          })();
          void loadFavorites();
          void loadSecrets(true);
        } else {
          sessionActive.current = false;
          setSessionIsActive(false);
          retireSensitiveState();
        }
      }
    );
    const offFocus = window.keyharbor.onWindowFocusChanged((focused) => {
      if (focused) {
        void refreshConfiguration();
      } else {
        setMenu(null);
        setReveal(null);
        setImportReveals({});
        importRevealEpochRef.current += 1;
      }
    });
    const offSync = window.keyharbor.vault.onVaultDataSynced(() => {
      retireTargetLifetime();
      const syncLifetime = captureEnvironmentLifetime();
      setSyncAt(Date.now());
      void (async () => {
        const [environments, projectResult] = await Promise.all([
          loadEnvironmentSummaries(),
          window.keyharbor.projects.get(),
        ]);
        if (
          !isEnvironmentLifetimeCurrent(syncLifetime) ||
          !sessionActive.current
        ) {
          return;
        }
        if (projectResult.success) {
          setProjects(projectResult.data);
        }
        if (!environments.some((entry) => entry.id === target?.environmentId)) {
          const replacement = projectResult.success
            ? projectResult.data.find((entry) => entry.name === projectName)
                ?.defaultEnvironmentId
            : undefined;
          setSelectedEnvironmentId(replacement || environments[0]?.id || null);
        }
      })();
    });
    const resize = () =>
      setOverlayMode(window.matchMedia("(max-width: 1100px)").matches);
    const pagehide = () => retireSensitiveState();
    const blur = () => setMenu(null);
    window.addEventListener("resize", resize);
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("blur", blur);
    return () => {
      offSession();
      offFocus();
      offSync();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("blur", blur);
    };
  }, [
    captureEnvironmentLifetime,
    isEnvironmentLifetimeCurrent,
    loadSecrets,
    loadFavorites,
    loadEnvironmentSummaries,
    target?.environmentId,
    projectName,
    retireTargetLifetime,
    refreshConfiguration,
    importRevealEpochRef,
    setImportReveals,
    setMenu,
    setOverlayMode,
    setReveal,
  ]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setSyncAt(Date.now());
      setStatusClock(Date.now());
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const revealKey = reveal?.key;
  useEffect(() => {
    if (!revealKey) {
      return;
    }
    const timer = window.setInterval(() => tickReveal(), 1000);
    return () => window.clearInterval(timer);
  }, [revealKey, tickReveal]);
  const importRevealCount = Object.keys(importReveals).length;
  useEffect(() => {
    if (!importRevealCount) {
      return;
    }
    const timer = window.setInterval(() => {
      const now = Date.now();
      setImportReveals((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([, item]) => item.expiresAt > now)
        )
      );
    }, 250);
    return () => window.clearInterval(timer);
  }, [importRevealCount, setImportReveals]);
  useEffect(() => {
    const result = configResult;
    if (
      !result ||
      !("configured" in result) ||
      !result.configured ||
      !result.nextExpiry
    ) {
      return;
    }
    const delay = Date.parse(result.nextExpiry) - Date.now() + 20;
    if (delay < 0) {
      const timer = window.setTimeout(() => {
        void refreshConfiguration();
      }, 0);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(
      () => {
        void refreshConfiguration();
      },
      Math.min(delay, 2_147_483_647)
    );
    return () => window.clearTimeout(timer);
  }, [configResult, refreshConfiguration]);

  const activeEntry = selectedSecretFor(secrets, selected);
  // Exact structured matching only: identically named keys in another Environment
  // or Project must never be attributed here. Denied approvals are not access.
  const usage = useMemo(
    () => environmentUsageFor(logs, target, selected, vaultInstanceId),
    [logs, target, selected, vaultInstanceId]
  );
  const ensureActiveHistory = useCallback(
    async (key: string) => {
      const operationTarget = target;
      const lifetime = captureEnvironmentLifetime();
      if (!operationTarget) {
        return null;
      }
      try {
        const result = await window.keyharbor.secrets.getHistory(
          operationTarget,
          key
        );
        if (result.success && isEnvironmentLifetimeCurrent(lifetime)) {
          return result.data;
        }
      } catch {
        /* history is optional inspector detail */
      }
      return null;
    },
    [captureEnvironmentLifetime, isEnvironmentLifetimeCurrent, target]
  );
  useEffect(() => {
    let live = true;
    const key = selected;
    void (async () => {
      await Promise.resolve();
      if (!live) {
        return;
      }
      if (!key || !own(secrets, key)) {
        setInspectorHistory(null);
        setInspectorHistoryKey(null);
        return;
      }
      setInspectorHistoryKey(key);
      setInspectorHistory(null);
      const result = await ensureActiveHistory(key);
      if (live && selected === key) {
        setInspectorHistory(result);
      }
    })();
    return () => {
      live = false;
    };
  }, [selected, secrets, ensureActiveHistory]);
  const selectKey = useCallback(
    (key: string, open = true) => {
      setReveal(null);
      setSelected(key);
      if (open && overlayMode) {
        setInspectorOpen(true);
      } else if (!overlayMode) {
        setInspectorOpen(true);
      }
    },
    [overlayMode, setInspectorOpen, setReveal, setSelected]
  );
  if (
    selected &&
    visible.length &&
    !visible.some((entry) => entry.key === selected)
  ) {
    setSelected(visible[0]?.key ?? null);
    setReveal(null);
  }
  const copySecret = async (key: string) => {
    const entry = secrets[key];
    if (!entry) {
      return;
    }
    const lifecycle = sensitiveEpoch.current;
    const copied = await copyWithAutoClear(String(entry.value ?? ""));
    if (sensitiveEpoch.current !== lifecycle || !sessionActive.current) {
      void clearClipboard();
      return;
    }
    if (copied) {
      notificationManager.show(
        t("project.copiedToast", { key }),
        "success",
        t("project.copiedDetail")
      );
    } else {
      notificationManager.show(
        t("project.notifications.failedToExport"),
        "error"
      );
    }
  };
  const openSecret = (mode: "new" | "edit", key = "") => {
    const entry = mode === "edit" ? secrets[key] : undefined;
    if (mode === "edit" && !entry) {
      return;
    }
    const date = entry?.expiresAt
      ? new Date(entry.expiresAt).toISOString().slice(0, 10)
      : "";
    setFieldErrors({});
    setSecretDraft({
      description: entry?.description || "",
      expires: date,
      key,
      mode,
      name: mode === "new" ? key : key,
      originalExpiry: entry?.expiresAt ?? null,
      originalExpiryDate: date,
      tags: (entry?.tags || []).join(", "),
      value: String(entry?.value ?? ""),
    });
    setModal("secret");
  };
  const saveSecret = async () => {
    const operation = beginAction();
    if (operation === null) {
      return;
    }
    const operationTarget = target;
    const lifetime = captureEnvironmentLifetime();
    if (!operationTarget) {
      finishAction(operation);
      return;
    }
    const {
      mode,
      key,
      name: rawName,
      value,
      description,
      tags: rawTags,
      expires,
      originalExpiry,
      originalExpiryDate,
    } = secretDraft;
    const name = rawName.trim();
    const errors: Record<string, string> = {};
    if (!name) {
      errors.name = t("project.secretForm.nameRequired");
    } else if (!validKey(name)) {
      errors.name = t("project.secretForm.nameInvalid");
    } else if (
      (mode === "new" && own(secrets, name)) ||
      (mode === "edit" && name !== key && own(secrets, name))
    ) {
      errors.name = t("project.secretForm.nameDuplicate");
    }
    if (!value) {
      errors.value = t("project.secretForm.valueRequired");
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      finishAction(operation);
      return;
    }
    const expiresAt = expiresAtFor(
      mode,
      expires,
      originalExpiryDate,
      originalExpiry
    );
    const metadata = {
      description: description.trim().slice(0, 500),
      tags: rawTags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 20),
    };
    return await runWithCleanup(
      async () => {
        try {
          const result =
            mode === "new"
              ? await window.keyharbor.secrets.set(
                  operationTarget,
                  name,
                  value,
                  expiresAt,
                  metadata
                )
              : await window.keyharbor.secrets.update(
                  operationTarget,
                  key,
                  name,
                  value,
                  expiresAt,
                  metadata
                );
          if (
            actionEpoch.current !== operation ||
            modal !== "secret" ||
            !isEnvironmentLifetimeCurrent(lifetime)
          ) {
            return;
          }
          if (!result.success) {
            failOperation(new Error(result.error));
          }
          showNotice(
            mode === "new"
              ? "project.notifications.secretAdded"
              : "project.notifications.secretSaved",
            "success",
            { key: name }
          );
          closeModal();
          await loadSecrets(false);
          await refreshConfiguration();
        } catch (error) {
          if (actionEpoch.current === operation) {
            notificationManager.show(
              error instanceof Error
                ? error.message
                : t("project.notifications.failedToSave"),
              "error"
            );
          }
        }
      },
      () => {
        finishAction(operation);
      }
    );
  };
  const removeSecret = async () => {
    const operation = beginAction();
    if (operation === null) {
      return;
    }
    const operationTarget = target;
    const lifetime = captureEnvironmentLifetime();
    if (!operationTarget) {
      finishAction(operation);
      return;
    }
    const key = actionKey;
    return await runWithCleanup(
      async () => {
        try {
          const result = await window.keyharbor.secrets.delete(
            operationTarget,
            key
          );
          if (
            actionEpoch.current !== operation ||
            modal !== "delete" ||
            !isEnvironmentLifetimeCurrent(lifetime)
          ) {
            return;
          }
          if (!result.success) {
            failOperation(new Error(result.error));
          }
          showNotice("project.notifications.secretDeleted", "success", { key });
          closeModal();
          await loadSecrets(false);
          await refreshConfiguration();
        } catch (error) {
          if (actionEpoch.current === operation) {
            notificationManager.show(
              error instanceof Error
                ? error.message
                : t("project.notifications.failedToDelete"),
              "error"
            );
          }
        }
      },
      () => {
        finishAction(operation);
      }
    );
  };
  const rotateSecret = async () => {
    const operation = beginAction();
    if (operation === null) {
      return;
    }
    const operationTarget = target;
    const lifetime = captureEnvironmentLifetime();
    if (!operationTarget) {
      finishAction(operation);
      return;
    }
    const key = actionKey;
    const entry = secrets[key];
    if (!entry) {
      finishAction(operation);
      return;
    }
    return await runWithCleanup(
      async () => {
        try {
          const result = await window.keyharbor.secrets.set(
            operationTarget,
            key,
            generateValue(32),
            entry.expiresAt ?? null,
            { description: entry.description || "", tags: entry.tags || [] }
          );
          if (
            actionEpoch.current !== operation ||
            modal !== "rotate" ||
            !isEnvironmentLifetimeCurrent(lifetime)
          ) {
            return;
          }
          if (!result.success) {
            failOperation(new Error(result.error));
          }
          showNotice("project.rotateModal.rotated", "success", { key });
          closeModal();
          await loadSecrets(false);
          await refreshConfiguration();
        } catch (error) {
          if (actionEpoch.current === operation) {
            notificationManager.show(
              error instanceof Error
                ? error.message
                : t("project.notifications.failedToRotate"),
              "error"
            );
          }
        }
      },
      () => {
        finishAction(operation);
      }
    );
  };
  const duplicateSecret = async () => {
    const operation = beginAction();
    if (operation === null) {
      return;
    }
    const sourceTarget = target;
    const lifetime = captureEnvironmentLifetime();
    const key = actionKey;
    const destinationProjectName = duplicateTarget;
    const entry = secrets[key];
    // The destination is another Project's default Environment, never a Project string.
    const destinationTarget = duplicateEnvironmentId
      ? {
          environmentId: duplicateEnvironmentId,
          projectName: destinationProjectName,
        }
      : null;
    if (
      !entry ||
      !sourceTarget ||
      !destinationProjectName ||
      !destinationTarget
    ) {
      finishAction(operation);
      return;
    }
    return await runWithCleanup(
      async () => {
        try {
          const current =
            await window.keyharbor.secrets.getAll(destinationTarget);
          if (
            actionEpoch.current !== operation ||
            modal !== "duplicate" ||
            !isEnvironmentLifetimeCurrent(lifetime)
          ) {
            return;
          }
          if (!current.success) {
            failOperation(new Error(current.error));
          }
          if (own(current.data, key)) {
            setFieldErrors({
              duplicate: t("project.duplicateModal.targetExists"),
            });
            return;
          }
          const result = await window.keyharbor.secrets.set(
            destinationTarget,
            key,
            String(entry.value ?? ""),
            entry.expiresAt ?? null,
            { description: entry.description || "", tags: entry.tags || [] }
          );
          if (
            actionEpoch.current !== operation ||
            modal !== "duplicate" ||
            !isEnvironmentLifetimeCurrent(lifetime)
          ) {
            return;
          }
          if (!result.success) {
            failOperation(new Error(result.error));
          }
          showNotice("project.duplicateModal.duplicated", "success", {
            environment:
              duplicateEnvironments.find(
                (item) => item.id === duplicateEnvironmentId
              )?.name || "",
            key,
            project: destinationProjectName,
          });
          closeModal();
        } catch (error) {
          if (
            actionEpoch.current === operation &&
            isEnvironmentLifetimeCurrent(lifetime)
          ) {
            notificationManager.show(
              error instanceof Error
                ? error.message
                : t("project.notifications.failedToDuplicate"),
              "error"
            );
          }
        }
      },
      () => {
        finishAction(operation);
      }
    );
  };
  const toggleFavorite = async (key: string) => {
    const operationTarget = target;
    const lifetime = captureEnvironmentLifetime();
    if (!operationTarget) {
      return;
    }
    try {
      const result = await window.keyharbor.favorite.toggleSecret(
        operationTarget,
        key
      );
      if (isEnvironmentLifetimeCurrent(lifetime) && result.success) {
        await loadFavorites();
      }
    } catch {
      if (isEnvironmentLifetimeCurrent(lifetime)) {
        notificationManager.show(
          t("project.notifications.failedToSave"),
          "error"
        );
      }
    }
  };
  const startReveal = (key: string) =>
    setReveal({ key, remaining: revealSeconds });

  const openConfiguration = () => {
    if (
      configResult &&
      "state" in configResult &&
      configResult.state === "unavailable"
    ) {
      void refreshConfiguration();
      return;
    }
    openConfig();
  };
  const setConfigDraftValue = (changes: Partial<ConfigDraft>) =>
    setConfigDraft((current) =>
      current ? { ...current, ...changes } : current
    );
  const requestConfigPreview = async (
    source: "text" | "file",
    text: string
  ) => {
    const draft = configDraft;
    const operationTarget = target;
    if (!draft || draft.busy || configPendingRef.current || !operationTarget) {
      return;
    }
    const lifetime = captureEnvironmentLifetime();
    configPendingRef.current = true;
    dialogEpochRef.current += 1;
    const op = dialogEpochRef.current;
    configHandleRef.current = null;
    setConfigDraftValue({ busy: true, message: "" });
    return await runWithCleanup(
      async () => {
        try {
          const result = await window.keyharbor.projects.configurationPreview(
            operationTarget,
            source === "text" ? { content: text, source } : { source }
          );
          if (
            dialogEpochRef.current !== op ||
            !draft ||
            !isEnvironmentLifetimeCurrent(lifetime)
          ) {
            if (result.success && result.handle) {
              await window.keyharbor.projects.configurationDiscard(
                result.handle
              );
            }
            return;
          }
          if (!result.success) {
            failOperation(
              new Error(
                result.error || t("project.configuration.previewFailed")
              )
            );
          }
          if (!result.handle) {
            setConfigDraftValue({
              busy: false,
              message:
                result.diagnostics
                  .map((item) =>
                    t("project.configuration.diagnosticLine", { ...item })
                  )
                  .join("\n") || t("project.configuration.previewFailed"),
            });
            return;
          }
          configHandleRef.current = result.handle;
          setConfigDraftValue({
            busy: false,
            changes: result.changes,
            duplicateNames: result.duplicateNames,
            entries: result.entries,
            handle: result.handle,
            step: "review",
            target: result.target,
          });
        } catch (error) {
          if (
            dialogEpochRef.current === op &&
            isEnvironmentLifetimeCurrent(lifetime)
          ) {
            setConfigDraftValue({
              busy: false,
              message:
                error instanceof Error
                  ? error.message
                  : t("project.configuration.previewFailed"),
            });
          }
        }
      },
      () => {
        if (
          dialogEpochRef.current === op &&
          isEnvironmentLifetimeCurrent(lifetime)
        ) {
          configPendingRef.current = false;
        }
      }
    );
  };
  const requestConfigClear = async () => {
    const operationTarget = target;
    if (configPendingRef.current || !operationTarget) {
      return;
    }
    const lifetime = captureEnvironmentLifetime();
    configPendingRef.current = true;
    dialogEpochRef.current += 1;
    const op = dialogEpochRef.current;
    setConfigDraftValue({ busy: true, message: "" });
    return await runWithCleanup(
      async () => {
        try {
          const result =
            await window.keyharbor.projects.configurationClearPreview(
              operationTarget
            );
          if (
            dialogEpochRef.current !== op ||
            !isEnvironmentLifetimeCurrent(lifetime)
          ) {
            if (result.success) {
              await window.keyharbor.projects.configurationDiscard(
                result.handle
              );
            }
            return;
          }
          if (!result.success) {
            failOperation(
              new Error(result.error || t("project.configuration.clearFailed"))
            );
          }
          configHandleRef.current = result.handle;
          setConfigDraftValue({
            busy: false,
            handle: result.handle,
            removed: result.removed,
            step: "clear",
            target: result.target,
          });
        } catch (error) {
          if (
            dialogEpochRef.current === op &&
            isEnvironmentLifetimeCurrent(lifetime)
          ) {
            setConfigDraftValue({
              busy: false,
              message:
                error instanceof Error
                  ? error.message
                  : t("project.configuration.clearFailed"),
            });
          }
        }
      },
      () => {
        if (
          dialogEpochRef.current === op &&
          isEnvironmentLifetimeCurrent(lifetime)
        ) {
          configPendingRef.current = false;
        }
      }
    );
  };
  const commitConfiguration = async () => {
    const draft = configDraft;
    const handle = configHandleRef.current;
    if (!draft || !handle || draft.busy || configPendingRef.current) {
      return;
    }
    const lifetime = captureEnvironmentLifetime();
    configPendingRef.current = true;
    dialogEpochRef.current += 1;
    const op = dialogEpochRef.current;
    const clear = draft.step === "clear";
    configHandleRef.current = null;
    setConfigDraftValue({ busy: true, message: "" });
    return await runWithCleanup(
      async () => {
        try {
          const result =
            await window.keyharbor.projects.configurationCommit(handle);
          if (
            dialogEpochRef.current !== op ||
            !isEnvironmentLifetimeCurrent(lifetime)
          ) {
            return;
          }
          if (!result.success) {
            failOperation(
              new Error(result.error || t("project.configuration.saveFailed"))
            );
          }
          showNotice(
            clear
              ? "project.configuration.cleared"
              : "project.configuration.saved",
            "success",
            {
              added: result.addedCount,
              removed: result.removedCount,
              required: result.requiredCount,
              unchanged: result.unchangedCount,
            }
          );
          setModal(null);
          setConfigDraft(null);
          void refreshConfiguration();
        } catch (error) {
          if (
            dialogEpochRef.current === op &&
            isEnvironmentLifetimeCurrent(lifetime)
          ) {
            setConfigDraftValue({
              busy: false,
              message:
                error instanceof Error
                  ? error.message
                  : t("project.configuration.saveFailed"),
            });
          }
        }
      },
      () => {
        if (
          dialogEpochRef.current === op &&
          isEnvironmentLifetimeCurrent(lifetime)
        ) {
          configPendingRef.current = false;
        }
      }
    );
  };
  const configTarget = (reviewTarget: ConfigDraft["target"] | null = null) =>
    configurationTargetLabelFor(
      reviewTarget,
      configDraft,
      currentEnvironment?.name,
      projectName,
      vaultName
    );
  const checklist = configuredChecklistFor(configResult);
  const openImport = () => {
    clearImportState();
    setImportSource("text");
    setImportFolderEnvironmentId(target?.environmentId || "");
    setModal("import");
  };
  const clearImportFile = useCallback(() => {
    setImportFileName(null);
    setImportFileContent("");
    setImportDiagnostics([]);
  }, [setImportFileName, setImportFileContent, setImportDiagnostics]);
  const handleImportFileDrop = useCallback(
    async (file: File) => {
      if (importBusy || importPendingRef.current) {
        return;
      }
      if (file.size > 1024 * 1024) {
        setImportDiagnostics([t("project.importReview.fileTooLarge")]);
        return;
      }
      try {
        const content = await file.text();
        if (new TextEncoder().encode(content).length > 1024 * 1024) {
          setImportDiagnostics([t("project.importReview.fileTooLarge")]);
          return;
        }
        setImportFileName(file.name);
        setImportFileContent(content);
        setImportDiagnostics([]);
      } catch {
        setImportDiagnostics([t("project.importReview.fileReadFailed")]);
      }
    },
    [
      importBusy,
      importPendingRef,
      setImportDiagnostics,
      setImportFileName,
      setImportFileContent,
    ]
  );
  const scanImportFolder = async (folder?: File, resume = false) => {
    if (!target || importBusy || importPendingRef.current) {
      return;
    }
    const lifetime = captureEnvironmentLifetime();
    importEpochRef.current += 1;
    const op = importEpochRef.current;
    importPendingRef.current = true;
    setImportBusy(true);
    setImportDiagnostics([]);
    await retireImport();
    return await runWithCleanup(
      async () => {
        try {
          if (
            importEpochRef.current !== op ||
            !isEnvironmentLifetimeCurrent(lifetime)
          ) {
            return;
          }
          const result = await (resume
            ? window.keyharbor.secrets.importFolderResume(target)
            : window.keyharbor.secrets.importFolderScan(target, folder));
          if (
            importEpochRef.current !== op ||
            !isEnvironmentLifetimeCurrent(lifetime)
          ) {
            if (result.success) {
              await window.keyharbor.secrets.importDiscard(result.scan.scanId);
            }
            return;
          }
          if (!result.success) {
            if (!result.cancelled) {
              setImportDiagnostics([t("project.folderImport.scanFailed")]);
            }
            return;
          }
          importFolderScanRef.current = result.scan.scanId;
          setImportFolderScan(result.scan);
        } catch {
          if (
            importEpochRef.current === op &&
            isEnvironmentLifetimeCurrent(lifetime)
          ) {
            setImportDiagnostics([t("project.folderImport.scanFailed")]);
          }
        }
      },
      () => {
        if (
          importEpochRef.current === op &&
          isEnvironmentLifetimeCurrent(lifetime)
        ) {
          importPendingRef.current = false;
          setImportBusy(false);
        }
      }
    );
  };
  const resumeHomeFolder = useEffectEvent(() => {
    openImport();
    setImportSource("folder");
    void scanImportFolder(undefined, true);
  });
  useEffect(() => {
    const url = new URL(window.location.href);
    if (target && url.searchParams.get("importFolder") === "1") {
      url.searchParams.delete("importFolder");
      window.history.replaceState(null, "", url);
      queueMicrotask(() => resumeHomeFolder());
    }
  }, [target]);

  const requestImportPreview = async (
    forceDialog = false,
    folderFileId?: string
  ) => {
    let operationTarget = target;
    if (importSource === "folder") {
      if (
        !target ||
        !importFolderEnvironmentId ||
        !importFolderScanRef.current ||
        !folderFileId
      ) {
        return;
      }
      operationTarget = { ...target, environmentId: importFolderEnvironmentId };
      setImportFolderFileId(folderFileId);
    }
    if (importBusy || importPendingRef.current || !operationTarget) {
      return;
    }
    const lifetime = captureEnvironmentLifetime();
    importPendingRef.current = true;
    importEpochRef.current += 1;
    const op = importEpochRef.current;
    importRevealEpochRef.current += 1;
    setImportBusy(true);
    setImportCommitting(false);
    setImportDiagnostics([]);
    setImportReveals({});
    void retireImport(false);
    return await runWithCleanup(
      async () => {
        try {
          const result = await fetchImportPreview(operationTarget, {
            fileContent: importFileContent,
            fileId: folderFileId,
            forceDialog,
            scanId: importFolderScanRef.current,
            source: importSource,
            text: importText,
          });
          if (
            importEpochRef.current !== op ||
            modal !== "import" ||
            !isEnvironmentLifetimeCurrent(lifetime)
          ) {
            if (result.success && result.handle) {
              await window.keyharbor.secrets.importDiscard(result.handle);
            }
            return;
          }
          if (!result.success) {
            if (!result.cancelled) {
              setImportDiagnostics([
                result.error || t("project.importReview.previewFailed"),
              ]);
            }
            return;
          }
          if (result.diagnostics.length) {
            if (result.handle) {
              await window.keyharbor.secrets.importDiscard(result.handle);
            }
            setImportDiagnostics(
              result.diagnostics.map((item) =>
                t("project.importReview.diagnosticLine", { ...item })
              )
            );
            return;
          }
          if (!result.handle) {
            setImportDiagnostics([t("project.importReview.previewFailed")]);
            return;
          }
          importHandleRef.current = result.handle;
          setImportHandle(result.handle);
          setImportTarget(result.target);
          const rows: ImportRow[] = result.entries.map((entry) => ({
            ...entry,
            choice: entry.duplicate
              ? null
              : {
                  action:
                    entry.occurrences[0]?.defaultAction === "add"
                      ? "add"
                      : "skip",
                  explicit: false,
                  occurrenceId: entry.occurrences[0]?.id ?? null,
                },
          }));
          setImportRows(rows);
          setImportDiagnostics([]);
        } catch (error) {
          if (
            importEpochRef.current === op &&
            isEnvironmentLifetimeCurrent(lifetime)
          ) {
            setImportDiagnostics([
              error instanceof Error
                ? error.message
                : t("project.importReview.previewFailed"),
            ]);
          }
        }
      },
      () => {
        if (
          importEpochRef.current === op &&
          isEnvironmentLifetimeCurrent(lifetime)
        ) {
          importPendingRef.current = false;
          setImportBusy(false);
        }
      }
    );
  };
  const importReady =
    importRows.length > 0 &&
    importRows.every((row) => !row.duplicate || row.choice?.explicit);
  const importCounts = countImportRows(importRows);
  const commitImport = async () => {
    const handle = importHandleRef.current;
    if (!handle || importBusy || importPendingRef.current || !importReady) {
      return;
    }
    const lifetime = captureEnvironmentLifetime();
    importPendingRef.current = true;
    importEpochRef.current += 1;
    const op = importEpochRef.current;
    const decisions: ImportDecision[] = importRows.map((row) => ({
      action: row.choice?.action || "skip",
      key: row.key,
      occurrenceId: row.choice?.occurrenceId ?? null,
    }));
    setImportBusy(true);
    setImportCommitting(true);
    return await runWithCleanup(
      async () => {
        try {
          const result = await window.keyharbor.secrets.importCommit(
            handle,
            decisions
          );
          if (
            importEpochRef.current !== op ||
            !isEnvironmentLifetimeCurrent(lifetime)
          ) {
            return;
          }
          if (!result.success) {
            failOperation(new Error(result.error));
          }
          showNotice("project.importReview.importedSummary", "success", {
            added: result.added,
            replaced: result.replaced,
            skipped: result.skipped,
          });
          if (importSource === "folder") {
            if (importFolderFileId) {
              setImportReviewedFileIds((ids) => [
                ...new Set([...ids, importFolderFileId]),
              ]);
            }
            await retireImport(false);
            setImportHandle(null);
            setImportTarget(null);
            setImportRows([]);
            setImportReveals({});
            setImportDiagnostics([]);
          } else {
            setModal(null);
            clearImportState();
          }
          await loadSecrets(false);
          await refreshConfiguration();
        } catch (error) {
          if (
            importEpochRef.current === op &&
            isEnvironmentLifetimeCurrent(lifetime)
          ) {
            setImportDiagnostics([
              error instanceof Error
                ? error.message
                : t("project.importReview.commitFailed"),
            ]);
          }
        }
      },
      () => {
        if (
          importEpochRef.current === op &&
          isEnvironmentLifetimeCurrent(lifetime)
        ) {
          importPendingRef.current = false;
          setImportBusy(false);
          setImportCommitting(false);
        }
      }
    );
  };
  const revealImportValue = async (
    entry: ImportRow,
    occurrence: ImportOccurrence
  ) => {
    const handle = importHandleRef.current;
    if (!handle) {
      return;
    }
    const id = `${entry.key}:${occurrence.id}`;
    if (importReveals[id]) {
      setImportReveals((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([key]) => key !== id)
        )
      );
      return;
    }
    const op = importEpochRef.current;
    const revealOp = importRevealEpochRef.current;
    const lifetime = captureEnvironmentLifetime();
    try {
      const result = await window.keyharbor.secrets.importReveal(
        handle,
        entry.key,
        occurrence.id
      );
      if (
        importEpochRef.current !== op ||
        importRevealEpochRef.current !== revealOp ||
        !isEnvironmentLifetimeCurrent(lifetime) ||
        modal !== "import"
      ) {
        return;
      }
      if (!result.success) {
        failOperation(new Error(result.error));
      }
      setImportReveals((current) => ({
        ...current,
        [id]: { expiresAt: Date.now() + 30_000, value: result.value },
      }));
    } catch {
      if (
        importEpochRef.current === op &&
        importRevealEpochRef.current === revealOp &&
        isEnvironmentLifetimeCurrent(lifetime)
      ) {
        notificationManager.show(
          t("project.importReview.revealFailed"),
          "error"
        );
      }
    }
  };
  const runExport = async (
    mode: "example" | "references" | "backup" | "raw",
    password?: string,
    isCurrent: () => boolean = () => true
  ) => {
    const operationTarget = target;
    const lifetime = captureEnvironmentLifetime();
    const isFresh = () => isCurrent() && isEnvironmentLifetimeCurrent(lifetime);
    // Whole-Project backup is a separate operation and is never coerced into a
    // raw Environment export.
    if (mode === "backup") {
      return exportProjectBackup(projectName, isFresh);
    }
    if (!operationTarget) {
      if (isFresh()) {
        notificationManager.show(
          t("project.notifications.failedToLoad"),
          "error"
        );
      }
      return false;
    }
    try {
      const result = await window.keyharbor.secrets.export(
        operationTarget,
        mode,
        password ? { password } : undefined
      );
      if (!isFresh()) {
        return false;
      }
      if (!result.success) {
        if (!result.cancelled) {
          notificationManager.show(
            result.error || t("project.notifications.failedToExport"),
            "error"
          );
        }
        return false;
      }
      if (mode === "raw") {
        showNotice("project.rawExportModal.exported");
      } else {
        notificationManager.show(
          t("project.exportMenu.exported", { path: result.path }),
          "success"
        );
      }
      return true;
    } catch (error) {
      if (isFresh()) {
        notificationManager.show(
          error instanceof Error
            ? error.message
            : t("project.notifications.failedToExport"),
          "error"
        );
      }
      return false;
    }
  };
  const exportRaw = async () => {
    if (!rawPassword) {
      setFieldErrors({ password: t("project.rawExportModal.wrongPassword") });
      return;
    }
    const operation = beginAction();
    if (operation === null) {
      return;
    }
    const password = rawPassword;
    return await runWithCleanup(
      async () => {
        const success = await runExport(
          "raw",
          password,
          () => actionEpoch.current === operation && modal === "raw"
        );
        if (actionEpoch.current !== operation || modal !== "raw") {
          return;
        }
        if (success) {
          closeModal();
        } else {
          setFieldErrors({
            password: t("project.rawExportModal.wrongPassword"),
          });
        }
      },
      () => {
        finishAction(operation);
      }
    );
  };
  const openHistory = async (key: string) => {
    const operationTarget = target;
    if (!operationTarget) {
      return;
    }
    const lifetime = captureEnvironmentLifetime();
    historyEpoch.current += 1;
    const op = historyEpoch.current;
    setActionKey(key);
    setHistory(null);
    setHistoryLoading(true);
    setHistoryShown({});
    setRestoreArmed(null);
    setModal("history");
    return await runWithCleanup(
      async () => {
        try {
          const result = await window.keyharbor.secrets.getHistory(
            operationTarget,
            key
          );
          if (
            historyEpoch.current !== op ||
            !isEnvironmentLifetimeCurrent(lifetime)
          ) {
            return;
          }
          if (!result.success) {
            failOperation(new Error(result.error));
          }
          setHistory(result.data);
        } catch {
          if (
            historyEpoch.current === op &&
            isEnvironmentLifetimeCurrent(lifetime)
          ) {
            setHistory(null);
          }
        }
      },
      () => {
        if (
          historyEpoch.current === op &&
          isEnvironmentLifetimeCurrent(lifetime)
        ) {
          setHistoryLoading(false);
        }
      }
    );
  };
  const restoreVersion = async (index: number) => {
    if (restoreArmed !== index) {
      setRestoreArmed(index);
      if (restoreTimer.current) {
        window.clearTimeout(restoreTimer.current);
      }
      restoreTimer.current = window.setTimeout(() => {
        clearRestoreArmed(index);
        restoreTimer.current = null;
      }, 4000);
      return;
    }
    const operation = beginAction();
    if (operation === null) {
      return;
    }
    const operationTarget = target;
    const lifetime = captureEnvironmentLifetime();
    if (!operationTarget) {
      finishAction(operation);
      return;
    }
    const key = actionKey;
    const historyOperation = historyEpoch.current;
    return await runWithCleanup(
      async () => {
        try {
          const result = await window.keyharbor.secrets.restoreVersion(
            operationTarget,
            key,
            index
          );
          if (
            actionEpoch.current !== operation ||
            modal !== "history" ||
            historyEpoch.current !== historyOperation ||
            !isEnvironmentLifetimeCurrent(lifetime)
          ) {
            return;
          }
          if (!result.success) {
            failOperation(new Error(result.error));
          }
          if (restoreTimer.current) {
            window.clearTimeout(restoreTimer.current);
          }
          restoreTimer.current = null;
          setRestoreArmed(null);
          setHistoryShown({});
          setHistoryLoading(true);
          showNotice("project.history.restored");
          await loadSecrets(false);
          await refreshConfiguration();
          const refreshed = await window.keyharbor.secrets.getHistory(
            operationTarget,
            key
          );
          if (
            actionEpoch.current === operation &&
            modal === "history" &&
            historyEpoch.current === historyOperation &&
            isEnvironmentLifetimeCurrent(lifetime) &&
            refreshed.success
          ) {
            setHistory(refreshed.data);
          }
        } catch {
          if (
            actionEpoch.current === operation &&
            isEnvironmentLifetimeCurrent(lifetime)
          ) {
            notificationManager.show(
              t("project.history.failedToRestore"),
              "error"
            );
          }
        }
      },
      () => {
        if (actionEpoch.current === operation) {
          setHistoryLoading(false);
        }
        finishAction(operation);
      }
    );
  };
  const selectEnvironment = (nextEnvironmentId: string) => {
    if (!nextEnvironmentId || nextEnvironmentId === target?.environmentId) {
      return;
    }
    retireTargetLifetime();
    setSelectedEnvironmentId(nextEnvironmentId);
  };
  const onEnvironmentStructureChanged = async (
    preferredEnvironmentId?: string
  ) => {
    retireTargetLifetime();
    const lifetime = captureEnvironmentLifetime();
    const [updated, projectResult] = await Promise.all([
      loadEnvironmentSummaries(),
      window.keyharbor.projects.get(),
    ]);
    if (!isEnvironmentLifetimeCurrent(lifetime) || !sessionActive.current) {
      return;
    }
    if (projectResult.success) {
      setProjects(projectResult.data);
    }
    if (
      preferredEnvironmentId &&
      updated.some((entry) => entry.id === preferredEnvironmentId)
    ) {
      setSelectedEnvironmentId(preferredEnvironmentId);
    }
  };
  const nav = (destination: string) => {
    closeModal();
    window.location.href = destination;
  };

  useEffect(() => {
    const dismissTopLayer = (event: KeyboardEvent) => {
      if (document.querySelector(".lk-vault-merge-overlay")) {
        return;
      }
      if (modal) {
        event.stopPropagation();
        closeModal();
      } else if (menu) {
        setMenu(null);
      } else if (overlayMode && inspectorOpen) {
        setInspectorOpen(false);
      } else if (indexOpen && window.matchMedia("(max-width: 860px)").matches) {
        closeSidebar();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      const field = /^(?:INPUT|TEXTAREA|SELECT)$/u.test(
        (document.activeElement as HTMLElement | null)?.tagName || ""
      );
      if (event.key === "Escape") {
        dismissTopLayer(event);
        return;
      }
      if (isSearchShortcut(event, field) && !modal) {
        event.preventDefault();
        document.querySelector<HTMLElement>("#searchInput")?.focus();
        return;
      }
      if (
        field ||
        modal ||
        !["ArrowDown", "ArrowUp"].includes(event.key) ||
        !visible.length
      ) {
        return;
      }
      event.preventDefault();
      let index = visible.findIndex((item) => item.key === selected);
      index =
        event.key === "ArrowDown"
          ? Math.min(visible.length - 1, index + 1)
          : Math.max(0, index - 1);
      const entry = visible[index];
      if (!entry) {
        return;
      }
      const { key } = entry;
      selectKey(key);
      document
        .querySelector<HTMLElement>(`[data-list-key="${CSS.escape(key)}"]`)
        ?.focus({ preventScroll: true });
      document
        .querySelector<HTMLElement>(`[data-list-key="${CSS.escape(key)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [
    modal,
    menu,
    overlayMode,
    inspectorOpen,
    indexOpen,
    visible,
    selected,
    closeModal,
    closeSidebar,
    selectKey,
    setInspectorOpen,
    setMenu,
  ]);

  const contextLabel = environmentContextLabelFor(
    currentEnvironment?.name,
    projectName
  );
  const importTargetText = importTargetLabelFor(
    importTarget,
    importSource === "folder"
      ? environmentSummaries.find(
          (entry) => entry.id === importFolderEnvironmentId
        )?.name
      : currentEnvironment?.name,
    projectName,
    vaultName
  );
  const otherProjects = projects.filter((item) => item.name !== projectName);
  const handleInspectorAction = (action: InspectorAction) => {
    setMenu(null);
    if (!selected) {
      return;
    }
    setActionKey(selected);
    if (action === "history") {
      void openHistory(selected);
    } else if (action === "delete") {
      setModal("delete");
    } else if (action === "rotate") {
      setModal("rotate");
    } else {
      setDuplicateTarget(otherProjects[0]?.name || "");
      void loadDuplicateEnvironments(otherProjects[0]?.name || "");
      setFieldErrors({});
      setModal("duplicate");
    }
  };
  return (
    <>
      <div
        className={cn(
          "bg-background text-foreground secrets-app flex h-screen w-screen overflow-hidden",
          nativeWindowStyles.canvas
        )}
      >
        <ProjectSidebar
          indexOpen={indexOpen}
          nav={nav}
          view={view}
          setView={setView}
          totalCount={entries.length}
          attention={attention}
          favoriteCount={
            entries.filter((entry) => favorites.includes(entry.key)).length
          }
          syncAt={syncAt}
        />
        <button
          type="button"
          className="max-[860px]:fixed max-[860px]:inset-0 max-[860px]:z-40 max-[860px]:bg-black/50 max-[860px]:backdrop-blur-[2px] min-[861px]:hidden"
          hidden={!indexOpen}
          aria-label={t("project.sidebar.collapse")}
          onClick={closeSidebar}
        />
        <main className="secrets-main bg-background flex h-full min-w-0 flex-1 flex-col overflow-hidden">
          <ProjectTopbar
            indexOpen={indexOpen}
            onToggleIndex={toggleSidebar}
            projectName={projectName}
            projects={projects}
            menu={menu}
            setMenu={setMenu}
            nav={nav}
            vaultLabel={vaultSubtitleFor(vaultName)}
          />
          <div className="border-border/40 flex shrink-0 flex-col border-b">
            <div className="secrets-title-row flex flex-wrap items-center gap-4 px-6 py-3">
              <h1 className="text-foreground truncate text-2xl font-semibold tracking-tight">
                {t("project.header.title")}
              </h1>
              <EnvironmentControls
                projectName={projectName}
                vaultInstanceId={vaultInstanceId}
                lifetimeRevision={environmentLifetimeRevision}
                target={target}
                environments={environmentSummaries}
                disabled={!sessionIsActive}
                onSelect={selectEnvironment}
                onStructureChanged={onEnvironmentStructureChanged}
              />
            </div>
            <ProjectToolbar
              search={search}
              setSearch={setSearch}
              menu={menu}
              setMenu={setMenu}
              filterType={filterType}
              setFilterType={setFilterType}
              filterStatus={filterStatus}
              setFilterStatus={setFilterStatus}
              targetReady={Boolean(target)}
              onImport={openImport}
              onNewSecret={() => openSecret("new")}
              onExport={(mode) => {
                if (mode === "raw") {
                  setRawPassword("");
                  setModal("raw");
                } else {
                  void runExport(mode);
                }
              }}
            />
          </div>
          <ProjectSummary
            entryCount={entries.length}
            attention={attention}
            updatedAt={projectUpdated}
          />
          <ConfigurationPanel
            result={configResult}
            checklist={checklist}
            targetAvailable={Boolean(target)}
            open={checklistOpen}
            onOpen={openConfiguration}
            onToggle={toggleChecklist}
            onSecret={(key, mode) => openSecret(mode, key)}
          />
          <SecretTable
            entries={visible.map(({ key, secret, type, status }) => ({
              description: secret.description,
              key,
              status,
              tags: secret.tags,
              type,
              updatedAt: secret.updatedAt,
              value: String(secret.value ?? ""),
            }))}
            selected={selected}
            favorites={favorites}
            menu={menu}
            loadState={loadState}
            emptyMessage={
              <ProjectState
                environmentState={environmentState}
                loadState={loadState}
                hasEntries={entries.length > 0}
                environmentName={projectStateEnvironmentFor(
                  currentEnvironment?.name
                )}
                projectName={projectName}
                targetAvailable={Boolean(target)}
                loadEnvironments={() => {
                  void loadEnvironmentSummaries();
                }}
                loadSecrets={() => {
                  void loadSecrets(true);
                }}
                openSecret={() => openSecret("new")}
              />
            }
            onSelect={selectKey}
            onFavorite={(key) => {
              void toggleFavorite(key);
            }}
            onCopy={(key) => {
              void copySecret(key);
            }}
            onEnter={() =>
              window.requestAnimationFrame(() =>
                document.querySelector<HTMLElement>("#inspectorCopy")?.focus()
              )
            }
            onEdit={(key) => {
              setMenu(null);
              openSecret("edit", key);
            }}
            onHistory={(key) => {
              setMenu(null);
              void openHistory(key);
            }}
            onDelete={(key) => {
              setMenu(null);
              setActionKey(key);
              setModal("delete");
            }}
            onMenu={setRowMenu}
          />
          <div className="border-border/30 text-muted-foreground secrets-hint border-t px-6 py-2 text-xs">
            {t("project.footerHint")}
          </div>
        </main>
        <InspectorPanel
          selected={selected}
          inspectorOpen={inspectorOpen}
          activeEntry={activeEntry}
          menu={menu}
          vaultName={vaultName}
          history={inspectorHistory}
          historyKey={inspectorHistoryKey}
          usage={usage}
          reveal={reveal}
          onMenuOpenChange={(open) => setMenu(open ? "inspector" : null)}
          onAction={handleInspectorAction}
          onClose={() => setInspectorOpen(false)}
          onCopy={() => {
            if (selected) {
              void copySecret(selected);
            }
          }}
          onReveal={() => {
            if (selected) {
              startReveal(selected);
            }
          }}
        />
        <button
          type="button"
          aria-label={t("project.inspector.close")}
          className={`secrets-scrim${overlayMode && inspectorOpen ? " is-visible" : ""}`}
          id="scrim"
          onClick={() => setInspectorOpen(false)}
        />
      </div>
      <ProjectDialogs
        modal={modal}
        secretEditor={{
          actionBusy,
          closeModal,
          contextLabel,
          fieldErrors,
          onGenerate: () =>
            setSecretDraft({ ...secretDraft, value: generateValue(32) }),
          saveSecret,
          secretDraft,
          setSecretDraft,
        }}
        deleteConfirmation={{
          action: "delete",
          actionBusy,
          actionKey,
          closeModal,
          contextLabel,
          onConfirm: removeSecret,
        }}
        rotateConfirmation={{
          action: "rotate",
          actionBusy,
          actionKey,
          closeModal,
          contextLabel,
          onConfirm: rotateSecret,
        }}
        duplicate={{
          actionBusy,
          actionKey,
          closeModal,
          contextLabel,
          duplicateEnvironmentId,
          duplicateEnvironments,
          duplicateSecret,
          duplicateTarget,
          fieldErrors,
          onProjectChange: (name) => {
            setDuplicateTarget(name);
            void loadDuplicateEnvironments(name);
            setFieldErrors({});
          },
          otherProjects,
          setDuplicateEnvironmentId,
        }}
        configuration={{
          configured: Boolean(checklist),
          draft: configDraft,
          onBack: () => {
            dialogEpochRef.current += 1;
            const op = dialogEpochRef.current;
            configPendingRef.current = false;
            void (async () => {
              await retireConfig();
              if (dialogEpochRef.current === op) {
                setConfigDraftValue({
                  handle: null,
                  message: "",
                  step: "input",
                });
              }
            })();
          },
          onChooseFile: () => {
            void requestConfigPreview("file", "");
          },
          onClear: () => {
            void requestConfigClear();
          },
          onClose: closeModal,
          onCommit: () => {
            void commitConfiguration();
          },
          onReview: () => {
            void requestConfigPreview("text", configDraft?.text ?? "");
          },
          onSource: (source) => setConfigDraftValue({ source }),
          onText: (text) => setConfigDraftValue({ text }),
          targetLabel: configTarget(),
        }}
        importProps={{
          busy: importBusy,
          committing: importCommitting,
          counts: importCounts,
          diagnostics: importDiagnostics,
          fileName: importFileLabel(
            importSource,
            importFolderScan,
            importFolderFileId,
            importFileName
          ),
          folder: {
            environmentId: importFolderEnvironmentId,
            environments: environmentSummaries,
            onEnvironment: setImportFolderEnvironmentId,
            onReviewFile: (id) => {
              void requestImportPreview(false, id);
            },
            onScan: (folder) => {
              void scanImportFolder(folder);
            },
            reviewedFileIds: importReviewedFileIds,
            scan: importFolderScan,
          },
          handle: importHandle,
          onAction: (key, occurrenceId, action) =>
            setImportRows((current) =>
              current.map((row) =>
                row.key === key
                  ? { ...row, choice: { action, explicit: true, occurrenceId } }
                  : row
              )
            ),
          onBack: () => {
            importEpochRef.current += 1;
            importRevealEpochRef.current += 1;
            importPendingRef.current = false;
            void retireImport(false);
            setImportHandle(null);
            setImportTarget(null);
            setImportRows([]);
            setImportReveals({});
            setImportDiagnostics([]);
          },
          onChoose: (key, occurrenceId) =>
            setImportRows((current) =>
              current.map((row) =>
                row.key === key
                  ? {
                      ...row,
                      choice:
                        occurrenceId === null
                          ? {
                              action: "skip",
                              explicit: true,
                              occurrenceId: null,
                            }
                          : { action: "skip", explicit: true, occurrenceId },
                    }
                  : row
              )
            ),
          onChooseFile: () => {
            clearImportFile();
            void requestImportPreview(true);
          },
          onClearFile: () => {
            clearImportFile();
          },
          onClose: closeModal,
          onCommit: () => {
            void commitImport();
          },
          onDropFile: (file) => {
            void handleImportFileDrop(file);
          },
          onPreview: () => {
            void requestImportPreview(false);
          },
          onReveal: (entry, occurrence) => {
            void revealImportValue(entry, occurrence);
          },
          onSource: (source) => {
            if (source !== importSource) {
              void retireImport();
            }
            setImportSource(source);
            setImportDiagnostics([]);
          },
          onText: setImportText,
          ready: importReady,
          reveals: importReveals,
          rows: importRows,
          source: importSource,
          targetText: importTargetText,
          text: importText,
        }}
        rawExport={{
          actionBusy,
          closeModal,
          contextLabel,
          exportRaw,
          fieldErrors,
          onPasswordChange: (password) => {
            setRawPassword(password);
            setFieldErrors({});
          },
          rawPassword,
        }}
        history={{
          actionBusy,
          closeModal: () => {
            historyEpoch.current += 1;
            closeModal();
          },
          contextLabel,
          history,
          historyLoading,
          historyShown,
          onToggle: toggleHistoryShown,
          restoreArmed,
          restoreVersion,
        }}
      />
    </>
  );
};

const mount = document.querySelector<HTMLElement>("#project-root");
if (mount) {
  mountRenderer(
    mount,
    <RendererProviders>
      <ProjectApp />
    </RendererProviders>
  );
}
