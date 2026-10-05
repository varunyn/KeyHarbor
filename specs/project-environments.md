# Project Environments

Status: Implementation authorized by user on 2026-10-02. Tracker: repository Markdown tickets under project-environments/. Date: 2026-10-02.

## Problem Statement

A Project currently stores one collection of Secrets. Developers need different values for the same key in dev and prod without duplicating Projects, confusing approval prompts, or letting an operation silently use credentials from another environment. Imports, configuration completeness, history, favorites, CLI execution, and MCP access must agree on the selected target.

## Solution

A Vault contains Projects; each Project contains independent Environments. Each Environment owns its Secrets and optional configuration baseline. The desktop shows the selected Environment alongside the Project. Every secret operation targets exactly one Environment, and a missing key never falls back to another Environment.

Existing Projects migrate to an Environment named `default`, preserving their complete contents. Users can create empty `dev`, `prod`, or other named Environments. Names describe user intent; they do not create deployment integration or a separate encryption/authorization domain.

The user authorized implementation of this spec. Use isolated collections, neutral default migration, stable default selection, and confirmed rename/delete as recommended. Versioned encrypted files preserve old-writer isolation; every installation sharing a Vault must be upgraded.

## User Stories

1. As a developer, I want dev and prod inside one Project so that its identity remains coherent.
2. As a developer, I want the same key to hold independent values in each Environment so that credentials remain isolated.
3. As a developer, I want a visible current Environment so that I know what I am editing.
4. As a developer, I want missing keys reported without fallback so that dev cannot silently use prod credentials.
5. As an existing user, I want migration to preserve values, metadata, history, favorites, and requirements so that upgrading loses no context.
6. As an existing CLI user, I want omitted selectors to continue targeting the migrated collection so that desktop navigation cannot change script behavior.
7. As a developer, I want new Environments created empty so that creating dev does not copy prod credentials.
8. As a developer, I want to rename an Environment without changing its identity so that its history remains intact.
9. As a developer, I want deletion to identify the Environment and affected count so that destructive actions are deliberate.
10. As a developer, I want imports reviewed against the displayed Environment so that credentials reach the intended collection.
11. As a developer, I want independent required-key templates and completeness counts so that dev and prod can have different requirements.
12. As a developer, I want history, expiry, restore, favorites, search, and counts scoped consistently so that matching names remain distinguishable.
13. As a developer, I want approval prompts to show Vault, Project, Environment, keys, and action so that I can assess the actual request.
14. As a CLI user, I want an explicit environment flag for run, get, and set so that commands use the intended credentials.
15. As an MCP user, I want to discover and explicitly select Environments so that an agent does not infer my target.
16. As a developer, I want environment-qualified exports so that similarly named keys remain identifiable.
17. As a developer, I want backups to retain every Environment so that recovery restores the complete Project.
18. As a developer, I want concurrent edits in different Environments merged so that unrelated work does not conflict.
19. As a developer, I want stale reviews rejected after target replacement or deletion so that approval cannot authorize a different target.
20. As a keyboard user, I want accessible selection, management, and status labels so that this workflow is usable without a mouse.

## Architectural Review

No domain glossary or ADR directory existed at review time. Existing lifecycle, reconciliation, import, and configuration-completeness specs remain the foundation. Their earlier environment exclusions are extended by this requested feature; their other guarantees remain requirements. Existing design guidance forbids invented environment metadata: persist real Environment records before displaying them.

The strongest deepening opportunity is the Project Environment module inside the existing Vault-owned implementation. Its interface must own target resolution, identity validation, and scoped operations. HTTP and desktop IPC are two real adapters at this seam. Existing import and configuration modules consume the same target semantics rather than repeating selector rules.

Depth comes from concentrating compatibility, identity, freshness, and isolation behind that interface. Locality keeps fixes in one authoritative implementation; leverage applies them to desktop, CLI, MCP, import, export, and configuration checks. The deletion test supports this design: removing authoritative target resolution would redistribute the same rules across callers. A shallow selector helper that only forwards a name would add no useful depth.

Do not introduce an Environment manager that merely forwards to Vault, or generic storage adapters without a second concrete implementation. Retain VaultSession ownership of admission, cancellation, persistence, and closure.

### First-principles design review

If Environments were foundational, the credential collection would belong to an Environment from the outset. A Project would group those collections; a Vault would own encrypted persistence and session lifecycle. Project operations manage grouping, Environment operations manage collections and requirements, and Secret operations always receive an Environment target. This is the intended final design, delivered incrementally.

