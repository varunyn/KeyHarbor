import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import Circle from "lucide-react/dist/esm/icons/circle.mjs";
import type { ComponentProps } from "react";

import { cn } from "./utils";

export const RadioGroup = ({
  className,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Root>) => (
  <RadioGroupPrimitive.Root
    data-slot="radio-group"
    className={cn("grid gap-3", className)}
    {...props}
  />
);

export const RadioGroupItem = ({
  className,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Item>) => (
  <RadioGroupPrimitive.Item
    data-slot="radio-group-item"
    className={cn(
      "border-input text-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive size-4 shrink-0 rounded-full border bg-transparent p-0 shadow-xs outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
  >
    <RadioGroupPrimitive.Indicator
      data-slot="radio-group-indicator"
      className="flex items-center justify-center"
    >
      <Circle aria-hidden="true" className="size-2 fill-current" />
    </RadioGroupPrimitive.Indicator>
  </RadioGroupPrimitive.Item>
);
