# Shared UI controls

Editable shadcn/ui New York components, adapted from the official registry on October 2, 2026 (MIT): https://ui.shadcn.com/r/styles/new-york/ . Button, Input, Dialog, ModalDialog, Dropdown Menu, and Popover use local theme tokens and Radix primitives. Command uses cmdk for accessible search and keyboard navigation. Dialog close labels come from the caller's translations. No external assets or runtime network requests are needed.

The homepage, project secrets screen, Settings, Access Logs, and Vault reconciliation share these controls. The confirmation hook replaces blocking browser prompts with translated in-app decisions, starts focus on Cancel, and cancels pending requests when the Vault session changes or the page retires. Tailwind utilities omit Preflight so existing renderer defaults remain intact. Global shared styles live in `src/styles/common.css`, platform-aware light/dark theme tokens in `theme.css`, and Tailwind theme mappings and utilities in `ui.css`. Load them in that order, followed by page composition in `dashboard.css` or `project.css`. Import individual components rather than a barrel.

The shared Checkbox follows the current [shadcn/ui Radix Checkbox](https://ui.shadcn.com/docs/components/radix/checkbox) pattern, adapted on October 23, 2026 with `@radix-ui/react-checkbox` 1.4.1 and local theme tokens.

`ModalDialog` standardizes Radix Dialog chrome, autofocus, focus restoration, accessible title/descriptions, and footer actions across renderer screens.

`ActionMenu` uses Electron system menus on macOS for standard action lists, with the shared Radix dropdown elsewhere and as a fallback. Rich and searchable pickers use Popover and Command. Native menu IPC carries only bounded labels, action IDs, and a window-relative anchor; actions run through the original renderer handlers after selection.

Shared workspace navigation uses `nav-bar.tsx`, `sidebar-toggle.tsx`, and `../use-sidebar-state.ts`. Home, Project, and Access Logs share a 208px expanded sidebar, a 64px rail, and the saved expansion preference. Counts stay beside expanded labels and in tooltips rather than overlaying collapsed icons. `../workspace-shell.tsx` composes the Access Logs shell; `../window-chrome.tsx` handles native macOS framing.

`ui.css` defines pixel-based text sizes; `theme.css` fixes interface SVG sizes independently of the legacy 13px root. macOS uses the system interface font and native colors; other platforms use bundled Geist and the existing navy/cyan palette. JetBrains Mono remains bundled for credential material. Keep the shared page scale intact; native zoom is configured in `src/modules/workspace-navigation.ts` and must remain consistent across page navigation. See the root `DESIGN.md` for the current contract.
