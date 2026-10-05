# Spec: Deep Vault Reconciliation Module

## 1. Background

Vault reconciliation is currently split across:

- `src/modules/vault.js`: baseline capture, stale-write detection, periodic merge, auto-save recovery, disk reads, and persistence.
- `src/modules/vault-merge.js`: two-way diff, manual merge, three-way merge, comparison, and favorites rules.
- `src/main.js`: six reconciliation handlers that read `vault.data`, decrypt disk state, select algorithms, mutate Vault state, and force-save.
- `src/preload.js`: six procedural reconciliation operations exposed to renderers.
- `src/modules/vault-external-change.js` and `src/modules/vault-merge-ui.js`: repeated silent-resolution checks and orchestration of reload, merge, and overwrite.

The interface leaks the implementation's ordering rules. Periodic sync uses a baseline-aware three-way merge, while the renderer-driven path uses a two-way diff and a different merge algorithm. No focused test exercises Vault reconciliation.

This spec redesigns reconciliation as if concurrent disk changes had been a foundational Vault requirement.

## 2. Goals

- Make one module authoritative for reconciliation policy, disk comparison, merge selection, persistence, and conflict outcomes.
- Give callers a small outcome-based interface; callers provide intent and display results.
- Automatically combine changes only when the baseline proves that no side is discarded.
- Require an explicit user decision before a conflicting session or disk version is discarded.
- Treat every disk mutation as untrusted input, including partial, missing, malformed, or undecryptable data.
- Prevent a user decision from applying after either the session or disk version has changed.
- Make the reconciliation interface the test surface using real encrypted Vault files in temporary directories.
- Preserve the current Vault file format and normal user workflows.

## 3. Non-goals

- No Vault file-format migration.
- No change to encryption, key derivation, or password handling.
- No Project rename feature.
- No per-field or per-Secret conflict editor in this change.
- No durable conflict queue across app restarts.
- No recovery-copy retention policy.
- No redesign of general renderer navigation or styling.
- No new filesystem port solely for tests; temporary directories are the local-substitutable test adapter.

## 4. Confirmed decisions

1. Preserve existing visible behavior where it is safe; remove inconsistent or unsafe reconciliation paths.
2. A silent action may combine changes only when it provably preserves both sides.
3. A conflicting side may be discarded only after an explicit user decision.
4. Missing, malformed, and undecryptable disk data produce a safe reconciliation outcome; detection never overwrites it.
5. The merge experience remains recognizable, but renderers display outcomes instead of orchestrating reconciliation.
6. The latest disk fingerprint and session revision must still match the reconciliation plan when a decision is applied.
7. One baseline-aware three-way implementation replaces the current two-way manual merge path.

## 5. Architecture

### 5.1 External seam

The external seam lives on the Vault module. It has two operations:

```js
await vault.reconcileExternalChange({ origin });
await vault.resolveReconciliation({ reconciliationId, decision });
```

`origin` is diagnostic context only: `"save"`, `"periodic"`, `"focus"`, or `"external-notification"`. It must not select different merge policy.

`decision` is one of:

- `"use_disk"`: explicitly discard the conflicting session version and load the disk version.
- `"keep_session"`: explicitly discard the conflicting disk version and persist the session version.

There is no default decision. Unknown decisions fail closed.

### 5.2 Internal implementation

Create `src/modules/vault-reconciliation.js`. It is internal to the Vault implementation and owns:

- normalized baseline snapshots;
- semantic comparison;
- disk fingerprint verification;
- encrypted disk read and validation coordination through the owning Vault;
- three-way conflict detection;
- conflict-free merge construction;
- safe renderer summaries;
- reconciliation-plan creation and invalidation;
- resolution validation;
- persistence ordering.

`src/modules/vault.js` remains responsible for the unlocked key and encrypted file mechanics. It delegates reconciliation decisions to the new module and does not expose raw mutable data across the seam.

Do not add a public interface for merge helpers. Comparison, diff construction, and merge helpers are private implementation details.

### 5.3 Caller shape

