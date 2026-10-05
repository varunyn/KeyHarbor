---
version: 1
slug: "src-views-dashboard-html"
primary_target: "src/views/dashboard.html"
related_targets: ["src/dashboard/main.tsx", "src/styles/dashboard.css"]
---

# Projects homepage

Mode: Operate. The developer finds and opens a local project, creates one, or switches Vaults. The supplied October 2 homepage design is the visual authority; preserve supported product workflows.

Navy/cyan surfaces and locally bundled Geist / JetBrains Mono typography follow the homepage contract in DESIGN.md. The sidebar expands from an 88px rail to 248px labelled navigation and retains the functional Vault switcher. Below 860px it becomes a drawer with outside-click and Escape dismissal. Native macOS framing remains native.

Search, Lock Vault, CLI overflow, and New Project share the topbar. The scrollable canvas carries the heading, four separate overview cards, All Projects / Starred filters, grid/list controls, existing sorting with favorites pinned, descriptive project cards, and a creation tile. Cards form up to three columns and adapt to content width.

Only real data appears: statistics from the active Vault, stored secret and Environment counts, updated timestamps, recorded last access, and activity today when present. No invented descriptions, integration tags, Docker readiness, hardware-enclave claims, percentage health, or raw .env copy actions. Statistics disappear when disabled; loading, errors, empty Vault, and no-match states remain actionable. Sidebar refresh status describes the last successful read, not remote synchronization.

Preserve projects get/create/delete, favorites, Vault list/switch/create/import/rename/remove, settings, CLI install/uninstall, lock, session epochs, polling, sync notifications, focus handling, and confirmation guards. Search uses Command/Ctrl+K, project cards open with Enter/Space, and Escape dismisses dialogs/menus/drawers. All new copy uses translations; CSS loads after common.css and remains scoped to this surface.

Homepage buttons and inputs use shared shadcn/ui controls. Project overflow, toolbar actions, and sorting use Radix dropdowns; creation and Vault forms use Radix dialogs with focus containment and translated close labels. Tailwind utilities compile locally without Preflight; shared navy/cyan tokens opt in via `lk-ui-theme`. The functional Vault switcher retains its existing management behavior.
