import React from "react";

import { mountRenderer } from "../renderer/mount";
import { RendererProviders } from "../renderer/providers";
import { SettingsScreen } from "../renderer/screens";

const mount = document.querySelector<HTMLElement>("#settings-root");
if (!mount) {
  throw new Error("Missing settings root element");
}
mountRenderer(
  mount,
  <RendererProviders>
    <SettingsScreen />
  </RendererProviders>
);