```text
auto-save ───────┐
periodic sync ───┤
focus check ─────┼──> Vault reconciliation interface
disk event ──────┘                │
                                  ├── unchanged
                                  ├── merged
                                  └── needs_resolution ──> renderer
                                                               │
                                      explicit decision ───────┘
```

All origins cross the same seam and receive the same outcomes. Renderer and main-process adapters must not read `vault.data`, call merge helpers, read encrypted disk state, or force-save as part of reconciliation.

## 6. State and invariants

### 6.1 Vault reconciliation state

The Vault implementation tracks:

- `sessionRevision`: a monotonic integer incremented after every in-memory Vault mutation and successful reload or merge.
- `diskFingerprint`: SHA-256 of the encrypted bytes last loaded or written successfully.
- `baseline`: normalized semantic state last known to be shared by session and disk.
- `pendingPlan`: at most one reconciliation plan for the Vault.

The pending plan contains:

- an unpredictable `reconciliationId`;
- the captured `sessionRevision`;
- the captured disk fingerprint or explicit missing marker;
- normalized session, disk, and baseline snapshots needed to apply the decision;
- a safe conflict summary containing no Secret values.

The plan is memory-only. Successful resolution, lock, reload, or a newer reconciliation clears it. A session mutation invalidates it by advancing `sessionRevision`; resolving that plan returns `superseded` without changing either side.

### 6.2 Safety invariants

1. **No implicit loss:** automatic reconciliation must preserve every semantic change from both sides relative to the baseline.
2. **No stale decision:** resolution must compare the current session revision and disk fingerprint with the pending plan before changing state.
3. **No raw Secret output:** outcomes may include Project names, Secret keys, conflict reasons, and masked length/last-two previews only.
4. **No partial mutation:** construct and validate the complete next Vault state before replacing session state or writing disk.
5. **No premature baseline:** refresh the baseline and disk fingerprint only after a successful load or write.
6. **No origin-specific policy:** save, periodic sync, focus, and disk notifications use identical comparison and merge rules.
7. **One active reconciliation:** a newer reconciliation supersedes the older pending plan.
8. **Locked means unavailable:** both interface operations fail with the existing locked-Vault error behavior.

## 7. Semantic merge rules

### 7.1 Comparison scope

Normalize and compare all persisted semantic data:

- Projects and their Secret membership;
- Secret value, expiry, description, and tags;
- Secret history;
- Project and Secret favorites.

Vault, Project, and Secret timestamps are derived metadata. They do not independently create conflicts, but the winning or merged records must retain truthful timestamps.

### 7.2 Conflict-free cases

Automatically merge when the baseline proves one of these cases:

- only the session changed;
- only disk changed;
- both sides made the same semantic change;
- each side changed different Projects;
- each side changed different Secrets in the same Project;
- one side added a Project or Secret while the other changed unrelated data;
- favorites changed on only one side;
- both histories gained distinct entries that can be combined deterministically.

After a conflict-free merge, persist the merged state atomically, refresh the baseline, and return `merged`. When the merged result is semantically identical to the current disk version, adopt that disk version and fingerprint without rewriting it.

### 7.3 Conflict cases

Require resolution when:

- both sides changed the same Secret differently;
- both sides added the same Secret key with different content;
- one side deleted a Project or Secret that the other side changed;
- both sides changed favorites differently and neither result contains the other;
- the disk file is missing, malformed, or undecryptable;
- semantic normalization cannot produce a valid Vault state.

No conflict case defaults to the session side.

### 7.4 History and timestamps

- Deduplicate history entries by the tuple of value, expiry, description, tags, and `changedAt`.
- Sort combined history newest first and keep at most `maxHistoryVersions` entries.
- Preserve the earliest valid `createdAt` for the merged record.
- Use the latest valid `updatedAt` from the contributing records for an unchanged current value.
- Set `updatedAt` to the reconciliation time when reconciliation constructs new semantic state.

## 8. Outcomes

`reconcileExternalChange` returns exactly one outcome shape:

