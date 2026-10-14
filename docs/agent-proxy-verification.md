# Agent proxy implementation and verification

Verified locally on 2026-10-13 on macOS arm64. All changes remain local; nothing was committed, pushed, or released.

## What is implemented

KeyHarbor creates a short-lived proxy session bound to one Vault, Project, Environment, Secret, and HTTPS origin. The desktop asks for connection approval and approval for every outgoing request. A private native helper receives the credential only after approval, injects the authentication header, and filters reflected credentials from bounded text responses. The agent receives a placeholder, a scoped proxy bearer, and a public temporary CA certificate.

The helper adapts the pinned Infisical Agent Vault network guard; the surrounding proxy and KeyHarbor approval adapter are maintained here. Upstream provenance and licensing are preserved under `native/agent-proxy/`. This is not the stock Agent Vault service.

Vault locking, session expiry, and child exit revoke sessions. Environment omission resolves to the Project's stable default; missing keys never fall back. The proxy bearer cannot authenticate raw-secret HTTP bridge actions. Existing raw-secret CLI and MCP workflows remain available separately.

## Checks completed

| Check | Result |
| --- | --- |
| Full Node suite, including real helper/TLS fixtures, spawned CLI lifecycle, and close-window decisions | 167 passed, zero failures or skips |
| Native Go tests with race detection | 7 top-level tests passed, including upstream diagnostic and privacy subcases |
| Repository lint, backend types, renderer types and production build | Passed |
| Helper cross-compilation | macOS, Linux, Windows; arm64 and x64 |
| macOS arm64 directory package | Built successfully |
| macOS package signature verification | `codesign --verify --deep --strict` passed; local ad-hoc signature |
| Packaged helper launch | `--version` succeeded |
| Approval UI | Synthetic preview inspected with request details expanded and credentials masked |

Integration checks cover approval before dispatch, repeated approval on a persistent tunnel, denials, origin/path restrictions, rotation during approval, lock/cancellation, environment isolation, private-network/custom-CA policy immutability, reflected raw and encoded credential filtering, bearer separation, and CLI cleanup. Automated tests use synthetic credentials and local TLS fixtures. The separate live Mealie verification below exercised the approved credential through secretless MCP without retrieving or printing it. One fixture emits Node's IP-address SNI deprecation warning; tests pass.

This verification is not an independent security audit. Windows/Linux runtime behavior and release signing/notarization are pending.

## Approval timeout follow-up

The first live Mealie test connected successfully and confirmed the secretless tool surface, but the connection approval expired at the original 30-second limit. Its authenticated request did not complete at that time. The later live verification below completed successfully after the timeout and macOS packaging follow-ups.

Approvals now allow 120 seconds each. The desktop HTTP connection wait is 135 seconds, the helper approval wait is 130 seconds, and the proxy client wait is 150 seconds. The native response write deadline is 160 seconds so human review can finish before the response is written. Short upstream network limits remain bounded separately.

A real stdio MCP regression waits 31 seconds at both the connection and request approvals, then expects HTTP 200 with reflected credentials filtered. It failed against the old helper with HTTP 403 at its 30-second authorization cutoff. The fixed helper passes this regression.

For the live Mealie retest, call `authenticated_request` using Project `Mealie`, Environment `default`, key name `API_KEY`, origin `https://mealie.varunyadav.com`, method `GET`, and path `/api/groups/self`. The user verified this read-only endpoint against their instance API schema; an unauthenticated control returned 401. Pass `{ timeout: 300_000 }` as the second argument to the MCP v2 SDK's `client.callTool`. Clients manage their own timeout; changing the server cannot increase it.

## Try it locally

The prepared app is `dist/mac-arm64/KeyHarbor.app`. Open it, unlock your Vault, and use an existing Project, Environment, and API credential. Substitute your own names below:

```sh
node backend-build/cli/keyharbor.js agent \
  --project=myapp --env=dev --key=GITHUB_TOKEN \
  --origin=https://api.github.com -- curl https://api.github.com/user
```

Approve the connection, then inspect and approve the request. The proxy injects `Authorization: Bearer <credential>` by default. Try denying a request and locking the Vault during a session; neither should permit further upstream use.

For an MCP client, configure this local server command:

```sh
node backend-build/cli/keyharbor-mcp.mjs --secretless
```

Use `create_agent_session`, `authenticated_request`, and `close_agent_session`. Secretless mode omits the direct secret read/write tools. Custom authentication headers and prefixes are supported; see [README](../README.md).

To launch from source without rebuilding the already prepared artifacts:

```sh
npm start --ignore-scripts
```

Normal builds now require Go for the native helper. The local verification toolchain is available at `/tmp/keyharbor-go/go/bin/go`; `KEYHARBOR_GO_BINARY` selects it for build scripts.

## Practical boundaries

