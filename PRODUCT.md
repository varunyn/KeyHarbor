# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers and small-team operators who manage application secrets (env vars) on their own machines — primary use is a desktop user on macOS (Windows secondary) curating production credentials for apps they deploy, plus CLI/MCP-driven access from terminals and coding agents.

## Product Purpose

KeyHarbor encrypts secrets locally (AES-256-GCM vault) and manages them through a GUI plus a CLI/MCP with explicit approval prompts. Success means: no secret is ever exposed by default, every read/write is deliberate and user-approved, and the tool works fully offline.

## Positioning

A free local secrets workspace for developers who want to see missing, empty, or expired configuration, review changes, and approve access from terminals and coding assistants. Core workflows work offline. Open-source publication is pending clarification of upstream licensing.

## Operating Context

- Desktop Electron app (Electron 44, Node.js 20.19+ or 22.12+): multiple windows (main, approval prompt, lock/setup gates).
- Developer workstation workflows: `.env` files, docker-compose, terminals, coding agents via MCP.
- Multiple vaults (system vault + imported `.lkv` folders), switchable from the dashboard; periodic on-disk sync with three-way merge on external changes.
- Fully offline core; optional network only for optional GitHub release checks.
- English-only repository content (AGENTS.md).

## Capabilities and Constraints

- GUI screens: lock, setup, dashboard (projects), project secrets screen (the redesign target), settings, logs, approval prompt.
- Secrets CRUD with per-key version history (last 50 versions) and restore; expiration dates (`expiresAt`); favorites (projects + per-project secret keys); statistics; encrypted app logs (access/app/lock categories).
- Vault → Project → Environment → Secret ownership. Each Environment owns an isolated Secret collection and optional required-key baseline; new Environments start empty, and missing keys never fall back. Migration places legacy data into an Environment initially named `default`. The stored default Environment ID is the stable omission target: rename preserves it, while deleting it requires a replacement and changes the target. CLI/HTTP/MCP omission behavior is independent of desktop selection.
- CLI `--env`, HTTP/MCP `environmentName`, metadata-only Environment discovery, selected-Environment credential exports, and all-Environment encrypted Project backups. Reference exports are literal identifiers; no reference resolver or deployment integration is implied.
- Optional per-Project required-key configuration from pasted or selected `.env.example` templates, with Missing, Empty, Expired, and Ready checks against stored Secrets. Template values are ignored, and readiness does not validate credentials or connectivity.
- CLI (`keyharbor set/get/run`), MCP server, HTTP server — all funneled through approval prompts in the app.
- Renderer ↔ main via the typed `window.keyharbor` preload API (IPC). All seven views use React and strict TypeScript. Vite builds local renderer assets before app start and packaging.
- Styling: Tailwind CSS, editable shadcn/ui components, Radix interactions, and shared navy/cyan theme tokens. Vite bundles local CSS and assets for the renderer. Shared styles in `src/styles/common.css`, page-specific in `src/styles/<page>.css`, `common.css` loaded first (AGENTS.md).
- All UI copy routed through i18n (`i18n.t`), source strings in `src/locales/en.json`.
- Approved schema extension for secrets: optional `description` (string) and `tags` (string[]) alongside `value`/`expiresAt`; net-new app assumption — no legacy migration required.
- Approved backend work: four export modes (.env.example keys-only as recommended default, secret references, encrypted backup, raw values behind explicit warning + re-authentication + audit event) and a shared pasted-text/file import flow with bounded parsing, line diagnostics, masked review, explicit duplicate choices, and a main-process-validated batch commit. Raw-value export and import decisions must be enforced in the main process, not only in UI.
- Environment names such as `dev` and `prod` are labels for independent local collections; they do not represent deployment state, permissions, or external integrations. Environment metadata must come from persisted Vault records.
- Migration uses versioned encrypted files and preserves recoverable pre-migration Vault, salt, and manager configuration copies. Every installation sharing a Vault must upgrade together; earlier writers cannot round-trip named Environments. Rollback requires restoring the encrypted pre-migration file set together.
- Binding visual constraint (user-supplied brief): dark macOS desktop utility — charcoal backgrounds (#171717–#1E1E1E), surfaces #242424–#2A2A2A, macOS blue accent #0A84FF, muted green/amber/red status colors, SF Pro/Inter-like sans, 12–14px body / 16–18px section / 24px page title, 10–12px radii, SF Symbols-like icons, compact table as primary browse pattern, no oversized cards/gradients/heavy shadows, masked values only (no real sensitive data shown in repo or designs).

## Brand Commitments

- Name: KeyHarbor. Use the user-supplied cyan anchor/key shield with navy fill and gold trim, extracted onto a transparent background in `src/assets/keyharbor-logo.png`; packaged icons are `src/assets/icon.png` / `src/assets/macicon.png`.
- Voice: technical, direct, security-first; English only.
- Free to use with no activation, account, or subscription; preserve upstream attribution and resolve licensing before publication.

## Evidence on Hand

- User-provided reference image (secrets screen mock) — layout/composition reference, not brand authority.
- User brief with five synthetic sample rows (DATABASE_URL etc.) — labeled illustrative; shipped screen renders real vault data.
- Existing code: `src/views/project.html` (incumbent screen), `src/styles/common.css`, `src/modules/{vault,crypto,logger,dropdown,notification,i18n*}.js`, `src/locales/en.json`, `src/icons/*.svg` (lucide-style stroke icons).
- Absences that must not be fabricated: no user/owner/actor model (no "varun@…" identities), no deployment events, no per-secret usage graph, and no file references (docker-compose) knowledge. Audit/usage content is derived only from version history, structured encrypted app logs, and timestamps actually present.

## Product Principles

1. Masked by default; exposure is always explicit, confirmed, and time-boxed.
2. Every sensitive read/write goes through explicit user approval.
3. Local-first and fully offline for core workflows.
4. Desktop-native conventions: compact density, keyboard-first, discoverable via hover/focus states.
5. Honest data: never display invented metadata where the vault has none.

## Accessibility & Inclusion

- Brief requirements: strong visible keyboard focus, tooltips on icon-only controls, dark-mode contrast ≥4.5:1 body / ≥3:1 large, status never conveyed by color alone (always paired with text), destructive actions visually distinct and separated, semantic labels for screen readers, empty/loading/error states designed.

## Approved project secrets design update — October 2, 2026

The project secrets workspace uses the supplied navy/cyan design with locally bundled Geist and JetBrains Mono fonts. This supersedes the earlier charcoal/macOS-blue styling constraint for this screen only. The home Projects dashboard and other screens retain their existing materials. Preserve product truth and existing capabilities; omit unsupported hardware-enclave, leak-detection, and percentage-health claims from the prototype.

The Projects homepage uses the approved navy/cyan reference with bundled Geist and JetBrains Mono fonts, an expandable sidebar, statistics from the active Vault, and project cards with persisted Environment counts. Unsupported reference capabilities are omitted.

Homepage, project secrets, Settings, Access Logs, and Vault reconciliation controls use editable shadcn/ui components with Radix interactions and compiled Tailwind utilities. Shared theme styles are opt-in, keeping the existing renderer screens isolated during incremental migration.
