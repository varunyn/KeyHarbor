import {
  Activity,
  AlertCircle,
  ArrowRight,
  ChevronDown,
  Clock,
  Database,
  Download,
  Folder,
  Key,
  LayoutGrid,
  List,
  Lock,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Star,
} from "lucide-react";
import type { ComponentType } from "react";

interface IconProps {
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}

export const ICON_MAP = {
  activity: Activity,
  "arrow-right": ArrowRight,
  "chevron-down": ChevronDown,
  "circle-alert": AlertCircle,
  clock: Clock,
  download: Download,
  ellipsis: MoreHorizontal,
  folder: Folder,
  grid: LayoutGrid,
  key: Key,
  list: List,
  lock: Lock,
  plus: Plus,
  search: Search,
  settings: Settings,
  star: Star,
  vault: Database,
} satisfies Record<string, ComponentType<IconProps>>;

export const isIconName = (name: string): name is keyof typeof ICON_MAP =>
  Object.hasOwn(ICON_MAP, name);

export const TONE_CLASSES = {
  "text-destructive": "text-destructive",
  "text-warning": "text-warning",
  "tone-amber": "text-warning",
  "tone-red": "text-destructive",
} satisfies Record<string, string>;

export const isToneName = (tone: string): tone is keyof typeof TONE_CLASSES =>
  Object.hasOwn(TONE_CLASSES, tone);
