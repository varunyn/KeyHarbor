import { cn } from "./utils";

export const ProjectName = ({
  name,
  className,
  wrap = false,
  compact = false,
}: {
  name: string;
  className?: string;
  wrap?: boolean;
  compact?: boolean;
}) => {
  const separator = name.lastIndexOf(" → ");
  const parent = separator === -1 ? "" : name.slice(0, separator + 3);
  const leaf = separator === -1 ? name : name.slice(separator + 3);

  return (
    <span
      className={cn(
        "flex min-w-0 text-left",
        compact ? "flex-row items-baseline gap-1" : "flex-col",
        className
      )}
      title={name}
    >
      {parent && (
        <span className="text-muted-foreground truncate text-xs font-normal">
          {compact ? parent.slice(0, -3) : parent}
        </span>
      )}
      {compact && parent && (
        <span className="text-muted-foreground shrink-0 font-normal">→</span>
      )}
      <span
        className={cn(
          wrap ? "break-words whitespace-normal" : "truncate",
          compact && "max-w-[80%] shrink-0"
        )}
      >
        {leaf}
      </span>
    </span>
  );
};
