# Vault Session Lifecycle Specification

Status: Implemented

## Summary

Create one deep `VaultSession` module that owns the process-wide lifecycle of decrypted Vault state. The module serializes setup, unlock, active use, locking, idle timeout, and shutdown behind one interface. It coordinates `VaultManager`, encrypted logging, local HTTP ingress, disk synchronization, and auto-lock without exposing their ordering rules to `main.js`.

The renderer and Electron event handlers remain thin adapters. Vault encryption, Vault data operations, and three-way reconciliation remain owned by their existing modules.

## Problem

Session lifecycle policy is currently distributed across `main.js`, `VaultManager`, and `Vault`:

- `main.js` owns a second `isUnlocked` flag in addition to `Vault.isLocked`.
- setup and unlock have different activation paths; setup does not start auto-lock or periodic disk synchronization.
- password unlock and Touch ID unlock duplicate post-unlock orchestration.
- manual, tray, navigation, idle, delete, and quit paths close the session differently.
- `lockVault()` reports success before asynchronous Vault saves finish.
- `VaultManager.lockAllVaults()` suppresses Vault failures and then discards manager state.
- `Vault.lock()` can clear decrypted memory after reconciliation prevented a save, silently losing session-only changes.
- `before-quit` uses asynchronous work in an Electron event whose completion is not awaited.
- HTTP ingress, timers, renderer navigation, logger keys, and Vault keys can temporarily disagree about whether the application is unlocked.
- dozens of IPC handlers independently consult the global boolean, so lifecycle state is easy to bypass or misread.

This is a shallow cluster: callers coordinate the same ordering and cleanup rules themselves. Deleting any one helper would move little complexity because the lifecycle contract is not concentrated anywhere.

## Goals

- Define one authoritative state machine for the Vault session.
- Make setup, password unlock, and key-based unlock share one activation pipeline.
- Serialize competing transitions and make repeated requests idempotent.
- Prevent new sensitive work once closing begins.
- Wait for admitted work and Vault persistence before reporting a graceful lock as complete.
- Never silently discard session-only changes.
- Ensure security-required close paths remove plaintext keys and data even when ordinary persistence is blocked.
- Keep logger encryption, HTTP ingress, auto-lock, disk synchronization, and Vault memory consistent with session state.
- Replace scattered `isUnlocked` checks with access through the session seam.
- Test lifecycle behavior through the same interface used by production callers.

## Non-goals

- Change Vault encryption algorithms or password derivation.
- Change three-way reconciliation rules.
- Change Project, Secret, favorites, or history behavior.
- Move renderer navigation into the lifecycle module.
- Persist a master password or plaintext Vault key in a recovery envelope or on disk. An encrypted manager-configuration recovery body may contain the secondary keys already present in `vaults.enc`.
- Add remote synchronization or background cloud services.
- Redesign multi-Vault configuration storage.

## Module and seam

Add `src/modules/vault-session.js`.

`VaultSession` is the deep module. Its external seam sits between application adapters (`main.js`, IPC, tray, power monitor, and Electron shutdown) and the decrypted Vault runtime.

The module accepts dependencies rather than constructing them:

- `vaultManager`
- `logger`
- `httpIngress`
- `monitorScheduler`
- `settingsProvider`
- `recoveryStore`
- `onStateChange`

These are internal seams. Production adapters use the existing Electron and filesystem implementations. Tests use local fake adapters. They are not re-exported through the external interface.

## External interface

```js
class VaultSession {
  async open(request) {}
  async close(request) {}
  async destroy(request) {}
  async withActiveSession(operation) {}
  async resolveRecovery(request) {}
  async configure(policy) {}
  snapshot() {}
}
```

### `open(request)`

Opens or creates the process-wide session.

```js
await session.open({
  method: "setup" | "password" | "key",
  credential,
  reason: "setup" | "manual" | "touch_id",
});
```

Rules:

- credentials are not stored on the session, state snapshots, events, or logs; owned credential Buffers are copied and zero-filled on a best-effort basis after use;
- an `active` session returns its current public snapshot without reopening Vaults or validating a newly supplied credential;
- every second open request during `opening`, regardless of method, fails with `VAULT_SESSION_TRANSITION_IN_PROGRESS`; credentials are never compared or coalesced;
- open during `closing` fails with `VAULT_SESSION_CLOSING`;
- every open method runs the same activation pipeline after Vault keys are loaded;
- failure rolls back every completed activation step and returns to `locked`;
- setup provisioning is a durable commit: if activation after setup fails, the new Vault is sealed and the result reports `provisioned: true`; retry uses password unlock rather than setup;
- recovery metadata may be enumerated before authentication, but recovery bytes are decrypted only after a candidate Vault key is acquired;
- open may enter `recovering` rather than `active` when authenticated recovery requires a decision.

Successful open returns:

