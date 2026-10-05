# React Project renderer migration

Status: Implemented, independently verified and installed. Label: ready-for-agent. Tracker: repository Markdown; see [tickets](react-project-migration-tickets.md).

## Problem Statement

The Project screen has grown into a large inline script managing rendering, dialogs, selection, async responses and timers. Adding features requires manually keeping DOM and application state synchronized. The user selected React with TypeScript and Vite after reviewing current comparable desktop applications.

## Solution

Migrate the Project screen to typed React components, keeping its current appearance and observable behavior. Use Vite to build local renderer assets. Preserve the Electron main/preload boundary and Vault operations; keep other screens in vanilla HTML/JavaScript in this first migration.

## User Stories

1. As a developer, I want reusable Project components, so that future features are easier to maintain.
2. As a developer, I want typed bridge responses and state, so that incorrect assumptions are caught before shipping.
3. As a user, I want the existing dark compact appearance preserved, so that migration does not disrupt my workflow.
4. As a user, I want Project navigation and switching preserved, so that I can reach every existing screen.
5. As a user, I want search, filters and view counts preserved, so that I can find Secrets.
6. As a user, I want selection and favorites preserved, so that my working context stays clear.
7. As a user, I want Secret creation, editing and renaming preserved, so that I can manage credentials.
8. As a user, I want explicit deletion preserved, so that credentials cannot disappear accidentally.
9. As a user, I want rotation and duplication preserved, so that existing management actions keep working.
10. As a user, I want the inspector metadata, usage and history preserved, so that I can understand a Secret.
11. As a user, I want masked values and deliberate reveal preserved, so that values do not appear unexpectedly.
12. As a user, I want the 30-second reveal timer and blur hiding preserved, so that exposure remains bounded.
13. As a user, I want clipboard clearing preserved, so that copied credentials do not linger.
14. As a user, I want version history and explicit restore preserved, so that I can recover previous values.
15. As a user, I want Paste/File import and safe duplicate decisions preserved, so that imports remain deliberate.
16. As a user, I want cancel and late reply cleanup preserved, so that abandoned reviews stay closed.
17. As a user, I want safe export modes and raw-export authentication preserved, so that export policy remains unchanged.
18. As a user, I want required-key templates and checklist statuses preserved, so that I can check configuration completeness.
19. As a user, I want fill-gap editor actions preserved, so that missing configuration is easy to resolve.
20. As a user, I want expiry and accepted mutations to refresh the checklist, so that results stay current.
21. As a user, I want loading, empty, no-results and error states preserved, so that the app reports real conditions.
22. As a keyboard user, I want focus traps, restoration, shortcuts and accessible labels preserved, so that all actions remain reachable.
23. As a user, I want drawer and menu behavior at minimum window size preserved, so that controls stay usable.
24. As a user, I want session closure and navigation to retire sensitive UI state, so that old responses cannot repopulate it.
25. As a developer, I want effects and subscriptions cleaned up on unmount, so that remounting cannot leak listeners or timers.
26. As a user, I want the packaged app to load entirely local assets, so that it works offline.
27. As a developer, I want start and packaging commands to build the renderer, so that source and shipped assets cannot drift.
28. As a user, I want my existing Vault format and data preserved, so that migration requires no data conversion.

## Implementation Decisions