Use one explicit target object across production Secret operations instead of appending an optional environment argument to every existing positional call. The desktop supplies Project name and Environment ID; external adapters resolve Project and Environment names. The main process validates these inputs and captures the authoritative session-bound identity. A supplied target is a selector, never proof of admission. Keep transient admission identity out of persisted domain records.

Treat omitted external selectors as compatibility behavior at the external adapter seam. Once resolved, every internal operation has an explicit Environment target. Do not maintain both Project-level and Environment-level Secret maps, duplicate baselines, or separate implementations for default and named Environments. The compatibility rule must not spread through the implementation.

Keep Project backup/export distinct from Environment credential export in ownership and contracts. The former represents the complete grouping; the latter represents one collection. The existing `secrets.export(..., backup)` shape should be replaced internally by a Project backup operation rather than retaining a misleading Environment-targeted operation that ignores its target.

Selection, credentials, review handles, and async results form one Environment-scoped desktop state lifetime. A target change retires that lifetime and starts a fresh one. Reuse existing cancellation epochs and cleanup machinery under this single rule rather than adding independent environment checks to every dialog.

## Implementation Decisions — Proposed

### TypeScript delivery

- User explicitly requires files touched by implementation to migrate to TypeScript. Compile touched backend and tests to CommonJS-compatible output, preserving Node 20.19 support; do not rely on native type stripping. Untouched JavaScript can remain through an allowJs compilation path.
- Keep renderer and backend typecheck scopes distinct. Point Electron, CLI/MCP, package contents, and tests at the compiled runtime tree; mirror assets, locales, renderer bundles and package metadata needed by relative paths. Do not keep duplicate handwritten JavaScript implementations.
- Legacy converted helpers can retain implicit-any during this incremental migration; public/new model and transport contracts must be explicitly typed.
- Type Environment records, selectors, authoritative identities, operation results, and transport contracts; no blanket ts-nocheck or untyped rewrite disguised by an extension change.

### Domain and schema

- Environment identity is scoped to a Project and represented by a persistent opaque ID, a mutable unique name, creation/update timestamps, a Secret map, and an optional configuration baseline. A Project stores an Environment map keyed by ID and a `defaultEnvironmentId`.
- Secret identity becomes Project + Environment ID + key. Values, expiration, descriptions, tags, and history retain their existing record shape. Requirements move from Project to Environment. There is no shared collection, inheritance, interpolation, or precedence rule.
- Project favorites remain Project-scoped. Secret favorites become Project → Environment ID → key lists. Project statistics aggregate all Environments and count duplicate key names as distinct Secrets; Environment statistics count only the selected collection. Project listing retains `secretCount` as that aggregate and adds `environmentCount`; before migration its count is unchanged.
- Proposed name rule: lowercase ASCII letters, digits, hyphen, and underscore; begin with a letter; 1–64 characters; trim input before validation; unique per Project. No aliasing between prod/production or dev/development. Names are user labels, not permission levels.
- New Projects start with an empty `default` Environment. Additional Environments start empty. Rename retains ID. Deletion removes only the selected Environment and its favorites, requirements, and history; it requires confirmation and cannot remove the last Environment.
- The default Environment is a stable compatibility target. If deleting it, explicitly choose its replacement and warn that omitted CLI/MCP selectors will change target. Do not update it merely because desktop selection changes. Rename retains the default ID, so omitted selectors continue to reach the same collection.

### Migration and persistence

- Introduce an explicit new vault format version separate from the application version. Validate supported formats before normalization and mutation; reject unknown or mixed ambiguous shapes with a safe actionable error.
- Convert each legacy Project atomically: create one `default` Environment, move Secrets with all history/metadata, move its baseline unchanged, remap favorites, and set the default ID. Preserve Project metadata and vault identity. Do not label legacy contents dev/prod or duplicate values.
- Migration is idempotent. Use the existing encrypted atomic persistence path and disk-change detection; preserve a recoverable encrypted pre-migration copy before replacing the file. Failure must leave the original readable and must not report a successful upgrade.
- Normalize legacy disk/session/recovery data into the same model before comparison. Migration IDs must be consistent across the local snapshot and its reconciliation baseline. Two independently upgraded copies can assign different IDs: treat that case as an explicit whole-Project conflict rather than silently combining duplicate migrated Environments. Never drop either collection.
- Extend recovery snapshots, reconciliation baselines, encrypted Project backup formats, validation, and restore together. A legacy Project backup restores as one `default` Environment; a new backup restores the full Project atomically with ID/favorite mappings intact. Backup name collisions require reviewed handling, not silent merging.
- Downgrades are unsupported once migrated. The existing older implementation lacks adequate format gating and can normalize/rewrite unfamiliar data. New-reader checks alone cannot protect against old writers. Release acceptance requires an enforceable old-writer exclusion strategy or an explicit reviewed compatibility decision; do not describe unsupported downgrade as safely rejected by already-shipped releases. Document upgrading every installation that shares the Vault and restoring the encrypted pre-migration copy if rollback is necessary.