```js
{ status: "unchanged" }

{ status: "merged", changed: true }

{
    status: "needs_resolution",
    reconciliationId,
    reason: "conflict" | "disk_missing" | "disk_unreadable" | "invalid_vault",
    conflicts: [
        {
            kind: "project" | "secret" | "favorites",
            project,
            key,
            reason,
            sessionPreview,
            diskPreview,
        },
    ],
    allowedDecisions: ["use_disk", "keep_session"],
}
```

Fields that do not apply are omitted. For unreadable or missing disk data, `use_disk` is omitted from `allowedDecisions`.

`resolveReconciliation` returns:

```js
{ status: "resolved", decision: "use_disk" | "keep_session" }
{ status: "superseded" }
```

Unexpected I/O failures remain errors and retain stable error codes. Adapters translate errors into their existing `{ success, error, code }` envelope.

## 9. Persistence behavior

### 9.1 Normal save

1. Compare the current encrypted disk fingerprint with `diskFingerprint`.
2. If unchanged, write the session state and refresh the baseline.
3. If changed, invoke reconciliation through the same internal path as every other origin.
4. Persist automatically only for `unchanged` or conflict-free `merged` outcomes.
5. For `needs_resolution`, keep the session state intact, create a pending plan, notify the renderer, and return `VAULT_RECONCILIATION_REQUIRED` to the save caller.

### 9.2 Atomic write

Write encrypted bytes to a sibling temporary file, apply restrictive permissions, then replace `vault.enc` with an atomic rename supported by the platform. A failed write must leave the previous `vault.enc` readable and must not refresh the baseline.

### 9.3 Explicit resolution

- `use_disk`: revalidate the plan, load and normalize the captured disk version, replace session state, refresh the baseline, and emit the data-synced event.
- `keep_session`: revalidate the plan, atomically persist the captured session version, refresh the baseline, and emit the data-synced event.
- If revalidation fails, apply nothing, clear the stale plan, and return `superseded` so the caller can inspect again.

## 10. Main-process and renderer changes

### 10.1 Main process

Replace these handlers:

- `vault:reloadFromDisk`
- `vault:saveForce`
- `vault:checkDiskStale`
- `vault:getVaultDiff`
- `vault:trySilentConflictResolve`
- `vault:applyMerge`

with two adapters:

- `vault:reconcileExternalChange`
- `vault:resolveReconciliation`

The adapters validate input, call the Vault interface, and translate results. They contain no merge policy.

Remove direct `vault.data`, `peekRemoteData`, and `applyMergedData` access from `src/main.js`.

### 10.2 Preload

Expose only:

```js
vault.reconcileExternalChange(origin);
vault.resolveReconciliation(reconciliationId, decision);
vault.onReconciliationRequired(callback);
vault.onVaultDataSynced(callback);
```

Keep unsubscribe functions for event listeners.

### 10.3 Renderer

`src/modules/vault-external-change.js` invokes reconciliation on focus and on an external-change notification. It reacts to outcomes:

- `unchanged`: no visible action;
- `merged`: dispatch `localkeys:vault-data-synced`;
- `needs_resolution`: open the reconciliation view with the supplied safe summary.

`src/modules/vault-merge-ui.js` displays conflicts and submits one explicit allowed decision. It does not retry silent resolution, read disk state, calculate a diff, or choose a default.

## 11. File plan

### Add

- `src/modules/vault-reconciliation.js`
- `test/vault-reconciliation.test.js`

### Modify

- `src/modules/vault.js`
- `src/main.js`
- `src/preload.js`
- `src/modules/vault-external-change.js`
- `src/modules/vault-merge-ui.js`
- renderer copy in `src/locales/en.json` only where new outcomes require it

### Remove after migration

- `src/modules/vault-merge.js`, once all policy and tests live behind the reconciliation seam
- obsolete reconciliation handlers and preload methods

## 12. Implementation sequence

1. Add characterization tests for current encrypted-file loading, save conflicts, and three-way cases. Completion: each existing safe behavior is observable through a Vault instance using temporary directories.
2. Add the reconciliation module and new Vault interface. Completion: the full test matrix in section 13 passes without Electron or DOM setup.
3. Route normal save and periodic sync through the new implementation. Completion: `vault.js` has one comparison and merge path.
4. Replace main-process and preload adapters. Completion: `src/main.js` contains no direct Vault data or merge-helper access.
5. Reduce renderer modules to outcome display and explicit decision collection. Completion: renderers contain no reconciliation policy or ordering rules.
6. Remove `vault-merge.js` and obsolete operations. Completion: searches find no old calls, and linting plus all tests pass.