- React plus TypeScript owns the Project rendering and interactive state. Extract components and feature hooks for the shell/table, inspector, menus, checklist and dialogs. Merely wrapping the old inline script or injecting the old HTML through a React root does not complete the migration.
- Keep the established CSS, icons, localization keys and compact Vault Ledger design. Preserve existing automation IDs where natural to retain observable acceptance seams. Use semantic React markup and controlled forms; imperative DOM operations are limited to legitimate focus, scroll, measurement and clipboard work.
- Vite produces static local assets with relative URLs suitable for Electron file loading. Build renderer pages together so vanilla navigation can enter and leave the migrated Project page without broken relative links. Legacy pages remain vanilla; their browser helpers are copied or bundled deliberately, without exposing Node-only modules as browser dependencies.
- Main routes load built renderer pages; start and each platform packaging command build them first. Generated artifacts are ignored and rebuilt from source. Production has no dependency on a development server or network assets. Missing generated entry points produce an actionable build error, not a stale fallback that masks build failures.
- Preserve the existing main/preload/session APIs and security settings. Renderer code accesses the typed narrow bridge, never Node/Electron internals or filesystem operations. Existing browser Web Crypto remains permitted for secure value generation; Node crypto remains in main. No new direct secret access endpoints or relaxed context isolation, nodeIntegration or sandbox setting.
- Define strict types for Project-relevant bridge envelopes, Secret records, logs, history, configuration results, import previews/decisions and session state. Model loading/error/dialog phases explicitly and treat unknown data safely. Avoid broad any casts, ignored type errors, or duplicated definitions of authoritative main-process behavior.
- Existing subscription APIs used by React effects return unsubscribe callbacks. Extend compatible listener cleanup only where necessary; no unrelated IPC changes.
- Keep authoritative parsing, stale review admission, expiry evaluation, credential checks and persistence in main. React state handles presentation, safe review choices and lifecycle ownership only.
- Capture operation identity for late async responses; unmount, lock, source change and dismissal retire handles and draft/reveal state. Commit admission remains main-owned. Independent checklist refresh cannot invalidate a pending dialog operation.
- No renderer persistence for Secret values or source drafts. Reset sensitive state on session transition/navigation. Do not log sensitive values or add remote telemetry.
- Preserve exact recorded expiry when editing an existing Secret without changing its expiry field. Prototype-named keys use exact own-key semantics throughout the UI.
- Existing plain Config display heuristics, safe export defaults, Secret health statuses and required-key readiness remain distinct. No product policy changes bundled into migration.
- Preserve current 680×500 minimum window behavior, ruled tables, row menu right alignment, overlay scrims and focus restoration. Do not elevate background actions over an overlay drawer.
- Keep additional libraries minimal: React/React DOM, TypeScript/Vite/tooling and required lint support. No routing/state/UI kit or CSS framework needed for this first screen unless a concrete boundary requires one.
- Keep other screens and core Vault/HTTP/CLI/MCP behavior unchanged. No schema change, branch, commit or external publication is part of this request.

## Testing Decisions

- Reuse the user-confirmed seam: actual production renderer/preload/IPC and public Project operations through isolated Electron with a real temporary encrypted Vault and synthetic credentials. Fake unavoidable OS file selection, never parsing, expiry, persistence or reconciliation.
- Strict type checking, renderer build and packaged local-asset loading are additional build checks, not new test-only production seams.
- Preserve existing public integration tests. Add tests only for new externally meaningful boundary behavior; do not test React hook internals or mirror markup implementation.
- Verify search/filter/selection/favorites, CRUD/rename/delete/rotate/duplicate, metadata/history/restore, reveal/blur/timeouts, clipboard behavior, import decisions/late cleanup, export modes/authentication, checklist/template/expiry, reconciliation refresh, navigation and session cleanup.
- Batch desktop and minimum-size visual checks in bounded passes. The intended appearance is the existing screen, not a redesign.
- Test built Project entry and vanilla dashboard/settings/activity navigation under file URLs, and verify packaged renderer assets correspond to current sources.
- Run full repository tests, JavaScript/CSS lint, renderer type checking and build at final acceptance. Reuse prior evidence only while affected inputs, dependencies and fixtures remain unchanged.

## Out of Scope

- Migrating every screen, adopting Next.js, changing desktop runtime, introducing server rendering, redesigning the UI or replacing the CSS system.
- Vault schema/encryption changes, provider validation, new product features or changed import/export/security policies.
- Commit, push or PR. Installed-app replacement follows the user's existing authorization only after build and acceptance succeed.

## Further Notes

The user approved the proposed gradual migration. The existing Electron/Vault acceptance seam was already confirmed in this conversation; no new private test seam is proposed. Repository Markdown remains the tracker. Main/preload changes are limited to built-page resolution and necessary compatible subscription cleanup.

Verification: [acceptance evidence](react-project-migration-verification.md).
