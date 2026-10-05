# KeyHarbor - AI Agent Guidelines

Welcome to KeyHarbor. These instructions provide operational rules, architectural constraints, and development standards for AI coding agents working in this repository.

---

## 1. Core Principles & Philosophy

- **Security & Privacy First**: KeyHarbor is a local-first, zero-knowledge secrets workspace. All secrets are encrypted at rest with AES-256-GCM. Never add telemetry, cloud exfiltration, or unapproved external network requests.
- **Explicit Access Approval**: External callers (CLI, MCP server, HTTP bridge) must always funnel through the desktop approval prompt (`ApprovalGate`). Never bypass or auto-approve requests silently.
- **Masked by Default**: Sensitive credentials must never be exposed as plain text in the UI or logs unless explicitly requested by the user and time-boxed (30s reveal / hide on window blur).
- **Honest Data**: Never fabricate metadata, user models, or deployment states. All visible states must trace to real vault evidence, version history, or audit logs.
- **Language**: Keep repository documentation, source comments, logs, diagnostics, and agent instructions in English only. Do not add non-English files unless explicitly requested.

---

## 2. Architecture & Directory Layout

KeyHarbor is an Electron desktop app with a React renderer and separate Node.js backend/CLI/MCP processes.

```text
├── cli/                 # Stdio CLI (keyharbor) and MCP v2 server (keyharbor-mcp)
├── src/
│   ├── main.ts          # Electron main process entry point & lifecycle
│   ├── preload.ts       # Typed contextBridge IPC (window.keyharbor)
│   ├── modules/         # Vault crypto, storage, HTTP bridge, and logger
│   ├── dashboard/       # React view for Vault and Project list
│   ├── project/         # React view for Secrets table, environments, & audits
│   ├── renderer/        # Shared React providers, Radix UI dialogs, i18n
│   ├── styles/          # common.css, theme.css, and page-specific styles
│   └── views/           # HTML entry templates for Electron windows
├── test/                # Node.js native test runner test suite
└── .github/             # CI, Dependabot, and Release Please workflows
```

---

## 3. Data Hierarchy & Environments

- **Hierarchy**: `Vault → Project → Environment → Secrets`.
- **Environment Isolation**: Each environment (`dev`, `staging`, `prod`) owns an isolated secrets collection. A missing key never falls back across environments.
- **Default Resolution**: Every Project maintains a stable default environment ID. External callers (CLI/MCP/HTTP) that omit an environment selector always resolve to this default, independent of whatever the user has selected in the desktop GUI.

---

## 4. UI & Styling Guidelines

### Technology Stack

- **React 19** + **Strict TypeScript**
- **Tailwind CSS v4** + **Radix UI** primitives + **Lucide icons**
- Bundled **Geist** (sans) and **JetBrains Mono** fonts

### CSS Architecture

- **`src/styles/common.css`**: Shared reusable components, design tokens, and utility classes. Place any pattern here that could naturally be reused across pages.
- **`src/styles/<page>.css`**: Page-specific layout or styles used exclusively on that page (e.g., `dashboard.css`, `project.css`).
- **Load Order in HTML**: Always load `common.css` before page-specific styles:
  ```html
  <link rel="stylesheet" href="../styles/common.css" />
  <link rel="stylesheet" href="../styles/<page>.css" />
  ```
- **Localization**: Route all user-facing UI text through `i18n.t()`, with source translations in `src/locales/en.json`.

---

## 5. TypeScript, Build & Tooling

### Strict TypeScript Standards

- Backend, CLI/MCP, and test source files target Node.js 20.19+ and 22.12+.
- Keep a single source of truth in TypeScript; never add handwritten JavaScript duplicates or rely on Node's native TypeScript stripping.
- Renderer-to-main IPC communication is strictly typed via `src/project/bridge.ts` and `window.keyharbor`.

### Code Quality & Formatting

- **Linting & Formatting Presets**: Managed via Ultracite and Oxfmt.
- **Check (Read-only)**: Run `npm run check` for read-only linting and style verification.
- **Backend Verification**: Run `npm run check:backend` to validate TypeScript types and backend lint rules.
- **Formatting a File**: Run `npm run fix -- <path/to/file>`. This command runs Oxfmt formatting only. Do not use broad unused-code autofix on converted CommonJS modules, where exports may be consumed through `module.exports`.

### Testing

- Run tests via `npm test` (uses Node's native `--test` runner).
- Always ensure all tests pass before completing changes.

---

## 6. Conventional Commits & Releases

This repository uses automated releases powered by **Release Please**:

- Use conventional commit messages:
  - `feat:` for new capabilities (triggers minor version bump)
  - `fix:` for bug fixes (triggers patch version bump)
  - `chore:`, `docs:`, `refactor:`, `test:`, `ci:` for maintenance
- Pull requests merged into `main` automatically update `CHANGELOG.md` and publish GitHub releases with multi-platform binary assets.
