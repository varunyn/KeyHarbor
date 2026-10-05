# React Dashboard migration

Status: Implemented, independently verified and installed on 2026-10-01. See [verification](react-dashboard-migration-verification.md) and [evidence](react-dashboard-migration-evidence.json). Dashboard changes remain uncommitted.

Migrate Dashboard to React and strict TypeScript using the existing local Vite build. Preserve the Vault Ledger appearance and all observable workflows. Project is already React; the six other screens remain vanilla. No Vault schema, security, Touch ID, IPC behavior or signing changes.

## Acceptance scope

1. React owns the Dashboard shell, statistics strip, Project grid/list, search, sorting, favorites, menus and dialogs. No old inline controller, injected HTML wrapper or imperative rendering clone.
2. Preserve Project counts, recent/access metadata, attention statistics and showStatistics preference. Search is case-insensitive; favorites lead the current name/recent/secrets sort; grid/list switching preserves context. Loading, empty/no-match and failure recovery are explicit.
3. Preserve Project open/create (trimmed validation/Enter)/confirmed delete and favorite toggle through existing IPC.
4. Preserve Vault listing/active/offline indicators, selection/switch, create, import, browse/cancel, rename and confirmed removal. Removal unregisters, does not delete files. Passwords exist only in current dialog state and are cleared on close/lock/navigation. No passwords in logs, DOM attributes, persistence or diagnostics.
5. Preserve CLI status/install/confirmed uninstall, settings/logs/activity navigation and lock. Test CLI UI transport without modifying real system installation.
6. Preserve keyboard search shortcut, Escape, outside dismissal, one-click menu reopening, blur dismissal, modal initial focus and focus return/trapping, mobile navigation toggle and minimum 680×500 window functionality.
7. Refresh on current Vault/session changes, reconciliation/data-synced, focus and visible polling; retire late replies on dialog close, Vault change, lock and unmount. Guard pending actions synchronously against double admission, avoid a late completion closing a newer dialog or applying data to a different Vault. Dispose subscriptions/listeners/timers.
8. Strict typing models real preload/main response envelopes. Reuse small existing React/shared helpers where natural; do not introduce competing Window.localkeys declarations. Shared CSS in common.css, feature CSS in dashboard.css, existing stylesheet order preserved.
9. Static file-URL assets built/packaged locally; no renderer Node access or remote assets. Existing Project and vanilla navigation still work. Update architecture docs accurately; no cosmetic redesign.
10. Primary independent source review, typecheck/lint/build, current full core tests, native synthetic Vault workflow/lifecycle checks, two bounded desktop/minimum visual batches, packaged asset/executable check. Native Touch ID availability checked without authentication; final real biometric success requires the user. macOS package/install follows existing authorization. Preserve unrelated skill files; no push/PR or Dashboard commit unless newly requested.

## Verification strategy

One explicit GPT-6 Luna high implementation worker; primary owns acceptance and native fixtures/evidence. Start from the existing committed Dashboard as behavior reference. Use actual production main/preload/Vault handlers with temp HOME/userData and synthetic credentials. Controlled OS folder picker/confirm and CLI transport gates are external boundaries, not private production hooks. Record fixture/source/runtime identities and correction count. At most three same-worker correction rounds. Reuse prior core test evidence only when all tested input hashes/dependencies/config/runtime still match; no redundant implementation-mirroring tests. Refresh core suite if bridge/preload/main dependencies change. Install only after packaged acceptance; ensure normal quit excludes independent MCP CLI processes.
