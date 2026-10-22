# Changelog

## [Unreleased]

### Added

- macOS now uses a unified native title bar and translucent navigation, with Apple Liquid Glass on macOS 26 or later, native vibrancy on older versions, and solid materials when accessibility settings require them.

- Import from a project folder with bounded .env discovery, Git-ignore and tracked-file warnings, nearby-template missing-key checks, and masked per-file review into an explicitly selected environment.
- Drop project folders on Home, choose an existing project or create one, and continue into the folder scan and masked import review.

### Changed

- Collapsed sidebar icons now stay clear of overlapping count bubbles; counts remain beside expanded labels and in navigation tooltips.

- Expanded sidebars use a compact shared width, reducing empty navigation space and leaving more room for project and log content.

- Access Logs now uses the shared workspace navigation, saved sidebar preference, and readable typography, with compact log rows, a shared category dropdown, and clear actions behind confirmation.

- Sidebar controls now sit beside the top navigation breadcrumbs on the Projects and secrets screens, with distinct expand and collapse icons.

- macOS secret row and inspector actions now use system menus; searchable project switching continues to use the shared command picker.

- Project switching now uses a compact searchable picker with the current project marked and every project available.

### Fixed

- Zoom In, Zoom Out, and Actual Size now keep one scale across Home, projects, Access Logs, and Settings instead of restoring different page zoom levels.

- Home and project screens now share a consistent interface icon scale; project icons retain their size when color classes are added, and secret rows use readable 13px text.

- Sidebar expansion now stays consistent between Home and project pages, including Back, Forward, and reload; Command/Ctrl+B toggles the shared saved preference.

- Navigation and content now use a consistent readable type scale, matching sidebar widths and selection styles, and a simpler project header with the active vault name.

- macOS can display the unlock screen without opening Keychain merely to check Touch ID availability; credential operations still require biometric approval and Keychain encryption.

## [2.2.0](https://github.com/varunyn/KeyHarbor/compare/v2.1.1...v2.2.0) - 2026-10-21

### Added

- Approved agents can use credentials through the native proxy without receiving the secret value.

- Window close behavior now supports keeping KeyHarbor running in the system tray.

- Import review now accepts drag-and-drop .env files, shows the selected filename, and offers inline per-secret action choices.

### Fixed

- Windows proxy requests now report the correct safe diagnostic when an upstream service refuses a connection.

- Selecting a secret now opens its details panel, and row action menus stay open reliably with mouse and keyboard navigation.

- macOS builds now give KeyHarbor a distinct native build UUID and explicitly sign its proxy helper, preventing identity collisions with stock Electron or the previous LocalKeys app during Local Network permission checks.

- macOS packages now declare local-network access for approved agent requests. Proxy connection failures return safe diagnostic codes and guidance instead of a generic 502, without exposing transport errors or credentials.

- Approval prompts now center within their window, wrap text naturally, and keep action buttons visible while long details scroll. Agent prompts now use the full two-minute approval countdown.

- The macOS menu bar now uses the current shield-and-anchor logo instead of a separate key glyph.

- Agent approvals now allow two minutes per prompt, with longer proxy and desktop transport timeouts so requests can complete after human review. MCP clients must allow at least five minutes per authenticated request.

- Redesigned the collapsed sidebar into a modern, compact 64px desktop icon rail with square action buttons, subtle hairline dividers, dedicated vault switcher icon button, and badge counts, eliminating squeezed text and awkward vertical stacking.

- All application screens (Dashboard, Project workspace, Settings, Approval, Lock, Setup, and Access Logs) now scroll properly on small window heights, and have been completely migrated to Tailwind CSS utilities, shared UI components, and Lucide icons, eliminating all legacy custom page stylesheets (`dashboard.css`, `project.css`, `approval.css`, `lock.css`, `logs.css`, `settings.css`, and `setup.css`).

## [2.1.1](https://github.com/varunyn/KeyHarbor/compare/v2.1.0...v2.1.1) (2026-10-06)


### Bug Fixes

* publish downloadable desktop installers ([4409e27](https://github.com/varunyn/KeyHarbor/commit/4409e27c7e5a177fbbb343d38dc4fc01db5b1fc4))

## [2.1.0](https://github.com/varunyn/KeyHarbor/compare/v2.0.0...v2.1.0) (2026-10-06)


### Features

* initial commit for KeyHarbor ([dc3ade2](https://github.com/varunyn/KeyHarbor/commit/dc3ade2569f1f112950ea1a77798b4630df6ffbc))
