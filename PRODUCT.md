# KeyHarbor

<!-- impeccable:product-schema 1 -->

## Platform

web

The interface is a React renderer inside an Electron desktop app for macOS, Windows, and Linux. It runs locally, with CLI, MCP, and HTTP access through the desktop process.

## Users

Developers and small teams managing application credentials and environment variables on their own machines, including people using terminals and coding assistants.

## Product purpose

A free, MIT-licensed local secrets workspace. KeyHarbor helps users organize credentials, find missing or expired configuration, review changes, and explicitly approve external access. Core Vault workflows work offline and require no account, subscription, or activation.

## Current capabilities

- Multiple encrypted Vaults, with Projects containing isolated Environments and Secrets. A missing Secret never falls back to another Environment. Callers that omit an Environment use the stored default, independently of desktop selection.
- Secret creation, editing, deletion, descriptions, tags, expiration, favorites, version history, and restore. Home provides Project search, sorting, favorites, and optional statistics.
- Required-key baselines for each Environment, populated from `.env.example` templates. Checks report Missing, Empty, Expired, or Ready from stored data; template values are ignored, and readiness does not validate credentials or connectivity.
- Pasted-text, file, and Project-folder imports with masked review and explicit duplicate decisions. Folder scanning is bounded, reports Git warnings and missing template keys, and requires an explicit destination Environment. Source files and Git ignore rules remain unchanged.
- Exports of keys-only templates, literal Secret references, encrypted backups, and raw values. Raw exports require warning, re-authentication, and audit recording. References do not imply a resolver or deployment integration.
- CLI, MCP, and HTTP operations through desktop approval. Existing credential-reading operations can return approved values; `keyharbor run` injects approved values into a child process.
- Approved credential use through authenticated HTTPS requests and scoped agent proxy sessions. The proxy substitutes a credential upstream without returning its value to the agent. Connection and request approvals remain explicit; locking the Vault revokes sessions. This feature does not sandbox the calling process.
- Access Logs with search, category filtering, export, and confirmed clearing. Settings include auto-lock, optional Touch ID on supported Macs, screen-capture protection, updates, and disk synchronization.
- On-disk Vault synchronization and conflict reconciliation for externally changed files.

## Security and data rules

- Vault contents are encrypted at rest with AES-256-GCM. Keep credentials local; do not add telemetry or unapproved outbound requests.
- Secrets are masked by default. Reveals are deliberate, time-boxed, and hidden on blur. Preserve clipboard clearing and main-process enforcement for sensitive operations.
- External CLI, MCP, HTTP, and agent credential access must pass through desktop approval. Never silently bypass or auto-approve it.
- Core workflows work offline. Network activity includes optional release checks and user-approved credential-use requests; do not describe the application as incapable of network access.
- Environment names are local collection labels, not deployment state or access permissions. Show only real Vault data, recorded history, and logs. Do not invent users, owners, deployments, integrations, credential validity, or percentage health.
- Versioned Vault migrations preserve recovery copies. Installations sharing a Vault must use compatible versions; rollback requires restoring the corresponding encrypted file set.

## Interface and brand

Use the KeyHarbor name and existing logo assets. Write direct, technical English; route user-facing copy through translations.

The interface is compact, keyboard-accessible, and consistent across pages. Reuse existing shadcn/Radix controls and Tailwind utilities. Home, Project, and Access Logs share navigation and the saved sidebar preference; native zoom stays consistent across main workspace pages. Support both themes and system accessibility preferences.

[DESIGN.md](DESIGN.md) owns UI guidance. Exact colors, sizes, and control behavior live in source code. [AGENTS.md](AGENTS.md) owns contributor rules, and [README.md](README.md) documents setup and supported workflows.
