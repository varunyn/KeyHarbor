import React from "react";

import { mountRenderer } from "../renderer/mount";
import { RendererProviders } from "../renderer/providers";
import { LogsScreen } from "../renderer/screens";

const mount = document.querySelector<HTMLElement>("#logs-root");
if (!mount) {
  throw new Error("Missing logs root element");
}
mountRenderer(
  mount,
  <RendererProviders>
    <LogsScreen />
  </RendererProviders>
);
