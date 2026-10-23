import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import type { ComponentProps } from "react";

import { cn } from "./utils";

export const Checkbox = ({
  className,
  ...props
}: ComponentProps<typeof CheckboxPrimitive.Root>) => (
  <CheckboxPrimitive.Root
    data-slot="checkbox"
    className={cn(
      "peer border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground size-4 shrink-0 rounded-[4px] border bg-transparent p-0 shadow-xs transition-shadow outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      data-slot="checkbox-indicator"
      className="grid place-content-center text-current transition-none"
    >
      <Check className="size-3.5" aria-hidden="true" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
);
