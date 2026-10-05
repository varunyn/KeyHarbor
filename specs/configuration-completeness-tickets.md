# Configuration completeness implementation tickets

Spec: [Project configuration completeness](configuration-completeness.md). Tracker: repository Markdown. Label: ready-for-agent. Confirmed test seam: public Project operations through a real temporary VaultSession, plus isolated desktop checklist verification. Workflow when implementation is requested: implement skill, explicit GPT-6 Luna workers, one writer at a time; primary reviews and independently verifies. No implementation lock or worker is claimed during specification.

## COMPLETE-1 — Persist Project requirements safely

Implementation: resolved Blocked by: none Expected areas: Project baseline schema/validation, guarded mutation, normalization, semantic snapshots, reconciliation, recovery and encrypted backup. Claim time: 2026-10-01T00:01:16.990583+00:00 Worker: /root/luna_completeness_storage Requested model: gpt-6-luna (high) Review rounds: 1 Baseline: /private/tmp/localkeys-complete-1-baseline.json No previous completeness evidence exists. Final full-suite/native checks run after COMPLETE-3; focused real storage/lifecycle/reconciliation checks run for this ticket.

### Acceptance

- [x] Optional validated baseline has unique requiredKeys, revision and updatedAt; absent field stays compatible and Not configured.
- [x] Replacement/clear atomically preserves all Secrets, histories, favorites and unrelated data through normal persistence.
- [x] Save/reopen, recovery and encrypted Project backup preserve requirements; existing Projects need no default rewrite.
- [x] Three-way merge preserves one-sided/equal-set changes and independent Secret edits; divergent sets, clear/edit and delete/edit require explicit resolution.

### Verification plan

Worker uses TDD through real Project/VaultSession boundaries and distinct existing reconciliation integration scenarios. Primary reviews serialization and every merge/adoption path, independently runs real encrypted storage/lifecycle and reconciliation checks. Code/dependency/fixture changes invalidate affected evidence.

### Implementation evidence

Primary independently verified 60/60 storage/session/recovery/reconciliation/import tests, independent /private/tmp/localkeys-completeness-verify/storage-probe.cjs (present baseline save/reopen, prototype-named requirements, metadata/history preservation, no-op, invalid replacement and stale clear), npm run lint:js and diffcheck. Node v24.21.0, real encrypted temporary Vaults. Complete changed-file/caller review; worker scope, HEAD/index and unrelated files match baseline. Requested gpt-6-luna high, /root/luna_completeness_storage, zero correction rounds. Current source identity /private/tmp/localkeys-complete-1-accepted.json. COMPLETE-2 is runnable.

### Post-acceptance boundary finding

Primary real Vault probe passed a sparse requiredKeys array (new Array(1)); replace accepted and installed requiredKeys [null], violating validated/atomic baseline admission. Array.some skips holes. Reopen COMPLETE-1 for its same Luna worker after current COMPLETE-2 writer freezes; one focused invalid-input regression and validation fix, then rerun affected proofs. No concurrent writers.

## COMPLETE-2 — Main-process template review and evaluation

Implementation: resolved Blocked by: COMPLETE-1 Expected areas: session-gated public Project completeness/template operations, shared parser reuse, opaque handles, queued target validation and authoritative evaluation. Claim time: 2026-10-01T00:12:45.924683+00:00 Worker: /root/luna_completeness_core Requested model: gpt-6-luna (high) Review rounds: 0 Baseline: /private/tmp/localkeys-complete-2-baseline.json Focused real public-boundary tests and JS lint during this ticket; full-suite/native final after COMPLETE-3. Reuse COMPLETE-1 evidence only if storage/fixture inputs unchanged; rerun affected lifecycle/reconciliation/import paths if shared modules change.

### Acceptance

- [x] Statuses/counts reflect exact own keys, zero-length emptiness, expiry boundaries and extra keys; invalid metadata cannot produce false readiness.
- [x] Paste/File template preview strips values, collapses repeated names and reviews added/removed/unchanged keys; malformed/empty input blocks saving.
- [x] Commit replaces requirements only; unchanged set is a no-op; reviewed clear returns Not configured without Secret mutation.
- [x] Target/baseline/session lifecycle and delayed/queued races reject stale mutation while independent Secret changes remain allowed.
- [x] Payloads, diagnostics, logs and retained previews exclude source values/paths; existing credential import remains intact.

### Verification plan

Worker tests observable public Project operations with real temporary VaultSession; reuse shared parser evidence and add only template-specific behavior. Primary independently verifies all status and state-transition boundaries, atomic rejection and persisted results, with controlled production evaluation time for expiry.

## COMPLETE-3 — Project checklist and Electron integration

