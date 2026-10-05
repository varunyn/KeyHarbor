# Project configuration completeness

Status: Implemented and verified. Label: resolved. Tracker: repository Markdown; see [implementation tickets](configuration-completeness-tickets.md).

## Problem Statement

The user stores application credentials as Secrets in LocalKeys but cannot tell whether a Project has all the configuration keys its application expects. A list of existing Secrets cannot reveal absent keys. Importing a template as Secrets would also confuse placeholders with working configuration and risk changing credentials.

## Solution

Give each Project an optional required-key baseline sourced from a pasted or selected `.env.example` file. Review and save the key names, then compare that baseline with the Project's current Secrets. Show a compact readiness summary and a checklist with Missing, Empty, Expired, and Ready states, with actions that open the existing Secret editor to fill gaps.

Keep template management and credential import distinct operations sharing the same input conventions. Saving a baseline changes required-key metadata only. Existing Secrets remain intact when requirements are added, removed, refreshed, or cleared.

## User Stories

1. As a developer, I want to define required keys from `.env.example`, so that completeness reflects my application's expected configuration.
2. As a developer, I want to paste a template from notes, so that I do not need a temporary file.
3. As a developer, I want to select a template file, so that repository examples are easy to use.
4. As a developer, I want identical text and file input interpreted consistently, so that choosing a source does not change requirements.
5. As a developer, I want the target Vault and Project visible during setup, so that I attach requirements to the intended application.
6. As a developer, I want to review required key names before saving, so that unexpected requirements do not appear silently.
7. As a developer, I want template values ignored, so that example credentials never replace stored Secrets.
8. As a developer, I want comments and supported quoting accepted, so that ordinary templates need little cleanup.
9. As a developer, I want malformed template input reported by line number, so that unsupported content is not silently omitted.
10. As a developer, I want repeated template names counted once, so that duplicates do not inflate readiness totals.
11. As a developer, I want Projects without a baseline identified clearly, so that an undefined configuration is not shown as complete.
12. As a developer, I want a count of ready and required keys, so that I can assess configuration at a glance.
13. As a developer, I want absent keys marked Missing, so that I know which Secrets to add.
14. As a developer, I want zero-length values marked Empty, so that placeholders do not count as ready.
15. As a developer, I want expired Secrets identified, so that a populated but expired credential does not count as ready.
16. As a developer, I want populated unexpired values marked Ready, so that configured keys are easy to distinguish.
17. As a developer, I want extra stored Secrets preserved, so that unrelated configuration is not deleted or counted against completeness.
18. As a developer, I want to add a missing key from the checklist, so that filling gaps requires little navigation.
19. As a developer, I want to edit an empty or expired Secret from the checklist, so that I can resolve the actual problem.
20. As a developer, I want readiness refreshed after Secret edits, deletions, restores, or imports, so that the checklist describes current state.
21. As a developer, I want expiry reflected while the Project is open, so that readiness does not remain stale after time passes.
22. As a developer, I want saved requirements retained after locking and reopening, so that I define the baseline once.
23. As a developer, I want to review added and removed requirements when refreshing a template, so that changing application configuration is deliberate.
24. As a developer, I want a removed requirement to leave its Secret untouched, so that refreshing a template cannot destroy credentials.
25. As a developer, I want to cancel or return to template input without changing requirements, so that I can correct mistakes safely.
26. As a developer, I want to clear a baseline deliberately, so that I can stop tracking requirements without deleting Secrets.
27. As a developer, I want previews tied to the current Vault, Project, and baseline, so that stale review cannot change another target.
28. As a developer, I want baseline updates applied atomically, so that failure cannot save a partially reviewed list.
29. As a developer, I want requirements preserved during disk synchronization and recovery, so that external changes do not silently erase them.
30. As a developer, I want concurrent requirement edits surfaced as a conflict, so that one application session does not silently overwrite another.
31. As a developer, I want template drafts cleared on dismissal, navigation, or lock, so that abandoned source contents do not linger in app state.
32. As a keyboard user, I want labelled controls, focus restoration, and text statuses, so that I can manage and review requirements without a mouse.
33. As a developer, I want an honest explanation of readiness, so that I do not confuse presence with credential validity or application connectivity.
34. As a developer, I want completeness checks fully offline and free of value exposure, so that checking configuration does not send or display credentials.
35. As a developer, I want safe logs and diagnostics, so that templates containing real values cannot create another credential store.

## Implementation Decisions

### Domain and state