```js
{
    state: "active" | "recovering",
    outcome: "opened" | "already_active" | "recovery_required",
    transitionId,
    provisioned: boolean,
    vaults: [{ vaultId, status: "active" | "offline" | "failed" | "recovery_required", code? }],
    warnings: [{ code, vaultId? }],
}
```

All successful and idempotent opens use this schema. Authentication, transition, and activation failures throw typed errors. `VAULT_SESSION_OPEN_FAILED` includes safe `details: { provisioned: boolean }` so setup routing can distinguish a committed Vault from a pre-provision failure.

The system Vault must authenticate for `active`. Missing or failed secondary Vaults are reported and remain unavailable; they do not silently disappear from configuration.

### `close(request)`

Closes the process-wide session.

```js
await session.close({
  reason: "manual" | "idle" | "quit",
  deadlineMs,
});
```

Rules:

- closing is idempotent;
- `locked` returns the full close result with `state: "locked"` and `outcome: "already_locked"`;
- the state changes to `closing` before ingress and monitors are stopped;
- new `withActiveSession()` calls are rejected after closing begins;
- admitted operations are drained before Vaults are sealed;
- graceful close reports success only after Vaults have persisted or are known unchanged;
- manual close aborts and returns to `active` when safe persistence requires user action;
- idle and quit are security-required closes and use encrypted recovery capsules when normal persistence cannot safely complete;
- keys, decrypted data, reconciliation plans, logger keys, and manager references are cleared before the state becomes `locked`;
- Vaults are never sealed while an admitted operation lease is live;
- `deadlineMs` requests cancellation but never authorizes concurrent sealing;
- manual drain timeout returns to `active`; idle remains `closing` until cancellation settles; quit reports the timeout to the shutdown coordinator, which may terminate the process but must not publish a reusable `locked` state while a lease remains live.

Close intents have priority `manual < idle < quit`. A higher-priority request atomically upgrades an in-progress close. An upgraded security-required close may not return to `active`. All callers receive the final aggregate outcome. Destruction is separate and never joins an ordinary close.

```js
{
    state: "locked" | "active" | "closing",
    outcome: "closed" | "already_locked" | "blocked" | "drain_timeout" | "recovery_failed",
    reason: "manual" | "idle" | "quit",
    transitionId,
    vaults: [{ vaultId, status: "clean" | "persisted" | "needs_resolution" | "recovered" | "failed", code? }],
    warnings: [{ code, vaultId? }],
}
```

All successful and idempotent closes use this schema. Expected persistence conflicts return `outcome: "blocked"`. Invalid transitions, authentication failures, and programmer errors throw typed errors.

### `destroy(request)`

```js
await session.destroy({
  confirmation: "delete",
  deadlineMs,
});
```

Destruction is an explicitly confirmed, non-recoverable transition. The module accepts only the exact literal confirmation and resolves the current system identity internally; callers never receive or submit internal identity or filesystem paths. It drains or cancels admitted work, disables ingress and monitors, seals memory without ordinary persistence, then deletes a precomputed internal allowlist of system Vault, salt, configuration, log, Touch ID, and recovery artifacts. It never accepts paths from the caller and never deletes secondary Vault directories; those Vaults are detached.

Destruction never seals while a lease remains live. A drain timeout returns `outcome: "drain_timeout"` without deleting or sealing, unless the process is already on the quit hard-exit path. Partial filesystem deletion leaves the session locked and returns per-artifact safe status codes. A repeated destroy is idempotent. Destruction never creates a recovery capsule because the user explicitly authorized discard.

Initial destruction is admitted only from an authenticated `active` session. Before deleting anything, the module writes a durable non-secret destruction tombstone containing the internal operation ID and fixed artifact allowlist. If deletion is interrupted, `destroy({ confirmation: "delete" })` may resume from `locked` only when that tombstone exists; an ordinary locked session without a tombstone rejects destruction with `VAULT_SESSION_LOCKED`. The tombstone is removed after every allowlisted artifact is deleted or explicitly reported as absent.

```js
{
    state: "locked" | "active",
    outcome: "destroyed" | "already_absent" | "drain_timeout" | "partial_failure",
    transitionId,
    artifacts: [{ kind, status: "deleted" | "absent" | "failed", code? }],
}
```

### `withActiveSession(operation)`

Runs a sensitive operation against an active session.

```js
return session.withActiveSession(({ activeVault, signal }) =>
  activeVault.getProjects()
);
```

Rules:

