import React from "react";

import { mountRenderer } from "../renderer/mount";
import { RendererProviders } from "../renderer/providers";
import { SetupScreen } from "../renderer/screens";

const mount = document.querySelector<HTMLElement>("#setup-root");
if (!mount) {
  throw new Error("Missing setup root element");
}
mountRenderer(
  mount,
  <RendererProviders>
    <SetupScreen />
  </RendererProviders>
);
