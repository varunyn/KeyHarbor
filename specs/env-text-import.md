# Import secrets from pasted .env text and files

Status: Implemented and verified. Tracker: repository Markdown; see env-text-import-tickets.md.

## Problem Statement

The user keeps application environment credentials in notes and wants to move them into LocalKeys without creating each Secret individually or saving a temporary plaintext file. Existing import starts with a file picker, silently skips malformed lines, and selects differing existing values for overwrite by default. This makes importing from notes inconvenient and makes it difficult to know whether the intended configuration was imported accurately.

## Solution

Treat import as one Project-scoped operation with two input sources: Paste and File. Both sources use the same interpretation, diagnostics, masked review, duplicate resolution, and commit behavior. The user chooses input, reviews what will change, and explicitly imports selected Secrets into the displayed Vault and Project.

Preserve the established compact desktop utility design. Use one dialog with Input and Review steps; Paste is the initial source. The focal moment is the review of key names and proposed changes, with existing values protected by default.

## User Stories

1. As a developer, I want to paste environment assignments from my notes, so that I can import credentials without a temporary file.
2. As a developer, I want to choose an existing .env file, so that my current file workflow remains available.
3. As a developer, I want both sources to interpret identical content identically, so that source selection does not change my configuration.
4. As a developer, I want to see the target Vault and Project throughout import, so that I know where credentials will be saved.
5. As a developer, I want blank lines and comments accepted, so that ordinary .env content requires no cleanup.
6. As a developer, I want an optional export prefix accepted, so that copied shell-style assignments work.
7. As a developer, I want values containing equals signs preserved, so that tokens and connection strings stay intact.
8. As a developer, I want single-quoted and double-quoted values interpreted predictably, so that quoting does not corrupt credentials.
9. As a developer, I want quoted multiline values accepted, so that private keys and certificates can be imported.
10. As a developer, I want Windows and Unix line endings accepted, so that file origin does not affect import.
11. As a developer, I want empty values displayed explicitly, so that I can distinguish placeholders from populated credentials.
12. As a developer, I want a whole .env code fence accepted, so that copying a note's code block is convenient.
13. As a developer, I want malformed content reported by line number, so that I can fix input without losing my draft.
14. As a developer, I want repeated keys in input highlighted, so that ambiguous values cannot silently replace each other.
15. As a developer, I want new keys distinguished from existing keys, so that I can understand the proposed changes.
16. As a developer, I want identical existing values skipped, so that repeated imports do not create needless history.
17. As a developer, I want differing existing values kept unless I choose Replace, so that import does not overwrite working credentials accidentally.
18. As a developer, I want to exclude individual entries, so that I can import only the credentials I need.
19. As a developer, I want review values masked with deliberate reveal controls, so that credentials are not exposed during routine review.
20. As a developer, I want to return to input and edit it, so that I can correct mistakes before saving.
21. As a developer, I want a count of additions, replacements, and skipped entries, so that confirmation describes the actual operation.
22. As a developer, I want cancellation to leave my Project unchanged, so that exploring import is safe.
23. As a developer, I want replaced Secrets to retain descriptions, tags, and expiry and record prior values in history, so that import preserves useful context.
24. As a developer, I want stale previews rejected when the target or relevant Secrets change, so that I never approve one change and receive another.
25. As a developer, I want an import to apply all selected changes or none, so that failure does not leave a partly imported configuration.
26. As a developer, I want drafts cleared when import closes or the Vault locks, so that abandoned credentials do not linger in app state.
27. As a keyboard user, I want accessible step navigation, diagnostics, and review controls, so that I can complete import without a mouse.
28. As a developer, I want a clear success result and refreshed Secret list, so that I can verify what was imported.
29. As a developer, I want sensitive input excluded from logs and error messages, so that importing does not create another plaintext credential store.

## Implementation Decisions

