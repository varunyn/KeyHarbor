import React, { useEffect, useRef, useState } from "react";

import { i18n } from "../renderer/i18n";
import { ActionMenu } from "../renderer/ui/action-menu";
import { Button } from "../renderer/ui/button";
import { ModalDialog, ModalTitle } from "../renderer/ui/modal-dialog";
import { cn } from "../renderer/ui/utils";
import type {
  ConfigurationChanges,
  ConfigurationEntry,
  ImportOccurrence,
  ImportPreviewEntry,
  ReviewTarget,
  SecretHistory,
  SecretRecord,
} from "./bridge";
import { FolderImportSection } from "./folder-import-section";
import type { FolderImportControls } from "./folder-import-section";
import { Icon } from "./icon";
import { ImportReviewSection } from "./import-review-section";
import { Pill } from "./status-pill";
import type { Status } from "./status-pill";

const t = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars);

export { Icon } from "./icon";

export { Pill } from "./status-pill";

export { ModalTitle } from "../renderer/ui/modal-dialog";

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
}) => (
  <ModalDialog
    id={id}
    className={cn(
      "lk-ui-theme bg-card border-border block max-h-[min(88dvh,760px)] max-w-[500px] overflow-y-auto rounded-2xl border p-6 shadow-xl",
      className
    )}
    initialFocusId={initialFocusId}
    fallbackReturnFocusSelector="#newBtn"
    onClose={onClose}
  >
    {children}
  </ModalDialog>
);

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

