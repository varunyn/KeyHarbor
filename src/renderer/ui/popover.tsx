import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ComponentProps } from "react";

import { cn } from "./utils";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverContent = ({
  className,
  align = "start",
  sideOffset = 6,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      align={align}
      sideOffset={sideOffset}
      data-slot="popover-content"
      className={cn(
        "bg-popover text-popover-foreground border-border z-[650] w-[280px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border p-1 shadow-lg outline-none",
        className
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
);