### Target interface and lifecycle

- Resolve an external target from Vault selection, Project name, and an explicit Environment name or omitted-selector policy. Produce authoritative identity containing Vault instance, active session generation, Project incarnation, Environment ID, and session incarnation. Callers never index nested storage directly or choose fallback behavior themselves.
- Desktop secret operations require the selected Environment ID. Legacy HTTP/CLI/MCP omissions resolve to `defaultEnvironmentId`, independently of desktop selection. An explicit unknown Environment fails; missing keys fail within that target.
- Rename does not retarget pending operations. Invalidate pending approval/review on rename so displayed labels must be reviewed afresh. Delete/recreate with the same name has a different ID and invalidates old handles. Reconciliation replacement and recovery must also refresh relevant incarnation checks.
- Imports and template reviews bind to Environment identity and their relevant Secret/baseline snapshots. Capture before native selection, revalidate after selection and immediately before queued mutation. Changes in a different Environment do not stale a review; target changes and relevant edits do. Clear drafts, handles, revealed values, and inspector state on Environment switching and existing lifecycle exits.
- Approval captures the resolved target and requested operation; revalidate after approval before reading or writing. Bulk reads must not release a pre-approval snapshot after a relevant change. Reject stale approval and request fresh approval. Bind approval to operation-relevant state rather than every unrelated Vault revision.
- All secret edits, rename/delete/history/restore, favorites, configuration reads/mutations, imports, and exports use the same scoped interface. Preserve current expiry, exposure, raw-export reauthentication, cancellation, and persistence semantics.

### Desktop, CLI, MCP, and exports

- Add a compact Environment selector near the Project heading. Show the name in edit/import/template/export confirmations and empty states. Switching closes or cancels pending target-specific workflows and prevents late replies from rendering in the new Environment. Keep masked defaults, keyboard access, textual labels, and existing density.
- Environment management supports create, rename, and confirmed delete. Copying/promoting credentials is deferred; use the existing reviewed import flow for deliberate transfer.
- CLI adds `--env=<name>` to run/get/set. Parse LocalKeys flags before the `--` separator; flags after it belong to the child command. Preserve existing omitted behavior. Add metadata-only environment discovery. Do not derive target from `NODE_ENV`, filenames, shell variables, or last desktop selection.
- Advertise Environment protocol support in server discovery/health and have new clients reject explicit Environment requests when the connected desktop server lacks it. An older dispatcher may ignore unknown selector fields; it must not silently answer a dev request from legacy/default credentials. Test this with a real incompatible server transport fixture.
- MCP adds optional `environmentName` to every Secret-related tool, including key listing and bulk writes, and metadata-only Environment discovery. HTTP accepts the corresponding selector and exposes discovery. Malformed or conflicting selectors fail before approval. First release Environment management is desktop-only.
- Approval display and sanitized access diagnostics include resolved Vault, Project, Environment, keys, and action. Values and raw input never appear in logs. Thread the captured target through the existing approval callback and rendering contracts.
- New access events carry structured target metadata: Vault instance, Project name, Environment ID and name at event time, key, and action. Usage views match exact fields, not message substrings; otherwise identical dev/prod keys or similar Project names can be attributed incorrectly. Keep readable messages for display. Preserve legacy events without inventing Environment identity; display them as legacy/unscoped and exclude them from Environment-specific usage claims. Environment rename preserves attribution by ID.
- Raw, keys-only, and reference exports contain only the selected Environment; suggested filenames include Project and Environment. Keys-only export still describes stored Secrets, not requirements. Encrypted Project backup includes all Environments and states that scope in its confirmation.
- Legacy `localkeys://<project>/<key>` text denotes the Project default. New exported reference text includes an encoded Environment query selector, for example `localkeys://myapp/DATABASE_URL?environment=dev`. Encode all user-controlled segments. The current import parser treats references literally and there is no resolver here; do not imply these strings fetch values. A future resolver is out of scope.