export const SecretTable = ({
  entries,
  selected,
  favorites,
  menu,
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
  loadState: "loading" | "ready" | "error";
  emptyMessage: React.ReactNode;
  onSelect: (key: string) => void;
  onEnter: (key: string) => void;
  onFavorite: (key: string) => void;
  onCopy: (key: string) => void;
  onEdit: (key: string) => void;
  onHistory: (key: string) => void;
  onDelete: (key: string) => void;
  onMenu: (key: string, open: boolean) => void;
}) => {
  const showRows = loadState === "ready" && entries.length > 0;
  return (
    <div
      className="secrets-table-wrap mt-2 min-h-[120px] w-full flex-1 overflow-y-auto px-6 pb-4"
      id="tableWrap"
    >
      <table
        className="secrets-table text-foreground w-full border-collapse text-[13px]"
        id="secretsTable"
        aria-label={t("project.a11y.tableLabel")}
        style={{ display: showRows ? "" : "none" }}
      >
        <thead className="bg-background/95 border-border sticky top-0 z-10 border-b text-[11px] backdrop-blur-xs">
          <tr>
            <th
              scope="col"
              className="text-muted-foreground px-3 py-2.5 text-left font-medium tracking-wider uppercase"
            >
              {t("project.table.name")}
            </th>
            <th
              scope="col"
              className="text-muted-foreground px-3 py-2.5 text-left font-medium tracking-wider uppercase"
            >
              {t("project.table.value")}
            </th>
            <th
              scope="col"
              className="text-muted-foreground px-3 py-2.5 text-left font-medium tracking-wider uppercase"
            >
              {t("project.table.status")}
            </th>
            <th
              scope="col"
              className="text-muted-foreground px-3 py-2.5 text-left font-medium tracking-wider uppercase"
            >
              {t("project.table.updated")}
            </th>
            <th
              scope="col"
              className="text-muted-foreground px-3 py-2.5 text-right font-medium tracking-wider uppercase"
            >
              <span className="sr-only">{t("project.table.actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody id="secretsBody" className="divide-border/40 divide-y">
          {entries.map((entry) => {
            const favorite = favorites.includes(entry.key);
            const isSelected = selected === entry.key;
            const masked =
              entry.type === "secret" ? mask(entry.value) : entry.value;
            const rowMenu = `row:${entry.key}`;
            return (
              <tr
                key={entry.key}
                data-status={entry.status}
                data-list-key={entry.key}
                tabIndex={0}
                aria-selected={isSelected}
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
                className={cn(
                  "group hover:bg-secondary/40 focus:bg-secondary/40 cursor-pointer transition-colors focus:outline-hidden",
                  isSelected && "bg-primary/10 hover:bg-primary/15"
                )}
              >
                <td className="px-3 py-4">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className="text-foreground truncate font-mono font-medium"
                          title={entry.key}
                        >
                          {entry.key}
                        </span>
                        <span className="text-primary shrink-0 text-[10px] font-medium">
                          {t(
                            entry.type === "secret"
                              ? "project.table.typeSecret"
                              : "project.table.typeConfig"
                          )}
                        </span>
                      </div>
                      {(entry.description || entry.tags?.length) && (
                        <div className="text-muted-foreground mt-0.5 flex items-center gap-2 truncate text-xs">
                          {entry.description && (
                            <span>{entry.description}</span>
                          )}
                          {entry.tags?.map((tag) => (
                            <span
                              key={tag}
                              className="text-primary/80 text-[11px]"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      type="button"
                      className={cn(
                        "size-7 rounded-md opacity-60 hover:opacity-100",
                        favorite && "text-warning opacity-100"
                      )}
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
                      <Icon
                        name="star"
                        className={cn("size-3.5", favorite && "fill-warning")}
                      />
                    </Button>
                  </div>
                </td>
                <td className="px-3 py-4">
                  <span className="text-muted-foreground block max-w-[240px] truncate font-mono">
                    {masked}
                  </span>
                </td>
                <td className="px-3 py-4 whitespace-nowrap">
                  <Pill status={entry.status} />
                </td>
                <td
                  className="text-muted-foreground px-3 py-4 whitespace-nowrap tabular-nums"
                  title={fmtDate(entry.updatedAt)}
                >
                  {relative(entry.updatedAt)}
                </td>
                <td className="px-3 py-4 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      type="button"
                      className="text-muted-foreground hover:text-foreground size-7 rounded-md"
                      aria-label={t("project.copyValue")}
                      title={t("project.copyValue")}
                      onClick={(event) => {
                        event.stopPropagation();
                        onCopy(entry.key);
                      }}
                    >
                      <Icon name="clipboard" className="size-3.5" />
                    </Button>
                    <ActionMenu
                      open={menu === rowMenu}
                      onOpenChange={(open) => onMenu(entry.key, open)}
                      items={[
                        {
                          label: t("project.edit"),
                          onSelect: () => onEdit(entry.key),
                        },
                        {
                          label: t("project.viewHistory"),
                          onSelect: () => onHistory(entry.key),
                        },
                        { separator: true },
                        {
                          destructive: true,
                          label: t("project.deleteSecret"),
                          onSelect: () => onDelete(entry.key),
                        },
                      ]}
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        type="button"
                        className="text-muted-foreground hover:text-foreground size-7 rounded-md"
                        aria-expanded={menu === rowMenu}
                        aria-label={t("project.table.moreActions", {
                          key: entry.key,
                        })}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Icon name="ellipsis" className="size-3.5" />
                      </Button>
                    </ActionMenu>
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
    <div className="space-y-6">
      <section aria-label={t("project.table.value")}>
        <div className="bg-card border-border space-y-3 rounded-xl border p-4">
          <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
            <Icon name="lock" className="size-3.5" />
            <span>
              {t(
                shown
                  ? "project.inspector.visibleValue"
                  : "project.inspector.maskedValue"
              )}
            </span>
          </div>
          <div
            className="text-foreground bg-secondary/50 border-border/50 flex min-h-[48px] items-center rounded-lg border p-3 font-mono text-sm break-all select-text"
            id="inspectorValue"
          >
            {shown ? String(entry.value ?? "") : mask(entry.value)}
          </div>
          <div className="flex flex-col gap-2">
            <Button
              variant="default"
              type="button"
              className="w-full justify-center text-xs"
              id="inspectorCopy"
              onClick={onCopy}
            >
              <Icon name="clipboard" className="size-3.5" />
              <span>{t("project.copyValue")}</span>
            </Button>
            {type === "secret" && !reveal && (
              <Button
                variant="secondary"
                type="button"
                className="w-full justify-center text-xs"
                id="inspectorReveal"
                onClick={onReveal}
              >
                <Icon name="eye" className="size-3.5" />
                <span>{t("project.inspector.reveal")}</span>
              </Button>
            )}
          </div>
          {reveal ? (
            <p
              className="text-warning text-xs tabular-nums"
              id="revealCountdown"
            >
              {t("project.inspector.hidesIn", { count: reveal.remaining })}
            </p>
          ) : (
            type === "secret" && (
              <p className="text-muted-foreground text-xs">
                {t("project.copiedDetail")}
              </p>
            )
          )}
        </div>
      </section>
      {entry.description && (
        <section aria-label={t("project.inspector.description")}>
          <p className="text-muted-foreground bg-secondary/30 border-border/40 rounded-lg border p-3 text-xs leading-relaxed">
            {entry.description}
          </p>
        </section>
      )}
      <section
        className="space-y-2"
        aria-label={t("project.inspector.metadata")}
      >
        <h3 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
          {t("project.inspector.metadata")}
        </h3>
        <dl
          className="bg-card border-border grid grid-cols-2 gap-2 rounded-xl border p-3.5 text-xs"
          id="metaGrid"
        >
          <div>
            <dt className="text-muted-foreground">
              {t("project.inspector.created")}
            </dt>
            <dd className="text-foreground font-medium">
              {fmtDate(entry.createdAt)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {t("project.inspector.updated")}
            </dt>
            <dd className="text-foreground font-medium">
              {fmtDate(entry.updatedAt)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {t("project.inspector.version")}
            </dt>
            <dd id="metaVersion" className="text-foreground font-medium">
              {history?.totalVersions ?? "…"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {t("project.inspector.expires")}
            </dt>
            <dd className="text-foreground font-medium">
              {entry.expiresAt
                ? fmtDate(entry.expiresAt)
                : t("project.inspector.neverExpires")}
            </dd>
          </div>
          <div className="border-border/50 col-span-2 border-t pt-1">
            <dt className="text-muted-foreground">
              {t("project.inspector.vault")}
            </dt>
            <dd className="text-foreground font-medium">{vaultName || "–"}</dd>
          </div>
        </dl>
      </section>
      <section className="space-y-2" aria-label={t("project.inspector.tags")}>
        <h3 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
          {t("project.inspector.tags")}
        </h3>
        {entry.tags?.length ? (
          <div className="flex flex-wrap gap-1.5">
            {entry.tags.map((tag) => (
              <span
                className="bg-secondary border-border text-primary rounded-full border px-2 py-0.5 text-[11px]"
                key={tag}
              >
                #{tag}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-xs italic">
            {t("project.inspector.noTags")}
          </p>
        )}
      </section>
      <section className="space-y-2" aria-label={t("project.inspector.usage")}>
        <h3 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
          {t("project.inspector.usage")}
        </h3>
        {usage.length ? (
          <ul className="divide-border/40 border-border bg-card divide-y overflow-hidden rounded-xl border text-xs">
            {usage.map((item, index) => (
              <li
                key={`${item.timestamp}:${index}`}
                className="flex items-center justify-between p-2.5"
              >
                <span className="text-foreground font-medium">
                  {item.action}
                </span>
                <time className="text-muted-foreground">
                  {relative(item.timestamp)}
                </time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-xs italic">
            {t("project.inspector.noUsage")}
          </p>
        )}
      </section>
      <section className="space-y-2" aria-label={t("project.inspector.audit")}>
        <h3 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
          {t("project.inspector.audit")}
        </h3>
        <ul
          className="divide-border/40 border-border bg-card divide-y overflow-hidden rounded-xl border text-xs"
          id="auditList"
        >
          {audit.map((item, index) => (
            <li
              key={`${item.timestamp}:${index}`}
              className="flex items-center justify-between p-2.5"
            >
              <span className="text-foreground font-medium">{item.text}</span>
              <time className="text-muted-foreground">
                {relative(item.timestamp)}
              </time>
            </li>
          ))}
        </ul>
      </section>
    </div>
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
  <div className="space-y-4" id="configurationInputStep">
    <p
      className="text-muted-foreground bg-secondary/50 border-border/50 rounded-lg border p-2.5 font-mono text-xs"
      id="configurationInputTarget"
    >
      {targetLabel}
    </p>
    <section
      className="flex gap-2"
      aria-label={t("project.configuration.sourceLabel")}
    >
      <Button
        variant={draft.source === "text" ? "secondary" : "ghost"}
        type="button"
        size="sm"
        className={cn(
          "h-8 px-3 text-xs font-medium",
          draft.source === "text" && "bg-secondary text-foreground shadow-xs"
        )}
        id="configurationPasteSource"
        aria-pressed={draft.source === "text"}
        disabled={draft.busy}
        onClick={() => onSource("text")}
      >
        {t("project.configuration.pasteSource")}
      </Button>
      <Button
        variant={draft.source === "file" ? "secondary" : "ghost"}
        type="button"
        size="sm"
        className={cn(
          "h-8 px-3 text-xs font-medium",
          draft.source === "file" && "bg-secondary text-foreground shadow-xs"
        )}
        id="configurationFileSource"
        aria-pressed={draft.source === "file"}
        disabled={draft.busy}
        onClick={() => onSource("file")}
      >
        {t("project.configuration.fileSource")}
      </Button>
    </section>
    {draft.source === "text" ? (
      <div id="configurationPastePanel" className="space-y-1.5">
        <label
          className="text-foreground block text-xs font-medium"
          htmlFor="configurationText"
        >
          {t("project.configuration.textLabel")}
        </label>
        <textarea
          className="bg-secondary/30 border-border focus:ring-primary h-36 w-full rounded-lg border p-3 font-mono text-xs focus:ring-1 focus:outline-hidden"
          id="configurationText"
          spellCheck={false}
          placeholder={t("project.configuration.textPlaceholder")}
          value={draft.text}
          disabled={draft.busy}
          onChange={(event) => onText(event.target.value)}
        />
        <p className="text-muted-foreground text-xs">
          {t("project.configuration.formatHint")}
        </p>
      </div>
    ) : (
      <div id="configurationFilePanel" className="space-y-3">
        <p className="text-muted-foreground text-xs">
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
        className="border-warning/20 bg-warning/10 text-warning block rounded-lg border p-3 text-xs"
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
  <div className="space-y-4" id="configurationReviewStep">
    <p
      className="text-muted-foreground bg-secondary/50 border-border/50 rounded-lg border p-2.5 font-mono text-xs"
      id="configurationReviewTarget"
    >
      {targetLabel}
    </p>
    <p
      className="text-foreground text-xs font-medium"
      id="configurationReviewSummary"
    >
      {t("project.configuration.reviewCounts", {
        added: draft.changes?.added.length || 0,
        removed: draft.changes?.removed.length || 0,
        required: draft.entries.length,
        unchanged: draft.changes?.unchanged.length || 0,
      })}
    </p>
    {draft.duplicateNames > 0 && (
      <p
        className="border-warning/20 bg-warning/10 text-warning rounded-lg border p-2.5 text-xs"
        id="configurationDuplicateNote"
      >
        {t("project.configuration.duplicates", {
          count: draft.duplicateNames,
        })}
      </p>
    )}
    <div
      className="bg-secondary/30 border-border grid grid-cols-2 gap-2 rounded-lg border p-3 text-xs"
      id="configurationChangeGroups"
    >
      {Object.entries(draft.changes || {}).map(([kind, keys]) => (
        <div key={kind} className="space-y-0.5">
          <strong className="text-muted-foreground block text-[10px] uppercase">
            {t(`project.configuration.change.${kind}`)}
          </strong>
          <span className="text-foreground block truncate font-mono">
            {keys.length ? keys.join(", ") : t("project.configuration.none")}
          </span>
        </div>
      ))}
    </div>
    <ul
      className="divide-border/40 border-border bg-card max-h-[220px] divide-y overflow-hidden overflow-y-auto rounded-xl border text-xs"
      id="configurationReviewList"
      aria-label={t("project.configuration.heading")}
    >
      {draft.entries.map((entry) => (
        <li className="flex items-center justify-between p-2.5" key={entry.key}>
          <code className="text-foreground font-mono font-medium">
            {entry.key}
          </code>
          <span
            className="bg-secondary text-muted-foreground rounded-md px-2 py-0.5 text-[11px]"
            data-status={entry.status}
          >
            {t(`project.configuration.status.${entry.status.toLowerCase()}`)}
          </span>
        </li>
      ))}
    </ul>
    {draft.message && (
      <output
        className="border-warning/20 bg-warning/10 text-warning block rounded-lg border p-3 text-xs"
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
  <div className="space-y-4" id="configurationClearStep">
    <p
      className="text-muted-foreground bg-secondary/50 border-border/50 rounded-lg border p-2.5 font-mono text-xs"
      id="configurationClearTarget"
    >
      {targetLabel}
    </p>
    <p className="text-destructive bg-destructive/10 border-destructive/20 rounded-lg border p-2.5 text-xs">
      {t("project.configuration.clearWarning")}
    </p>
    <p
      className="text-foreground text-xs font-medium"
      id="configurationClearSummary"
    >
      {t("project.configuration.clearCount", {
        count: draft.removed.length,
      })}
    </p>
    <ul
      className="divide-border/40 border-border bg-card max-h-[220px] divide-y overflow-hidden overflow-y-auto rounded-xl border text-xs"
      id="configurationClearList"
      aria-label={t("project.configuration.heading")}
    >
      {draft.removed.map((key) => (
        <li className="p-2.5" key={key}>
          <code className="text-foreground font-mono font-medium">{key}</code>
        </li>
      ))}
    </ul>
    {draft.message && (
      <output
        className="border-warning/20 bg-warning/10 text-warning block rounded-lg border p-3 text-xs"
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
      className="max-w-[700px]"
      initialFocusId={initialFocusId}
      onClose={onClose}
    >
      <div className="mb-4">
        <ModalTitle>{t("project.configuration.modalTitle")}</ModalTitle>
        <p
          className="text-muted-foreground mt-1 text-xs"
          id="configurationModalDescription"
        >
          {t("project.configuration.modalDescription")}
        </p>
      </div>
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
      <div className="border-border mt-6 flex justify-end gap-2 border-t pt-4">
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

const ImportInputSection = ({
  source,
  text,
  targetText,
  diagnostics,
  busy,
  fileName,
  onSource,
  onText,
  onChooseFile,
  onDropFile,
  onClearFile,
  folder,
}: {
  source: "text" | "file" | "folder";
  text: string;
  targetText: string;
  diagnostics: string[];
  busy: boolean;
  fileName: string | null;
  onSource: (source: "text" | "file" | "folder") => void;
  onText: (text: string) => void;
  onChooseFile: () => void;
  onDropFile: (file: File) => void;
  onClearFile: () => void;
  folder: FolderImportControls;
}) => {
  const [dragActive, setDragActive] = useState(false);
  return (
    <section
      id="importInputStep"
      className="space-y-4"
      aria-labelledby="importInputHeading"
    >
      <h3
        id="importInputHeading"
        className="text-muted-foreground text-xs font-semibold tracking-wider uppercase"
      >
        {t("project.importReview.inputHeading")}
      </h3>
      <div
        className="text-muted-foreground bg-secondary/50 border-border/50 rounded-lg border p-2.5 font-mono text-xs"
        id="importInputTarget"
      >
        {targetText}
      </div>
      <section
        className="flex gap-2"
        aria-label={t("project.importReview.sourceLabel")}
      >
        <Button
          variant={source === "text" ? "secondary" : "ghost"}
          type="button"
          size="sm"
          className={cn(
            "h-8 px-3 text-xs font-medium",
            source === "text" && "bg-secondary text-foreground shadow-xs"
          )}
          id="importPasteSource"
          aria-pressed={source === "text"}
          disabled={busy}
          onClick={() => onSource("text")}
        >
          {t("project.importReview.pasteSource")}
        </Button>
        <Button
          variant={source === "file" ? "secondary" : "ghost"}
          type="button"
          size="sm"
          className={cn(
            "h-8 px-3 text-xs font-medium",
            source === "file" && "bg-secondary text-foreground shadow-xs"
          )}
          id="importFileSource"
          aria-pressed={source === "file"}
          disabled={busy}
          onClick={() => onSource("file")}
        >
          {t("project.importReview.fileSource")}
        </Button>
        <Button
          variant={source === "folder" ? "secondary" : "ghost"}
          type="button"
          size="sm"
          className="h-8 px-3 text-xs font-medium"
          aria-pressed={source === "folder"}
          disabled={busy}
          onClick={() => onSource("folder")}
        >
          {t("project.folderImport.source")}
        </Button>
      </section>
      {source === "folder" && <FolderImportSection busy={busy} {...folder} />}
      {source === "text" && (
        <div id="importPastePanel" className="space-y-1.5">
          <label
            className="text-foreground block text-xs font-medium"
            htmlFor="importText"
          >
            {t("project.importReview.textLabel")}
          </label>
          <textarea
            className="bg-secondary/30 border-border focus:ring-primary h-36 w-full rounded-lg border p-3 font-mono text-xs focus:ring-1 focus:outline-hidden"
            id="importText"
            spellCheck={false}
            placeholder={t("project.importReview.textPlaceholder")}
            value={text}
            onChange={(event) => onText(event.target.value)}
          />
          <p className="text-muted-foreground text-xs">
            {t("project.importReview.formatHint")}
          </p>
        </div>
      )}
      {source === "file" && (
        <div
          id="importFilePanel"
          className={cn(
            "space-y-3 rounded-lg border border-dashed p-3 transition-colors",
            dragActive ? "border-primary bg-primary/10" : "border-border/60"
          )}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            const dropped = event.dataTransfer.files?.[0];
            if (dropped && !busy) {
              onDropFile(dropped);
            }
          }}
        >
          <p className="text-muted-foreground text-xs">
            {t("project.importReview.fileHint")}
          </p>
          <p className="text-muted-foreground text-xs" aria-hidden="true">
            {t(
              dragActive
                ? "project.importReview.dropActive"
                : "project.importReview.dropHint"
            )}
          </p>
          {fileName ? (
            <div className="bg-secondary/50 border-border/50 flex items-center justify-between gap-2 rounded-lg border p-2 text-xs">
              <code
                className="text-foreground truncate font-mono"
                title={fileName}
              >
                {t("project.importReview.droppedFile", { name: fileName })}
              </code>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                className="h-6 shrink-0 px-2 text-xs"
                disabled={busy}
                onClick={onClearFile}
                aria-label={t("project.importReview.removeFile", {
                  name: fileName,
                })}
              >
                {t("project.importReview.removeFileLabel")}
              </Button>
            </div>
          ) : null}
          <Button
            variant="secondary"
            type="button"
            id="importChooseFileBtn"
            disabled={busy}
            onClick={onChooseFile}
          >
            <Icon name="upload" />
            <span>{t("project.importReview.chooseFile")}</span>
          </Button>
        </div>
      )}
      {diagnostics.length > 0 && (
        <div
          className="bg-destructive/10 border-destructive/20 text-destructive space-y-1 rounded-lg border p-3 text-xs"
          id="importDiagnostics"
          aria-live="polite"
          aria-atomic="true"
        >
          <strong>
            {t("project.importReview.diagnosticSummary", {
              count: diagnostics.length,
            })}
          </strong>
          <ul className="list-inside list-disc">
            {diagnostics.map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};

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
  fileName,
  onClose,
  onSource,
  onText,
  onPreview,
  onChooseFile,
  onDropFile,
  onClearFile,
  folder,
  onBack,
  onCommit,
  onReveal,
  onChoose,
  onAction,
}: {
  source: "text" | "file" | "folder";
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
  fileName: string | null;
  onClose: () => void;
  onSource: (source: "text" | "file" | "folder") => void;
  onText: (text: string) => void;
  onPreview: () => void;
  onChooseFile: () => void;
  onDropFile: (file: File) => void;
  onClearFile: () => void;
  folder: FolderImportControls;
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

  const inputFocusId = {
    file: "importChooseFileBtn",
    folder: "importChooseFolderBtn",
    text: "importText",
  }[source];
  const initialFocusId = handle ? "importBackBtn" : inputFocusId;
  const busyCancelLabel = committing
    ? "project.importReview.closeDuringCommit"
    : "project.importReview.cancelRequest";

  return (
    <ModalFrame
      id="importModalOverlay"
      className="max-w-[760px]"
      initialFocusId={initialFocusId}
      onClose={onClose}
    >
      <div className="mb-4">
        <ModalTitle>{t("project.importReview.title")}</ModalTitle>
        <p className="text-muted-foreground mt-1 text-xs" id="importSub">
          {t("project.importReview.subtitle")}
        </p>
        {handle && source === "folder" && fileName && (
          <p className="text-foreground mt-2 font-mono text-xs break-all">
            {t("project.folderImport.reviewing", { path: fileName })}
          </p>
        )}
      </div>
      {!handle && (
        <ImportInputSection
          source={source}
          text={text}
          targetText={targetText}
          diagnostics={diagnostics}
          busy={busy}
          fileName={fileName}
          onSource={onSource}
          onText={onText}
          onChooseFile={onChooseFile}
          onDropFile={onDropFile}
          onClearFile={onClearFile}
          folder={folder}
        />
      )}
      {handle && (
        <ImportReviewSection
          targetText={targetText}
          counts={counts}
          rows={rows}
          reveals={reveals}
          diagnostics={diagnostics}
          busy={busy}
          onReveal={onReveal}
          onChoose={onChoose}
          onAction={onAction}
        />
      )}
      <div className="border-border mt-6 flex justify-end gap-2 border-t pt-4">
        <Button
          variant="secondary"
          type="button"
          id="importCancelBtn"
          disabled={committing}
          onClick={onClose}
        >
          {t(busy ? busyCancelLabel : "common.cancel")}
        </Button>
        {handle && (
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
        )}
        {!handle && source !== "folder" && (
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
