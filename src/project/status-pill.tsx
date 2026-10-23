import { i18n } from "../renderer/i18n";
import { cn } from "../renderer/ui/utils";

export type Status = "config" | "expired" | "rotate" | "healthy";
const t = (key: string) => i18n.t(key);

const PILL_STYLES: Record<Status, string> = {
  config: "bg-muted text-muted-foreground border-border",
  expired: "bg-destructive/15 text-destructive border-destructive/20",
  healthy: "bg-success/15 text-success border-success/20",
  rotate: "bg-warning/15 text-warning border-warning/20",
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
