import React from "react";

import { mountRenderer } from "../renderer/mount";
import { RendererProviders } from "../renderer/providers";
import { LockScreen } from "../renderer/screens";

const mount = document.querySelector<HTMLElement>("#lock-root");
if (!mount) {
  throw new Error("Missing lock root element");
}
mountRenderer(
  mount,
  <RendererProviders>
    <LockScreen />
  </RendererProviders>
);
