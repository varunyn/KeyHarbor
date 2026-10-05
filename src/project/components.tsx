import React, { useEffect, useRef } from "react";

import { i18n } from "../renderer/i18n";
import { Button } from "../renderer/ui/button";
import { Dialog, DialogContent, DialogTitle } from "../renderer/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../renderer/ui/dropdown-menu";
import { cn } from "../renderer/ui/utils";
import type {
  ReviewTarget,
  ConfigurationEntry,
  ConfigurationChanges,
  ImportPreviewEntry,
  ImportOccurrence,
  SecretHistory,
  SecretRecord,
} from "./bridge";

type Status = "config" | "expired" | "rotate" | "healthy";
const t = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars);

const fmtDate = (value?: string | null) => {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  try {
    return date.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return date.toISOString();
  }
};
const relative = (value?: string | null) => {
  if (!value) {
    return "—";
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    return "—";
  }
  const diff = Date.now() - time;
  if (diff < 60_000) {
    return t("project.time.justNow");
  }
  const minutes = Math.floor(diff / 60_000);
  let unit: [number, string];
  if (minutes < 60) {
    unit = [minutes, "minute"];
  } else if (minutes < 1440) {
    unit = [Math.floor(minutes / 60), "hour"];
  } else if (minutes < 10_080) {
    unit = [Math.floor(minutes / 1440), "day"];
  } else if (minutes < 21_600) {
    unit = [Math.floor(minutes / 10_080), "week"];
  } else {
    unit = [Math.floor(minutes / 43_200), "month"];
  }
  return t("project.time.ago", {
    time: t(`project.time.${unit[1]}`, { count: unit[0] }),
  });
};
const mask = (value: unknown) => {
  const text = String(value ?? "");
  return text.length <= 4 ? "••••" : `••••••••${text.slice(-4)}`;
};

export const Icon = ({ name }: { name: string }) => (
  <span className={`lk-icon lk-icon-${name}`} aria-hidden="true" />
);
export const Pill = ({ status }: { status: Status }) => (
  <span className={`pill pill-${status}`}>
    <span className="pill-dot" aria-hidden="true" />
    {t(`project.status.${status === "rotate" ? "rotateSoon" : status}`)}
  </span>
);
export const ModalTitle = ({ children }: { children: React.ReactNode }) => (
  <DialogTitle className="mb-1 text-base tracking-[-0.01em]">
    {children}
  </DialogTitle>
);

export const ModalFrame = ({
  id,
  className = "",
  initialFocusId,
  children,
  onClose,
}: {
  id: string;
  className?: string;
  initialFocusId?: string;
  children: React.ReactNode;
  onClose: () => void;
}) => {
  const content = useRef<HTMLDivElement>(null);
  const priorFocus = useRef<HTMLElement | null>(null);
  const previousInitialFocusId = useRef(initialFocusId);
  useEffect(() => {
    if (previousInitialFocusId.current === initialFocusId || !initialFocusId) {
      return;
    }
    previousInitialFocusId.current = initialFocusId;
    content.current
      ?.querySelector<HTMLElement>(`#${CSS.escape(initialFocusId)}`)
      ?.focus();
  }, [initialFocusId]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent
        ref={content}
        id={id}
        className={cn(
          "lk-ui-theme block max-h-[min(88dvh,760px)] max-w-[500px]",
          className
        )}
        closeLabel={t("common.close")}
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          priorFocus.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
          const target = initialFocusId
            ? content.current?.querySelector<HTMLElement>(
                `#${CSS.escape(initialFocusId)}`
              )
            : content.current?.querySelector<HTMLElement>(
                "input:not([type=hidden]), textarea, select, button:not([data-close])"
              );
          target?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const prior = priorFocus.current;
          if (prior?.isConnected && prior.getClientRects().length > 0) {
            prior.focus();
            return;
          }
          const opener = prior
            ?.closest(".dropdown")
            ?.querySelector<HTMLElement>("button");
          const fallback = opener?.getClientRects().length
            ? opener
            : document.querySelector<HTMLElement>("#newBtn");
          fallback?.focus();
        }}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
};

