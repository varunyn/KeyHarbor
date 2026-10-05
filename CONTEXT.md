# KeyHarbor Domain Context

## Vault

An encrypted collection of Projects, Secrets, favorites, and history stored in one `vault.enc` file. An unlocked Vault has an in-memory session version and a last-known disk version.

## Project

A named collection of Secrets inside a Vault.

## Secret

A keyed value inside a Project, including expiry, description, tags, timestamps, and bounded version history.

## Approval

An explicit user decision that authorizes a sensitive read or write requested through the local CLI or MCP flow.

## Vault reconciliation

The process that compares the Vault's session version, current disk version, and last synchronized baseline. It automatically combines provably non-conflicting changes and requires an explicit user decision before either conflicting side is discarded.

## Reconciliation baseline

The normalized Vault state and encrypted-file fingerprint last known to exist in both the session and on disk. It is refreshed only after unlock, reload, or a successful write.

## Reconciliation plan

A short-lived in-memory record of a conflict. It binds the session revision and disk fingerprint shown to the user so a later decision cannot be applied to changed data.

## Vault session

The process-wide period in which Vault keys and decrypted Vault data are available. A Vault session coordinates every unlocked Vault together with local ingress, encrypted logging, disk reconciliation, auto-lock, and shutdown behavior.

## Session transition

An ordered change between `locked`, `opening`, `active`, and `closing`. Transitions are serialized so setup, password unlock, Touch ID unlock, manual lock, idle lock, deletion, and shutdown cannot partially overlap.

## Recovery capsule

An atomic, encrypted, short-lived snapshot of session-only Vault state created when a security-required close cannot safely persist to the normal Vault file. It contains no encryption key and is reconciled after the next successful unlock.
