# React Dashboard migration tickets

Spec: [Dashboard migration](react-dashboard-migration.md).

## DASH-1 — React Dashboard and typed workflows

Implementation: resolved Blocked by: none Review rounds: 1 Expected areas: src/dashboard/, shared typed bridge as needed, Dashboard HTML entry, tsconfig, architecture docs; CSS only functional parity fixes.

- [x] All spec behaviors 1–9 implemented with lifecycle/security parity.
- [x] Worker strict typecheck/build/lint and focused native checks pass.
- [x] Primary independently reviews changed paths and verifies real synthetic Vault workflows, pending/late replies, navigation and bounded visuals.

Verification: freeze source before review; primary captures baseline and validates unrelated edits. Native acceptance tests public UI/IPC, not private hooks. Corrections return to same Luna worker max three rounds.

## DASH-2 — Combined packaged acceptance

Implementation: resolved Blocked by: DASH-1 Review rounds: 0 Expected areas: primary acceptance/evidence/tracker only; production corrections return to DASH-1 worker.

- [x] Core tests with current hash evidence, strict typecheck/lint/build and independent final native checks pass.
- [x] Final package assets/executable and authorized local installation verified, including read-only Touch ID capability check.
- [x] Evidence recorded, unrelated Git/skill state preserved and lock removed.

Verification: inspect all source/build/fixture hashes, actual macOS packaged executable with isolated data, signature/archive check and normal-quit install preserving MCP CLI processes. No Dashboard commit/push/PR.

DASH-1 claim time: 2026-10-01T17:25:50.149124+00:00; requested gpt-6-luna high.

DASH-1 sole write-enabled worker: /root/luna_dashboard (explicit gpt-6-luna high). Baseline: /private/tmp/localkeys-dashboard-baseline.json.

### DASH-1 correction round 1

Native focus.cjs confirmed closing New Vault dialog via Escape leaves document.activeElement=BODY after two animation frames: trigger is inside the now-hidden menu. Return to a visible Vault switcher/fallback; same applies to renamed Vault menus. Source review requires final retirement checks for focus reconciliation, CLI status after await, switch completion after await and Project creation notification; no UI mutation/merge overlay after lock/Vault change/pagehide/unmount. Preserve modal outside-click press/release semantics instead of closing immediately on pointer-down. Worker /root/luna_dashboard owns corrections. Independent strict build/lint passed; workflows, import/rename/active removal, offline/preferences, external reconciliation, pending/late picker/mutation and minimum trap passed. Visual batch 1 preserves layout. Navigation first run overlapped worker's last rebuilt assets and timed out; frozen-source repeat passed. Focus timing harness now waits its scheduled animation frame. Affected checks will rerun after correction; unchanged core inputs retain independent 115-test evidence.

DASH-1 accepted after correction round 1: primary source review, strict typecheck/build/lint, native focus/scrim/stale reconciliation, Project/CLI/Vault workflows, lifecycle/late replies, disk reconciliation and final visual batch passed. Worker native launch was sandbox infrastructure failure; primary elevated native acceptance passed. Documentation-only changelog follow-through included.

DASH-2 claimed for primary combined packaged acceptance at 2026-10-01T18:02:24.199993+00:00.

## Implementation evidence

Both DASH-1 and DASH-2 resolved. Production edits: `/root/luna_dashboard`, requested GPT-6 Luna high, one formal correction round; primary independently reviewed and accepted all changed paths. No downstream ticket remains. Source/build/fixture/runtime/Git identities and outcomes: [verification](react-dashboard-migration-verification.md), [evidence manifest](react-dashboard-migration-evidence.json). Final strict typecheck/build/lint, fresh 115-test core suite, all native workflow/lifecycle/reconciliation checks and two bounded visual batches passed. Actual macOS arm64 package/signature/archive and normal-quit local installation passed; actual lock window shows Touch ID. Six vanilla pages remain. Unrelated skills preserved; no Dashboard commit/push/PR.