export const SecretTable = ({
  entries,
  selected,
  favorites,
  menu,
  menuOpenUp,
  loadState,
  emptyMessage,
  onSelect,
  onEnter,
  onFavorite,
  onCopy,
  onEdit,
  onHistory,
  onDelete,
  onMenu,
}: {
  entries: {
    key: string;
    value: string;
    type: "secret" | "config";
    status: Status;
    description?: string;
    tags?: string[];
    updatedAt?: string | null;
  }[];
  selected: string | null;
  favorites: string[];
  menu: string | null;
  menuOpenUp: boolean;
  loadState: "loading" | "ready" | "error";
  emptyMessage: React.ReactNode;
  onSelect: (key: string) => void;
  onEnter: (key: string) => void;
  onFavorite: (key: string) => void;
  onCopy: (key: string) => void;
  onEdit: (key: string) => void;
  onHistory: (key: string) => void;
  onDelete: (key: string) => void;
  onMenu: (key: string) => void;
}) => {
  const showRows = loadState === "ready" && entries.length > 0;
  return (
    <div className="secrets-table-wrap" id="tableWrap">
      <table
        className="secrets-table"
        id="secretsTable"
        aria-label={t("project.a11y.tableLabel")}
        style={{ display: showRows ? "" : "none" }}
      >
        <thead>
          <tr>
            <th scope="col">{t("project.table.name")}</th>
            <th scope="col">{t("project.table.value")}</th>
            <th scope="col">{t("project.table.status")}</th>
            <th scope="col">{t("project.table.updated")}</th>
            <th scope="col">
              <span className="sr-only">{t("project.table.actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody id="secretsBody">
          {entries.map((entry) => {
            const favorite = favorites.includes(entry.key);
            const masked =
              entry.type === "secret" ? mask(entry.value) : entry.value;
            const rowMenu = `row:${entry.key}`;
            return (
              <tr
                key={entry.key}
                data-status={entry.status}
                data-list-key={entry.key}
                tabIndex={0}
                aria-selected={selected === entry.key}
                aria-label={t("project.table.selectRow", { key: entry.key })}
                onClick={(event) => {
                  if (!(event.target as HTMLElement).closest("button")) {
                    onSelect(entry.key);
                  }
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !(event.target as HTMLElement).closest("button")
                  ) {
                    event.preventDefault();
                    onSelect(entry.key);
                    onEnter(entry.key);
                  }
                }}
              >
                <td>
                  <span className="cell-name">
                    <span className="type-icon" aria-hidden="true">
                      <Icon
                        name={entry.type === "secret" ? "lock" : "file-text"}
                      />
                    </span>
                    <span className="secret-row-identity">
                      <span className="secret-row-heading">
                        <span className="key-name" title={entry.key}>
                          {entry.key}
                        </span>
                        <span className="secret-type-badge">
                          {t(
                            entry.type === "secret"
                              ? "project.table.typeSecret"
                              : "project.table.typeConfig"
                          )}
                        </span>
                      </span>
                      {entry.description || entry.tags?.length ? (
                        <span className="secret-row-description">
                          {entry.description}
                          {entry.tags?.map((tag) => (
                            <span className="secret-row-tag" key={tag}>
                              #{tag}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </span>
                    <Button
                      variant="ghost"
                      type="button"
                      className={`fav-btn${favorite ? " is-fav" : ""}`}
                      aria-pressed={favorite}
                      aria-label={t(
                        favorite
                          ? "project.removeFromFavorites"
                          : "project.addToFavorites"
                      )}
                      title={t(
                        favorite
                          ? "project.removeFromFavorites"
                          : "project.addToFavorites"
                      )}
                      onClick={(event) => {
                        event.stopPropagation();
                        onFavorite(entry.key);
                      }}
                    >
                      <Icon name="star" />
                    </Button>
                  </span>
                </td>
                <td>
                  <span className="cell-value">{masked}</span>
                </td>
                <td>
                  <Pill status={entry.status} />
                </td>
                <td>
                  <span
                    className="cell-updated"
                    title={fmtDate(entry.updatedAt)}
                  >
                    {relative(entry.updatedAt)}
                  </span>
                </td>
                <td>
                  <div className="cell-actions">
                    <Button
                      variant="ghost"
                      type="button"
                      className="row-action row-copy"
                      aria-label={t("project.copyValue")}
                      title={t("project.copyValue")}
                      onClick={(event) => {
                        event.stopPropagation();
                        onCopy(entry.key);
                      }}
                    >
                      <Icon name="clipboard" />
                    </Button>
                    <DropdownMenu
                      open={menu === rowMenu}
                      onOpenChange={(open) => {
                        if (open) {
                          onMenu(entry.key);
                        } else if (menu === rowMenu) {
                          onMenu(entry.key);
                        }
                      }}
                    >
                      <div className="dropdown">
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            type="button"
                            className="row-action row-more"
                            aria-expanded={menu === rowMenu}
                            aria-label={t("project.table.moreActions", {
                              key: entry.key,
                            })}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Icon name="ellipsis" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          className="dropdown-menu dropdown-menu-left"
                          side={
                            menuOpenUp && menu === rowMenu ? "top" : "bottom"
                          }
                          align="end"
                        >
                          <DropdownMenuItem
                            className="dropdown-item"
                            data-act="edit"
                            onSelect={() => onEdit(entry.key)}
                          >
                            {t("project.edit")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="dropdown-item"
                            data-act="history"
                            onSelect={() => onHistory(entry.key)}
                          >
                            {t("project.viewHistory")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="dropdown-separator" />
                          <DropdownMenuItem
                            className="dropdown-item danger"
                            data-act="delete"
                            onSelect={() => onDelete(entry.key)}
                          >
                            {t("project.deleteSecret")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </div>
                    </DropdownMenu>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {(!showRows || entries.length === 0) && emptyMessage}
    </div>
  );
};

export const Inspector = ({
  entry,
  type,
  vaultName,
  history,
  usage,
  reveal,
  onCopy,
  onReveal,
}: {
  entry: SecretRecord;
  type: "secret" | "config";
  vaultName: string;
  history: SecretHistory | null;
  usage: { action: string; timestamp: string }[];
  reveal: { key: string; remaining: number } | null;
  onCopy: () => void;
  onReveal: () => void;
}) => {
  const shown = type === "config" || Boolean(reveal);
  const audit = [
    ...(history?.history.slice(0, 4).map((item) => ({
      text: t("project.inspector.valueUpdated"),
      timestamp: item.changedAt,
    })) || []),
    {
      text: t("project.inspector.secretCreated"),
      timestamp: entry.createdAt || null,
    },
  ];
  return (
    <>
      <section aria-label={t("project.table.value")}>
        <div className="inspector-value-block">
          <div className="inspector-value-label">
            <span>
              <Icon name="lock" />
              {t(
                shown
                  ? "project.inspector.visibleValue"
                  : "project.inspector.maskedValue"
              )}
            </span>
          </div>
          <div className="inspector-value" id="inspectorValue">
            {shown ? String(entry.value ?? "") : mask(entry.value)}
          </div>
          <div className="inspector-value-actions">
            <Button
              variant="default"
              type="button"
              className="sl-btn sl-btn-primary"
              id="inspectorCopy"
              onClick={onCopy}
            >
              <Icon name="clipboard" />
              <span>{t("project.copyValue")}</span>
            </Button>
            {type === "secret" && !reveal && (
              <Button
                variant="secondary"
                type="button"
                className="sl-btn sl-btn-secondary"
                id="inspectorReveal"
                onClick={onReveal}
              >
                <Icon name="eye" />
                <span>{t("project.inspector.reveal")}</span>
              </Button>
            )}
          </div>
          {reveal ? (
            <p className="inspector-countdown" id="revealCountdown">
              {t("project.inspector.hidesIn", { count: reveal.remaining })}
            </p>
          ) : (
            type === "secret" && (
              <p className="inspector-note">{t("project.copiedDetail")}</p>
            )
          )}
        </div>
      </section>
      {entry.description && (
        <section aria-label={t("project.inspector.description")}>
          <p className="inspector-desc">{entry.description}</p>
        </section>
      )}
      <section
        className="inspector-section"
        aria-label={t("project.inspector.metadata")}
      >
        <h3>{t("project.inspector.metadata")}</h3>
        <dl className="meta-grid" id="metaGrid">
          <div className="meta-row">
            <dt>{t("project.inspector.created")}</dt>
            <dd>{fmtDate(entry.createdAt)}</dd>
          </div>
          <div className="meta-row">
            <dt>{t("project.inspector.updated")}</dt>
            <dd>{fmtDate(entry.updatedAt)}</dd>
          </div>
          <div className="meta-row">
            <dt>{t("project.inspector.version")}</dt>
            <dd id="metaVersion">{history?.totalVersions ?? "…"}</dd>
          </div>
          <div className="meta-row">
            <dt>{t("project.inspector.expires")}</dt>
            <dd>
              {entry.expiresAt
                ? fmtDate(entry.expiresAt)
                : t("project.inspector.neverExpires")}
            </dd>
          </div>
          <div className="meta-row">
            <dt>{t("project.inspector.vault")}</dt>
            <dd>{vaultName || "–"}</dd>
          </div>
        </dl>
      </section>
      <section
        className="inspector-section"
        aria-label={t("project.inspector.tags")}
      >
        <h3>{t("project.inspector.tags")}</h3>
        {entry.tags?.length ? (
          <div className="tag-list">
            {entry.tags.map((tag) => (
              <span className="tag-chip" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        ) : (
          <p className="inspector-empty">{t("project.inspector.noTags")}</p>
        )}
      </section>
      <section
        className="inspector-section"
        aria-label={t("project.inspector.usage")}
      >
        <h3>{t("project.inspector.usage")}</h3>
        {usage.length ? (
          <ul className="usage-list">
            {usage.map((item, index) => (
              <li key={`${item.timestamp}:${index}`}>
                <span className="entry-text">{item.action}</span>
                <time>{relative(item.timestamp)}</time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="inspector-empty">{t("project.inspector.noUsage")}</p>
        )}
      </section>
      <section
        className="inspector-section"
        aria-label={t("project.inspector.audit")}
      >
        <h3>{t("project.inspector.audit")}</h3>
        <ul className="audit-list" id="auditList">
          {audit.map((item, index) => (
            <li key={`${item.timestamp}:${index}`}>
              <span className="entry-text">{item.text}</span>
              <time>{relative(item.timestamp)}</time>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
};

export interface ConfigDraft {
  source: "text" | "file";
  text: string;
  step: "input" | "review" | "clear";
  busy: boolean;
  handle: string | null;
  target: ReviewTarget | null;
  entries: ConfigurationEntry[];
  changes: ConfigurationChanges | null;
  removed: string[];
  duplicateNames: number;
  message: string;
}

interface ConfigurationReviewProps {
  draft: ConfigDraft;
  configured: boolean;
  targetLabel: string;
  onClose: () => void;
  onSource: (source: "text" | "file") => void;
  onText: (value: string) => void;
  onChooseFile: () => void;
  onReview: () => void;
  onClear: () => void;
  onBack: () => void;
  onCommit: () => void;
}
const ConfigurationInputStep = ({
  draft,
  targetLabel,
  onSource,
  onText,
  onChooseFile,
}: Pick<
  ConfigurationReviewProps,
  "draft" | "targetLabel" | "onSource" | "onText" | "onChooseFile"
>) => (
  <div className="configuration-step" id="configurationInputStep">
    <p className="configuration-target" id="configurationInputTarget">
      {targetLabel}
    </p>
    <section
      className="import-source-tabs"
      aria-label={t("project.configuration.sourceLabel")}
    >
      <Button
        variant="secondary"
        type="button"
        className={`import-source-btn${draft.source === "text" ? " is-active" : ""}`}
        id="configurationPasteSource"
        aria-pressed={draft.source === "text"}
        disabled={draft.busy}
        onClick={() => onSource("text")}
      >
        {t("project.configuration.pasteSource")}
      </Button>
      <Button
        variant="secondary"
        type="button"
        className={`import-source-btn${draft.source === "file" ? " is-active" : ""}`}
        id="configurationFileSource"
        aria-pressed={draft.source === "file"}
        disabled={draft.busy}
        onClick={() => onSource("file")}
      >
        {t("project.configuration.fileSource")}
      </Button>
    </section>
    {draft.source === "text" ? (
      <div id="configurationPastePanel">
        <label className="import-input-label" htmlFor="configurationText">
          {t("project.configuration.textLabel")}
        </label>
        <textarea
          className="import-textarea configuration-textarea"
          id="configurationText"
          spellCheck={false}
          placeholder={t("project.configuration.textPlaceholder")}
          value={draft.text}
          disabled={draft.busy}
          onChange={(event) => onText(event.target.value)}
        />
        <p className="import-format-hint">
          {t("project.configuration.formatHint")}
        </p>
      </div>
    ) : (
      <div id="configurationFilePanel">
        <p className="import-format-hint">
          {t("project.configuration.fileHint")}
        </p>
        <Button
          variant="secondary"
          type="button"
          id="configurationChooseFileBtn"
          disabled={draft.busy}
          onClick={onChooseFile}
        >
          <Icon name="upload" />
          <span>{t("project.configuration.chooseFile")}</span>
        </Button>
      </div>
    )}
    {draft.message && (
      <output
        className="configuration-message"
        id="configurationMessage"
        aria-live="polite"
      >
        {draft.message}
      </output>
    )}
  </div>
);
const ConfigurationReviewStep = ({
  draft,
  targetLabel,
}: Pick<ConfigurationReviewProps, "draft" | "targetLabel">) => (
  <div className="configuration-step" id="configurationReviewStep">
    <p className="configuration-target" id="configurationReviewTarget">
      {targetLabel}
    </p>
    <p className="configuration-review-summary" id="configurationReviewSummary">
      {t("project.configuration.reviewCounts", {
        added: draft.changes?.added.length || 0,
        removed: draft.changes?.removed.length || 0,
        required: draft.entries.length,
        unchanged: draft.changes?.unchanged.length || 0,
      })}
    </p>
    {draft.duplicateNames > 0 && (
      <p
        className="configuration-duplicate-note"
        id="configurationDuplicateNote"
      >
        {t("project.configuration.duplicates", {
          count: draft.duplicateNames,
        })}
      </p>
    )}
    <div className="configuration-change-groups" id="configurationChangeGroups">
      {Object.entries(draft.changes || {}).map(([kind, keys]) => (
        <div className="configuration-change-group" key={kind}>
          <strong>{t(`project.configuration.change.${kind}`)}</strong>
          <span>
            {keys.length ? keys.join(", ") : t("project.configuration.none")}
          </span>
        </div>
      ))}
    </div>
    <ul
      className="configuration-review-list"
      id="configurationReviewList"
      aria-label={t("project.configuration.heading")}
    >
      {draft.entries.map((entry) => (
        <li className="configuration-review-row" key={entry.key}>
          <code>{entry.key}</code>
          <span className="configuration-status" data-status={entry.status}>
            {t(`project.configuration.status.${entry.status.toLowerCase()}`)}
          </span>
        </li>
      ))}
    </ul>
    {draft.message && (
      <output
        className="configuration-message"
        id="configurationReviewMessage"
        aria-live="polite"
      >
        {draft.message}
      </output>
    )}
  </div>
);
const ConfigurationClearStep = ({
  draft,
  targetLabel,
}: Pick<ConfigurationReviewProps, "draft" | "targetLabel">) => (
  <div className="configuration-step" id="configurationClearStep">
    <p className="configuration-target" id="configurationClearTarget">
      {targetLabel}
    </p>
    <p className="configuration-clear-warning">
      {t("project.configuration.clearWarning")}
    </p>
    <p className="configuration-review-summary" id="configurationClearSummary">
      {t("project.configuration.clearCount", {
        count: draft.removed.length,
      })}
    </p>
    <ul
      className="configuration-review-list"
      id="configurationClearList"
      aria-label={t("project.configuration.heading")}
    >
      {draft.removed.map((key) => (
        <li className="configuration-review-row" key={key}>
          <code>{key}</code>
        </li>
      ))}
    </ul>
    {draft.message && (
      <output
        className="configuration-message"
        id="configurationClearMessage"
        aria-live="polite"
      >
        {draft.message}
      </output>
    )}
  </div>
);
export const ConfigurationReviewDialog = ({
  draft,
  configured,
  targetLabel,
  onClose,
  onSource,
  onText,
  onChooseFile,
  onReview,
  onClear,
  onBack,
  onCommit,
}: ConfigurationReviewProps) => {
  const inputFocusId =
    draft.source === "text"
      ? "configurationText"
      : "configurationChooseFileBtn";
  const initialFocusId =
    draft.step === "input" ? inputFocusId : "configurationBackBtn";
  const commitLabel =
    draft.step === "clear"
      ? "project.configuration.confirmClear"
      : "project.configuration.saveButton";
  return (
    <ModalFrame
      id="configurationModalOverlay"
      className="configuration-modal max-w-[700px]"
      initialFocusId={initialFocusId}
      onClose={onClose}
    >
      <div className="modal-header">
        <ModalTitle>{t("project.configuration.modalTitle")}</ModalTitle>
      </div>
      <p className="modal-sub" id="configurationModalDescription">
        {t("project.configuration.modalDescription")}
      </p>
      {draft.step === "input" && (
        <ConfigurationInputStep
          draft={draft}
          targetLabel={targetLabel}
          onSource={onSource}
          onText={onText}
          onChooseFile={onChooseFile}
        />
      )}
      {draft.step === "review" && (
        <ConfigurationReviewStep draft={draft} targetLabel={targetLabel} />
      )}
      {draft.step === "clear" && (
        <ConfigurationClearStep draft={draft} targetLabel={targetLabel} />
      )}
      <div className="modal-actions">
        {draft.step !== "input" && (
          <Button
            variant="secondary"
            type="button"
            id="configurationBackBtn"
            disabled={draft.busy}
            onClick={onBack}
          >
            {t("project.configuration.back")}
          </Button>
        )}
        <Button
          variant="secondary"
          type="button"
          id="configurationCancelBtn"
          disabled={draft.busy && draft.step !== "input"}
          onClick={onClose}
        >
          {t("common.cancel")}
        </Button>
        {draft.step === "input" ? (
          <>
            <Button
              variant="default"
              type="button"
              id="configurationReviewBtn"
              disabled={draft.busy || draft.source === "file"}
              onClick={onReview}
            >
              {draft.busy
                ? t("project.configuration.saving")
                : t("project.configuration.reviewButton")}
            </Button>
            {configured && (
              <Button
                variant="destructive"
                type="button"
                id="configurationClearReviewBtn"
                disabled={draft.busy}
                onClick={onClear}
              >
                {t("project.configuration.clearAction")}
              </Button>
            )}
          </>
        ) : (
          <Button
            variant={draft.step === "clear" ? "destructive" : "default"}
            type="button"
            id="configurationSaveBtn"
            disabled={draft.busy}
            onClick={onCommit}
          >
            {draft.busy ? t("project.configuration.saving") : t(commitLabel)}
          </Button>
        )}
      </div>
    </ModalFrame>
  );
};

export interface ImportChoice {
  occurrenceId: string | null;
  action: "add" | "replace" | "skip";
  explicit: boolean;
}
export type ImportRow = ImportPreviewEntry & {
  choice: ImportChoice | null;
};
export interface ImportReveal {
  value: string;
  expiresAt: number;
}
export const ImportReviewDialog = ({
  source,
  text,
  rows,
  handle,
  targetText,
  diagnostics,
  busy,
  committing,
  ready,
  counts,
  reveals,
  onClose,
  onSource,
  onText,
  onPreview,
  onBack,
  onCommit,
  onReveal,
  onChoose,
  onAction,
}: {
  source: "text" | "file";
  text: string;
  rows: ImportRow[];
  handle: string | null;
  targetText: string;
  diagnostics: string[];
  busy: boolean;
  committing: boolean;
  ready: boolean;
  counts: { add: number; replace: number; skip: number; pending: number };
  reveals: Record<string, ImportReveal>;
  onClose: () => void;
  onSource: (source: "text" | "file") => void;
  onText: (text: string) => void;
  onPreview: () => void;
  onBack: () => void;
  onCommit: () => void;
  onReveal: (entry: ImportRow, occurrence: ImportOccurrence) => void;
  onChoose: (key: string, occurrenceId: string | null) => void;
  onAction: (
    key: string,
    occurrenceId: string,
    action: ImportChoice["action"]
  ) => void;
}) => {
  const previousHandle = useRef<string | null>(null);
  useEffect(() => {
    if (handle && !previousHandle.current) {
      document.querySelector<HTMLElement>("#importBackBtn")?.focus();
    }
    if (!handle && previousHandle.current) {
      document.querySelector<HTMLElement>("#importText")?.focus();
    }
    previousHandle.current = handle;
  }, [handle]);
  const inputFocusId = source === "text" ? "importText" : "importChooseFileBtn";
  const initialFocusId = handle ? "importBackBtn" : inputFocusId;
  const busyCancelLabel = committing
    ? "project.importReview.closeDuringCommit"
    : "project.importReview.cancelRequest";
  return (
    <ModalFrame
      id="importModalOverlay"
      className="import-modal max-w-[760px]"
      initialFocusId={initialFocusId}
      onClose={onClose}
    >
      <div className="modal-header">
        <ModalTitle>{t("project.importReview.title")}</ModalTitle>
      </div>
      <p className="modal-sub" id="importSub">
        {t("project.importReview.subtitle")}
      </p>
      {!handle && (
        <section
          id="importInputStep"
          className="import-step"
          aria-labelledby="importInputHeading"
        >
          <h3 id="importInputHeading" className="import-step-heading">
            {t("project.importReview.inputHeading")}
          </h3>
          <div className="import-target" id="importInputTarget">
            {targetText}
          </div>
          <section
            className="import-source-tabs"
            aria-label={t("project.importReview.sourceLabel")}
          >
            <Button
              variant="secondary"
              type="button"
              className={`import-source-btn${source === "text" ? " is-active" : ""}`}
              id="importPasteSource"
              aria-pressed={source === "text"}
              disabled={busy}
              onClick={() => onSource("text")}
            >
              {t("project.importReview.pasteSource")}
            </Button>
            <Button
              variant="secondary"
              type="button"
              className={`import-source-btn${source === "file" ? " is-active" : ""}`}
              id="importFileSource"
              aria-pressed={source === "file"}
              disabled={busy}
              onClick={() => onSource("file")}
            >
              {t("project.importReview.fileSource")}
            </Button>
          </section>
          {source === "text" ? (
            <div id="importPastePanel">
              <label className="import-input-label" htmlFor="importText">
                {t("project.importReview.textLabel")}
              </label>
              <textarea
                className="import-textarea"
                id="importText"
                spellCheck={false}
                placeholder={t("project.importReview.textPlaceholder")}
                value={text}
                onChange={(event) => onText(event.target.value)}
              />
              <p className="import-format-hint">
                {t("project.importReview.formatHint")}
              </p>
            </div>
          ) : (
            <div id="importFilePanel">
              <p className="import-format-hint">
                {t("project.importReview.fileHint")}
              </p>
              <Button
                variant="secondary"
                type="button"
                id="importChooseFileBtn"
                disabled={busy}
                onClick={onPreview}
              >
                <Icon name="upload" />
                <span>{t("project.importReview.chooseFile")}</span>
              </Button>
            </div>
          )}
          {diagnostics.length > 0 && (
            <div
              className="import-diagnostics"
              id="importDiagnostics"
              aria-live="polite"
              aria-atomic="true"
            >
              <strong>
                {t("project.importReview.diagnosticSummary", {
                  count: diagnostics.length,
                })}
              </strong>
              <ul>
                {diagnostics.map((message, index) => (
                  <li key={index}>{message}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
      {handle && (
        <section
          id="importReviewStep"
          className="import-step"
          aria-labelledby="importReviewHeading"
        >
          <h3 id="importReviewHeading" className="import-step-heading">
            {t("project.importReview.reviewHeading")}
          </h3>
          <div className="import-target" id="importReviewTarget">
            {targetText}
          </div>
          <p
            className="import-review-summary"
            id="importSummary"
            aria-live="polite"
          >
            {t("project.importReview.summary", counts)}
          </p>
          <div className="import-review-head" aria-hidden="true">
            <span>{t("project.importReview.columnKey")}</span>
            <span>{t("project.importReview.columnValue")}</span>
            <span>{t("project.importReview.columnStatus")}</span>
          </div>
          <section
            className="import-review-list"
            id="importList"
            aria-label={t("project.importReview.reviewListLabel")}
          >
            {rows.map((row, index) => (
              <article
                className="import-review-row"
                data-entry={index}
                key={row.key}
              >
                <div className="import-review-key">
                  <code>{row.key}</code>
                  {row.duplicate && (
                    <span className="import-duplicate-note">
                      {t("project.importReview.duplicateOccurrences", {
                        count: row.occurrences.length,
                      })}
                    </span>
                  )}
                </div>
                <div className="import-occurrences">
                  {row.occurrences.map((occurrence, occurrenceIndex) => {
                    const revealKey = `${row.key}:${occurrence.id}`;
                    const reveal = reveals[revealKey];
                    const selected = row.choice?.occurrenceId === occurrence.id;
                    let actions: string[];
                    let tone: string;
                    if (occurrence.status === "new") {
                      actions = ["add", "skip"];
                      tone = "healthy";
                    } else if (occurrence.status === "changed") {
                      actions = ["keep", "replace"];
                      tone = "rotate";
                    } else {
                      actions = ["skip"];
                      tone = "config";
                    }
                    let chosenAction: string = occurrence.defaultAction;
                    if (selected) {
                      chosenAction = row.choice?.action || "skip";
                      if (
                        chosenAction === "skip" &&
                        occurrence.status === "changed"
                      ) {
                        chosenAction = "keep";
                      }
                    }
                    const displayedValue = occurrence.empty
                      ? t("project.importReview.emptyValue")
                      : (reveal?.value ?? "••••••••");
                    return (
                      <div
                        className="import-occurrence"
                        data-occurrence={occurrenceIndex}
                        key={occurrence.id}
                      >
                        {row.duplicate ? (
                          <label>
                            <input
                              type="radio"
                              name={`import-${index}`}
                              checked={selected}
                              onChange={() => onChoose(row.key, occurrence.id)}
                              aria-label={t(
                                "project.importReview.occurrenceLabel",
                                { line: occurrence.line }
                              )}
                            />
                            <span>
                              {t("project.importReview.lineNumber", {
                                line: occurrence.line,
                              })}
                            </span>
                          </label>
                        ) : (
                          <span className="import-line-number">
                            {t("project.importReview.lineNumber", {
                              line: occurrence.line,
                            })}
                          </span>
                        )}
                        <span className="rev-value">{displayedValue}</span>
                        <span className={`pill pill-${tone}`}>
                          <span className="pill-dot" aria-hidden="true" />
                          {t(
                            `project.importReview.status.${occurrence.status}`
                          )}
                        </span>
                        <Button
                          variant="ghost"
                          type="button"
                          className="import-reveal-btn"
                          disabled={busy}
                          aria-label={t(
                            reveal
                              ? "project.importReview.hideOccurrence"
                              : "project.importReview.revealOccurrence",
                            { key: row.key, line: occurrence.line }
                          )}
                          onClick={() => onReveal(row, occurrence)}
                        >
                          {reveal
                            ? t("project.importReview.hideCountdown", {
                                seconds: Math.max(
                                  0,
                                  Math.ceil(
                                    (reveal.expiresAt - Date.now()) / 1000
                                  )
                                ),
                              })
                            : t("project.importReview.reveal")}
                        </Button>
                        <select
                          className="import-action-select"
                          aria-label={t("project.importReview.actionForKey", {
                            key: row.key,
                          })}
                          value={chosenAction}
                          disabled={row.duplicate && !selected}
                          hidden={row.duplicate && !selected}
                          onChange={(event) =>
                            onAction(
                              row.key,
                              occurrence.id,
                              event.target.value === "keep"
                                ? "skip"
                                : (event.target.value as ImportChoice["action"])
                            )
                          }
                        >
                          {actions.map((action) => (
                            <option
                              key={action}
                              value={action === "keep" ? "skip" : action}
                            >
                              {t(`project.importReview.action.${action}`)}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                  {row.duplicate && (
                    <label className="import-skip-key">
                      <input
                        type="radio"
                        name={`import-${index}`}
                        checked={
                          row.choice?.explicit === true &&
                          row.choice.occurrenceId === null
                        }
                        aria-label={t("project.importReview.excludeKey", {
                          key: row.key,
                        })}
                        onChange={() => onChoose(row.key, null)}
                      />
                      {t("project.importReview.skipKey")}
                    </label>
                  )}
                </div>
              </article>
            ))}
          </section>
          {diagnostics.length > 0 && (
            <div
              className="import-diagnostics"
              id="importReviewDiagnostics"
              aria-live="polite"
              aria-atomic="true"
            >
              {diagnostics.map((message, index) => (
                <p key={index}>{message}</p>
              ))}
            </div>
          )}
        </section>
      )}
      <div className="modal-actions">
        <Button
          variant="secondary"
          type="button"
          id="importCancelBtn"
          disabled={committing}
          onClick={onClose}
        >
          {t(busy ? busyCancelLabel : "common.cancel")}
        </Button>
        {handle ? (
          <>
            <Button
              variant="secondary"
              type="button"
              id="importBackBtn"
              disabled={busy}
              onClick={onBack}
            >
              {t("project.importReview.back")}
            </Button>
            <Button
              variant="default"
              type="button"
              id="importConfirmBtn"
              disabled={busy || !ready || counts.add + counts.replace === 0}
              onClick={onCommit}
            >
              {t("project.importReview.importButton", {
                count: counts.add + counts.replace,
              })}
            </Button>
          </>
        ) : (
          <Button
            variant="secondary"
            type="button"
            id="importReviewBtn"
            disabled={busy}
            onClick={onPreview}
          >
            {busy
              ? t("project.loadingSecrets")
              : t("project.importReview.reviewButton")}
          </Button>
        )}
      </div>
    </ModalFrame>
  );
};