- Use existing domain terms: Vault, Project, Secret, and VaultSession. No domain glossary or ADR directory was found; existing Vault session and reconciliation specifications govern lifecycle and persistence.
- Replace the file-specific import orchestration with one production import coordinator used by Paste and File. The main process owns parsing, authoritative comparison, preview identity, validation, and commit. The preload bridge exposes narrow preview/commit/discard operations; the renderer owns presentation and selections.
- Input step: show target, Paste/File source controls, multiline text input or native file selection, concise format guidance, Cancel, and Review secrets. Opening import never reads the clipboard automatically. A normal paste is sufficient; no clipboard watcher is introduced.
- Review step: show one row per resolved key, masked incoming value, status, and action. New populated keys default to Add; existing changed keys default to Keep; identical entries are skipped. Empty new values default to Skip and display Empty value; users can explicitly add them. Offer Back, Cancel, and an action stating the number of Secrets to import. Show additions and replacements separately in the summary.
- Preserve source text when returning to Input; rebuilding a preview invalidates prior review choices. Switching sources invalidates the preview. Retain drafts only in memory during the open flow; clear drafts, revealed values, selections, and preview handles on discard, successful commit, navigation, or session closure. This is application-state cleanup, not a promise of cryptographic memory erasure.
- Support UTF-8 files with optional BOM, CRLF/LF, blank lines, full-line comments, and an optional export prefix. Keys use shell-compatible identifiers: a letter or underscore followed by letters, digits, or underscores. Existing stored keys are unaffected by this import-only rule.
- Split assignments at the first equals sign. Trim unquoted surrounding whitespace; preserve whitespace inside quotes. Outside quotes, a hash begins a comment only at the start of the value or when preceded by whitespace; otherwise it is literal. Single-quoted contents are literal. Double quotes decode escaped newline, carriage return, tab, quote, and backslash; unknown escapes preserve the backslash. Literal newlines are allowed within either quoted form. Trailing material after a closing quote must be whitespace or a comment.
- Never execute shell commands, expand variables, or resolve LocalKeys references during import. Dollar signs, command substitutions, and reference-like strings remain literal values.
- Accept a single enclosing Markdown code fence with no language or env/dotenv language. Do not mine prose, tables, multiple code blocks, or an entire note for assignments. Report unsupported nonblank content as diagnostics rather than silently dropping it. Diagnostic line numbers refer to original input and messages never echo raw lines or values.
- Invalid assignments, unterminated quotes, and NUL characters block Review until corrected. Repeated source keys require an explicit occurrence choice or exclusion of the key; never use implicit first/last-wins behavior. Review contains at most one proposed change per key.
- Enforce a 1 MiB UTF-8 input limit and 5,000 assignment limit before retaining a preview; file input is size-checked before full reading. Display actionable limit errors without source contents. These are initial product limits, adjustable through a later explicit decision.
- Preview returns an opaque, single-use handle, target identity, structured diagnostics, and review entries. It is bound to the active session generation, Vault identity, Project, and relevant existing Secret state. Commit accepts the handle plus key/occurrence choices and Add/Replace/Skip decisions, rather than trusting renderer-supplied values or status labels. Reveal only selected incoming values through the session-gated bridge.
- Native file selection happens outside a VaultSession lease; verify the original target and current session after selection. A canceled picker changes no Secret. Late replies after dismissal or lock cannot repopulate the dialog.
- Commit revalidates session, target, choices, and relevant existing Secret state. Reject stale decisions and require fresh review. Do not hold a session lease while waiting for user input.
- Apply selected changes atomically to in-memory Vault state; preserve replacement metadata and existing history semantics. Use existing persistence and reconciliation rules. Success means the batch was accepted into the Vault under those rules; do not claim immediate disk durability unless the implementation explicitly persists and verifies it. Reject unsupported atomic behavior rather than shipping partial-write semantics.
- No Vault schema migration is needed. Import previews are transient and never serialized into Vault data, settings, recovery payloads, or logs. Existing Secret schema and encrypted persistence remain authoritative.
- Log only a sanitized operation summary and counts, without input, values, raw paths, or parser excerpts. Error responses use safe messages and line numbers.
- Fit the existing dark desktop styling and dialog hierarchy. Use a scrollable review region, visible textual statuses, labelled reveal buttons, focus trapping/restoration, keyboard-accessible controls, and an announced diagnostic summary. Import-specific styles remain feature-specific; reusable controls belong in shared styles.
- Update preload contracts, user-visible import copy, import usage documentation, and release notes together. Remove the superseded file-only parser/review path after both sources use the unified flow.
- Deliver incrementally: establish source-neutral preview/commit behavior; route file import through it; add pasted input and shared UI; complete lifecycle cleanup and documentation. Every increment retains one authoritative import path.

## Testing Decisions

- Proposed primary seam: the production import coordinator's public preview/commit/discard interface, using a real temporary Vault through VaultSession. This seam was accepted in the discussion. It must be a production boundary required by both sources, not an export introduced solely for tests.
- Test observable behavior: resulting Secret values, preserved metadata/history, counts, diagnostics, no-write cancellation, atomic failure, stale-preview rejection, and cleared session-bound previews. Avoid private parser assertions, DOM snapshots, source-string checks, and re-testing the same contract at multiple layers.
- Use table-driven input scenarios through preview/commit for quoting, multiline content, comments, empty values, equals signs, BOM/line endings, fences, repeated keys, literal expansion-like content, malformed input, and size limits. Expected values must be independently authored.
- Test Paste/File equivalence at this same boundary with real temporary input files. Fake only operating-system dialog selection and other unavoidable host adapters; do not mock parsing or Vault writes.
- Extend boundary scenarios for an unrelated Project update versus a relevant Secret update, deleted target, switched Vault, lock between steps, late async replies, repeated commit, invalid selection, and failed batch preparation. Assert no partial state or misleading success.
- Prior art: real session setup/mutation/close/reopen integration tests and real-file Vault reconciliation tests already exercise externally visible state through temporary storage. Use those fixture patterns rather than inventing a parallel persistence harness.
- Add only distinct adapter checks where IPC transport/admission cannot be covered by the coordinator. Use one focused desktop interaction verification for paste, review defaults, reveal, Back, Cancel, keyboard focus, small-window scrolling, and lock cleanup; do not duplicate parsing coverage in UI tests.
- No tests or implementation are added by this specification task.

## Out of Scope

- Environment profiles, repository association, configuration completeness checks, rotation reminders, and provider integrations.
- Automatic Obsidian access, vault scanning, note modification, deleting original credentials, clipboard monitoring, or automatic clipboard clearing.
- AI extraction, arbitrary Markdown/prose parsing, shell execution, interpolation, remote URLs, and batch import across multiple Projects.
- Changing raw export policy, CLI/MCP behavior, encryption, or the Vault schema.
- A full visual redesign of the Project page.

## Further Notes

The first-principles design unit is a reviewed import transaction with interchangeable input sources. File and Paste should not grow separate parsers, duplicate resolution rules, or commit implementations.

Repository product context explicitly excludes environment profiles; this feature respects that existing decision despite their appearance in the earlier brainstorming list.

The user selected repository Markdown as the tracker. Implementation status is recorded in the linked local ticket graph; external issue publication is not required.
