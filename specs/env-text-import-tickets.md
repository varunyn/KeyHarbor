# Environment import implementation tickets

Tracker: repository Markdown. Existing branch: codex/env-text-import. Workflow: implement; shared working tree; no new Git operations. No docs/agents configuration exists; the approved spec and root AGENTS.md supply domain rules. Spec: [Environment text import](env-text-import.md). Confirmed test seam: import coordinator preview/commit/discard against a real temporary Vault through VaultSession (accepted in the discussion).

## IMPORT-1 — Source-neutral reviewed import coordinator

Implementation: resolved Blocked by: none Build parser, bounded file/text preview, opaque session/target-bound previews, reveal/discard, stale validation, and atomic Vault batch mutation. Use TDD at the confirmed coordinator seam. Preserve metadata/history and existing persistence. Own coordinator/parser, Vault atomic batch method, and coordinator integration tests.

Claim time: 2026-09-30T21:06:19.191194+00:00 Worker: /root/luna_import_core Requested model: gpt-6-luna (high) Review rounds: 3 Expected areas: import coordinator/parser, Vault atomic mutation, coordinator integration tests.

### Acceptance and verification plan

- [x] Both text/file sources meet the spec grammar, limits and safe diagnostic rules; preview never returns values.
- [x] Duplicate choices are explicit; add/replace/skip validation cannot trust renderer values.
- [x] Relevant Secret, Project incarnation, Vault/session changes invalidate preview; unrelated Secret changes remain allowed.
- [x] Atomic batch preserves metadata/history; any preparation failure leaves all Secrets unchanged; accepted data survives close/reopen.
- [x] Reveal, discard, clear, repeat commit and stale handles obey session admission and return safe failures. Worker: TDD vertical slices at approved public coordinator boundary with real temporary VaultSession; focused node:test + changed-file ESLint. Primary: independently rerun focused tests, inspect entire diff and callers, verify actual persistence/lifecycle invariants. Final integration: full npm test/lint and synthetic desktop flow after IMPORT-3. No evidence reused yet. Source/fixture/runtime hashes recorded on acceptance; any change to coordinator, Vault, session, fixtures or dependencies invalidates corresponding evidence.

### Review feedback — round 1

Primary verification reproduced loss of an existing `__proto__` Secret after saveNow followed by a second import. Vault persistence reconstructs ordinary objects, and cloneVaultData assigns the prototype key through the inherited setter. Repair cloning to preserve every own key safely regardless of source prototype, and extend the same public coordinator regression to save/reopen/subsequent import. Remove unused import revision/disk-fingerprint facade methods and preview fields left from the abandoned custom persistence path. Harden file open/read by validating the opened descriptor as regular (nonblocking open avoids a replaced FIFO hanging), not only the pre-open pathname stat. Add current public-boundary proof for pending file clear/capture-binding discard and the 5,000 assignment/1 MiB limits and malformed quoted/fenced inputs. Freeze after focused checks for primary verification.

### Review feedback — round 2

Independent focused suite: 34/34 pass; JS lint and baseline Git checks pass. A deterministic primary FS-gated scenario still accepted a queued commit after switching the active Vault while its prior save was pending. Revalidate the complete review target and all relevant Secret state at the queue's actual batch execution boundary, after waiting and before mutation. The proof must reject switch/clear/relevant-change while waiting and leave both Vaults unchanged, while permitting unrelated changes. Do not fix this only at the IPC adapter.

### Implementation evidence

Primary independently verified `node --test test/env-text-import-coordinator.test.js test/vault-session-integration.test.js test/vault-lifecycle-primitives.test.js test/vault-reconciliation.test.js`: 35/35 passed, Node v24.21.0, real temporary Vaults. `npm run lint:js` and `git diff --check` passed. Reviewed every changed file and persistence/reconciliation callers; unrelated baseline files, HEAD and index preserved. Requested worker: gpt-6-luna, /root/luna_import_core; two correction rounds. Source hash evidence: `/private/tmp/localkeys-import-1-accepted.json`. IMPORT-2 is runnable.

### Post-acceptance integration finding

Primary saved an empty Project before previewing `constructor` and `__proto__`; preview returned IMPORT_TARGET_UNAVAILABLE. Snapshot/batch key lookup must distinguish own keys from inherited properties after persistence reconstructs ordinary objects. Revisit IMPORT-1 after the current UI writer freezes, using the same Luna worker and remaining third correction round; do not run simultaneous writers. Prior accepted evidence remains recorded but does not prove this case.

## IMPORT-2 — Shared Paste/File desktop flow