- only `active` admits work;
- non-active states map exactly to `VAULT_SESSION_LOCKED`, `VAULT_SESSION_OPENING`, `VAULT_SESSION_RECOVERING`, `VAULT_SESSION_CLOSING`, or `VAULT_SESSION_DESTROYING`;
- admitted synchronous and asynchronous operations hold an internal lease until settled;
- close waits for leases up to its deadline;
- the callback receives a narrow, trusted main-process context rather than the raw `VaultManager`, its maps, or a raw `Vault`;
- `activeVault` is a facade over the current Vault's Project, Secret, favorites, statistics, import/export, save, and reconciliation operations; it exposes no key, raw `data`, setup, unlock, lock, or seal method;
- `vaults` is a facade for list, lookup, switch, create, import, rename, and remove with lifecycle-aware persistence;
- `security` is a facade for password verification, key rotation, and Touch ID policy coordination;
- `signal` is the lease's `AbortSignal`;
- blocking adapters, approval dialogs, HTTP work, and disk synchronization must observe cancellation and settle their lease;
- native file/folder selection occurs outside the lease because Electron dialogs are not reliably cancellable; selected paths and session state are revalidated inside a new lease before any sensitive read, mutation, or export;
- callbacks must not return or retain Vault, manager, key, or decrypted-state references; this is an internal adapter capability and is never exposed through preload, IPC payloads, or HTTP callbacks;
- errors from the operation pass through unchanged.

This replaces direct `isUnlocked` checks and unguarded `getVault()` access in IPC handlers.

Key rotation is performed through the scoped context so the lifecycle module can atomically coordinate the system Vault, logger key, Touch ID credential, and pending recovery capsules. Rotation is blocked while a capsule is pending unless every capsule is transactionally re-encrypted before the Vault/salt commit.

### `resolveRecovery(request)`

Resolves authenticated recovery while the session is `recovering`:

```js
await session.resolveRecovery({
  kind: "vault" | "manager_config",
  artifactId,
  capsuleId,
  decision: "keep_recovered" | "use_current" | "discard" | "defer",
});
```

- only safe recovery metadata appears in `snapshot()`; decrypted recovery data remains internal;
- system Vault and manager-configuration recovery cannot be deferred because they anchor the session and secondary Vault keys;
- secondary recovery may be deferred, leaving that Vault unavailable while the rest of the session becomes active;
- every decision revalidates capsule generation and the current disk marker;
- `keep_recovered` uses compare-and-swap persistence and never overwrites bytes that changed after inspection;
- `use_current` requires a currently valid, authenticated Vault file;
- `discard` is explicit irreversible authorization and never implies that current disk data is valid;
- manager configuration uses its own current-file marker and compare-and-swap validation and must resolve before secondary Vault authentication;
- after all required decisions settle, the normal activation pipeline continues and enters `active`; discarding the only valid system recovery artifact returns `locked` instead.

### `configure(policy)`

Applies normalized lifecycle settings:

```js
await session.configure({
  autoLockEnabled: true,
  autoLockTimeoutSeconds: 1800,
  diskSyncIntervalMs: 5000,
});
```

Policy replacement and timer reconciliation are serialized with open and close. Updates are last-write-wins. If active, monitors are rescheduled exactly once using generation tokens so cleared but already-queued callbacks become no-ops. If locked, the policy is stored without starting monitors. Updates during opening or closing cannot start a monitor from stale state.

### `snapshot()`

Returns non-secret public state:

```js
{
    state: "locked" | "opening" | "recovering" | "active" | "closing" | "destroying",
    transitionId: 12,
    reason: "setup" | "manual" | "touch_id" | "idle" | "quit" | "delete" | null,
    activeVaultId: "system" | string | null,
    recovery: [{ kind: "vault" | "manager_config", artifactId, capsuleId, reason, allowedDecisions }],
    warnings: [{ code, vaultId? }],
}
```

Snapshots are immutable copies. `reason` is the current transition reason and is `null` in stable `active` or `locked` states. Callers may use snapshots for routing and display, but must use `withActiveSession()` for Vault access.

## State machine

The transition table is authoritative:

| From | Request | Result |
| --- | --- | --- |
| `locked` | open | `opening` |
| `opening` | authenticated, no decision | `active` |
| `opening` | authenticated recovery decision | `recovering` |
| `opening` | failure | `locked` |
| `opening` | close | cancel opening; if it committed, immediately close; otherwise finish `locked` |
| `opening` | destroy | cancel opening, drain, then `destroying` |
| `recovering` | all required decisions resolved | `active` or `locked` after discard |
| `recovering` | open | reject with `VAULT_SESSION_RECOVERING` |
| `recovering` | manual close | seal transient recovery state, preserve capsules, then `locked` |
| `recovering` | idle or quit close | preserve the existing authoritative capsule without writing a redundant generation, then `locked` after normal drain rules |
| `recovering` | destroy | drain, explicitly discard recovery, then `destroying` |
| `recovering` | configure | store policy; do not start monitors |
| `active` | close | `closing` |
| `closing` | manual close blocked | `active` |
| `closing` | close completed | `locked` |
| `closing` | higher-priority close | atomically upgrade intent; remain `closing` |
| `closing` | destroy | queue destructive intent after drain unless final quit exit has begun; then reject with `VAULT_SESSION_SHUTDOWN_IN_PROGRESS` |
| `active` | destroy | write tombstone, then `destroying`, then `locked` |
| `locked` | destroy | resume only an existing tombstoned destruction; otherwise reject locked |
| `destroying` | destroy | join the existing destruction result |
| `destroying` | open, close, configure, or recovery | reject with `VAULT_SESSION_DESTROYING` |

