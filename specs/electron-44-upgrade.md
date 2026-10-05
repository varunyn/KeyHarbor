# Spec: Electron 39 -> 44 Upgrade

## 1. Background

LocalKeys is on `electron: ^39.8.0` (installed `39.8.0`, see `package.json:32`). Latest stable is `44.4.x` (Chromium M152, Node 24.21.0, supported to 2027-03-02). `43.x` EOL is 2027-01-05 and `42.x` EOL is 2026-10-20, so `44` is the correct target.

This spec covers the major-version upgrade only. No feature changes.

## 2. Goals

- Upgrade `electron` to `^44.4.4` (or latest `44.4.x` at implementation time).
- Keep the app fully working: unlock/lock, vault CRUD, secrets CRUD, Touch ID, tray, dialogs, CLI install, HTTP approval server, MCP server.
- Align packaging, docs, and OS support matrix with Electron 44 requirements.
- Keep `electron-builder` on v26 (no v27 ESM migration in this spec).
- No renderer clipboard migration needed (already on `navigator.clipboard`).

## 3. Non-goals

- No upgrade to Electron 45 alpha/beta/nightly.
- No upgrade of `electron-builder` to v27.
- No cleanup of stale `asarUnpack` entries (`electron-context-menu`, `electron-dl`, `ext-name`) or `overrides` unless blocking the build.
- No restoration of pre-43 dialog last-used-directory behavior.
- No adoption of new Electron 40-44 APIs (WCO, `session.registerPreloadScript`, new clipboard `ClipboardItem`, etc.).
- No changes to vault crypto format, settings schema, or IPC contract.

## 4. Decisions (confirmed)

- Target: `v44 stable`.
- Accept Electron 44 OS drops: require macOS 13+, 64-bit only. Update docs.
- Packaging scope: Electron only. Stay on builder v26. Only fix `showHiddenFiles` gating.
- Dialog behavior: accept new Downloads default for open dialogs without `defaultPath`.

## 5. Breaking-change triage (39 -> 44)

### 5.1 Applies, must handle

1. **44: macOS 12 dropped, Win ia32 + Linux armv7l dropped**
   - Update `README.md` system requirements: macOS 13 Ventura+, Windows 10+ x64/arm64, Linux x64/arm64.
   - Verify `package.json:60-77` build targets contain no ia32/armv7l arch. Default x64/arm64 is correct; do not add 32-bit targets.
   - Acceptance: `npm run build:mac`, `build:win`, `build:linux` succeed; artifacts are 64-bit only.

2. **42: `electron` no longer installs via `postinstall`**
   - Binary downloads on first `npx electron .` / `npx install-electron`.
   - `ELECTRON_SKIP_BINARY_DOWNLOAD` is dead; use `ELECTRON_INSTALL_ARCH` / `ELECTRON_INSTALL_PLATFORM` for cross-arch testing.
   - Action: verify clean `npm install` + `npm start` works; verify `README.md` dev setup has no `ELECTRON_SKIP_BINARY_DOWNLOAD` or `--platform` npm-config instructions. Update if present.
   - Acceptance: fresh `node_modules` + `npm start` launches without manual binary steps.

3. **43: `showHiddenFiles` removed on Linux**
   - Location: `src/main.js:1268` in `secrets:import` (`dialog.showOpenDialog`).
   - Action: only pass `showHiddenFiles` on `darwin`/`win32`, omit on `linux`.
   - Acceptance: import dialog works on macOS, Windows, Linux; no deprecation warning in Linux console.

### 5.2 Applies, accepted as-is (no code change)

4. **43: open-dialog `defaultPath` now defaults to Downloads**
   - Save dialogs already set `defaultPath` (`src/main.js:1195,1228`) — unaffected.
   - Open dialogs without `defaultPath` now start in Downloads. Accepted per decision. No `lastUsedPath` tracking.

### 5.3 Verified not applicable (no change)

- **44 clipboard rearchitecture / renderer removal:** main process does not use `electron.clipboard`; renderer uses `navigator.clipboard.writeText` (`src/views/project.html:599`). No change.
- **42 macOS `UNNotification` codesign requirement:** `src/modules/notification.js:1-167` is in-app DOM toast, not `Electron.Notification`. Existing adhoc sign (`scripts/sign-adhoc.js:4-9`) is sufficient. No change.
- **41 PDF OOPIF, cookie `changed` cause, `session.clearStorageData quotas`, `nativeImage.toBitmap` colorspace, Linux WCO/rounded-corners, `net.request` Sec-Fetch, subframe worker/preload scoping, `select-client-certificate` null `webContents`, ANGLE static link, Unity `app.isUnityRunning()`, `desktopCapturer` `NSAudioCaptureUsageDescription`:** none used by this codebase (`nodeIntegration:false`, `contextIsolation:true`, `loadFile`, `setWindowOpenHandler` + `will-navigate` guard, `https.request` not `net` module). No change.

## 6. Implementation steps

1. `npm install --save-dev electron@^44.4.4` (resolve to latest `44.4.x`).
2. Delete `node_modules` + `package-lock.json` regeneration check: confirm `node_modules/electron` version is `44.x` and binary downloads on first run.
3. Code edit: gate `showHiddenFiles` by platform in `src/main.js:secrets:import` handler.
4. Docs edit: `README.md` — Electron 44, Node `>=20` (unchanged), macOS 13+, 64-bit only, install notes without `postinstall` assumptions.
5. `CHANGELOG.md` Unreleased/Changed entry: Electron 39 -> 44, OS requirement change.
6. No `preload.js`, Touch ID (`src/modules/touch-id-unlock.js`), tray, `safeStorage`, `powerMonitor`, or IPC changes expected.

## 7. Test plan

- [ ] `npm install` from clean state works.
- [ ] `npm start` launches; `src/views/lock.html`, `setup.html`, `dashboard.html` load.
- [ ] Vault setup/unlock/lock, change password, delete vault.
- [ ] Secrets/projects CRUD, import/export `.env`, logs export.
- [ ] Touch ID enable/unlock/refresh on macOS (fallback password works).
- [ ] Tray show/lock/quit; auto-lock idle timer; screen-capture protection toggle.
- [ ] `secrets:import` open dialog on Linux shows no warning; macOS/Windows unchanged.
- [ ] `cli:install` + `ELECTRON_RUN_AS_NODE` CLI (`cli/localkeys.js`, `cli/localkeys-mcp.mjs`) work under Node 24.
- [ ] HTTP approval flow + MCP stdio server work.
- [ ] `npm test` (`node --test`) passes.
- [ ] `npm run build:mac`, `build:win`, `build:linux` (with `--publish never` for verification) succeed.

## 8. Acceptance criteria

- `package.json` devDependency is `electron: ^44.x`; lockfile resolves to `44.4.x`.
- App passes full test plan on macOS; smoke-tested on Windows/Linux (dialogs + launch).
- No Electron deprecation warnings in main-process console for used APIs.
- README states macOS 13+ and 64-bit-only support.
- Rollback is `git revert` + `npm install electron@^39.8.0`; no data migration involved.

## 9. Rollback

Vault files, settings (`~/.localkeys/settings.json`), and Touch ID credential format are unchanged. Downgrade requires only package revert and reinstall. No user-data migration to undo.

## 10. Open questions for implementation

- None blocking. Confirm exact `44.4.x` patch at implementation time via `npm view electron version`.
