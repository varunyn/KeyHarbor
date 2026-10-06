# Changelog

## [2.1.0](https://github.com/varunyn/KeyHarbor/compare/v2.0.0...v2.1.0) (2026-10-06)


### Features

* initial commit for KeyHarbor ([dc3ade2](https://github.com/varunyn/KeyHarbor/commit/dc3ade2569f1f112950ea1a77798b4630df6ffbc))

## [Unreleased]

### Added

- Added independent Environments inside Projects. Existing collections migrate to an Environment initially named `default`; the stored default Environment ID controls omitted CLI, HTTP, and MCP selectors, while explicit Environment selection is available. Environment exports contain one collection, and encrypted Project backups contain all Environments. Upgrade every installation sharing a Vault before editing Environment data; earlier versions cannot preserve named Environments.
- Added project creation to the local API, CLI (`localkeys create <project>`), and MCP server (`create_project`), since setting a secret fails when the project does not exist. Creation requires explicit write approval and is idempotent when the project already exists.
- Added batch secret writes to the local API and MCP server (`set_secrets`), so a new project can be seeded from a `.env.example` file with a single approval request.
- Added optional descriptions and tags for secrets, shown in the inspector and editable from the secret dialogs.
- Added safe-by-default export modes (`.env.example` keys-only, secret references, encrypted backup); raw value export requires master-password re-authentication and is recorded in the audit log.
- Added a shared Paste/File environment import flow with line diagnostics, explicit duplicate choices, masked review, and safe defaults that keep changed secrets unless you choose Replace.
- Added per-Project required-key checklists from pasted or selected environment templates, with readiness states and reviewed updates that leave stored Secrets unchanged.
- Added secret rotation (new secure value, old value kept in version history) and duplication of a secret into another project.
- Redesigned the Projects dashboard in the dark Vault Ledger style: sidebar navigation with vault switcher, overview strip with vault health, grid/list views with sorting, compact project cards with activity state, and guided empty and no-results states.
- Redesigned the project secrets screen in the same style: ruled secrets table with Secret/Config types and status pills, inspector panel with metadata, tags, log-derived usage and version-history audit, one-click reveal with a 30-second auto-hide, clipboard clearing after copy, and a back link to all projects.

### Changed

- Renamed the app to KeyHarbor, with a new icon, app identity, `keyharbor` CLI, and `keyharbor-mcp` server (`keyharbor_status`). Update existing CLI/MCP client configurations.
- Removed paid activation, purchase links, licensing IPC, and activation requests. Update checks now use this fork's GitHub releases. Existing vault data and encrypted backup formats remain compatible; new installs use `~/.keyharbor`, while existing `~/.localkeys` data is reused.

- Set the app version to 2.0.0 for the Environment-aware Vault upgrade and redesigned React interface; the MCP server now reports the same version as the desktop app.
- Unified homepage, project secrets, Settings, and Access Logs controls with a shared navy/cyan theme. In-app confirmations and Vault reconciliation dialogs support keyboard focus and retire pending decisions when the active Vault session changes.

- Redesigned the Projects homepage with navy/cyan surfaces, offline Geist and JetBrains Mono fonts, an expandable sidebar, vault overview cards, starred filtering, and project cards showing real secret and Environment counts.

- Made the project secrets sidebar expandable, with labelled navigation and view counts alongside a compact icon rail.

- Redesigned the project secrets workspace with navy surfaces, cyan accents, offline Geist and JetBrains Mono fonts, compact navigation, environment tabs, descriptive secret rows, and a prominent copy panel while retaining expiration, readiness, and recorded activity.

- Environment deletion now uses an in-app confirmation with the affected Secret count and default replacement warning, with keyboard focus starting on Cancel.
- Migrated the Dashboard and Project secrets screens to React and TypeScript renderers while preserving their existing Vault workflows and local offline assets.
- Migrated Settings, Lock, Setup, Logs, License, and CLI Approval to React and strict TypeScript, sharing translations, notifications, platform focus, and vault reconciliation while preserving the existing renderer workflows and typed preload ownership.

### Fixed

- Fixed release installer uploads by separating packaging from publishing; manual rebuilds use the requested release tag, and macOS releases include a universal installer for Apple Silicon and Intel.
- Desktop packaging now explicitly rebuilds the app, preventing stale renderer files when npm lifecycle hooks are disabled.
- Aligned project dialog surfaces, fields, and action buttons with the shared shadcn theme in dark and light modes.
- Centered dialogs consistently across the app and kept tall dialogs scrollable within the window, preventing clipped headers and actions.
- Disabled CLI approval buttons immediately after a decision, while retaining the guard against duplicate responses.
- Preserved Unicode Secret values when CLI response chunks split a multi-byte character, and rejected malformed or interrupted desktop responses with a clear error.
- Kept secret row action menus visible beside the docked inspector by aligning them within the table.

## [1.6.0] - 2026-09-22

### Added

- Added a local MCP v2 stdio server so compatible AI clients can list LocalKeys vaults and projects, request narrowly scoped secret access, and set secrets through the existing desktop approval flow.
- Added optional Touch ID unlock on supported Macs, with the master password retained as a fallback.

### Changed

- Upgraded Electron from 39 to 44 (Chromium M152, Node 24). The app now requires macOS 13 or newer and 64-bit Windows/Linux.
- Standardized repository documentation, developer guidance, source comments, and diagnostic messages on English, and removed the Korean README.

### Fixed

- Fixed MCP connections incorrectly reporting that LocalKeys was not running when the client lacked permission to probe the desktop process.
- Fixed MCP status responses reporting a stale application version.
