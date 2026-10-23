import type { ReactNode } from "react";

import { nativeWindowStyles } from "../window-chrome";
import { cn } from "./utils";

export const topBarClass = cn(
  "border-border/60 bg-background/80 flex h-16 shrink-0 items-center justify-between gap-3 border-b px-6 backdrop-blur-xs",
  nativeWindowStyles.toolbar
);

export const crumbsClass =
  "text-muted-foreground flex min-w-0 flex-1 items-center gap-2 text-[13px]";

export const crumbSeparatorClass = "opacity-40";

export const CrumbSeparator = () => (
  <span aria-hidden="true" className={crumbSeparatorClass}>
    /
  </span>
);

export const AppTopBar = ({
  left,
  center,
  right,
  className,
  id,
  ariaLabel,
}: {
  left: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  className?: string;
  id?: string;
  ariaLabel?: string;
}) => (
  <header className={cn(topBarClass, className)} id={id} aria-label={ariaLabel}>
    <div className="flex min-w-0 flex-1 items-center gap-3">{left}</div>
    {center ? (
      <div className="relative mx-auto w-full max-w-[420px] min-w-[120px] flex-1">
        {center}
      </div>
    ) : null}
    {right ? (
      <div className="flex shrink-0 items-center gap-2">{right}</div>
    ) : null}
  </header>
);
