# Changelog

## [2.3.0](https://github.com/varunyn/KeyHarbor/compare/v2.2.0...v2.3.0) (2026-10-22)


### Features

* initial commit for KeyHarbor ([dc3ade2](https://github.com/varunyn/KeyHarbor/commit/dc3ade2569f1f112950ea1a77798b4630df6ffbc))
* **security:** add native credential proxy helper for secretless agent access ([3c156ec](https://github.com/varunyn/KeyHarbor/commit/3c156ecc62f1c32f5c72963a8f29111f4ed826ec))
* **window:** add window close behavior controller and background tray persistence ([27bd86a](https://github.com/varunyn/KeyHarbor/commit/27bd86ae95d18b0125e485e5a7da00c1214d799c))


### Bug Fixes

* **proxy:** recognize Windows connection refusal errors ([ce201b7](https://github.com/varunyn/KeyHarbor/commit/ce201b72b593b40b69586ddf95714a5c89cd8585))
* **proxy:** use Winsock errno and accept cancellation denial ([0759aaf](https://github.com/varunyn/KeyHarbor/commit/0759aaf131f1aca2b14f74569c7e1efae562b6f3))
* publish downloadable desktop installers ([4409e27](https://github.com/varunyn/KeyHarbor/commit/4409e27c7e5a177fbbb343d38dc4fc01db5b1fc4))
* **ui:** restore secret interactions and improve import review ([8b22a5d](https://github.com/varunyn/KeyHarbor/commit/8b22a5d8abf75b570618e8d1389d2e7b1ed2bc0f))

## [Unreleased]

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