Close during opening records intent and requests cooperative cancellation; it never validates or retains another credential. A manual-to-idle or manual-to-quit upgrade changes `snapshot().reason` but keeps the same transition ID because it is one close transition. It does not emit a duplicate state-change event while the state remains `closing`.

### Invariants

1. `active` means the system Vault is unlocked, available secondary Vaults have explicit status, the logger has the current system key, the sensitive-ingress gate is enabled, and configured monitors are running.
2. `locked` means local ingress is disabled, monitors are stopped, logger encryption material is cleared, and no Vault retains plaintext data or a key.
3. `opening`, `recovering`, `closing`, and `destroying` never admit ordinary sensitive operations.
4. Recovery decisions are the only operations admitted while `recovering`.
5. At most one transition mutates lifecycle state at a time.
6. A sanitized public state-change notification is emitted once per committed state change, after releasing the transition mutex; observer failures are isolated and observers may re-enter the interface.
7. No renderer event or adapter callback receives a password, key, Secret value, recovery payload, or reconciliation snapshot.
8. A failed open leaves a clean locked runtime; setup may additionally report that provisioning durably committed.
9. A successful manual close proves that every dirty Vault was persisted.
10. A security-required close never keeps plaintext available merely because persistence failed.
11. No Vault is sealed while an admitted operation lease can still execute.
12. JavaScript object clearing is best-effort reference removal, not a claim that arbitrary garbage-collected copies are securely erased; process termination is the hard purge for uncancellable quit-time work.

## Open pipeline

All authentication methods converge after candidate-key acquisition:

1. serialize the transition and enter `opening`;
2. stop stale monitors and disable the sensitive-ingress gate;
3. enumerate bounded recovery headers as untrusted metadata;
4. provision a new Vault, derive a candidate key from the validated system salt, or copy a supplied key;
5. attempt normal `vault.enc` authenticated loading first;
6. if normal loading fails because the artifact is missing, unreadable, or invalid, attempt strictly bound capsule authentication with the candidate key;
7. if neither artifact authenticates, return the same generic unlock failure used for an incorrect credential;
8. load and validate `vaults.enc`, distinguishing absence from corruption; never replace corrupt configuration with defaults;
9. authenticate any manager-configuration recovery record; if it needs a decision, enter `recovering` immediately and resume only after it resolves;
10. authenticate configured secondary Vaults from the resolved configuration and record `active`, `offline`, `failed`, or `recovery_required` for each;
11. enter `recovering` if an authenticated Vault artifact needs a decision;
12. otherwise install the logger encryption key, enable the HTTP sensitive-action gate, and start configured monitors;
13. enter `active` and emit one sanitized state notification.

Normal `vault.enc` is always authoritative when it authenticates and validates. A capsule never downgrades or bypasses a valid current Vault. Successful capsule authentication proves a candidate credential only for entry into restricted `recovering`, never directly into `active`.

For password bootstrap, `salt.txt` must be strict valid hex of the expected length. The capsule records its digest inside the authenticated body. If the salt is missing, password recovery is impossible; a valid supplied Touch ID key may still authenticate a capsule. Secondary keys and expected identities come only from authenticated system configuration, never from an untrusted capsule header.

If activation fails, unwind completed runtime steps in reverse order, seal opened Vaults without another ordinary save, clear keys and timers, disable ingress, and return to `locked`. A setup that already committed its Vault artifacts remains provisioned and is not deleted as compensation.

Setup must use this exact pipeline. It must not assign an unlocked flag directly.

## Close pipeline

1. enter `closing` and emit one state notification;
2. reject new `withActiveSession()` calls;
3. disable the HTTP sensitive-action gate, cancel approval windows, and stop monitors;
4. abort cooperative operations and wait for all admitted operations plus already-fired monitor callbacks to settle;
5. on a manual timeout, restore the active runtime and return `drain_timeout`; on idle, remain `closing`; on quit, let the shutdown coordinator choose continued waiting or process termination without claiming `locked`;
6. ask `VaultManager` to prepare its configuration and every unlocked Vault for close;
7. handle persistence results according to the highest-priority close reason;
8. clear logger encryption material;
9. idempotently seal Vault keys, decrypted data, baselines, and reconciliation plans without further persistence;
10. reset manager session state;
11. enter `locked` and emit one state notification.

Renderer navigation occurs after `close()` resolves. The lifecycle result, not an optimistic global boolean, decides whether the lock screen is shown.

## Persistence and recovery

### Graceful close

Manual close is graceful. Each Vault must return one of:

