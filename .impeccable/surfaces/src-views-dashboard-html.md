---
version: 1
slug: "src-views-dashboard-html"
primary_target: "src/views/dashboard.html"
related_targets: ["src/dashboard/main.tsx", "src/styles/dashboard.css"]
---

# Projects homepage

Mode: Operate. The developer finds and opens a local project, creates one, or switches Vaults. DESIGN.md defines shared sizes, materials, typography, and behavior.

Platform-aware surfaces, system interface text on macOS, and bundled Geist elsewhere follow DESIGN.md; JetBrains Mono remains available for credential material and existing metadata. The sidebar expands from a 64px rail to 208px labelled navigation and retains the functional Vault switcher. Below 860px it becomes a drawer with outside-click and Escape dismissal. Native macOS framing remains native.

Search, Lock Vault, CLI overflow, and New Project share the topbar. The scrollable canvas carries the heading, four separate overview cards, All Projects / Starred filters, grid/list controls, existing sorting with favorites pinned, descriptive project cards, and a Home folder-import drop area. Cards form up to three columns and adapt to content width.

Only real data appears: statistics from the active Vault, stored secret and Environment counts, updated timestamps, recorded last access, and activity today when present. No invented descriptions, integration tags, Docker readiness, hardware-enclave claims, percentage health, or raw .env copy actions. Statistics disappear when disabled; loading, errors, empty Vault, and no-match states remain actionable. Sidebar refresh status describes the last successful read, not remote synchronization.

Preserve projects get/create/delete, favorites, Vault list/switch/create/import/rename/remove, settings, CLI install/uninstall, lock, session epochs, polling, sync notifications, focus handling, and confirmation guards. Search uses Command/Ctrl+K, project cards open with Enter/Space, and Escape dismisses dialogs/menus/drawers. All new copy uses translations; CSS loads after common.css and remains scoped to this surface.

Homepage buttons and inputs use shared shadcn/ui controls. Project overflow, toolbar actions, and sorting use Radix dropdowns; creation and Vault forms use Radix dialogs with focus containment and translated close labels. Tailwind utilities compile locally without Preflight; shared platform-aware light/dark tokens opt in via `lk-ui-theme`. The functional Vault switcher retains its existing management behavior.

Sidebar state is shared with Project and Access Logs and changes through the toggle, Command/Ctrl+B, or explicit narrow-drawer dismissal. Navigation, history, reload, and resizing preserve the preference. Counts hide in the collapsed rail and remain in tooltips. Native zoom shares one scale across main workspace pages. Page headings use 24px, controls/navigation 13px, metadata 12px, and default interface icons 16px.