## 13. Test plan

Tests create real encrypted Vault files in temporary directories and interact through the Vault reconciliation interface.

### Baseline and unchanged

- [ ] Unlock establishes a normalized baseline and disk fingerprint.
- [ ] Unchanged disk returns `unchanged` without writing.
- [ ] Successful write refreshes baseline and fingerprint.

### Automatic merge

- [ ] Session-only edit persists.
- [ ] Disk-only edit loads and persists.
- [ ] Different Projects changed on each side merge.
- [ ] Different Secrets in one Project changed on each side merge.
- [ ] Same semantic edit on both sides merges.
- [ ] Independent Project and Secret additions merge.
- [ ] One-sided favorite changes merge.
- [ ] Compatible history additions merge, deduplicate, sort, and cap.

### Conflicts

- [ ] Divergent edit of the same Secret requires resolution.
- [ ] Divergent simultaneous addition requires resolution.
- [ ] Delete-versus-edit of a Secret requires resolution.
- [ ] Delete-versus-edit of a Project requires resolution.
- [ ] Divergent favorites require resolution.
- [ ] Conflict summaries contain no raw Secret values.
- [ ] No missing conflict choice defaults to the session side.

### Untrusted disk

- [ ] Missing disk file returns `disk_missing` without writing.
- [ ] Truncated ciphertext returns `disk_unreadable` without writing.
- [ ] Valid ciphertext with invalid Vault data returns `invalid_vault` without writing.
- [ ] Ciphertext encrypted with another key returns `disk_unreadable` without writing.

### Plan safety

- [ ] Session mutation invalidates a pending plan.
- [ ] Disk mutation invalidates a pending plan.
- [ ] A second inspection supersedes the first plan.
- [ ] Unknown and reused reconciliation IDs fail closed.
- [ ] A superseded decision changes neither session nor disk.

### Explicit resolution

- [ ] `use_disk` loads the exact inspected disk version.
- [ ] `keep_session` atomically writes the exact inspected session version.
- [ ] Missing or unreadable disk permits only `keep_session`.
- [ ] Successful resolution clears the plan and emits one sync event.

### Origin parity

- [ ] Save, periodic, focus, and external-notification origins produce identical outcomes for the same three states.
- [ ] Auto-save and periodic sync do not duplicate notifications for one pending plan.

### Repository checks

- [ ] `npm test`
- [ ] `npm run lint`
- [ ] Manual smoke test with two LocalKeys instances sharing one Vault directory.
- [ ] Manual smoke test with a sync tool replacing `vault.enc` while the Vault is unlocked.

## 14. Acceptance criteria

- The Vault exposes only the two reconciliation operations described in section 5.1.
- All reconciliation origins use the same policy and outcome types.
- `src/main.js` and renderer modules contain no merge implementation or persistence ordering.
- No caller reads mutable Vault data across the seam.
- A decision cannot apply after session or disk state changes.
- Automatic reconciliation demonstrably preserves both sides relative to the baseline.
- Missing, malformed, and undecryptable disk data are never overwritten during detection.
- Outcome payloads never expose raw Secret values.
- Focused reconciliation tests cover every case in section 13.
- Existing tests and linting pass.
- The existing Vault file format remains readable by the prior release.

The candidate is complete only when the intended seam owns all shared reconciliation complexity, equivalent orchestration is removed from callers, and tests use the reconciliation interface as their test surface.

## 15. Rollback

No user-data migration is introduced. Code rollback restores the earlier implementation. Vault files written by the new module retain the existing encrypted format. If implementation adds atomic temporary files, startup may delete only verified stale temporary files and must never delete `vault.enc` during recovery.

## 16. Open questions

None blocking. Per-Secret conflict choices, durable recovery copies, and cross-restart plans require separate product decisions.