- `clean`: nothing needed writing;
- `persisted`: session state was atomically written;
- `needs_resolution`: reconciliation requires a user decision;
- `failed`: an I/O or validation error prevented persistence.

`clean` means the exact drained revision has no unpersisted mutation and its expected durable Vault artifact still exists and authenticates. A missing or unreadable disk artifact is never clean. `sessionRevision` is not the dirty marker; each Vault tracks explicit `currentRevision` and `persistedRevision` values.

Preparation cancels pending autosave, captures the revision only after leases drain, reconciles or atomically persists against the expected disk fingerprint, and proves the revision did not change before returning. A cleared interval or timeout is not sufficient evidence that an already-fired callback stopped.

If any Vault returns `needs_resolution` or `failed`, the session restores ingress and monitors, returns to `active`, and returns a safe aggregate result. No Vault is wiped and the renderer can resolve or report the problem. Partial durable commits are allowed: a Vault that already persisted refreshes its baseline, while a blocked Vault preserves its in-memory state and reconciliation plan. Retrying preparation is idempotent and re-arms any autosave work still needed.

`vaults.enc` participates in the same preparation. Manager configuration has explicit dirty and persisted revisions, uses atomic compare-and-swap persistence, and cannot report create/import/rename/remove success until the configuration commit succeeds. A corrupt or unreadable existing configuration fails closed and is never overwritten with defaults.

### Security-required close

Idle and quit must remove plaintext even if normal persistence cannot complete.

For each Vault that cannot be safely persisted, write a recovery capsule before clearing memory. The capsule:

- is encrypted with that Vault's current key;
- is stored in an app-local recovery directory with mode `0700`, using opaque capsule-ID filenames rather than Vault names or paths;
- rejects symlinks, non-regular files, oversized records, malformed/trailing bytes, and unsupported envelope versions before decryption; after authenticated decryption it validates schema and depth before hydrating Vault objects;
- is written in the same directory through file fsync, atomic rename, and parent-directory fsync, with final mode `0600`;
- contains normalized session data, the reconciliation baseline, the inspected disk fingerprint, a schema version, and creation time;
- contains no password or plaintext key in its header or on disk; decrypted payloads necessarily contain Secret values and remain internal-only;
- is bound to an immutable random 256-bit `vaultInstanceId`, logical Vault ID, and canonical-path digest;
- is deleted only after successful recovery or an explicit user discard decision.

Each Vault receives `vaultInstanceId` at setup and stores it inside authenticated Vault data; secondary identities are also anchored in authenticated `vaults.enc`. The capsule has a canonical untrusted header containing format version, capsule ID/generation, logical Vault ID, instance ID, canonical-path digest, algorithm, and random nonce. The exact header bytes are AES-GCM additional authenticated data. The encrypted body repeats and must exactly match all identity fields and additionally contains session data, baseline, captured disk marker, dirty/persisted revisions, salt digest where applicable, and creation time.

Existing Vaults receive identity through a one-time authenticated migration before recovery generation is enabled. Persist the system and secondary Vault IDs first, then atomically persist matching IDs in manager configuration. If a secondary Vault commit succeeds but configuration commit fails, the next open re-authenticates the configured Vault at its existing path, adopts its persisted instance ID, and retries configuration; it never invents another ID. No capsule may be issued for an identity that exists only in memory. Migration is ordered, retryable, and covered by fault-injection tests.

For the system Vault, authenticated capsule identity is the fallback trust anchor only when the normal Vault cannot authenticate. Replacing the local salt, Vault, and capsule together is outside the threat model because an attacker able to replace every local authentication artifact can already replace the current salt and Vault. Capsule fallback does not grant access to a valid existing Vault.

Only one authoritative pending generation exists per Vault. A new generation becomes authoritative only after it is durable; the previous recoverable generation is not removed first. Resolution revalidates capsule ID/generation and current disk marker. Recovery is idempotent across a crash after Vault persistence but before capsule deletion by comparing authenticated data and disk digests.

After the next credential attempt, recovery follows these branches:

1. Authenticate a valid current Vault first. If present, reconcile `(capsule session, current disk, capsule baseline)` and require a decision for conflicts.
2. If disk is still `missing` exactly as captured, `keep_recovered` may atomically reconstruct, reload, and validate the Vault.
3. If captured disk was unreadable/invalid, or current bytes differ, enter `recovering` and require `keep_recovered`, `use_current` when current is valid, or explicit `discard`.
4. Immediately before any decision, re-read both the capsule generation and disk marker. A mismatch supersedes the plan without changing either artifact.
5. Delete the capsule durably only after the selected state is durably established or discard is explicitly authorized.

Corrupt, wrong-key, oversized, or identity-mismatched capsules are quarantined and reported through safe metadata. They do not prevent a valid normal Vault from opening. A system Vault that has no valid normal artifact and no valid capsule remains locked with the generic authentication failure. Offline secondary Vault recovery is deferred without blocking the system Vault; that Vault remains unavailable and unwritable.

