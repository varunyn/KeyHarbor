# KeyHarbor agent guidelines

## Start here

- [PRODUCT.md](PRODUCT.md) describes the current product and its boundaries.
- [DESIGN.md](DESIGN.md) describes UI decisions and component reuse.
- [README.md](README.md) documents setup, builds, and supported workflows.
- [docs/code-quality.md](docs/code-quality.md) explains lint enforcement and migration debt.

Keep these documents current when their contracts change. Remove obsolete guidance instead of adding historical copies or competing specifications.

## Security and data

- Encrypt Vault contents at rest with AES-256-GCM. Never add telemetry, credential exfiltration, or unapproved network requests.
- External CLI, MCP, HTTP, and agent credential access must go through desktop approval. Never bypass or silently auto-approve it.
- Keep credentials masked by default. UI reveals require explicit action, a 30-second limit, and hiding on window blur. Never write credential values to logs. Preserve clipboard clearing and main-process checks.
- Show only real Vault records, history, and logs. Do not fabricate identities, deployment state, integrations, or credential validity.
- Preserve `Vault → Project → Environment → Secrets` ownership. Environments are isolated: missing keys never fall back. Callers omitting an Environment resolve to the stored default ID, independently of desktop selection.
- Keep documentation, comments, logs, diagnostics, and agent instructions in English unless the user explicitly requests otherwise.

## Source map

| Area | Location |
| --- | --- |
| Electron lifecycle and IPC | `src/main.ts`, `src/preload.ts` |
| Vault, crypto, transports, import, and logging | `src/modules/` |
| CLI and MCP | `cli/` |
| Home and Project screens | `src/dashboard/`, `src/project/` |
| Access Logs | `src/logs/` |
| Shared renderer infrastructure and other screens | `src/renderer/` |
| Shared UI controls | `src/renderer/ui/` |
| Styles and HTML entry templates | `src/styles/`, `src/views/` |
| Native proxy and macOS window bridge | `native/` |
| Build tools and tests | `scripts/`, `test/` |

## Implementation rules

- Before adding complexity for a speculative or vanishingly unlikely race or security edge case, explain the concrete failure mode, likelihood, and complexity cost to the user and get their buy-in. Do not silently expand scope for theoretical robustness.
- Use React with strict TypeScript for renderer work. Keep TypeScript as the source of truth for new application, CLI, and tooling code; do not add handwritten JavaScript duplicates or rely on Node's native TypeScript stripping. Existing JavaScript modules remain until deliberately migrated.
- Backend, CLI/MCP, and test tooling support Node.js 20.19+ and 22.12+. Keep renderer-to-main IPC typed through `src/project/bridge.ts` and `window.keyharbor`.
- Reuse existing UI controls and workspace patterns first. If a control is missing, adapt shadcn/ui with Radix primitives and shared theme tokens. Use existing Lucide icons and cmdk patterns where applicable.
- Prefer Tailwind utilities. Add custom CSS only when the existing system cannot express the requirement clearly; explain why. Put reusable controls in `src/renderer/ui`, theme values in `theme.css`, Tailwind mappings in `ui.css`, and page composition in page styles. Do not duplicate controls or put every reusable pattern in `common.css`.
- Load styles in this order: `common.css`, `theme.css`, `ui.css`, then page CSS. Tailwind utilities omit Preflight.
- Route all user-facing text, including accessible labels, through `i18n.t()` with source translations in `src/locales/en.json`.
- Preserve shared sidebar state, native zoom, typography, and icon sizing across pages. Follow DESIGN.md for platform fonts, materials, and accessibility.

## Required workflow

1. Before the first code edit, complete and record the baseline: read `oxlint.config.mts` and [code quality](docs/code-quality.md), run `npm run check`, and count the physical lines of every planned target. If a target is at its limit, plan its extraction before extending it.
2. For every JavaScript or TypeScript change, run `npm run check:anti-slop -- <affected-files>` twice: once before the first edit and again after the final edit. Keep the pre-edit result distinct from new findings; do not weaken validation or type safety to silence either, and report unresolved findings.
3. After each cohesive change, run `npm run check -- <changed-files>`, including new modules and tests. Fix new lint and formatting failures before building on the change. Use `npm run fix -- <paths>` for formatting only; avoid broad unused-code autofixes on CommonJS exports.
4. Before finishing, run `npm run check` across the repository. For backend, CLI, or tooling changes, also run `npm run check:backend`; for renderer changes, run `npm run typecheck:renderer`.
5. Run `npm test` and ensure all tests pass before completing code changes. For native proxy changes, also run `npm run test:proxy`. For UI changes, verification is incomplete until the renderer is built and the affected pages and changed interactions are inspected with synthetic data at normal and narrow widths in both themes. Documentation-only changes require formatting and link checks.
6. Report what was verified and distinguish pre-existing failures from new failures.

JavaScript and TypeScript files, including components and tests, must stay at or below **500 physical lines**, including blank lines and comments. Existing oversized files have temporary ceilings in `oxlint.config.mts`. Never raise them, add exceptions, suppress `max-lines`, or disable rules to make a change pass. Lower ceilings as files shrink and remove exceptions when files fit the default limit.

Split by responsibility: components, hooks, domain operations, or transport adapters. Keep entrypoints focused on composition. Do not use numbered chunks, compressed formatting, or unrelated generic utilities to evade limits. Any proposed policy exception requires a concrete rationale for user review before changing enforcement.

## Commits and releases

Use conventional commits: `feat:` for capabilities, `fix:` for bug fixes, and `docs:`, `chore:`, `refactor:`, `test:`, or `ci:` for maintenance. Keep commits focused and preserve unrelated work.

Release Please prepares release PRs from changes on `main`. Merging a release PR creates the versioned release; the release workflow builds and uploads platform artifacts. See `.github/workflows/release.yml` for the actual triggers. Do not describe every merge to `main` as publishing a release.
