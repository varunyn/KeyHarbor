# React Dashboard migration verification

Date: 2026-10-01. Outcome: independently accepted, packaged and installed.

## Scope and source identity

Dashboard now uses React 19.3.0 and strict TypeScript 6.0.3 with the existing Vite 8.3.1 build, authored CSS and static offline assets. Project remains React; six other pages remain vanilla. Main, preload, Vault schema, Touch ID and signing implementation are unchanged. Architecture documentation and the existing Unreleased migration entry now cover both React screens; no data migration is required.

The prior work was committed as `028cdf0afa5a509950a3c1103a79aad02f3d1b64`. Dashboard work remains uncommitted on `codex/env-text-import`; index is empty. Preexisting `.agents/` and `skills-lock.json` hashes are unchanged. Exact dirty source, build, fixture and runtime identities are in [evidence](react-dashboard-migration-evidence.json).

Sole implementation worker: `/root/luna_dashboard`, explicitly requested GPT-6 Luna high. One formal correction round addressed visible dialog focus return, retirement after context changes and backdrop press/release semantics. Primary reviewed every changed path and performed independent acceptance.

## Independent acceptance

- Strict renderer typecheck/build, JS/CSS lint and `git diff --check` passed. Classic script notices from Vite are expected: those existing helpers are copied locally.
- Final independent `npm test` passed 115/115 tests, zero failed/skipped, in 16.61 seconds on Node 24.21.0. Every core/test/main/preload/dependency input hash was also rechecked against prior evidence. Final raw log: `/private/tmp/localkeys-dashboard-verify/tests.log`; the manifest is embedded in the evidence.
- Native production workflows passed Project creation/validation/Enter/deletion/cancel, search, sort, favorites, grid/list, controlled pending CLI installation and confirmed uninstall, secondary Vault creation/switching and scoped Project data.
- Real encrypted Vault import rejected an incorrect password and accepted the correct synthetic password. Rename, active removal with System fallback, preserved disk files, offline indicator and statistics preference passed.
- Actual external encrypted disk writes from a second Vault instance reconciled into Dashboard through the production periodic owner.
- Native lifecycle checks passed real blur/outside/Escape/one-click reopening, synchronous single pending mutation admission, late mutation/picker retirement, cleared password drafts, error recovery, minimum-size Tab containment and focus return.
- The focus regression failed before correction because Escape left focus on BODY. It now returns to the visible Vault switcher. A drag from scrim into dialog preserves the draft; an actual scrim click dismisses. A delayed reconciliation transport reply after a real Vault switch cannot open a stale merge dialog.
- Project enter/back, Activity/Settings navigation and lock passed. Final visual batch 2 inspected desktop, 680×500 and minimum-size New Vault dialog; existing layout and scroll behavior are retained. Baseline/final screenshot identities are recorded.

Fixtures live under `/private/tmp/localkeys-dashboard-verify`. They use temporary HOME/userData and synthetic credentials, real production main/preload/Vault handlers, controlled OS picker and CLI boundaries, and fixture-only disabled credential availability to avoid a macOS Keychain capability stall. Delayed/error reply overrides occur after the real owner runs, independently testing renderer transport retirement. No test hook or override was added to production.

## Packaging and installation

`npm --ignore-scripts=false run build:mac -- --dir` passed with the normal prebuild and unchanged ad-hoc signing. Strict deep signature verification passed. All 25 generated renderer files and main/preload/Touch ID owner files exactly match the packaged archive.

The actual packaged executable passed isolated synthetic Vault setup followed by the setup screen's public Dashboard navigation, Project creation/enter/back, local icon loading and renderer isolation (`require` unavailable). Native `canPromptTouchID()` returned true without fingerprint authentication.

Installed and packaged ASAR SHA256: `b7846c631a0fc78bf97380953c1a57db62595a8757062f162d9e4d23798316ec`.

Installed `/Applications/LocalKeys.app` after a normal desktop quit, preserving nine independent MCP CLI processes and live Vault files. Prior bundle: `/private/tmp/localkeys-before-dashboard-bxa9art4/LocalKeys.app`. Reopened desktop PID 96302 and observed the actual lock screen with **Unlock with Touch ID** visible. The user's earlier Touch ID issue had already resolved after restart without a code/signing change.

## Verification limits and harness corrections

Windows/Linux packaging was not run on this macOS host. Actual fingerprint authentication requires the user; native capability and lock-screen availability were checked.

The initial navigation probe overlapped a worker asset rebuild; frozen-source replay passed. Focus assertions now await their scheduled animation frames. Worker native launch failed in its sandbox before assertions; primary elevated native checks passed. The first packaged probe wrongly expected setup IPC alone to navigate; adding the established public navigation step passed. CUA reopen initially timed out during launch, then observed the lock window. These are distinct infrastructure issues, not unresolved product failures.

No Dashboard commit, push or PR was created.
