import { i18n } from "../renderer/i18n";
import { cn } from "../renderer/ui/utils";
import { ICON_MAP, isIconName } from "./icon-registry";

export const t = (key: string, vars?: Record<string, string | number>) =>
  i18n.t(key, vars);

export const Icon = ({
  name,
  className = "",
}: {
  name: string;
  className?: string;
}) => {
  const Comp = isIconName(name) ? ICON_MAP[name] : undefined;
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

export const MONOGRAM_TONES = [
  "bg-sky-500/15 text-sky-400 border border-sky-500/30",
  "bg-success/15 text-success border border-success/30",
  "bg-warning/15 text-warning border border-warning/30",
  "bg-purple-500/15 text-purple-400 border border-purple-500/30",
  "bg-teal-500/15 text-teal-400 border border-teal-500/30",
  "bg-muted text-muted-foreground border border-border",
];

export const monogram = (name: string) => {
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

export const formatDate = (value: string | undefined, now: number) => {
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

export const formatAccessTime = (timestamp: number, now: number) => {
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

export const isToday = (value?: string) => {
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
