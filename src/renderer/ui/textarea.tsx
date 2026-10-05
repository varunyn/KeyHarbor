import * as React from "react";

import { cn } from "./utils";

const Textarea = ({
  ref,
  className,
  ...props
}: React.ComponentProps<"textarea"> & {
  ref?: React.Ref<HTMLTextAreaElement>;
}) => (
  <textarea
    data-slot="textarea"
    ref={ref}
    className={cn(
      "border-input bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-ring block min-h-16 w-full rounded-lg border px-3 py-2 text-[13px] leading-relaxed transition-colors focus-visible:ring-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
  />
);
Textarea.displayName = "Textarea";

export { Textarea };
