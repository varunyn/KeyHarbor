---
version: 1
slug: "src-views-project-html"
primary_target: "src/views/project.html"
related_targets: ["src/project/main.tsx", "src/styles/project.css"]
---

# Surface brief — Project secrets workspace

Mode: Operate. A developer scans the selected Environment's secrets, selects an entry, and deliberately copies or reveals its value. Current platform materials and typography follow DESIGN.md.

## Direction

Use the project-specific contract in DESIGN.md: expandable 64px navigation rail / 208px labelled sidebar, project switcher in the header, persisted Environment tabs, search and import/export/new actions, readiness summary, descriptive secret rows, and a copy-first inspector. Keep KeyHarbor branding, routes, typed preload API, and all existing workflows. Home and Access Logs share the navigation, typography, icon scale, and expansion preference.

## Data and behavior

Render actual Environment names, Secret/Config classification, descriptions, tags, timestamps, expiration status, required-key readiness, version history, and recorded usage. Omit hardware-enclave, leak-detection, percentage health, fictitious identities, and deployment claims. Keep secret masking, explicit reveal with 30-second auto-hide and blur handling, clipboard clearing, reviewed import, safe export, history, rotation, duplication, and Environment management.

## Responsive and accessibility

Dock the inspector above 1100px and use an overlay below it. Collapse navigation below 860px; use the native Environment selector below 720px. Support the app's 680px minimum window. Preserve labelled icon controls, theme-aware focus rings, semantic table rows, color-plus-text statuses, keyboard selection, Enter to enter the inspector, `/` and Command/Ctrl+K for search, and Escape for the topmost layer.

## Delivery

Bundle fonts with their licenses for offline operation. Load common.css, theme.css, ui.css, then project.css; reusable font definitions belong in common.css and surface styling belongs in project.css. Route new copy through i18n. Verify production build and inspect desktop and minimum-width states with synthetic data.

Page headings use 24px; controls, navigation, secret rows, and inspector values use 13px; metadata uses 12px. Default interface icons are 16px. The header shows Projects → project switcher and the actual Vault name; Environment selection remains in workspace controls. Counts appear only in expanded rows and tooltips. Navigation preserves sidebar state and shared native zoom. Folder import requires explicit destination Environment selection and masked per-file review.
