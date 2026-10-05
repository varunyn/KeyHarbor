# Environment import verification

Verified UTC: 2026-09-30T22:13:36.427748+00:00 Branch: codex/env-text-import; HEAD: cc5883d7e3b494207de510065cd4a9ea81b5279f. Implementation remains unstaged and uncommitted. Runtime: Node v24.21.0; Electron44.4.4; installed Electron binary loads current repository files directly. No native dependencies changed.

## Independent results

- `npm test`: 93/93 passed. Real temporary encrypted Vaults cover parsing, bounds, duplicate decisions, safe errors, metadata/history, prototype-named keys after persistence, atomic rejection, queued mutation/target races, lifecycle and reconciliation.
- `npm run lint` and `git diff --check`: passed.
- Actual production preload and `env-text-import-ipc` registration exercised in isolated Electron with synthetic values and a real temporary VaultSession/coordinator. Only operating-system file selection and unrelated ancillary IPC were fixture adapters.
- Desktop scenarios passed: Paste/File, protected defaults and explicit duplicates, Back preserving input/resetting choices, Cancel no-write, malformed diagnostics without source, all-Skip disabled, successful import/reopen controls, 30-second reveal expiration, blur (including pending commit and delayed reveal), keyboard trap/restoration, 680x500 scrolling, late file response dismissal, and lock cleanup.
- Transport scenarios passed: reject renderer paths, retain authoritative main-process values, discard old handle without harming new preview, navigation retiring handles, and summary-only logging.
- Source revisions, HEAD/index and preexisting unrelated files checked against per-ticket baselines; only reported files changed.
- Impeccable detector executed. Generic tiny-text/radius and existing clipping/shadow advisories were reviewed against the established compact Vault Ledger design and two bounded visual passes. Corrected modal structure and current desktop/minimum-window captures verified.

## Production source identity

| File | SHA-256 |
| --- | --- |
| `src/main.js` | `f0b0fe2eb1c4cf16fccca67df2919d6a8aceefd49b73f60f1641dc1b366f715d` |
| `src/preload.js` | `8786be8ed15fc33826e4ac56622db6e160fda7208b0da3b892a7774a8aec560b` |
| `src/modules/env-text-import-coordinator.js` | `2c81780b2dd77f0b6710791a5b30345ba842c3788eea06f8340f0b7de6b0c123` |
| `src/modules/env-text-import-ipc.js` | `b3c3923b4bc4fca2f24f0d1ff23f13d6ad116249343a19714f4ace21aeb98cca` |
| `src/modules/env-text-parser.js` | `1b22eea6ed01c80b8f360239ed6c40f9683363faee704d13c2c6a064f32531d2` |
| `src/modules/vault.js` | `524881403f7c07dc99110c567d3900c21f80434f934ad08c9baf9ded38b4aa42` |
| `src/modules/vault-manager.js` | `3fa9143157878fda3f4fd402e296471095393d8cfa84de8300031c4f9297a3af` |
| `src/modules/vault-reconciliation.js` | `90caf2e5bae698084d3371ac59acc800f748c5169bcb78d5edb9ace5a5e90ae5` |
| `src/views/project.html` | `db542fac769f21fc19fa2c7a09fdbce3921665ca08411fc80a0e8ab6f7816a29` |
| `src/styles/project.css` | `9b1041a5aa58978b43c656c9af6e503db42026e7f2678ecd6c4cde2de6742e26` |
| `src/locales/en.json` | `3bf7b8754b98a0c91d00095969f2e6517d2b4e3bc923068a36485d3ff444d7e6` |
| `test/env-text-import-coordinator.test.js` | `5e4c1eedd4b0840c595dd7a624e1693fdfa2f05750a7f9a0de53b379fca62bfe` |
| `eslint.config.mjs` | `df1b6f467b03d44e116c9eb09610692abe341594857cd40642fdcfdaefb172b3` |
| `package.json` | `2d4845e6d23cd5bf295752f0e993cfca44dc292cd0f334e1a2e40d3c695bd1cf` |
| `package-lock.json` | `748923c938e4a37c9541b4978eedbf761d7c0b825d29d045e2e668f3cc0dcb96` |

## Local fixture identity

Native commands used `/private/tmp/localkeys-import-verify/{run,blur-busy,pending-reveal,transport}.cjs`; `LOCALKEYS_VERIFY_ADAPTER=production` selects the real adapter/preload. Temporary fixture/storage contains only synthetic credentials. Test log: `/private/tmp/localkeys-import-final-tests.log`. Captures: `review.png` and `minimum.png` in that fixture directory. These temporary artifacts are verification evidence rather than shipped app files.

- `fixture.cjs` SHA-256: `bb26e29a309d1ec8b3e2f1df711353acaf4021284a0b439b55342fb1e8807c95`
- `run.cjs` SHA-256: `813ab6f186774e7aa971244bd49a76cd83879339cc6cd0e1d3c04d6deac0691c`
- `blur-busy.cjs` SHA-256: `84541b8b123ca97ca853378abb607ecc85d0260b976b11e635de210ff0cfa26b`
- `pending-reveal.cjs` SHA-256: `acdf672051bed7d039c0b828c09615f3261e7dba88d1b2646f8ca88a12f7688e`
- `transport.cjs` SHA-256: `4b9ae63802789b6ff25d9752aae9684f60104888bcda9d3138f5a2791d8204ba`
