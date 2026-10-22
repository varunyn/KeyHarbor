import {
  Activity,
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronDown,
  Clipboard,
  Clock,
  Download,
  Eye,
  FileText,
  Folder,
  Key,
  LayoutGrid,
  List,
  Lock,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Star,
  Upload,
  X,
} from "lucide-react";

import { cn } from "../renderer/ui/utils";

const icons = {
  activity: Activity,
  "arrow-left": ArrowLeft,
  check: Check,
  "chevron-down": ChevronDown,
  "circle-alert": AlertCircle,
  clipboard: Clipboard,
  clock: Clock,
  download: Download,
  ellipsis: MoreHorizontal,
  eye: Eye,
  "file-text": FileText,
  folder: Folder,
  key: Key,
  "layout-grid": LayoutGrid,
  list: List,
  lock: Lock,
  plus: Plus,
  search: Search,
  settings: Settings,
  "sliders-horizontal": SlidersHorizontal,
  star: Star,
  upload: Upload,
  x: X,
};

const isIconName = (name: string): name is keyof typeof icons =>
  Object.hasOwn(icons, name);

export const Icon = ({
  name,
  className,
}: {
  name: string;
  className?: string;
}) => {
  const classes = cn("inline-block size-4 shrink-0 align-middle", className);
  if (!isIconName(name)) {
    return (
      <span
        className={cn("lk-icon", `lk-icon-${name}`, classes)}
        aria-hidden="true"
      />
    );
  }
  const IconComponent = icons[name];
  return <IconComponent className={classes} aria-hidden="true" />;
};
