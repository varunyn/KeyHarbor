import { useEffect, useId, useState } from "react";

import { i18n } from "../renderer/i18n";
import { Button } from "../renderer/ui/button";
import { RadioGroup, RadioGroupItem } from "../renderer/ui/radio-group";
import { cn } from "../renderer/ui/utils";
import type { ImportOccurrence } from "./bridge";
import type { ImportChoice, ImportReveal, ImportRow } from "./components";
import { Pill } from "./status-pill";
import type { Status } from "./status-pill";

const t = (key: string, vars?: Record<string, string | number>) =>
  i18n.t(key, vars);
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

const ImportActionPicker = ({
  actions,
  chosenAction,
  busy,
  rowKey,
  occurrenceId,
  onAction,
}: {
  actions: (ImportChoice["action"] | "keep")[];
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
      <span className="text-muted-foreground px-1 text-xs">
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
          <Button
            variant="ghost"
            size="sm"
            key={action}
            type="button"
            disabled={busy}
            aria-pressed={current === value}
            onClick={() => onAction(rowKey, occurrenceId, value)}
            className={cn(
              "h-6 rounded px-2 py-0.5 text-xs font-medium transition-colors",
              current === value
                ? "bg-secondary text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t(`project.importReview.action.${action}`)}
          </Button>
        );
      })}
    </fieldset>
  );
};

const ImportOccurrenceRow = ({
  row,
  occurrence,
  occurrenceIndex,
  reveal,
  busy,
  selected,
  onReveal,
  onAction,
}: {
  row: ImportRow;
  occurrence: ImportOccurrence;
  occurrenceIndex: number;
  reveal: ImportReveal | undefined;
  busy: boolean;
  selected: boolean;
  onReveal: (entry: ImportRow, occurrence: ImportOccurrence) => void;
  onAction: (
    key: string,
    occurrenceId: string,
    action: ImportChoice["action"]
  ) => void;
}) => {
  const radioId = useId();
  const now = useNow(Boolean(reveal));
  let actions: (ImportChoice["action"] | "keep")[];
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
        <label
          htmlFor={radioId}
          className="flex cursor-pointer items-center gap-1.5"
        >
          <RadioGroupItem
            id={radioId}
            value={occurrence.id}
            disabled={busy}
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
        className="h-6 px-2 text-xs"
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

export const ImportReviewSection = ({
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
              <span className="text-warning font-mono text-[10px]">
                {t("project.importReview.duplicateOccurrences", {
                  count: row.occurrences.length,
                })}
              </span>
            )}
          </div>
          <div className="space-y-1.5">
            {row.duplicate ? (
              <RadioGroup
                value={
                  row.choice?.explicit
                    ? (row.choice.occurrenceId ?? "skip-key")
                    : ""
                }
                onValueChange={(value) =>
                  onChoose(row.key, value === "skip-key" ? null : value)
                }
                disabled={busy}
                aria-label={row.key}
                className="gap-1.5"
              >
                {row.occurrences.map((occurrence, occurrenceIndex) => {
                  const revealKey = `${row.key}:${occurrence.id}`;
                  const reveal = reveals[revealKey];
                  const selected = row.choice?.occurrenceId === occurrence.id;
                  return (
                    <ImportOccurrenceRow
                      key={occurrence.id}
                      row={row}
                      occurrence={occurrence}
                      occurrenceIndex={occurrenceIndex}
                      reveal={reveal}
                      busy={busy}
                      selected={selected}
                      onReveal={onReveal}
                      onAction={onAction}
                    />
                  );
                })}
                <label
                  htmlFor={`import-${index}-skip`}
                  className="text-muted-foreground flex cursor-pointer items-center gap-1.5 pt-1 text-xs"
                >
                  <RadioGroupItem
                    id={`import-${index}-skip`}
                    value="skip-key"
                    disabled={busy}
                    aria-label={t("project.importReview.excludeKey", {
                      key: row.key,
                    })}
                  />
                  {t("project.importReview.skipKey")}
                </label>
              </RadioGroup>
            ) : (
              row.occurrences.map((occurrence, occurrenceIndex) => {
                const revealKey = `${row.key}:${occurrence.id}`;
                const reveal = reveals[revealKey];
                return (
                  <ImportOccurrenceRow
                    key={occurrence.id}
                    row={row}
                    occurrence={occurrence}
                    occurrenceIndex={occurrenceIndex}
                    reveal={reveal}
                    busy={busy}
                    selected
                    onReveal={onReveal}
                    onAction={onAction}
                  />
                );
              })
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