### Reconciliation

- Compare/merge Environment records by persistent identity, not display name. Independent Environment creation and independent Secret edits merge. Identical edits coalesce; divergent edits to the same Secret conflict with Environment-qualified display.
- Environment deletion versus editing its Secrets, metadata, baseline, or favorites requires explicit resolution. Divergent rename, same-name creation under different IDs, conflicting default selection, and a default pointing at a deleted Environment cannot produce an invalid merged Project.
- Preserve existing Secret history merge and configuration-baseline set/revision rules per Environment. Filter favorites only against the correct Environment. Project deletion versus any Environment edit retains existing Project-level conflict semantics.
- Conflict/recovery views show Environment identity and display name. Conflict decisions remain whole-plan decisions under existing lifecycle rules; do not introduce an unrelated reconciliation redesign.

## Testing Decisions

- Proposed primary seam: public scoped Project operations through a real temporary VaultSession. Exercise the production target interface; do not export private helpers solely for tests. Distinct HTTP/IPC adapter checks prove selector transport and approval admission. Existing real-file reconciliation and session fixtures provide prior art.
- Verify one key with different dev/prod values across create/read/update/delete, expiry, history restore, favorites, and import. Assert missing keys never fall back and another Environment remains unchanged. Check independent baselines and aggregate versus scoped counts.
- Verify legacy omitted selectors always target the default, explicit unknown selectors fail, and desktop selection does not affect external requests. Check CLI option parsing and MCP schema/transport behavior, including bulk writes and metadata-only discovery.
- Migration fixtures cover populated and empty Projects, complete Secret history, baseline revision, favorites, rollback copy, repeated load, save/reopen, legacy backup, and recovery. Unknown/malformed format fails without writing. Exercise independent-upgrade identity conflict behavior with real encrypted files.
- Reconciliation cases include different Environments with the same key, same-target divergent edit, rename/delete/edit, same-name creation collisions, default deletion/replacement, baseline conflicts, and favorite cleanup. Assert no lost collection and no invalid target references.
- Verify lock, Vault switch, Environment switch/rename/delete/recreate, native picker delay, stale approval, stale import/template handles, and delayed responses. Unrelated Environment changes remain permitted; relevant changes yield no partial write or disclosure.
- One isolated desktop run with synthetic credentials verifies selector, management, counts, target labels, masking, keyboard operation, cancellation, export scope, and conflict display. Implementation acceptance requires repository tests, lint, renderer typecheck/build, and recorded verification. Implementation must include meaningful public-contract tests.

## Delivery Order

1. Confirm isolation/default/deletion choices and old-writer compatibility strategy.
2. Add format validation, migration/recovery/backup, scoped Vault operations, and complete reconciliation support together; no mixed-format writes.
3. Carry target identity through imports, requirements, IPC, approvals, exports, and favorites; remove superseded Project-only paths.
4. Add desktop selection/management and CLI/MCP/HTTP selectors/discovery; document behavior and update release/design context.
5. Verify migration, isolation, lifecycle, concurrent files, and desktop behavior before release.

## Propagation Checklist for Implementation

This specification describes proposed behavior; shipped documentation and historical verification reports should continue describing the current release until implementation. At delivery, update every active reference together:

| Area | Required propagation |
| --- | --- |
| Vault, reconciliation, recovery, and Project backups | One Environment-owned collection model; matching format validation, identity, merge, restore, and rollback rules. |
| Renderer contracts and preload | Replace Project-only Secret selectors with explicit targets; update `ProjectRecord`, `FavoriteSnapshot`, `ReviewTarget`, `ApprovalRequest`, `ActivityLog`, and reconciliation conflict types. Separate Project backup from Environment export. |
| Main-process IPC, import, and configuration modules | Validate the shared target contract, preserve sender admission, capture before selection, and consume authoritative identity for review and commit. Requirements belong to Environment operations even if compatibility channel names temporarily remain. |
| Project navigation and review state | Selected Environment participates in loading, inspector/history/reveal lifetime, pending writes, favorites, requirements, and late-response rejection. Navigation must preserve or explicitly resolve the Environment; a missing ID cannot silently show another collection. |
| Dashboard, approval, logs, and conflict displays | Label count scope; show the captured target; match structured usage identity; render Environment management and default-selection conflicts. |
| CLI, HTTP, and MCP contracts | Resolve optional names once at admission; update schemas, descriptions, discovery, option parsing, and examples. Every internal Secret operation receives an explicit target. |
| English strings and page styles | Add Environment labels, management, stale-target errors, confirmations, and accessible names. Retain shared-versus-page CSS ownership and load order. |
| README, release notes, and product/design context | Explain Vault → Project → Environment → Secret, default compatibility, isolation, backup/export scope, migration, and rollback. Update active rationale excluding Environments; retain historical specs with a supersession link rather than rewriting past acceptance evidence. |

