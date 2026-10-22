import {
  Activity,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Clipboard,
  Clock,
  Download,
  Eye,
  FileText,
  Folder,
  Key,
  LayoutGrid,
  List,
  Lock,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Star,
  Upload,
  X,
} from "lucide-react";
import React, { useEffect, useRef, useState } from "react";

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
  ConfigurationChanges,
  ConfigurationEntry,
  ImportOccurrence,
  ImportPreviewEntry,
  ReviewTarget,
  SecretHistory,
  SecretRecord,
} from "./bridge";

type Status = "config" | "expired" | "rotate" | "healthy";
const t = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars);

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  activity: Activity,
  "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight,
  check: Check,
  "chevron-down": ChevronDown,
  "circle-alert": AlertCircle,
  clipboard: Clipboard,
  clock: Clock,
  download: Download,
  ellipsis: MoreHorizontal,
  eye: Eye,
  "file-text": FileText,
  folder: Folder,
  key: Key,
  "layout-grid": LayoutGrid,
  list: List,
  lock: Lock,
  plus: Plus,
  search: Search,
  settings: Settings,
  "sliders-horizontal": SlidersHorizontal,
  star: Star,
  upload: Upload,
  x: X,
};

export const Icon = ({
  name,
  className = "size-4",
}: {
  name: string;
  className?: string;
}) => {
  const IconComponent = ICON_MAP[name];
  if (!IconComponent) {
    return <span className={`lk-icon lk-icon-${name}`} aria-hidden="true" />;
  }
  return <IconComponent className={className} aria-hidden="true" />;
};

const PILL_STYLES: Record<Status, string> = {
  config: "bg-muted text-muted-foreground border-border",
  expired: "bg-rose-500/15 text-rose-400 border-rose-500/20",
  healthy: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  rotate: "bg-amber-500/15 text-amber-400 border-amber-500/20",
};

export const Pill = ({ status }: { status: Status }) => (
  <span
    className={cn(
      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
      PILL_STYLES[status]
    )}
  >
    <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
    {t(`project.status.${status === "rotate" ? "rotateSoon" : status}`)}
  </span>
);

