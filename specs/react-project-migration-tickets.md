# React Project migration tickets

Spec: [migration](react-project-migration.md). Label: ready-for-agent.

## REACT-1 — Typed renderer build foundation

Implementation: resolved Blocked by: none Expected areas: dependencies/lockfile, Vite and strict TypeScript/lint config, typed bridge, static asset build, main renderer-page resolution and compatible subscription cleanup. Review rounds: 0

### Acceptance

- [x] Local Vite renderer build preserves vanilla pages and relative navigation; generated output ignored and packaged.
- [x] Start/platform build commands regenerate renderer; no remote production assets or stale fallback.
- [x] Project bridge types model actual production responses; necessary subscriptions can be cleaned up.
- [x] Main/Vault security and unrelated existing changes preserved.

### Verification plan

Worker runs typecheck/build/lint and relevant boundary tests. Primary inspects dependencies, copy/routing paths and every bridge type against production, independently builds and opens actual existing pages from generated output under Electron file URLs. Freeze before review; final full suite/native workflows after REACT-2. Any changed dependency/config invalidates affected previous evidence.

### Implementation evidence

Requested model: gpt-6-luna high; worker /root/luna_react_build; review rounds 0. Primary independently ran npm run build:renderer (strict TS + Vite 8.3.1), npm run lint, and /private/tmp/localkeys-react-verify/foundation.cjs with Electron 44.4.4. Project/dashboard/settings/logs built file URLs loaded; local linked assets existed, no failed asset requests, renderer require unavailable. Main routes, npm lifecycle build hooks, relative assets/CSS order, copied classic helpers and typed coordinator/getter envelopes reviewed. Baseline file hashes preserved outside declared implementation and tracker files; branch/HEAD/index unchanged. Core session/Vault files unchanged. Generated directory ignored; existing src packaging glob includes it. REACT-2 is runnable.

## REACT-2 — React Project screen and workflows

Implementation: resolved Blocked by: REACT-1 Expected areas: React components/hooks, Project HTML entry, localized presentation/CSS only as needed, usage/product/design/changelog docs. Review rounds: 2

### Acceptance

- [x] React owns Project shell/table/inspector/checklist and all existing dialogs/state; no old inline controller or injected HTML wrapper.
- [x] Existing CRUD/metadata/history/favorites/rotation/duplication, import/export and completeness behaviors preserved.
- [x] Sensitive async state, handles, listeners and timers clean up; keyboard, menus and minimum-size layout preserved.
- [x] Strict typecheck/build/lint and assigned focused checks pass; documentation reflects renderer architecture.

### Verification plan

Worker uses real public UI/Vault seam and appropriate focused checks, no redundant private hook tests. Primary reviews every component/hook and state transition, independently uses prepared isolated Electron production fixture for current workflows plus navigation, history/favorites/export/cleanup; batches desktop/minimum visual verification. Full suite/typecheck/lint/build final. Scope-preserving architecture refactor; no speculative UI changes.

REACT-2 claim time: 2026-10-01T04:21:09.063055+00:00; requested gpt-6-luna high; baseline /private/tmp/localkeys-react-2-baseline.json. Worker /root/luna_react_project; sole write-enabled implementation worker.

### Correction round 1

Primary review rejects current REACT-2: native production lifecycle.cjs demonstrated stale outside-menu state/two-click reopen, duplicate pending Save admissions and a late Save closing a newer dialog. Visual batch 1 found broken literal JSX icon asset; root local assets must be bundled. Source review found untranslated architecture docs, missing operation identity/busy/retirement for other mutation/raw/history flows and incomplete keyboard focus parity. Existing completeness run/edge/menu and production CRUD/export checks otherwise passed; affected evidence invalidated by corrections and will be rerun. Same worker /root/luna_react_project owns corrections.

### Correction round 2

Original round-1 lifecycle regression passed independently. Production import/30-second reveal and clipboard/native File/late-reply checks passed; clipboard harness corrected to await Electron 44 asynchronous API. Remaining native failures: lifecycle.cjs real BrowserWindow.blur leaves menu open; workflows.cjs cannot duplicate to Target35 because a shared switcher cap now limits duplicate targets, unlike legacy full target list. Same worker must close React menu on blur and separate full duplicate-target list from limited switcher list. No other changes requested.

### Accepted implementation evidence

Primary independently verified final strict build/lint, native lifecycle (including real blur), production CRUD/history/rotation/Target35 duplication/export, import and real 30-second timers, completeness boundaries, prototype keys, bounded lists and row menu interaction. Favorites persistence/views and React-to-vanilla Activity/Settings/switcher/dashboard navigation passed. macOS credential capability is disabled only in the synthetic navigation fixture; production code unchanged. Every input hash for the independent 115/115 test run still matches. Final visual batch accepted desktop and 680×500 menus/review with existing transient notification overlay. Requested worker gpt-6-luna high, /root/luna_react_project, two correction rounds. Unrelated baseline files, branch/HEAD/index preserved. REACT-3 is runnable.

## REACT-3 — Combined and packaged acceptance

Implementation: resolved Blocked by: REACT-2 Expected areas: primary independent review/evidence; implementation corrections return to responsible Luna worker. Review rounds: 0

### Acceptance

- [x] Full spec and Project behavior parity independently verified with no unresolved issue.
- [x] Full tests/typecheck/JS/CSS lint/build pass on current inputs.
- [x] Packaged local renderer assets and vanilla/React navigation verified; approved app update installed after clean quit.
- [x] Source/runtime/fixture evidence recorded, unrelated changes preserved, graph resolved and lock removed.

### Verification plan

Primary combined review, full checks and packaged source/asset validation using installed Electron tooling with isolated synthetic data. Reopen narrowest responsible ticket for failures; no primary implementation takeover, at most three corrections per ticket. No Git mutations.

REACT-1 claim time: 2026-10-01T04:07:14.552998+00:00; requested gpt-6-luna high; baseline /private/tmp/localkeys-react-1-baseline.json.

REACT-1 worker: /root/luna_react_build; sole write-enabled implementation worker.

REACT-3 claim time: 2026-10-01T05:26:00.788665+00:00; primary acceptance only, no production implementation edits.

### REACT-3 implementation evidence

Primary combined acceptance completed. See [verification](react-project-migration-verification.md) and exact [hash manifest](react-project-migration-evidence.json). All required current checks passed; macOS signed package archive matches generated assets and installed bundle, actual packaged executable verified with synthetic data. Baseline unrelated hashes and Git identity/index preserved. No production edits by primary. All blockers resolved; owned lock removed.
