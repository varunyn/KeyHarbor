import { Command as CommandPrimitive } from "cmdk";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import type { ComponentProps } from "react";

import { cn } from "./utils";

export { Command } from "cmdk";
export const CommandInput = ({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Input>) => (
  <div className="border-border/60 mx-1 mb-1 flex items-center gap-2 border-b px-2">
    <Search
      aria-hidden="true"
      className="text-muted-foreground size-3.5 shrink-0"
    />
    <CommandPrimitive.Input
      className={cn(
        "text-foreground placeholder:text-muted-foreground h-[36px] min-w-0 flex-1 border-0 bg-transparent text-[13px] outline-none focus:shadow-none!",
        className
      )}
      {...props}
    />
  </div>
);
export const CommandList = ({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.List>) => (
  <CommandPrimitive.List
    className={cn(
      "max-h-[256px] overflow-x-hidden overflow-y-auto p-0.5",
      className
    )}
    {...props}
  />
);
export const CommandItem = ({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Item>) => (
  <CommandPrimitive.Item
    className={cn(
      "text-foreground data-[selected=true]:bg-secondary flex min-h-[32px] cursor-pointer items-center gap-2.5 rounded-md px-2 text-[13px] outline-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
      className
    )}
    {...props}
  />
);
export const CommandEmpty = ({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Empty>) => (
  <CommandPrimitive.Empty
    className={cn(
      "text-muted-foreground px-3 py-6 text-center text-[13px]",
      className
    )}
    {...props}
  />
);