- Scope one optional baseline to each Project in its Vault. Every distinct template key is required in the first version. The filename does not create an environment, repository association, or provider identity.
- The foundational distinction is expected key names versus stored Secret records. Missing requirements are checklist rows, not automatically created empty Secrets. Existing Secret/Config display heuristics do not determine whether a key is required.
- No baseline means Not configured, with a Set required keys action. Do not infer requirements from existing Secrets, or display 0 of 0 ready as success.
- Evaluate only required keys using exact, case-sensitive own-key lookup. Keys such as `constructor` and `__proto__` remain ordinary names; inherited object properties never satisfy requirements.
- Assign one primary state per key, in this order: Missing if absent; Empty if its string value has length zero; Expired if populated with a valid expiration timestamp at or before the evaluation time; otherwise Ready. Whitespace-only values count as populated because whitespace may be intentional. Do not infer placeholder strings, resolve references, expand variables, or validate provider credentials.
- Ready count excludes missing, empty, and expired keys. Show the breakdown beside “8 of 10 required keys ready”; do not imply that populated expired values are ready. A ready configuration means presence, non-empty values, and no recorded expiration, not proof that the application can run.
- Surface invalid stored expiry metadata as a safe evaluation error rather than falsely claiming readiness. Loading, locked, unavailable, and error states are separate from Not configured and from a computed result.
- Return an evaluated-at timestamp and the next future expiry when applicable. Refresh on Project load, focus, accepted Secret mutations/imports/restores, successful reconciliation, and the next expiry boundary. Clear timers on navigation or session closure. Do not persist derived statuses or counters.

### Template input and review

- Use a Project action Set required keys; after setup, use Review configuration and Update template. A compact configuration summary belongs near the Project overview, with a checklist in the same Project context. Keep unrelated Secret health indicators distinct from completeness.
- Use Input → Review → Save required keys, with Paste initially selected and File as the alternative. Reuse import's input conventions and shared main-process environment parser, without sharing credential-writing decisions.
- Accept the existing grammar and limits: UTF-8 with optional BOM, LF/CRLF, comments, export prefix, first-equals splitting, quoted and multiline values, and one enclosing plain/env/dotenv fence; at most 1 MiB and 5,000 assignments. Invalid input blocks review with safe line diagnostics. An empty template cannot create or replace a baseline; use the explicit clear action instead.
- Parse source values only as necessary to recognize valid assignments. Immediately reduce the result to distinct key names; previews never return or retain values, raw source, file paths, or comments. No reveal control is needed for a required-key template.
- Repeated template keys collapse to one requirement regardless of differing values, with a duplicate-name notice. This differs intentionally from credential import, where choosing a value requires explicit occurrence resolution.
- Initial review lists all required keys and their current completeness states. Refresh review shows added, removed, and unchanged names with counts. Save replaces the entire required-key set; no per-key optional flags or partial template selection in the first version.
- An unchanged template is a no-op; keep the existing baseline identity and update timestamp. Removed requirements remain ordinary stored Secrets if they exist. Extra stored Secrets neither increase the required denominator nor become errors.
- Back retains source input while dropping the handle and review choices. Cancel writes nothing. Source switches invalidate previews. Clear baseline requires a review naming the target and explaining that Secrets remain; it returns the Project to Not configured.
- Missing rows open the existing Add Secret dialog with the key prefilled. Empty and expired rows open the existing edit dialog. Updating an expired value does not silently remove or extend its expiry; the existing expiry control must be reviewed. Cancelling an editor leaves state unchanged. Recompute after accepted changes.
- Keep incoming and existing Secret values out of the checklist and its payload. Apply current dark compact desktop design, visible text statuses, labels, keyboard focus trapping/restoration, live result announcements, and scrolling at the existing minimum window size. English copy uses existing localization; feature-specific CSS follows repository structure.

### Persistent schema and reconciliation

- Add one optional Project field, `configurationBaseline`, containing a non-empty unique sorted `requiredKeys` array, an opaque `revision` generated on each real baseline change, and `updatedAt` in the existing timestamp format. No raw template, values, paths, filename, computed status, or provider metadata is saved.
- Omit the field for Projects without configured requirements; clearing removes it. Existing Vaults with no field remain valid and open as Not configured, without rewriting them just to introduce defaults. Secret schema and Secret version history remain unchanged.
- Validate baseline shape, identifiers, uniqueness, limits, revision, and timestamps at existing Vault validation/admission boundaries. Invalid baseline data fails safely under existing invalid-data rules; it is not silently dropped or replaced by a ready result.
- Apply a baseline replacement/clear as one guarded Project mutation through the existing persistence queue and normal autosave. Preserve every Secret, metadata/history, favorites, and unrelated Project data. Success means accepted under normal save rules, not an immediate disk-durability promise.
- Include baseline content in semantic Project snapshots and the existing three-way reconciliation baseline. One-sided edits and identical required-key changes merge alongside independent Secret edits. Different concurrent required-key sets, or clear versus edit, require explicit reconciliation; treat the list as one unit rather than unioning requirements. Revision/timestamps support stale admission but alone must not cause a semantic conflict between equal sets.
- Project deletion versus baseline editing is a real Project delete/edit conflict. Normalization, clone paths, prepared saves, recovery snapshots, and encrypted Project backup must preserve the optional baseline. Review all existing Project serialization paths; merely adding a field to createProject is insufficient.
- A baseline refresh does not create Secret history entries. Normal Secret CRUD, imports, API/CLI/MCP writes, and restores preserve baseline metadata. Renaming/deleting a Secret does not rename/delete its requirement; it can create a missing row.

