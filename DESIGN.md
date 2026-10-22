# KeyHarbor UI guide

KeyHarbor is a local secrets workspace. Keep the interface compact, consistent across pages, accessible, and clear about what each action does.

## Reuse components first

- Start with the components in [src/renderer/ui](src/renderer/ui/README.md) and existing workspace patterns.
- If a control is missing, adapt shadcn/ui with Radix primitives and the app's theme tokens. Use cmdk for searchable command lists.
- Use Tailwind utilities for layout and styling. Use custom CSS only when existing utilities and components cannot express the requirement clearly; explain the reason when introducing it.
- Add reusable controls to the shared library. Do not create page-specific copies of buttons, menus, dialogs, or navigation.
- Use the existing native macOS action menus and window framing where supported.

## Keep pages consistent

Home, Project, and Access Logs share navigation, sidebar sizing, typography, and icon sizes. Page headings use 24px, controls and navigation 13px, secondary text 12px, and interface icons default to 16px. Reuse shared classes instead of inventing a scale for each page.

Sidebar expansion is one saved preference. Navigation, reload, history, and resizing preserve it; the toggle, Command/Ctrl+B, or explicit drawer dismissal changes it. Counts sit beside expanded labels and stay in tooltips when collapsed. Native zoom applies consistently across main workspace pages.

macOS uses the system interface font and native materials with accessibility fallbacks. Other platforms use bundled Geist and the shared theme. JetBrains Mono is available for credential material. Support both light and dark mode using semantic theme classes rather than hard-coded colors.

## Preserve trustworthy interactions

- Keep secrets masked by default. Preserve explicit approval, reveal timers, blur handling, clipboard clearing, and main-process security checks.
- Show real Vault data. Do not invent identities, deployment status, integrations, or credential validity.
- Label icon controls, preserve keyboard navigation and visible focus, and respect reduced motion and transparency preferences.
- Use shared dialogs and menus for focus management. Confirmations initially focus Cancel.
- Route user-facing text through `i18n.t()`. Keep fonts and assets local.
- Folder imports require explicit Environment selection and masked review; never change source files or Git ignore rules.

## Where the details live

| Concern | Source of truth |
| --- | --- |
| Colors, platform themes, sidebar width, icon scale | [theme.css](src/styles/theme.css) |
| Text sizes and Tailwind theme mappings | [ui.css](src/styles/ui.css) |
| Shared controls and menus | [renderer/ui](src/renderer/ui/README.md) |
| Workspace navigation | [workspace-shell.tsx](src/renderer/workspace-shell.tsx), [nav-bar.tsx](src/renderer/ui/nav-bar.tsx) |
| Saved sidebar state | [use-sidebar-state.ts](src/renderer/use-sidebar-state.ts) |
| Native window framing | [window-chrome.tsx](src/renderer/window-chrome.tsx) |
| Shared native zoom | [workspace-navigation.ts](src/modules/workspace-navigation.ts) |

Load `common.css`, `theme.css`, `ui.css`, then page CSS. Keep exact values in code. When changing shared UI, verify Home, Project, and Access Logs at normal and narrow widths in both themes.
