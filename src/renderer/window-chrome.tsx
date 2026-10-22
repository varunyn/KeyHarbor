import type { ReactNode } from "react";

import type { ThemeChangePayload } from "../project/bridge";
import { cn } from "./ui/utils";

export const nativeWindowStyles = {
  canvas: "in-[.mac-native-window]:bg-transparent",
  inspector:
    "in-[.mac-native-window]:bg-card in-[.mac-native-window]:max-[1100px]:top-[48px] in-[.mac-native-window]:max-[1100px]:h-[calc(100dvh-48px)]",
  selectedNavigation:
    "in-[.mac-native-window]:bg-secondary in-[.mac-native-window]:text-foreground",
  sidebar:
    "in-[.mac-native-window]:bg-background/90 in-[.mac-opaque-window]:bg-card in-[.mac-native-window]:motion-reduce:transition-none in-[.mac-native-window]:max-[860px]:top-[48px] in-[.mac-native-window]:max-[860px]:h-[calc(100dvh-48px)] in-[.mac-native-window]:max-[860px]:bg-card",
  toolbar:
    "in-[.mac-native-window]:bg-background in-[.mac-native-window]:backdrop-blur-none",
} as const;

export const WindowChrome = ({
  children,
  material,
}: {
  children: ReactNode;
  material: ThemeChangePayload["macWindowMaterial"];
}) => {
  if (!material) {
    return children;
  }
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header
        aria-hidden="true"
        className={cn(
          "bg-background/90 text-foreground in-[.window-blurred]:text-muted-foreground flex h-[48px] shrink-0 items-center justify-center px-24 text-[13px] font-semibold select-none [-webkit-app-region:drag]",
          material === "opaque" && "bg-card"
        )}
      >
        KeyHarbor
      </header>
      <div className="[&>main]:bg-background min-h-0 flex-1 [&>.h-dvh]:h-full [&>.h-screen]:h-full">
        {children}
      </div>
    </div>
  );
};
