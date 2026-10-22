import type { ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { cn } from "./utils";

type ActionMenuItem =
  | { label: string; onSelect: () => void; destructive?: boolean }
  | { separator: true };
export const ActionMenu = ({
  children,
  items,
  open,
  onOpenChange,
}: {
  children: ReactNode;
  items: ActionMenuItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => (
  <DropdownMenu open={open} onOpenChange={onOpenChange}>
    <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="min-w-[160px]">
      {items.map((item, index) =>
        "separator" in item ? (
          <DropdownMenuSeparator key={`separator-${index}`} />
        ) : (
          <DropdownMenuItem
            key={item.label}
            className={cn(
              item.destructive && "text-destructive focus:text-destructive"
            )}
            onSelect={() => item.onSelect()}
          >
            {item.label}
          </DropdownMenuItem>
        )
      )}
    </DropdownMenuContent>
  </DropdownMenu>
);