Implementation: resolved Blocked by: COMPLETE-2 Expected areas: Project UI/CSS/English locale, narrow preload/IPC, native selection and lifecycle hooks, docs/product/design/release notes. Worker: /root/luna_completeness_ui Requested model: gpt-6-luna (high) Review rounds: 1 Baseline: /private/tmp/localkeys-complete-3-baseline.json

### Acceptance

- [x] Project summary and checklist distinguish Not configured, readiness, loading and unavailable/error states without exposing values.
- [x] Input/Review/save, refresh diff, clear, Back/Cancel and fill-gap editor flows are labelled, accessible and preserve existing Secrets.
- [x] Secret changes, import/restore/reconciliation, focus and next expiry refresh results; timers/drafts/revealed state cannot survive dismissal or lock.
- [x] Production adapters forbid renderer paths, bind file selection outside leases, and guard late replies/handle cleanup.
- [x] Existing dark desktop conventions and minimum-window scrolling hold; user documentation and release notes describe the actual boundaries.

### Verification plan

Worker performs focused bridge/UI checks. Primary independently runs actual production preload/IPC and Project view in isolated Electron with a real temporary Vault and synthetic credentials; verifies keyboard, small-window, fill-gap, expiry and cancellation/lifecycle scenarios. Native evidence identifies exact source/runtime/fixtures.

## COMPLETE-4 — Combined acceptance

Implementation: resolved Blocked by: COMPLETE-3 Expected areas: independent primary review and evidence; any implementation corrections return to the responsible Luna worker.

### Acceptance

- [x] Full spec and all user stories are met with no unresolved correctness or scope issue.
- [x] Full repository tests, JS/CSS lint, diff checks and required native scenarios pass on current combined source.
- [x] Per-ticket source/runtime evidence, requested worker models and review rounds recorded; unrelated user changes preserved.
- [x] Tracker resolves and owned implementation lock is removed. Commit/push/PR require explicit user authorization.

### Verification plan

Primary reviews combined diff and current independent evidence. Reuse results only when affected source, dependencies, configuration, fixture and runtime remain unchanged. Reopen the owning ticket for failures; no primary takeover of implementation fixes.

COMPLETE-1 correction round 1: reopen after COMPLETE-2 froze; reject sparse arrays at admission and demonstrate unchanged state through the real public mutation boundary.

Independent acceptance update: COMPLETE-1 correction round 1 passed current 36/36 storage/reconciliation/coordinator checks, JS lint, diffcheck and real storage probe. COMPLETE-2 passed independent 20/20 coordinator/import checks plus real lifecycle probe (discard, reincarnation, stale bound baseline, lock/reopen, clear generation), full source review. No unresolved issue; core zero formal corrections. Node v24.21.0. COMPLETE-3 claimed for native/UI integration; full suite and native scenarios remain.

COMPLETE-3 claim: 2026-10-01T00:24:00.851338+00:00; requested gpt-6-luna high; review rounds 0; baseline /private/tmp/localkeys-complete-3-baseline.json.

COMPLETE-3 worker: /root/luna_completeness_ui; explicit spawn accepted gpt-6-luna high.

COMPLETE-3 review round 1: native setup/Back/Cancel/save/editor/clear/file/expiry/lock and edge scenarios pass; 115/115 full tests, JS/CSS lint pass. Remaining user story 33: README explains presence vs credential validity, but interface only says Ready. Add concise localized explanation within template/checklist interface, preserving compact min-size layout. Also update spec status to implemented and verified after this correction passes. Primary will verify copy and one final bounded visual confirmation; core tests can reuse unchanged inputs.

COMPLETE-3 implementation evidence: primary independent real Electron 44.4.4 production preload/adapter/Project view accepted complete workflow and final copy confirmation at1150×760 and680×500. Edge run accepted prototype names, import-triggered refresh, safe malformed diagnostics, forbidden renderer paths, focus during picker and200-key scrolling. Node v24.21.0;115/115 full repository tests and JS/CSS lint pass. Sparse admission correction1 storage; core0 corrections; UI1 formal copy correction. Existing source/runtime unchanged for reused tests, edge checks and detector after locale/spec-only correction. Preexisting .agents/skills-lock preserved, HEAD/index unchanged. COMPLETE-4 primary combined review claimed.

## Final implementation evidence

All four tickets resolved after primary combined spec/diff review and current independent evidence recorded in [verification](configuration-completeness-verification.md). No unresolved product or acceptance issue. Node/Electron source/runtime identities and legitimate evidence reuse are recorded there. Owned implementation lock removed after resolving graph. All changes remain uncommitted on codex/env-text-import; preexisting user changes preserved.
