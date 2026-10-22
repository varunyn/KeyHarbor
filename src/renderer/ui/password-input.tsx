import { Eye, EyeOff } from "lucide-react";
import * as React from "react";

import { cn } from "./utils";

export interface PasswordInputProps extends Omit<
  React.ComponentProps<"input">,
  "type"
> {
  ref?: React.Ref<HTMLInputElement>;
  showToggle?: boolean;
}

const PasswordInput = ({
  ref,
  className,
  showToggle = true,
  disabled,
  ...props
}: PasswordInputProps) => {
  const [visible, setVisible] = React.useState(false);

  return (
    <div className="relative flex w-full items-center">
      <input
        data-slot="input"
        type={visible ? "text" : "password"}
        className={cn(
          "border-input bg-background file:bg-background file:text-foreground placeholder:text-muted-foreground focus-visible:ring-ring flex h-9 w-full rounded-lg border px-3 py-1 text-[13px] transition-colors file:border-0 file:text-sm file:font-medium focus-visible:ring-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
          showToggle ? "pr-9" : "",
          className
        )}
        ref={ref}
        disabled={disabled}
        {...props}
      />
      {showToggle ? (
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={() => setVisible((prev) => !prev)}
          className="text-muted-foreground hover:text-foreground absolute right-2.5 flex size-5 items-center justify-center rounded transition-colors focus:outline-none disabled:opacity-50"
          aria-label={visible ? "Hide password" : "Show password"}
        >
          {visible ? (
            <EyeOff className="size-3.5" aria-hidden="true" />
          ) : (
            <Eye className="size-3.5" aria-hidden="true" />
          )}
        </button>
      ) : null}
    </div>
  );
};
PasswordInput.displayName = "PasswordInput";

export { PasswordInput };
