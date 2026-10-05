import React from "react";

import { mountRenderer } from "../renderer/mount";
import { RendererProviders } from "../renderer/providers";
import { ApprovalScreen } from "../renderer/screens";

const mount = document.querySelector<HTMLElement>("#approval-root");
if (!mount) {
  throw new Error("Missing approval root element");
}
mountRenderer(
  mount,
  <RendererProviders>
    <ApprovalScreen />
  </RendererProviders>
);
