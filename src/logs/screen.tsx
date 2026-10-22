import {
  ChevronDown,
  ClipboardList,
  Download,
  Loader2,
  MoreHorizontal,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect } from "react";

import { useRendererTranslation } from "../renderer/providers";
import { Button } from "../renderer/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../renderer/ui/dropdown-menu";
import { Input } from "../renderer/ui/input";
import { cn } from "../renderer/ui/utils";
import { WorkspaceShell } from "../renderer/workspace-shell";
import { useLogs } from "./use-logs";

const categoryBadgeClasses = new Map([
  ["access", "bg-success/15 text-success"],
  ["app", "bg-secondary text-muted-foreground"],
  ["error", "bg-destructive/15 text-destructive"],
  ["info", "bg-secondary text-muted-foreground"],
  ["lock", "bg-warning/15 text-warning"],
  ["warning", "bg-warning/15 text-warning"],
]);

export const LogsScreen = () => {
  const { t } = useRendererTranslation();
  const {
    ago,
    busy,
    category,
    clearLogs,
    confirmationDialog,
    container,
    exportLogs,
    failure,
    filtered,
    load,
    loaded,
    loadMore,
    logs,
    search,
    setCategory,
    setSearch,
    setVisibleCount,
    visibleCount,
  } = useLogs();
  useEffect(() => {
    document.title = `KeyHarbor — ${t("logs.title")}`;
  }, [t]);
  return (
    <WorkspaceShell
      activePage="activity"
      title={t("logs.title")}
      searchInputId="logs-search"
      actions={
        <>
          <Button
            variant="secondary"
            size="sm"
            id="export-logs-btn"
            disabled={busy}
            onClick={() => {
              void exportLogs();
            }}
            className="h-10 gap-2 px-4 text-[13px]"
          >
            <Download className="size-4" aria-hidden="true" />
            {t("logs.export")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                size="icon"
                className="size-10"
                aria-label={t("dashboard.a11y.menuLabel")}
                title={t("dashboard.a11y.menuLabel")}
                disabled={busy}
              >
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="bg-card border-border min-w-[180px] rounded-xl border p-1.5 shadow-xl"
            >
              <DropdownMenuItem
                id="clear-logs-btn"
                className="text-destructive focus:text-destructive"
                disabled={busy}
                onSelect={() => {
                  void clearLogs();
                }}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                {t("logs.clearAll")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col px-6 pt-6 pb-4 lg:px-8">
        <div className="mb-5 shrink-0 space-y-1">
          <h1
            id="title"
            className="text-foreground text-2xl font-semibold tracking-tight"
          >
            {t("logs.title")}
          </h1>
          <p className="text-muted-foreground text-xs">
            {t("logs.description")}
          </p>
        </div>
        <div className="mb-4 flex shrink-0 flex-wrap items-center gap-3">
          <div className="relative max-w-[420px] min-w-[180px] flex-1">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              id="logs-search"
              aria-label={t("logs.searchPlaceholder")}
              className="bg-secondary/40 h-10 pl-9 text-[13px]"
              type="search"
              placeholder={t("logs.searchPlaceholder")}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setVisibleCount(50);
              }}
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                id="category-filter"
                variant="secondary"
                size="sm"
                className="h-10 min-w-[120px] justify-between gap-3 px-3 text-[13px]"
                aria-label={`${t("logs.filterLabel")}: ${t(`logs.categories.${category}`)}`}
                title={t("logs.filterLabel")}
              >
                <span>{t(`logs.categories.${category}`)}</span>
                <ChevronDown
                  className="text-muted-foreground size-3.5"
                  aria-hidden="true"
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="bg-card border-border min-w-[180px] rounded-xl border p-1.5 shadow-xl"
            >
              <DropdownMenuRadioGroup
                value={category}
                aria-label={t("logs.filterLabel")}
                onValueChange={(value) => {
                  setCategory(value);
                  setVisibleCount(50);
                }}
              >
                {(["all", "access", "app", "lock"] as const).map((value) => (
                  <DropdownMenuRadioItem
                    key={value}
                    value={value}
                    className="cursor-pointer py-2 pr-2.5 pl-8 text-[13px]"
                  >
                    {t(`logs.categories.${value}`)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div
          ref={container}
          className="border-border bg-card min-h-0 flex-1 overflow-y-auto rounded-xl border"
          id="logs-container"
          onScroll={loadMore}
          aria-label={t("logs.title")}
          aria-busy={!loaded && !failure}
        >
          {!loaded && !failure && (
            <output className="flex h-40 items-center justify-center">
              <Loader2
                className="text-muted-foreground size-6 animate-spin"
                aria-hidden="true"
              />
              <span className="sr-only">{t("logs.loading")}</span>
            </output>
          )}
          {failure && (
            <div
              className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center"
              role="alert"
            >
              <p className="text-destructive text-sm font-semibold">
                {t("logs.notifications.failedToLoad")}
              </p>
              <Button
                variant="secondary"
                onClick={() => {
                  void load();
                }}
              >
                {t("common.retry")}
              </Button>
            </div>
          )}
          {loaded && !failure && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <ClipboardList
                className="text-muted-foreground mb-3 size-8"
                aria-hidden="true"
              />
              <h2 className="text-foreground text-sm font-semibold">
                {logs.length
                  ? t("logs.emptyState.noMatchesTitle")
                  : t("logs.emptyState.title")}
              </h2>
              <p className="text-muted-foreground mt-1 max-w-sm text-xs">
                {logs.length
                  ? t("logs.emptyState.noMatchesDescription")
                  : t("logs.emptyState.description")}
              </p>
            </div>
          )}
          {filtered.slice(0, visibleCount).map((log, index) => {
            const categoryKey = `logs.categories.${log.category.toLowerCase()}`;
            const categoryLabel = t(categoryKey);
            return (
              <article
                className="border-border/60 hover:bg-secondary/30 flex items-start gap-4 border-b px-4 py-3 last:border-b-0"
                key={`${log.timestamp}:${log.category}:${index}`}
              >
                <span
                  className={cn(
                    "mt-0.5 shrink-0 rounded px-2 py-0.5 text-[11px] font-medium",
                    categoryBadgeClasses.get(log.category.toLowerCase()) ??
                      "bg-secondary text-muted-foreground"
                  )}
                >
                  {categoryLabel === categoryKey ? log.category : categoryLabel}
                </span>
                <p className="text-foreground min-w-0 flex-1 text-[13px] leading-relaxed break-words select-text">
                  {log.message}
                </p>
                <time
                  className="text-muted-foreground mt-0.5 shrink-0 text-right text-xs tabular-nums"
                  dateTime={log.timestamp}
                  title={new Date(log.timestamp).toLocaleString()}
                >
                  {ago(log.timestamp)}
                </time>
              </article>
            );
          })}
        </div>
      </div>
      {confirmationDialog}
    </WorkspaceShell>
  );
};
