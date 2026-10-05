import * as React from "react";

import { cn } from "./utils";

const Input = ({
  ref,
  className,
  type,
  ...props
}: React.ComponentProps<"input"> & { ref?: React.Ref<HTMLInputElement> }) => (
  <input
    data-slot="input"
    type={type}
    className={cn(
      "border-input bg-background file:bg-background file:text-foreground placeholder:text-muted-foreground focus-visible:ring-ring flex h-9 w-full rounded-lg border px-3 py-1 text-[13px] transition-colors file:border-0 file:text-sm file:font-medium focus-visible:ring-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    ref={ref}
    {...props}
  />
);
Input.displayName = "Input";

export { Input };