Implementation: resolved Blocked by: IMPORT-1 Build Input/Review dialog, diagnostics, explicit duplicate choices, safe action defaults, timed reveal, Back/Cancel, cleanup and accessibility. Own Project view/styles and English locale strings. Verify interactions with synthetic credentials.

Claim time: 2026-09-30T21:36:47.768995+00:00 Worker: /root/luna_import_ui Requested model: gpt-6-luna (high) Review rounds: 3 Expected files: Project view, Project CSS, English locale.

### Acceptance and verification plan

- [x] Shared Paste/File Input→Review flow matches coordinator contract and clearly displays target.
- [x] Malformed input remains editable with line diagnostics; duplicates require explicit occurrence or Skip choice; safe defaults protect existing/empty/identical values.
- [x] Review supports masked values, timed reveal/hide, truthful summary and explicit import.
- [x] Back/Cancel/source switching/session closure/navigation clear or invalidate correct state; late replies cannot reopen/reveal stale content.
- [x] Keyboard focus trap/restoration, labels/statuses, scrolling at 680×500 and desktop layout work. Worker: UI implementation and focused inline-JS/CSS lint; no tests at new seams. Primary: inspect complete diff; independent isolated Electron 44.4.4 desktop fixture uses actual view, synthetic data and real coordinator against agreed bridge contract to exercise all changed interactions and capture desktop/minimum-window appearance. Final IMPORT-3 uses production preload/IPC and full-suite verification. Reuse IMPORT-1 tests only if backend hashes/dependencies unchanged; UI or bridge changes invalidate native evidence.

## IMPORT-3 — Electron integration and documentation

Implementation: resolved Blocked by: IMPORT-1, IMPORT-2 Wire narrow preload and IPC adapters, session/navigation cleanup and safe logging. Remove old file-only import. Document feature, update release notes and spec status; run full checks and desktop verification.

Claim time: 2026-09-30T22:05:08.123695+00:00 Worker: /root/luna_import_integration Requested model: gpt-6-luna (high) Review rounds: 1 Expected areas: main/preload, production import IPC module, ESLint registration, import documentation/product/design context, release notes.

### Acceptance and verification plan

- [x] Real preload/IPC routes both sources through the coordinator; file selection outside lease and bound to original target; renderer cannot submit paths/values.
- [x] Session/navigation/window/Vault switch cleanup and safe errors/logging have production coverage; old file-only path removed.
- [x] User docs, release notes and design/product context describe actual safe defaults and grammar limits. Worker: focused adapter checks only for distinct transport behavior, JS lint and full npm test/lint when frozen. Primary: full diff and caller review, independent actual production IPC/preload Electron fixture with synthetic Vault/Paste/File/cancellation/lifecycle; current coordinator36/36 reused if backend unchanged; full npm test/lint on combined final source.

## IMPORT-4 — Review and fixes

Implementation: resolved Blocked by: IMPORT-3 Independent primary review of the combined spec, checks and integration evidence; complete tracker and lock cleanup. Existing empty worktrees from the superseded implement-spec workflow are retained because the current implement workflow authorizes no new Git operations.

Worker: primary acceptance reviewer; implementation corrections return to the owning Luna worker. Review rounds: 0

### Acceptance and verification plan

- [x] Combined implementation satisfies all approved stories and remains one authoritative import path.
- [x] Required full checks and production desktop verification have current independent evidence.
- [x] HEAD/index and preexisting unrelated files are preserved; lock removed after all tickets resolve.

## Shared contract

Renderer bridge:

- importPreview(projectName, { source: 'text', content } | { source: 'file' }) -> { success, handle, target: { vaultName, projectName }, entries, diagnostics }; cancelled for file-picker cancel. Main process supplies file path internally only.
- entries: [{ key, occurrences: [{ id, line, empty, status: 'new'|'changed'|'identical', defaultAction: 'add'|'skip' }], duplicate: boolean }]. No plaintext values in preview. Changed entries default to skip (UI labels Keep).
- diagnostics: [{ line, code, message }]; any diagnostics block Review. Empty input has a safe diagnostic.
- importReveal(handle, key, occurrenceId) -> { success, value }.
- importCommit(handle, decisions) -> { success, count, added, replaced, skipped }; decisions: [{ key, occurrenceId, action: 'add'|'replace'|'skip' }]. Unresolved repeated keys require occurrence selection or skip with null occurrenceId.
- importDiscard(handle) -> { success }; cleanup is idempotent.
- failures: { success: false, code, error }; no secret content in errors.

Coordinator public methods: preview(projectName, input), reveal(handle, key, occurrenceId), commit(handle, decisions), discard(handle), clear(). Constructor takes { session }. File input uses { source: 'file', filePath } after native selection. For file-picker targeting, captureTarget(projectName) returns a binding usable as optional third preview argument to reject stale selection. Runtime clear on session closure/navigation is required.