export const ModalTitle = ({ children }: { children: React.ReactNode }) => (
  <DialogTitle className="text-foreground text-base font-semibold tracking-tight">
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
          "lk-ui-theme bg-card border-border block max-h-[min(88dvh,760px)] max-w-[500px] overflow-y-auto rounded-2xl border p-6 shadow-xl",
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

const useNow = (active: boolean) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
};

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
      className="secrets-table-wrap min-h-0 flex-1 overflow-y-auto px-6 py-4"
      id="tableWrap"
    >
      <table
        className="secrets-table w-full border-collapse text-xs"
        id="secretsTable"
        aria-label={t("project.a11y.tableLabel")}
        style={{ display: showRows ? "" : "none" }}
      >
        <thead className="bg-background/95 border-border sticky top-0 z-10 border-b backdrop-blur-xs">
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
                <td className="px-3 py-3">
                  <div className="flex items-center gap-3">
                    <span className="bg-secondary/80 border-border text-primary flex size-8 shrink-0 items-center justify-center rounded-lg border">
                      <Icon
                        name={entry.type === "secret" ? "lock" : "file-text"}
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className="text-foreground truncate font-mono font-semibold"
                          title={entry.key}
                        >
                          {entry.key}
                        </span>
                        <span className="bg-secondary text-muted-foreground rounded px-1.5 py-0.5 font-mono text-[10px] uppercase">
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
                              className="text-primary/80 text-[10px]"
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
                        favorite && "text-amber-400 opacity-100"
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
                        className={cn("size-3.5", favorite && "fill-amber-400")}
                      />
                    </Button>
                  </div>
                </td>
                <td className="px-3 py-3">
                  <span className="text-muted-foreground block max-w-[240px] truncate font-mono">
                    {masked}
                  </span>
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <Pill status={entry.status} />
                </td>
                <td
                  className="text-muted-foreground px-3 py-3 font-mono whitespace-nowrap"
                  title={fmtDate(entry.updatedAt)}
                >
                  {relative(entry.updatedAt)}
                </td>
                <td className="px-3 py-3 text-right">
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
                    <DropdownMenu
                      open={menu === rowMenu}
                      onOpenChange={(open) => {
                        onMenu(entry.key, open);
                      }}
                    >
                      <DropdownMenuTrigger asChild>
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
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        className="bg-card border-border min-w-[140px] rounded-xl border p-1 shadow-xl"
                        side="bottom"
                        align="end"
                      >
                        <DropdownMenuItem
                          className="hover:bg-secondary flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs"
                          data-act="edit"
                          onSelect={() => onEdit(entry.key)}
                        >
                          {t("project.edit")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="hover:bg-secondary flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs"
                          data-act="history"
                          onSelect={() => onHistory(entry.key)}
                        >
                          {t("project.viewHistory")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="border-border my-1 border-t" />
                        <DropdownMenuItem
                          className="text-destructive hover:bg-destructive/10 flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs"
                          data-act="delete"
                          onSelect={() => onDelete(entry.key)}
                        >
                          {t("project.deleteSecret")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
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
            className="text-foreground bg-secondary/50 border-border/50 flex min-h-[48px] items-center rounded-lg border p-3 font-mono text-xs break-all select-text"
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
              className="font-mono text-xs text-amber-400"
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
                className="bg-secondary border-border text-primary rounded-full border px-2 py-0.5 font-mono text-[11px]"
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
        className="block rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-400"
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
        className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-2.5 text-xs text-amber-400"
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
            className="bg-secondary text-muted-foreground rounded-md px-2 py-0.5 font-mono text-[11px]"
            data-status={entry.status}
          >
            {t(`project.configuration.status.${entry.status.toLowerCase()}`)}
          </span>
        </li>
      ))}
    </ul>
    {draft.message && (
      <output
        className="block rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-400"
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
        className="block rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-400"
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
}: {
  source: "text" | "file";
  text: string;
  targetText: string;
  diagnostics: string[];
  busy: boolean;
  fileName: string | null;
  onSource: (source: "text" | "file") => void;
  onText: (text: string) => void;
  onChooseFile: () => void;
  onDropFile: (file: File) => void;
  onClearFile: () => void;
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
      </section>
      {source === "text" ? (
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
      ) : (
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
                className="h-6 shrink-0 px-2 text-[11px]"
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

const ImportActionPicker = ({
  actions,
  chosenAction,
  busy,
  rowKey,
  occurrenceId,
  onAction,
}: {
  actions: string[];
  chosenAction: string;
  busy: boolean;
  rowKey: string;
  occurrenceId: string;
  onAction: (
    key: string,
    occurrenceId: string,
    action: ImportChoice["action"]
  ) => void;
}) => {
  if (actions.length <= 1) {
    return (
      <span className="text-muted-foreground px-1 text-[11px]">
        {t("project.importReview.action.skip")}
      </span>
    );
  }
  const current = chosenAction === "keep" ? "skip" : chosenAction;
  return (
    <fieldset className="border-border m-0 flex min-w-0 items-center gap-0.5 rounded-md border p-0.5">
      <legend className="sr-only">
        {t("project.importReview.actionForKey", { key: rowKey })}
      </legend>
      {actions.map((action) => {
        const value = action === "keep" ? "skip" : action;
        return (
          <button
            key={action}
            type="button"
            disabled={busy}
            aria-pressed={current === value}
            onClick={() =>
              onAction(rowKey, occurrenceId, value as ImportChoice["action"])
            }
            className={cn(
              "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
              current === value
                ? "bg-secondary text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t(`project.importReview.action.${action}`)}
          </button>
        );
      })}
    </fieldset>
  );
};

const ImportOccurrenceRow = ({
  row,
  index,
  occurrence,
  occurrenceIndex,
  reveal,
  busy,
  selected,
  onReveal,
  onChoose,
  onAction,
}: {
  row: ImportRow;
  index: number;
  occurrence: ImportOccurrence;
  occurrenceIndex: number;
  reveal: ImportReveal | undefined;
  busy: boolean;
  selected: boolean;
  onReveal: (entry: ImportRow, occurrence: ImportOccurrence) => void;
  onChoose: (key: string, occurrenceId: string | null) => void;
  onAction: (
    key: string,
    occurrenceId: string,
    action: ImportChoice["action"]
  ) => void;
}) => {
  const now = useNow(Boolean(reveal));
  let actions: string[];
  let tone: Status;
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
    if (chosenAction === "skip" && occurrence.status === "changed") {
      chosenAction = "keep";
    }
  }

  let displayedValue: string;
  if (occurrence.empty) {
    displayedValue = t("project.importReview.emptyValue");
  } else if (reveal?.value) {
    displayedValue = reveal.value;
  } else {
    displayedValue = "••••••••";
  }

  return (
    <div
      className="bg-secondary/30 flex flex-wrap items-center gap-3 rounded-lg p-2 text-xs"
      data-occurrence={occurrenceIndex}
      key={occurrence.id}
    >
      {row.duplicate ? (
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="radio"
            name={`import-${index}`}
            checked={selected}
            onChange={() => onChoose(row.key, occurrence.id)}
            aria-label={t("project.importReview.occurrenceLabel", {
              line: occurrence.line,
            })}
          />
          <span className="text-muted-foreground font-mono">
            {t("project.importReview.lineNumber", {
              line: occurrence.line,
            })}
          </span>
        </label>
      ) : (
        <span className="text-muted-foreground font-mono">
          {t("project.importReview.lineNumber", {
            line: occurrence.line,
          })}
        </span>
      )}
      <span className="text-foreground flex-1 truncate font-mono">
        {displayedValue}
      </span>
      <Pill status={tone} />
      <Button
        variant="ghost"
        size="sm"
        type="button"
        className="h-6 px-2 text-[11px]"
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
              seconds: Math.max(0, Math.ceil((reveal.expiresAt - now) / 1000)),
            })
          : t("project.importReview.reveal")}
      </Button>
      {row.duplicate && !selected ? null : (
        <ImportActionPicker
          actions={actions}
          chosenAction={chosenAction}
          busy={busy}
          rowKey={row.key}
          occurrenceId={occurrence.id}
          onAction={onAction}
        />
      )}
    </div>
  );
};

const ImportReviewSection = ({
  targetText,
  counts,
  rows,
  reveals,
  diagnostics,
  busy,
  onReveal,
  onChoose,
  onAction,
}: {
  targetText: string;
  counts: { add: number; replace: number; skip: number; pending: number };
  rows: ImportRow[];
  reveals: Record<string, ImportReveal>;
  diagnostics: string[];
  busy: boolean;
  onReveal: (entry: ImportRow, occurrence: ImportOccurrence) => void;
  onChoose: (key: string, occurrenceId: string | null) => void;
  onAction: (
    key: string,
    occurrenceId: string,
    action: ImportChoice["action"]
  ) => void;
}) => (
  <section
    id="importReviewStep"
    className="space-y-4"
    aria-labelledby="importReviewHeading"
  >
    <h3
      id="importReviewHeading"
      className="text-muted-foreground text-xs font-semibold tracking-wider uppercase"
    >
      {t("project.importReview.reviewHeading")}
    </h3>
    <div
      className="text-muted-foreground bg-secondary/50 border-border/50 rounded-lg border p-2.5 font-mono text-xs"
      id="importReviewTarget"
    >
      {targetText}
    </div>
    <p
      className="text-foreground text-xs font-medium"
      id="importSummary"
      aria-live="polite"
    >
      {t("project.importReview.summary", counts)}
    </p>
    <div
      className="border-border divide-border/40 bg-card max-h-[320px] divide-y overflow-y-auto rounded-xl border"
      id="importList"
      aria-label={t("project.importReview.reviewListLabel")}
    >
      {rows.map((row, index) => (
        <article
          className="space-y-2 p-3 text-xs"
          data-entry={index}
          key={row.key}
        >
          <div className="flex items-center justify-between">
            <code className="text-foreground font-mono font-semibold">
              {row.key}
            </code>
            {row.duplicate && (
              <span className="font-mono text-[10px] text-amber-400">
                {t("project.importReview.duplicateOccurrences", {
                  count: row.occurrences.length,
                })}
              </span>
            )}
          </div>
          <div className="space-y-1.5">
            {row.occurrences.map((occurrence, occurrenceIndex) => {
              const revealKey = `${row.key}:${occurrence.id}`;
              const reveal = reveals[revealKey];
              const selected = row.choice?.occurrenceId === occurrence.id;
              return (
                <ImportOccurrenceRow
                  key={occurrence.id}
                  row={row}
                  index={index}
                  occurrence={occurrence}
                  occurrenceIndex={occurrenceIndex}
                  reveal={reveal}
                  busy={busy}
                  selected={selected}
                  onReveal={onReveal}
                  onChoose={onChoose}
                  onAction={onAction}
                />
              );
            })}
            {row.duplicate && (
              <label className="text-muted-foreground flex cursor-pointer items-center gap-1.5 pt-1 text-xs">
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
    </div>
    {diagnostics.length > 0 && (
      <div
        className="bg-destructive/10 border-destructive/20 text-destructive space-y-1 rounded-lg border p-3 text-xs"
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
);

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
  fileName: string | null;
  onClose: () => void;
  onSource: (source: "text" | "file") => void;
  onText: (text: string) => void;
  onPreview: () => void;
  onChooseFile: () => void;
  onDropFile: (file: File) => void;
  onClearFile: () => void;
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
      className="max-w-[760px]"
      initialFocusId={initialFocusId}
      onClose={onClose}
    >
      <div className="mb-4">
        <ModalTitle>{t("project.importReview.title")}</ModalTitle>
        <p className="text-muted-foreground mt-1 text-xs" id="importSub">
          {t("project.importReview.subtitle")}
        </p>
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