Pending capsules block password/key rotation unless all affected capsules are transactionally re-encrypted before the Vault/salt change commits. System deletion and auxiliary Vault removal require explicit recovery discard and clean up matching capsules. A relocated Vault requires explicit rebind after its instance identity authenticates; path mismatch alone is never silently accepted.

Manager configuration has its own encrypted recovery record under the system key because it contains secondary Vault identities and keys. Its envelope contains no plaintext key. It follows the same generation, durability, replay, cleanup, and explicit-decision rules as Vault capsules.

If both normal persistence and recovery-capsule persistence fail, security wins: plaintext is cleared, the close result records `recovery_failed`, and a non-secret diagnostic is logged. This unavoidable data-loss risk must never be reported as an ordinary successful save.

## Vault and VaultManager changes

### Vault

- separate persistence preparation from plaintext clearing;
- replace the ambiguous `lock(sync)` behavior with internal operations that return structured results;
- never catch reconciliation failures and then clear data as though persistence succeeded;
- track explicit dirty and persisted revisions independently of reconciliation plan revision;
- serialize mutation, autosave, reconciliation, recovery, and close preparation through one tracked internal write gate;
- provide an internal recovery snapshot only to `VaultManager` during close;
- provide an internal capsule-assisted authenticated open path that can enter restricted recovery when normal disk loading fails;
- defensively copy supplied key Buffers and zero owned temporary Buffers on a best-effort basis;
- keep reconciliation and atomic Vault writes owned by `Vault` and `VaultReconciliation`.

### VaultManager

- replace `lockAllVaults()` and `lockAllVaultsSync()` with a structured prepare/seal sequence;
- do not suppress individual Vault errors;
- aggregate results by Vault ID without Secret data;
- reset maps and configuration only after the lifecycle module commits the close;
- make rollback of a partially opened session explicit;
- distinguish absent `vaults.enc` from corrupt, unreadable, or undecryptable configuration and never overwrite the latter;
- track and atomically persist manager-configuration revisions with compare-and-swap and fsync;
- report partial secondary activation explicitly rather than logging and forgetting failures;
- make auxiliary removal use the same prepare/seal result and abort on conflict unless discard is explicitly confirmed;
- keep multi-Vault discovery, configuration, switching, and reactivation owned by `VaultManager`.

## Monitor ownership

Auto-lock and periodic disk synchronization move behind the lifecycle seam.

The scheduler adapter exposes timer creation/cancellation and idle-time reads. `VaultSession` owns:

- whether monitors may run in the current state;
- ensuring at most one timer of each kind exists;
- restarting timers after policy changes;
- converting an idle threshold crossing into one serialized `close({ reason: "idle" })` call;
- preventing disk-sync ticks during opening or closing;
- routing disk-sync work through `withActiveSession()`;
- applying generation tokens to stale queued callbacks and single-flight guards to asynchronous ticks;
- reconciling every unlocked Vault, not only the currently selected Vault.

Timer callbacks contain no lifecycle policy.

## Local ingress and logging

- the HTTP listener may remain allocated for authenticated `status`, but its sensitive-action gate is disabled before close begins draining operations;
- HTTP handlers use `session.withActiveSession()` and cannot rely on a separate unlocked flag;
- Vault lookup/reactivation, approval, mutation, and save all occur inside one lease;
- `HttpServer.isUnlocked` and `setUnlocked()` are removed;
- locked/opening/recovering/closing states map to stable non-secret error codes;
- approval windows and request work receive the lease `AbortSignal` and settle on cancellation;
- the logger receives its encryption key only during open activation.
- the logger key is cleared before a close commits `locked`.
- lifecycle diagnostics contain Vault IDs, transition IDs, reasons, and result codes only.
- HTTP availability is a reported capability rather than an active-state requirement: listener-start failure leaves the UI session active with ingress unavailable and no stale `server-info.json`.

Construction avoids an ingress/session dependency cycle by creating the session first with an ingress gate adapter, then binding HTTP actions to the session's `withActiveSession` capability before the listener starts.

## Electron adapters

`main.js` becomes an adapter:

- `vault:setup`, `vault:unlock`, and Touch ID unlock call `session.open()`;
- `vault:lock`, tray lock, navigation lock, and auto-lock call `session.close()`;
- Vault deletion calls `session.destroy()`;
- sensitive IPC handlers call one shared adapter around `session.withActiveSession()`;
- settings updates await `session.configure()`;
- routing consults `session.snapshot()`;
- state events navigate or refresh the renderer after a transition commits;
- no global `isUnlocked` variable remains.

The migration includes Vault list/switch/create/import/rename/remove, verification and password change, Touch ID enablement, save/reconcile/resolve, Project/Secret/favorite/statistics/log/export/import, and every HTTP action. Navigation to setup or license from an active session must close first or be rejected.