Documentation examples must show explicit targeting, such as `localkeys run --project=myapp --env=dev -- npm start` and `localkeys get myapp DATABASE_URL --env=prod`, plus the corresponding MCP `environmentName`. Also show an omitted-selector example and explain its fixed default behavior. Do not let examples imply that the last desktop selection or `NODE_ENV` determines a credential target.

Acceptance includes auditing remaining Project-only Secret calls and domain references. Any surviving reference must be a documented external compatibility adapter, a genuine Project grouping operation, or historical evidence; none may retain a second credential collection implementation.

## Out of Scope

Shared overrides, inheritance, secret promotion/copy workflows, provider checks, deployment orchestration, repository watchers, environment-specific passwords/unlock, role-based permissions, external environment management, and a functioning reference resolver. Implementation is authorized; commit, publication, installation and deployment require separate user requests.

## Implementation Choices

- Independent Environments; no fallback or shared overrides.
- Neutral `default` migration and stable omission target.
- Rename/delete with explicit default replacement and last-Environment protection.
- Versioned encrypted Vault, salt and manager configuration files preserve legacy files and detect legacy writes. Older installations can change only the retained legacy collection; they cannot round-trip the new Environment data. Legacy changes require explicit recovery rather than silent merging.

### Active implementation contract

This section records the delivered contract and supersedes any earlier active product or design note that excluded Environments. The hierarchy is Vault → Project → Environment → Secret. Each Environment starts empty when created, owns its Secret history and optional required-key baseline, and never inherits a missing key from another Environment. Existing and new Projects initially have an Environment named `default`; the stored `defaultEnvironmentId` is the omission target. Renaming that Environment preserves its identity and omission behavior. Confirmed deletion requires an explicit replacement and changes the omission target, which may now have another name. Changing desktop selection does not change it.

The Vault owner requires `{ projectName, environmentId }` for internal credential, history, favorites, configuration, import, and scoped-statistics operations. External HTTP, CLI, and MCP admission resolves an optional `environmentName` or omission to an explicit ID once, then passes that target through approval and execution. CLI examples use `--env=dev` before `--`; HTTP and MCP use `environmentName`. Environment discovery returns metadata only. Exported `localkeys://` references can encode an Environment selector, while imports continue to treat every reference as literal text.

Raw, keys-only, and reference exports contain the selected Environment. Encrypted Project backup captures every Environment's full stored record (Secret metadata and history, baselines, IDs and timestamps), Project defaults/metadata, and scoped favorites before opening the native save picker. The app revalidates Project/Vault/session identity and that complete snapshot after the picker, then writes the already-captured encrypted bytes.

Migration preserves the complete legacy collection in an Environment initially named `default` in versioned encrypted Vault, salt, and manager files. The retained recovery set is `vault-v1-pre-environments.enc`, `salt-v1-pre-environments.txt`, and `vaults-v1-pre-environments.enc`; it remains byte-for-byte at migration time and is not re-encrypted when the active password later changes. Every installation sharing a Vault must upgrade before Environment edits. Earlier writers cannot preserve named Environments or reject every unfamiliar versioned file; their retained legacy writes create divergence that requires explicit recovery. Rollback means restoring the complete pre-migration encrypted file set together and using its migration-era credentials, then opening it with a supported version. Password changes and destruction must use the current versioned implementation so active files remain consistent.

## Further Notes

Source anchors at review time: Vault storage and normalization; Vault reconciliation; VaultSession; import/configuration coordinators; main-process secret, favorite, approval, and export handlers; HTTP dispatcher; CLI commands and MCP tools. These are the affected implementation areas, not a request for a general refactor.