### Process boundary and lifecycle

- Main owns template parsing, authoritative key sets, completeness evaluation, target binding, and baseline mutation. Expose narrow session-gated read, template-preview, template-commit, clear, and discard operations through the existing preload/IPC pattern.
- Template preview returns an opaque handle, target description, required-key names, change summary and diagnostics. Retained preview data contains only candidate keys, target identity, and the baseline revision/existence observed at capture. Commit accepts the handle, never a renderer-authoritative replacement key set.
- Bind preview and clear admission to active session generation, Vault identity, Project incarnation, and baseline revision/existence. Revalidate immediately before queued mutation. Baseline changes, Project delete/recreate, Vault switch, navigation, and session closure invalidate approval; unrelated Secret changes are permitted and completeness is reevaluated from current data.
- Native selection runs outside the session lease; capture target before opening the picker and reject stale selection. Preserve hidden-file and All Files selection support. Never accept renderer-provided paths.
- Discard is idempotent and scoped to its handle. Clear retained handles and draft/review state on dismissal, success, navigation, window destruction, or session closure; delayed replies cannot repopulate an abandoned dialog or clear a newer review.
- Do not hold a session lease while the user reviews. Checklist reads reveal only keys/statuses/counts and evaluation timing. Logger entries contain sanitized operation counts, with no raw template, values, paths, or diagnostic source excerpts.
- Update usage docs, product/design context, release notes, and bridge contracts during implementation. Existing credential import/export behavior remains intact; keys-only export continues describing stored Secrets, not silently substituting requirements.

## Testing Decisions

- Confirmed primary seam: public Project operations through a real temporary VaultSession, with desktop verification of the checklist and template workflow. The user approved this testing approach. Exercise production baseline preview/commit/read/clear boundaries against real Vault storage; do not add private parser tests or test-only exports.
- Assert external behavior: expected names and counts, status precedence, absence of values in payloads, no Secret mutation, persisted optional metadata, no-write cancellation, stale rejection, and no partial baseline writes. Independently author expected results rather than mirroring implementation.
- Reuse current parser contract coverage; add only template-specific distinctions such as duplicate-name collapse, value stripping, empty-template rejection, diff review and no-op refresh. Verify Paste/File equivalence without repeating the import grammar suite.
- Test absent baseline versus empty value, missing versus own prototype-named keys, case-sensitive names, extra Secrets, whitespace values, expiration just before/at/after the boundary, invalid expiry metadata, and ready count excluding expired keys. Use controlled evaluation time at the production operation boundary, not global timing sleeps or a test-only export.
- Verify initial setup, replacement, no-op, clear, ordinary Secret edits/imports/rename/delete/restore, and save/close/reopen preserve the intended baseline and all Secret history/metadata.
- Extend real-file reconciliation tests for one-sided baseline changes, equal sets with different revisions, independent Secret changes, divergent sets, clear/edit, and Project delete/baseline edit. Verify recovery and encrypted Project backup preserve requirements. Existing Vaults without the new field are a compatibility fixture.
- Prove queued stale-baseline rejection, lock during selection/review, target Vault switch, Project reincarnation, handle discard, repeat commit, and delayed reply cleanup. Relevant baseline changes invalidate admission; independent Secret edits do not.
- Distinct adapter checks cover native picker admission and forbidden renderer paths only where the public Project boundary cannot. Fake unavoidable OS selection, not parsing, evaluation, persistence, or reconciliation.
- One isolated desktop run with synthetic credentials verifies setup, refresh review, fill-gap editors, clear, live refresh/expiry, keyboard access, minimum-size scrolling, target labels, lock and cancellation. Capture actual current source in Electron; never verify against the user's live credentials.
- Full repository tests, JavaScript/CSS lint and diff checks are required for final implementation acceptance. No implementation or tests are added by this spec task.

## Out of Scope

- Optional requirements, type schemas, default values, placeholder detection, value patterns, provider validation, network calls, or proving application connectivity.
- Environment profiles, multiple baselines per Project, repository scanning/watchers, automatic note access, clipboard monitoring, or importing template values.
- Automatic creation, deletion, renaming, rotation or expiration extension of Secrets to satisfy requirements.
- New CLI/MCP/HTTP completeness commands, dashboard-wide rollout, and changes to credential import/export policy.
- Baseline version-history UI or an ADR/glossary overhaul.

## Further Notes

The user explicitly selected `.env.example` as the first required-key source and requested a spec before implementation. Repository Markdown remains the selected tracker. This design treats requirements as part of the Project model, separate from Secret values, and propagates that distinction through persistence, reconciliation, review and display.

The new optional Project field is a schema extension requiring compatibility and reconciliation work; it is not a new environment model. Implementation should land in dependency order, with one authoritative evaluation path and explicit final acceptance evidence.
