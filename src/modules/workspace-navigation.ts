import type { WebContents } from "electron";

/** Keep one native zoom level while the workspace navigates between local pages. */
export const configureWorkspaceNavigation = (
  contents: WebContents,
  openExternal: (url: string) => void
) => {
  // Electron 44 retains isolated zoom across navigation instead of restoring
  // Chromium's separate per-origin scales for the file-backed renderer pages.
  contents.setZoomMode("isolated");
  contents.setZoomLevel(0);

  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (url.startsWith("file://")) {
      return;
    }
    event.preventDefault();
    openExternal(url);
  });
};