The existing renderer transport names can remain stable, but behavior changes for close: dashboard, tray, and navigation adapters show the lock screen only after `state: "locked"`; `blocked` and `drain_timeout` retain the dashboard and show conflict/error UI. State listeners route on stable `active` or `locked`, never on `closing`. Setup activation failure with `provisioned: true` routes to lock rather than setup. A later unlock shows safe notices for deferred or failed recovery.

IPC adapters translate typed lifecycle errors to the current `{ success, error, code }` shape. State and reconciliation events use explicit allowlists; arbitrary internal objects are never spread into renderer payloads.

## Shutdown

Add a testable `ShutdownCoordinator`. Electron shutdown is explicitly coordinated:

1. tray quit, application-menu quit, `app:quit`, and non-macOS `window-all-closed` all call the coordinator;
2. `before-quit` synchronously calls `preventDefault()` unless `finalExitStarted` is true;
3. intercepted `before-quit` calls or joins that same coordinator promise;
4. a singleton shutdown promise calls `session.close({ reason: "quit", deadlineMs: 5000 })`;
5. the quit-close pipeline writes its final sanitized encrypted lifecycle record immediately before clearing the logger key;
6. after a completed close, destroy tray and remaining windows, set the bypass flag, and call `app.quit()` exactly once;
7. repeated quit requests join the same promise;
8. if drain cancellation does not settle by the deadline, record the timeout to stderr, destroy tray/windows, and call `app.exit(1)`; this hard path does not call `app.quit()` or publish `locked`, and operating-system process exit is the final plaintext purge.

Do not rely on awaiting an asynchronous `before-quit` listener.

The synchronous Vault save path is removed after the coordinated shutdown path is established.

## Error codes

- `VAULT_SESSION_LOCKED`
- `VAULT_SESSION_OPENING`
- `VAULT_SESSION_RECOVERING`
- `VAULT_SESSION_CLOSING`
- `VAULT_SESSION_DESTROYING`
- `VAULT_SESSION_TRANSITION_IN_PROGRESS`
- `VAULT_SESSION_OPEN_FAILED`
- `VAULT_SESSION_CLOSE_BLOCKED`
- `VAULT_SESSION_DRAIN_TIMEOUT`
- `VAULT_SESSION_RECOVERY_REQUIRED`
- `VAULT_SESSION_RECOVERY_FAILED`
- `VAULT_SESSION_CONFIG_INVALID`
- `VAULT_SESSION_SHUTDOWN_IN_PROGRESS`

Error messages and public results must not contain credentials, keys, Secret values, decrypted snapshots, or encrypted recovery bytes.

## Test strategy

The `VaultSession` interface is the primary test surface. Use real temporary Vault files plus fake local adapters for ingress, logger, timers, idle time, and state notifications.

Required scenarios:

### Open

- setup, password, and key methods converge on identical active state;
- setup starts both configured monitors;
- failure after setup provisioning returns locked with `provisioned: true` and does not delete the new Vault;
- a failed credential returns to a clean locked state;
- failure at each activation step rolls back earlier steps;
- every concurrent second open fails deterministically without comparing credentials;
- close during open and higher-priority close escalation follow the transition table;
- close and destroy during recovery preserve or explicitly discard the authoritative capsule as specified;
- a missing or corrupt normal Vault can authenticate only into `recovering` through a valid capsule;
- a valid normal Vault remains authoritative over an old capsule;
- corrupt `vaults.enc` fails closed and is never overwritten;
- legacy Vault identity migration is ordered and recovers from failure between Vault and configuration commits;
- secondary Vault offline/failure status is preserved without blocking the system Vault;
- no credential appears in results, events, or logs.

### Active access

- `withActiveSession()` rejects while locked, opening, recovering, closing, and destroying;
- close waits for admitted asynchronous work;
- hung approvals and other blocking adapters observe cancellation and settle;
- a drain timeout never seals while a lease remains live;
- native dialogs occur outside leases and their paths are revalidated after admission;
- operation errors pass through without corrupting state;
- a Vault switch updates `activeVaultId` and is visible to the next `withActiveSession()` call;
- sensitive IPC and HTTP adapters cannot bypass the seam.

### Close

- manual close resolves only after all Vaults persist and plaintext is cleared;
- a reconciliation conflict blocks manual close and leaves the session active;
- an ordinary I/O failure blocks manual close without dropping data;
- idle close creates a recovery capsule when normal persistence is blocked;
- quit close creates recovery capsules and respects its deadline;
- capsule-write failure still clears plaintext and returns `recovery_failed`;
- repeated close requests join the same transition;
- manual close upgraded by idle or quit cannot roll back to active;
- an idle tick racing manual or quit produces one transition;
- a queued stale timer callback cannot access Vault state after close or reconfiguration;
- mixed multi-Vault `persisted + needs_resolution` preparation is retryable and preserves the blocked Vault;
- manager configuration is durably prepared with Vault data;
- logger keys, timers, ingress, and manager state are cleared exactly once.

