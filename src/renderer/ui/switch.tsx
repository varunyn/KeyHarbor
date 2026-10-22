import * as SwitchPrimitives from "@radix-ui/react-switch";
import * as React from "react";

import { cn } from "./utils";

const Switch = ({
  ref,
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root> & {
  ref?: React.Ref<React.ElementRef<typeof SwitchPrimitives.Root>>;
}) => (
  <SwitchPrimitives.Root
    data-slot="switch"
    className={cn(
      "focus-visible:ring-ring focus-visible:ring-offset-background data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=unchecked]:border-border data-[state=unchecked]:bg-secondary inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    ref={ref}
    {...props}
  >
    <SwitchPrimitives.Thumb
      data-slot="switch-thumb"
      className={cn(
        "pointer-events-none block size-5 rounded-full bg-white shadow-sm ring-1 ring-black/10 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0.5"
      )}
    />
  </SwitchPrimitives.Root>
);
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