The live Mealie follow-up reported an approved request ending with generic HTTP 502. Unauthenticated curl and a credential-free reproduction of the helper's exact upstream transport both returned 401 from the LAN service. This confirms terminal-context reachability, not desktop-app permission. The installed app lacked `NSLocalNetworkUsageDescription`; the new package declares that use for macOS's separate Local Network permission. A desktop retest after declaring that use returned HTTP 502 with the new `network_unreachable` code after approval. System Settings listed LocalKeys with Local Network access enabled, but no KeyHarbor entry. This narrows the failure to the desktop network context; the error code alone does not prove an OS permission denial.

Proxy-generated connection failures now expose allowlisted codes via the body and `X-KeyHarbor-Proxy-Error`, including policy denial, OS permission denial, unreachable route, DNS, certificate validation, timeout, and refused connection. Tests first reproduced the absence of codes with real local TLS/refused-connection fixtures, then passed with the fix. Additional privacy cases confirm that wrapped transport-error details never appear in responses. Certificate validation, metadata blocking, and explicit private-network approval remain enforced. Local Network permissions must be granted by the user in macOS; the app does not modify them. Packaging inspection also found that KeyHarbor, LocalKeys, and stock Electron shared the same main-executable UUID. The packaging hook now derives a distinct UUID from the app identity and packaged source before signing, and explicitly signs the native helper with its KeyHarbor identifier. Three build-artifact tests cover thin and universal Mach-O files, unchanged non-UUID bytes, and malformed inputs. The installed arm64 app has UUID `54A802D6-6D68-8670-88CA-E14F1499DE29`; strict signature verification and the packaged helper launch passed. The obsolete LocalKeys app and launcher were moved to Trash at the user’s request; vault data was preserved. The first authenticated retry with the corrected identity returned `502 network_unreachable`. Native System Settings inspection then confirmed that KeyHarbor appeared under Local Network with its switch enabled. A subsequent user-approved secretless stdio MCP request returned HTTP 200 with no proxy error. Only the HTTP status and safe error code were printed; no credential or response body was retrieved into this thread. This verifies the live read-only Mealie path after Local Network access became available, without attributing the entire fix to UUID changes alone. The local build remains ad-hoc signed; release signing and reliable OS permission tracking across updates still need a Developer ID identity.

The approval screen now uses Tailwind utilities, the shared `Button` component, and the Lucide lock icon. Its standalone `approval.css`, stylesheet reference, and duplicated approval rules in `common.css` were removed. The Tailwind source list explicitly includes `renderer/screens.tsx`. Synthetic light/dark previews confirmed centering at both desktop window sizes, expanded-body scrolling, visible decision buttons, and an undecided agent prompt remaining enabled after 88 seconds. Only the dynamic progress width remains an inline style; shared theme tokens continue to provide colors.

The approval layout follow-up centers its card in both the 560×650 agent window and 450×390 standard window, with observed center offsets below 0.2 CSS pixels in synthetic browser previews. Expanded long request bodies scroll inside the details area while both decision buttons remain visible. Prose wraps at word boundaries; long URLs can still wrap within their text. The renderer agent countdown now uses the shared 120-second policy, fixing a remaining 30-second frontend cutoff. A synthetic prompt remained undecided and enabled after 50 seconds. These previews use public fixture data and do not exercise a live service credential.

The close-window follow-up adds an explicit background/quit/cancel choice, an optional remembered preference in Settings, and the current shield-and-anchor menu bar logo with live vault status and pending-approval access. The close controller checks cover remembered choices, cancel, repeated close clicks, shutdown racing an open prompt, and a failed preference save. The new settings selector was inspected using synthetic data. The final macOS package was signed, verified, and installed in Applications after the Mac was unlocked. Native UI inspection confirmed the close prompt, its unchecked remember option, and Cancel returning to the existing window. Keep Running was selected without remembering a preference. System menu bar inspection timed out, so menu bar reopening remains a manual check. Background mode preserves existing session and auto-lock behavior; explicit Quit still uses the guarded shutdown coordinator.

Pending approvals now use Electron's native desktop notifications. Clicking one restores and focuses its approval window; it never submits a decision. The notification and Dock attention cue are retired when approval completes, expires, is canceled, or the window closes. Notification content is generic and localized, with no Project, Secret, URL, or request body. Unsupported or failed notification delivery leaves the desktop gate available and logs only a generic diagnostic.

For native delivery testing on macOS, enable KeyHarbor under System Settings → Notifications, unlock the installed app, switch to another app, and initiate a request. Confirm that the banner opens the matching prompt, dismissing the banner does not approve anything, and the alert disappears after denial or expiry. Banners may be suppressed by OS permissions or Focus; actual native delivery and click behavior need this manual check. Electron requires a signed macOS app for notifications; the prepared package is ad-hoc signed and its signature was verified. Other OS delivery remains unverified.

The first version supports bounded HTTPS requests and UTF-8 text/JSON responses. Redirects, WebSockets, streaming, compressed/binary responses, and oversized payloads fail closed. Private-network access and additional upstream CA trust require explicit connection approval.

Proxy configuration is not a sandbox. An agent running with unrestricted access to your user account can access other files, inherited credentials, and legacy interfaces. Run it in a sandbox or separate identity when those boundaries matter. Response filtering covers common encodings; it cannot prove that a malicious service cannot transform a credential into an unrecognized form.
