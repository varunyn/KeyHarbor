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
import { Button } from "../renderer/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../renderer/ui/dropdown-menu";
import type {
  ActivityLog,
  ConfigurationResult,
  EnvironmentSummary,
  EnvironmentTarget,
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
import { ProjectSidebar, ProjectSwitcher } from "./project-sidebar";
import type { ProjectView } from "./project-sidebar";
import { ProjectToolbar } from "./project-toolbar";
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

type Modal =
  | "secret"
  | "delete"
  | "rotate"
  | "duplicate"
  | "configuration"
  | "import"
  | "raw"
  | "history"
  | null;
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
const projectBreadcrumbFor = (projectName: string) => projectName || "–";
const environmentBreadcrumbFor = (environmentName?: string) =>
  environmentName || t("project.environments.loading");
const projectStateEnvironmentFor = (environmentName?: string) =>
  environmentName || t("project.environments.unknown");
const vaultSubtitleFor = (vaultName: string) =>
  vaultName ? t("project.header.vaultSubtitle", { vault: vaultName }) : "";
const secretCountLabelFor = (count: number) =>
  count === 1
    ? t("project.summary.secretsOne")
    : t("project.summary.secrets", { count });
const inspectorClassFor = (open: boolean, selected: string | null) =>
  `secrets-inspector${!open || !selected ? " is-hidden" : ""}`;
const selectedSecretFor = (
  secrets: Record<string, SecretRecord>,
  selected: string | null
) =>
  selected && Object.hasOwn(secrets, selected) ? secrets[selected] : undefined;
const sidebarToggleLabelFor = (expanded: boolean) =>
  t(expanded ? "project.sidebar.collapse" : "project.sidebar.expand");

const isSearchShortcut = (event: KeyboardEvent, field: boolean) =>
  (event.key === "/" && !field) ||
  ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k");

const revealSeconds = 30;
const remainingReveal = (current: { key: string; remaining: number } | null) =>
  current && current.remaining > 1
    ? { ...current, remaining: current.remaining - 1 }
    : null;
const validKey = (name: string) =>
  /^[A-Za-z0-9._-]+$/u.test(name) && !/[=\s]/u.test(name);
const own = (object: object, key: PropertyKey) => Object.hasOwn(object, key);
const clearClipboard = async () => {
  try {
    await navigator.clipboard.writeText("");
  } catch {
    // Clipboard access can be unavailable after the window or session closes.
  }
};
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

const firstKey = (keys: string[]) => {
  let first: string | null = null;
  for (const key of keys) {
    if (first === null || key < first) {
      first = key;
    }
  }
  return first;
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
  <>
    <output className="spinner" aria-label={label} />
    <p>{label}</p>
  </>
);

const ErrorState = ({ label, retry }: { label: string; retry: () => void }) => (
  <div className="secrets-error-card">
    <Icon name="circle-alert" />
    <h2>{label}</h2>
    <Button
      variant="secondary"
      className="sl-btn sl-btn-secondary"
      type="button"
      onClick={retry}
    >
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
        <h2>{t("project.emptyState.title")}</h2>
        <p>{t("project.table.noResults")}</p>
      </>
    );
  } else {
    content = (
      <>
        <Icon name="key" />
        <h2>{t("project.emptyState.title")}</h2>
        <p>
          {t("project.environments.emptyState", {
            environment: environmentName,
            project: projectName,
          })}
        </p>
        <Button
          variant="default"
          className="sl-btn sl-btn-primary"
          type="button"
          disabled={!targetAvailable}
          onClick={openSecret}
        >
          <Icon name="plus" />
          {t("project.newSecret")}
        </Button>
      </>
    );
  }
  return <div className="secrets-state">{content}</div>;
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
  <div className="secrets-footing" id="footing" aria-live="polite">
    <span>{secretCountLabelFor(entryCount)}</span>
    <span className="attention">
      {t("project.summary.needsAttention", { count: attention })}
    </span>
    {updatedAt && (
      <>
        <span className="sep" aria-hidden="true">
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
      className="configuration-panel"
      id="configurationPanel"
      aria-labelledby="configurationHeading"
    >
      <div className="configuration-panel-head">
        <div className="configuration-overview">
          <h2 id="configurationHeading">
            {t("project.configuration.heading")}
          </h2>
          <output id="configurationSummaryText" aria-live="polite">
            {configurationSummaryText}
          </output>
          {checklist && statusCounts && (
            <p className="configuration-breakdown" id="configurationBreakdown">
              {t("project.configuration.breakdown", {
                empty: statusCounts.empty,
                expired: statusCounts.expired,
                missing: statusCounts.missing,
              })}
            </p>
          )}
        </div>
        <div className="configuration-panel-actions">
          <Button
            variant="secondary"
            type="button"
            className="sl-btn sl-btn-secondary"
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
              className="sl-btn sl-btn-icon"
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
        <p className="configuration-error" id="configurationError">
          {t("project.configuration.retryHint")}
        </p>
      )}
      {checklist && (
        <ul
          className="configuration-checklist"
          id="configurationChecklist"
          aria-label={t("project.configuration.heading")}
          hidden={!open}
        >
          {checklist.entries.map((entry) => (
            <li className="configuration-check-row" key={entry.key}>
              <code>{entry.key}</code>
              <span className="configuration-status" data-status={entry.status}>
                {t(
                  `project.configuration.status.${entry.status.toLowerCase()}`
                )}
              </span>
              {entry.status === "Ready" ? (
                <span />
              ) : (
                <Button
                  variant="link"
                  type="button"
                  className="configuration-row-action"
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
    className={inspectorClassFor(inspectorOpen, selected)}
    id="inspector"
    aria-label={t("project.a11y.inspectorLabel")}
  >
    <div className="inspector-head">
      <span className="type-icon" id="inspectorIcon">
        <Icon
          name={
            activeEntry &&
            deriveType(selected || "", activeEntry.value) === "secret"
              ? "lock"
              : "file-text"
          }
        />
      </span>
      <div className="inspector-title">
        <h2 id="inspectorName">{selected || "–"}</h2>
        <p id="inspectorSub">
          {activeEntry
            ? `${t(deriveType(selected || "", activeEntry.value) === "secret" ? "project.inspector.secretIn" : "project.inspector.configIn")} · ${relative(activeEntry.updatedAt)}`
            : t("project.inspector.noSelection")}
        </p>
      </div>
      <DropdownMenu open={menu === "inspector"} onOpenChange={onMenuOpenChange}>
        <div className="dropdown" id="inspectorMenuDropdown">
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              type="button"
              className="row-action"
              id="inspectorMenuBtn"
              aria-expanded={menu === "inspector"}
            >
              <Icon name="ellipsis" />
              <span className="sr-only">
                {t("project.inspector.secretActions")}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="dropdown-menu dropdown-menu-left"
            id="inspectorMenu"
            align="end"
          >
            {(
              [
                ["rotate", t("project.inspector.rotateSecret")],
                ["history", t("project.viewHistory")],
                ["duplicate", t("project.inspector.duplicateToProject")],
                ["delete", t("project.deleteSecret")],
              ] as const
            ).map(([action, label]) => (
              <React.Fragment key={action}>
                {action === "delete" && (
                  <DropdownMenuSeparator className="dropdown-separator" />
                )}
                <DropdownMenuItem
                  className={`dropdown-item${action === "delete" ? " danger" : ""}`}
                  data-act={action}
                  onSelect={() => onAction(action)}
                >
                  {label}
                </DropdownMenuItem>
              </React.Fragment>
            ))}
          </DropdownMenuContent>
        </div>
      </DropdownMenu>
      <Button
        variant="ghost"
        size="icon"
        type="button"
        className="row-action"
        id="inspectorClose"
        onClick={onClose}
      >
        <Icon name="x" />
        <span className="sr-only">{t("project.inspector.close")}</span>
      </Button>
    </div>
    <div className="inspector-body" id="inspectorBody">
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
        <p className="inspector-empty">{t("project.inspector.noSelection")}</p>
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
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<ProjectView>("all");
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [modal, setModal] = useState<Modal>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [menuPlacement, setMenuPlacement] = useState<{
    menu: string | null;
    openUp: boolean;
  }>({ menu: null, openUp: false });
  const menuOpenUp = menuPlacement.menu === menu && menuPlacement.openUp;
  const [actionBusy, setActionBusy] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [indexOpen, setIndexOpen] = useState(false);
  const [overlayMode, setOverlayMode] = useState(
    () => window.matchMedia("(max-width: 1100px)").matches
  );
  const [syncAt, setSyncAt] = useState(() => Date.now());
  const [statusClock, setStatusClock] = useState(() => Date.now());
  const [configResult, setConfigResult] = useState<
    ConfigurationResult | { state: "loading" | "unavailable" } | null
  >({ state: "loading" });
  const [checklistOpen, setChecklistOpen] = useState(false);
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
    source: importSource,
    setSource: setImportSource,
    text: importText,
    setText: setImportText,
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
  const [secretDraft, setSecretDraft] = useState<SecretDraft>({
    description: "",
    expires: "",
    key: "",
    mode: "new",
    name: "",
    originalExpiry: null,
    originalExpiryDate: "",
    tags: "",
    value: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [actionKey, setActionKey] = useState("");
  const [duplicateTarget, setDuplicateTarget] = useState("");
  const [duplicateEnvironmentId, setDuplicateEnvironmentId] = useState("");
  const [duplicateEnvironments, setDuplicateEnvironments] = useState<
    EnvironmentSummary[]
  >([]);
  const [rawPassword, setRawPassword] = useState("");
  const [history, setHistory] = useState<SecretHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyShown, setHistoryShown] = useState<Record<number, boolean>>({});
  const [restoreArmed, setRestoreArmed] = useState<number | null>(null);
  const [reveal, setReveal] = useState<{
    key: string;
    remaining: number;
  } | null>(null);
  const clipboardTimer = useRef<number | null>(null);
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
        setReveal(null);
        setSelected((current) =>
          current && own(data, current) ? current : firstKey(Object.keys(data))
        );
        void refreshConfiguration();
        if (
          initial &&
          !window.matchMedia("(max-width: 1100px)").matches &&
          Object.keys(data).length
        ) {
          setInspectorOpen(true);
        }
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
    [captureEnvironmentLifetime, isEnvironmentLifetimeCurrent]
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
  const retireImport = useCallback(async () => {
    const handle = importHandleRef.current;
    importHandleRef.current = null;
    if (handle) {
      try {
        await window.keyharbor.secrets.importDiscard(handle);
      } catch {
        /* main process retires expired handles */
      }
    }
  }, [importHandleRef]);
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
    setImportHandle,
    setImportCommitting,
  ]);
  const closeModal = useCallback(() => {
    actionEpoch.current += 1;
    actionPending.current = false;
    setActionBusy(false);
    if (modal === "history") {
      historyEpoch.current += 1;
      setHistory(null);
      setHistoryShown({});
      setHistoryLoading(false);
      setRestoreArmed(null);
      if (restoreTimer.current) {
        window.clearTimeout(restoreTimer.current);
      }
      restoreTimer.current = null;
    }
    if (modal === "duplicate") {
      duplicateEnvironmentEpoch.current += 1;
      setDuplicateEnvironmentId("");
      setDuplicateEnvironments([]);
    }
    if (modal === "secret") {
      setSecretDraft({
        description: "",
        expires: "",
        key: "",
        mode: "new",
        name: "",
        originalExpiry: null,
        originalExpiryDate: "",
        tags: "",
        value: "",
      });
      setFieldErrors({});
    }
    if (modal === "raw") {
      setRawPassword("");
      setFieldErrors({});
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
    setModal(null);
    setMenu(null);
  }, [
    modal,
    retireConfig,
    clearImportState,
    dialogEpochRef,
    setConfigDraft,
    configPendingRef,
    setHistoryShown,
    setFieldErrors,
    setRawPassword,
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
    setActionBusy(false);
    setSecrets({});
    setFavorites([]);
    setDuplicateEnvironmentId("");
    setDuplicateEnvironments([]);
    setSelected(null);
    setInspectorHistory(null);
    setInspectorHistoryKey(null);
    setReveal(null);
    setHistory(null);
    setHistoryShown({});
    setRestoreArmed(null);
    setSecretDraft({
      description: "",
      expires: "",
      key: "",
      mode: "new",
      name: "",
      originalExpiry: null,
      originalExpiryDate: "",
      tags: "",
      value: "",
    });
    setRawPassword("");
    setConfigDraft(null);
    setImportRows([]);
    setImportHandle(null);
    setImportTarget(null);
    setImportText("");
    setImportReveals({});
    setModal(null);
    setMenu(null);
    setLoadState("loading");
  }, [
    closeModal,
    retireConfig,
    retireImport,
    dialogEpochRef,
    importEpochRef,
    importRevealEpochRef,
    retireEnvironmentLifetime,
    setImportTarget,
    setImportRows,
    setImportHandle,
    setImportText,
    setConfigDraft,
    importPendingRef,
    setImportReveals,
    configPendingRef,
    setHistoryShown,
    setRawPassword,
  ]);
  const beginAction = useCallback(() => {
    if (actionPending.current || !sessionActive.current) {
      return null;
    }
    actionPending.current = true;
    setActionBusy(true);
    actionEpoch.current += 1;
    return actionEpoch.current;
  }, []);
  const finishAction = useCallback((operation: number) => {
    if (actionEpoch.current !== operation) {
      return false;
    }
    actionPending.current = false;
    setActionBusy(false);
    return true;
  }, []);
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
  }, [dialogEpochRef, setConfigDraft]);
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
      if (clipboardTimer.current) {
        window.clearTimeout(clipboardTimer.current);
        clipboardTimer.current = null;
        void clearClipboard();
      }
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
    retireImport,
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
    setSelected(null);
    setInspectorHistory(null);
    setInspectorHistoryKey(null);
    setReveal(null);
    setImportReveals({});
    setHistory(null);
    setHistoryShown({});
    setSecretDraft((draft) => ({
      ...draft,
      description: "",
      tags: "",
      value: "",
    }));
    setRawPassword("");
    setConfigDraft(null);
    setImportRows([]);
    setImportHandle(null);
    setImportTarget(null);
    setImportText("");
    setModal(null);
    setInspectorOpen(false);
    setLoadState("loading");
    if (clipboardTimer.current) {
      window.clearTimeout(clipboardTimer.current);
      clipboardTimer.current = null;
      void clearClipboard();
    }
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
  ]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setSyncAt(Date.now());
      setStatusClock(Date.now());
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!menu) {
      return;
    }
    const dismissOutside = (event: Event) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest('.dropdown, [data-slot="dropdown-menu-content"]')
      ) {
        setMenu(null);
      }
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(null);
      }
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [menu]);
  useEffect(() => {
    if (!menu?.startsWith("row:")) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const row = document.querySelector(
        `[data-list-key="${CSS.escape(menu.slice(4))}"]`
      );
      const dropdown = row?.querySelector<HTMLElement>(".dropdown-menu");
      const wrap = document.querySelector<HTMLElement>("#tableWrap");
      if (dropdown && wrap) {
        setMenuPlacement({
          menu,
          openUp:
            dropdown.getBoundingClientRect().bottom >
            wrap.getBoundingClientRect().bottom - 8,
        });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [menu]);
  const revealKey = reveal?.key;
  useEffect(() => {
    if (!revealKey) {
      return;
    }
    const timer = window.setInterval(
      () => setReveal((current) => remainingReveal(current)),
      1000
    );
    return () => window.clearInterval(timer);
  }, [revealKey]);
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
    [overlayMode]
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
    try {
      await navigator.clipboard.writeText(String(entry.value ?? ""));
      if (sensitiveEpoch.current !== lifecycle || !sessionActive.current) {
        void clearClipboard();
        return;
      }
      notificationManager.show(
        t("project.copiedToast", { key }),
        "success",
        t("project.copiedDetail")
      );
      if (clipboardTimer.current) {
        window.clearTimeout(clipboardTimer.current);
      }
      clipboardTimer.current = window.setTimeout(() => {
        void clearClipboard();
        clipboardTimer.current = null;
      }, 30_000);
    } catch {
      if (sensitiveEpoch.current === lifecycle && sessionActive.current) {
        notificationManager.show(
          t("project.notifications.failedToExport"),
          "error"
        );
      }
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
    setModal("import");
  };
  const requestImportPreview = async () => {
    const operationTarget = target;
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
    void retireImport();
    return await runWithCleanup(
      async () => {
        try {
          const result = await window.keyharbor.secrets.importPreview(
            operationTarget,
            importSource === "text"
              ? { content: importText, source: "text" }
              : { source: "file" }
          );
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
          setModal(null);
          clearImportState();
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
        setRestoreArmed((current) => (current === index ? null : current));
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
        setIndexOpen(false);
        document.querySelector<HTMLElement>("#indexToggle")?.focus();
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
    selectKey,
  ]);

  const contextLabel = environmentContextLabelFor(
    currentEnvironment?.name,
    projectName
  );
  const importTargetText = importTargetLabelFor(
    importTarget,
    currentEnvironment?.name,
    projectName,
    vaultName
  );
  const otherProjects = projects.filter((item) => item.name !== projectName);
  const sidebarToggleLabel = sidebarToggleLabelFor(indexOpen);
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
      <div className="secrets-app">
        <ProjectSidebar
          indexOpen={indexOpen}
          onToggle={() => setIndexOpen((open) => !open)}
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
          className="secrets-index-scrim"
          hidden={!indexOpen}
          aria-label={t("project.sidebar.collapse")}
          onClick={() => {
            setIndexOpen(false);
            document.querySelector<HTMLElement>("#indexToggle")?.focus();
          }}
        />
        <main className="secrets-main">
          <div className="secrets-topbar">
            <div className="secrets-commandbar">
              <ProjectSwitcher
                menu={menu}
                setMenu={setMenu}
                projectName={projectName}
                switcherProjects={otherProjects.slice(0, 30)}
                nav={nav}
              />
              <span className="secrets-local-state">
                <Icon name="lock" />
                {t("project.header.localVault")}
              </span>
            </div>
            <nav
              className="secrets-crumbs"
              aria-label={t("project.a11y.crumbsLabel")}
            >
              <a className="secrets-back-link" href="dashboard.html">
                <Icon name="arrow-left" />
                <span>{t("project.sidebar.allProjects")}</span>
              </a>
              <span aria-hidden="true">/</span>
              <span id="crumbProject">{projectBreadcrumbFor(projectName)}</span>
              <span aria-hidden="true">/</span>
              <span id="crumbEnvironment">
                {environmentBreadcrumbFor(currentEnvironment?.name)}
              </span>
              <span aria-hidden="true">/</span>
              <span aria-current="page">
                {t("project.header.breadcrumbSecrets")}
              </span>
            </nav>
            <div className="secrets-title-row">
              <Button
                variant="ghost"
                size="icon"
                type="button"
                className="sl-btn sl-btn-icon secrets-index-toggle"
                id="indexToggle"
                aria-label={sidebarToggleLabel}
                title={sidebarToggleLabel}
                aria-expanded={indexOpen}
                aria-controls="indexPanel"
                onClick={() => setIndexOpen((open) => !open)}
              >
                <Icon name="list" />
              </Button>
              <h1>{t("project.header.title")}</h1>
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
              <span className="secrets-vault-tag" id="vaultTag">
                {vaultSubtitleFor(vaultName)}
              </span>
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
            onToggle={() => setChecklistOpen((open) => !open)}
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
            menuOpenUp={menuOpenUp}
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
            onMenu={(key) => {
              setMenu(menu === `row:${key}` ? null : `row:${key}`);
            }}
          />
          <div className="secrets-hint">{t("project.footerHint")}</div>
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
            void retireImport();
            setImportHandle(null);
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
          onClose: closeModal,
          onCommit: () => {
            void commitImport();
          },
          onPreview: () => {
            void requestImportPreview();
          },
          onReveal: (entry, occurrence) => {
            void revealImportValue(entry, occurrence);
          },
          onSource: (source) => {
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
          onToggle: (index) =>
            setHistoryShown((current) => ({
              ...current,
              [index]: !current[index],
            })),
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
