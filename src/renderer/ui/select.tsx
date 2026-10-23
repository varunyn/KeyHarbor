import * as SelectPrimitive from "@radix-ui/react-select";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up.mjs";
import type { ComponentProps } from "react";

import { cn } from "./utils";

export interface SelectOption<Value extends string> {
  value: Value;
  label: string;
  disabled?: boolean;
  id?: string;
}

type SelectProps<Value extends string> = Omit<
  ComponentProps<typeof SelectPrimitive.Trigger>,
  "children" | "value" | "defaultValue" | "onChange"
> & {
  value: Value | "";
  onValueChange: (value: Value) => void;
  options: readonly SelectOption<Value>[];
  placeholder?: string;
};

export const Select = <Value extends string>({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  className,
  name,
  ...props
}: SelectProps<Value>) => (
  <SelectPrimitive.Root
    value={value}
    name={name}
    disabled={disabled || options.length === 0}
    onValueChange={(selected) => {
      const option = options.find((entry) => entry.value === selected);
      if (option && !option.disabled) {
        onValueChange(option.value);
      }
    }}
  >
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "border-input bg-background text-foreground focus-visible:ring-ring data-[placeholder]:text-muted-foreground inline-flex h-8 max-w-full min-w-24 items-center justify-between gap-3 rounded-lg border px-3 text-xs shadow-xs outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SelectPrimitive.Value
        data-slot="select-value"
        className="truncate"
        placeholder={placeholder}
      />
      <SelectPrimitive.Icon asChild>
        <ChevronDown
          aria-hidden="true"
          className="text-muted-foreground size-3.5 shrink-0"
        />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position="popper"
        align="start"
        sideOffset={4}
        className="border-border bg-popover text-popover-foreground z-[750] max-h-[var(--radix-select-content-available-height)] max-w-[calc(100vw-24px)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border p-1 shadow-lg"
      >
        <SelectPrimitive.ScrollUpButton className="text-muted-foreground flex justify-center py-1">
          <ChevronUp aria-hidden="true" className="size-3.5" />
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport>
          {options.map((option) => (
            <SelectPrimitive.Item
              key={option.value}
              id={option.id}
              value={option.value}
              disabled={option.disabled}
              title={option.label}
              className="focus:bg-accent focus:text-accent-foreground relative flex min-h-8 cursor-pointer items-center rounded-md py-1.5 pr-8 pl-2 text-xs outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
            >
              <SelectPrimitive.ItemText className="min-w-0 flex-1 truncate">
                {option.label}
              </SelectPrimitive.ItemText>
              <SelectPrimitive.ItemIndicator className="absolute right-2 flex items-center">
                <Check aria-hidden="true" className="size-3.5" />
              </SelectPrimitive.ItemIndicator>
            </SelectPrimitive.Item>
          ))}
        </SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="text-muted-foreground flex justify-center py-1">
          <ChevronDown aria-hidden="true" className="size-3.5" />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  </SelectPrimitive.Root>
);