### IMPORT-1 correction round 3

Reopened after UI writer froze. Fix own-key snapshot and batch lookup after persisted ordinary maps, and preserve safe new prototype-named key insertion. Primary will independently rerun coordinator and lifecycle integration checks plus persisted-empty-Project regression. UI remains frozen pending acceptance.

### IMPORT-1 final acceptance

Primary independently verified 36/36 real coordinator/session/lifecycle/reconciliation tests, JS lint and diffcheck. Persisted-empty-Project constructor/**proto** regression and inherited Project rejection pass. Round-3 baseline permits only Vault/test edits; HEAD/index and unrelated files match. Source evidence /private/tmp/localkeys-import-1-final-accepted.json, Node v24.21.0. Three correction rounds; same requested Luna worker.

### IMPORT-2 review feedback round 1

Primary Electron fixture passed duplicate block, reveal/blur, Replace selection, Back reset, Cancel no-write and successful commit. Visual capture exposed malformed section close: importReviewStep closes div, producing detached footer and broken modal presentation. Repair section structure and verify footer belongs to modal with Input/Review hidden buttons respected. Primary minimum-window attempt was intercepted by existing inspector; close inspector in fixture before testing. Source hashes will be recorded after correction; backend 36/36 evidence is current.

### IMPORT-2 review feedback round 2

Corrected desktop review looks coherent and footer is contained. Independent native flow then found reopening after successful commit retains disabled textarea/source controls: setImportBusy(true) disabled DOM before cleanup nulls state, and open does not reset controls. Reset busy/disabled/button text on every fresh open, including rapid Cancel while preview pending. Prove successful commit then reopen editable, and pending cancel then reopen editable; retain epoch guards.

### IMPORT-2 review feedback round 3

Independent main UI run passes timed 30s reveal, blur, default/duplicate/Replace/Back/Cancel, reopen after commit, diagnostics, all-Skip disabled, File import, pending picker Cancel and lock cleanup. Separate FS-free delayed-commit fixture exposes incoming value staying revealed on blur during pending commit because hideAllImportValues returns when busy. Always mask/clear reveals on blur while retaining disabled controls during commit. Final correction; primary will rerun busy-blur and pending-reveal response races.

### IMPORT-2 implementation evidence

Primary independently exercised actual Project view in Electron44.4.4 with real temporary Vault/coordinator and synthetic bridge fixture: Paste/File, masked/default actions, duplicates, Replace, Back source/reset, Cancel no-write, 30s reveal/blur, all-Skip disabled, success/reopen, diagnostics, native-picker late Cancel, lock cleanup, keyboard trap/restore and 680x500 scrolling. Main run passed; final busy-commit blur and pending-reveal blur passed. JS/CSS lint and diffcheck pass. Three correction rounds, requested GPT-6 Luna /root/luna_import_ui. Primary visual captures /private/tmp/localkeys-import-verify/review.png and minimum.png; source evidence /private/tmp/localkeys-import-2-accepted.json. Production adapters remain IMPORT-3.

### IMPORT-3 final documentation correction

Primary independently verified final combined source: npm test93/93; npm run lint and diffcheck; actual production preload/IPC synthetic Electron run, pending commit/reveal blur and transport scenarios all pass. Finalize spec status to implemented and verified, linking evidence tracker, then freeze. No code change is required; source/native evidence remains valid.

### IMPORT-3 implementation evidence

All acceptance checks verified independently; implementation worker /root/luna_import_integration requested gpt-6-luna high, one docs-only final correction. npm test93/93 and npm run lint pass. Production Electron44.4.4 actual preload and IPC registration: shared full flow, 30s masking/blur, delayed reply races, file cancellation, keyboard/minimum window, lock, renderer-path rejection, authoritative values, old discard preserving new preview, navigation invalidation and count-only logging pass. Reviewed entire adapter/main/preload/docs/config diff. Existing baselines, branch codex/env-text-import, HEAD cc5883d7e3b494207de510065cd4a9ea81b5279f and clean index preserved. Final source/runtime proof is recorded in env-text-import-verification.md.

### IMPORT-4 final acceptance

Primary reviewed the combined implementation against the full spec and all29 user stories; no unresolved correctness or scope issue remains. Reused current independently verified final source results recorded in env-text-import-verification.md: 93/93 tests, repository lint/diffcheck and actual production Electron scenarios. Only docs/tracker status changed after those results. No implementation commits, staging, branch changes, push or PR. All four tickets resolve; implementation lock removed. Existing pre-workflow-change empty worktrees remain untouched.