### Destruction

- missing or malformed confirmation is rejected without changing state;
- destruction during opening or recovery follows the transition table;
- destruction never deletes or seals while a lease is live;
- timeout leaves the active runtime intact unless quit hard-exit owns termination;
- only the internal allowlist is deleted and secondary Vault directories remain;
- partial deletion returns sanitized per-artifact results and leaves the runtime locked;
- locked retry is allowed only with the durable destruction tombstone;
- repeated destruction returns the stable operation schema.

### Recovery

- a valid capsule restores session-only state through reconciliation;
- recovery works when `vault.enc` is missing or corrupt but the credential/capsule authenticate;
- a changed disk file requires explicit conflict resolution;
- a stale, corrupt, wrong-key, or wrong-Vault capsule fails closed;
- successful recovery deletes the capsule;
- failed or deferred recovery preserves the capsule;
- capsule envelope, stored bytes, events, and diagnostics expose no plaintext Secret values; the decrypted internal payload necessarily contains them;
- disk changes again while recovery UI is open supersede the decision;
- capsule replay and duplicate generations are idempotent;
- a crash before/after file fsync, rename, parent fsync, Vault write, and capsule deletion preserves at least one recoverable generation;
- symlink, non-regular, oversized, malformed, and excessive-depth capsules are rejected;
- key rotation is blocked or atomically rewraps pending capsules;
- Vault removal and system destruction explicitly discard matching capsules;
- configuration recovery preserves secondary Vault identity and keys without plaintext exposure.
- manager-configuration recovery resolves before secondary Vault authentication and uses its own artifact ID and file marker.

### Shutdown and policy

- settings changes reschedule each monitor once;
- idle threshold causes one close transition;
- no disk-sync tick starts during close;
- every unlocked Vault participates in periodic reconciliation;
- quit waits for the coordinated close before final exit;
- tray, menu, IPC, `window-all-closed`, and repeated quit signals share one shutdown execution;
- completed shutdown uses one bypassed `app.quit()`, while an uncancellable timeout uses `app.exit(1)` without publishing locked;
- blocked manual close UI stays on the dashboard and stable state events navigate only after commit;
- adapter contract tests cover every sensitive IPC and HTTP action.

Existing direct tests of superseded lock helpers should be replaced rather than layered beneath the new interface.

## Migration sequence

1. Extract testable IPC registration and `ShutdownCoordinator`; add failing lifecycle interface tests with fake adapters.
2. Implement state serialization, immutable snapshots, cancellable operation leases, close-intent escalation, and serialized policy configuration.
3. Add immutable Vault instance identity plus strict manager-configuration validation and atomic dirty-revision persistence.
4. Make setup, password unlock, and key unlock use one candidate-key/open pipeline with explicit secondary statuses.
5. Split Vault persistence preparation from idempotent plaintext sealing and remove swallowed close errors.
6. Add the hardened recovery store, capsule-assisted authentication, `recovering` state, and recovery decisions.
7. Move auto-lock and all-Vault disk-sync monitor ownership into `VaultSession`.
8. Route HTTP and every sensitive IPC action through `withActiveSession()` and cooperative cancellation.
9. Replace every lock entry point with `close()` and deletion with `destroy()`.
10. Make key rotation lifecycle-aware and define pending-capsule rewrap/block behavior.
11. Replace asynchronous `before-quit` cleanup with `ShutdownCoordinator`.
12. Remove `isUnlocked`, HTTP's unlocked boolean, old timer helpers, synchronous locking, and duplicated open/close orchestration.
13. Delete only superseded shallow lifecycle tests; retain reconciliation and Touch ID module tests and verify adapters plus lifecycle through their interfaces.

## Completion criteria

The candidate is complete only when:

- callers use the `VaultSession` interface for every session transition;
- setup, both unlock methods, manual lock, idle lock, and quit share the same pipelines;
- session state has one authority and `isUnlocked` is removed;
- sensitive IPC and HTTP work is admitted only through `withActiveSession()`;
- save, conflict, recovery, timer, ingress, logger, and shutdown ordering lives behind the seam;
- Vault and manager close errors are not suppressed;
- security-required close cannot silently discard recoverable data;
- manager configuration and Vault data have explicit dirty/durable revision tracking;
- recovery can bootstrap a restricted authenticated state when the normal Vault artifact is unavailable;
- old lifecycle helpers and synchronous shutdown saving are removed;
- tests cover the interface's success, failure, race, and recovery paths;
- deleting `VaultSession` would force lifecycle coordination back into multiple callers.

Implementation verification: the production Electron adapters now route session transitions and sensitive work through `VaultSession`; focused lifecycle, recovery, shutdown, HTTP admission, reconciliation, and real setup/close/reopen integration tests pass together with the repository lint suite.
