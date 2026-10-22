import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { i18n } from "../i18n";
import { Button } from "./button";

export const SidebarToggle = ({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) => {
  const label = i18n.t(
    expanded ? "project.sidebar.collapse" : "project.sidebar.expand"
  );
  const Icon = expanded ? PanelLeftClose : PanelLeftOpen;
  return (
    <div className="border-border/60 mr-1 flex shrink-0 items-center border-r pr-3">
      <Button
        variant="ghost"
        size="icon"
        type="button"
        className="text-muted-foreground hover:text-foreground size-8 shrink-0"
        id="indexToggle"
        aria-label={label}
        title={label}
        aria-expanded={expanded}
        aria-controls="indexPanel"
        onClick={onToggle}
      >
        <Icon aria-hidden="true" />
      </Button>
    </div>
  );
};
