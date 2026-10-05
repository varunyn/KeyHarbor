import type { ReactNode } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";

export const mountRenderer = (element: HTMLElement, view: ReactNode) => {
  let root: Root | null = null;
  const render = () => {
    root = createRoot(element);
    root.render(view);
  };
  const unmount = () => {
    root?.unmount();
    root = null;
  };
  const onPagehide = () => unmount();
  const onPageshow = (event: PageTransitionEvent) => {
    if (event.persisted && !root) {
      render();
    }
  };
  render();
  window.addEventListener("pagehide", onPagehide);
  window.addEventListener("pageshow", onPageshow);
  return () => {
    window.removeEventListener("pagehide", onPagehide);
    window.removeEventListener("pageshow", onPageshow);
    unmount();
  };
};
