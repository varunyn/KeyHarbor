# Agent Vault integration feasibility

Reviewed: 2026-10-13. This is a feasibility report, not an implemented integration or a security certification.

Implementation follow-up: the scoped helper and KeyHarbor adapters are now implemented locally. See [implementation verification and testing instructions](agent-proxy-verification.md). The findings below describe the original upstream review, before implementation.

## Result

Infisical Agent Vault can supply reusable proxy infrastructure, but its released application cannot be bundled unchanged while meeting KeyHarbor's approval, storage, lifecycle, and platform requirements.

The recommended experiment is a dedicated helper built from a pinned upstream source snapshot, with a KeyHarbor credential/approval adapter. This avoids writing TLS interception and credential substitution from scratch. It still creates a maintained Go dependency and requires targeted upstream changes. Shipping that helper should depend on the integration checks below passing.

## Evidence and scope

- Reviewed release: [v0.40.0](https://github.com/Infisical/agent-vault/releases/tag/v0.40.0).
- Source commit: [`872578e4cdf9e03d5e3bcb5512023a70bf90ed65`](https://github.com/Infisical/agent-vault/tree/872578e4cdf9e03d5e3bcb5512023a70bf90ed65), also the current `main` commit returned by GitHub during this review.
- Inspected the source archive, release asset list, credential providers, forwarding paths, session resolution, external-store sync, telemetry initialization, and build configuration.
- Downloaded the official Darwin ARM64 archive and verified its SHA-256 against the release's `checksums.txt`: `356e6ee04bb887baf47f16780e0d446014864e0fc6c6c976c1b48bfb416f21a0`.
- Ran only `version`, with both `AGENT_VAULT_TELEMETRY=false` and `--telemetry=false`. It succeeded and reported version 0.40.0, commit 872578e, and darwin/arm64.
- The extracted executable is 36,835,282 bytes; its release archive is 13,548,978 bytes. A trimmed custom helper's size is unmeasured.
- No upstream server was started, trust store changed, or real vault credential supplied. Signature/attestation verification and an end-to-end proxy integration were not performed. Go is unavailable in this workspace, so no source build or Windows cross-build was attempted.
- Existing KeyHarbor verification: `npm test` passed all 148 tests. The initial sandboxed run could not bind loopback HTTP fixtures; the approved rerun outside the sandbox passed. These tests validate the existing app, not the proposed integration. Only this report was added to the repository.

## Findings

| Requirement | What upstream provides | Integration consequence |
| --- | --- | --- |
| Reusable HTTP proxy | CONNECT/TLS interception, header and placeholder injection, destination matching, and network guards | Useful foundation; do not replace this machinery without a reason. |
| KeyHarbor remains the credential authority | Internal `CredentialProvider` and `SessionResolver` interfaces | A custom helper can supply adapters, but the stock executable has no KeyHarbor provider configuration. |
| No second persistent secret collection | Built-in encrypted credentials; external Infisical static secrets are synchronized into its credential database | Do not import or periodically synchronize KeyHarbor secrets into the stock server. |
| Approval for each external operation | Proposal approval for service/credential configuration | Add a request approval boundary before credential resolution and upstream dispatch. |
| Project/environment isolation | Proxy sessions scoped to an Agent Vault vault | Bind each helper session to immutable KeyHarbor vault/project/environment identities; never use desktop selection as routing state. |
| No telemetry | Telemetry defaults on, with an opt-out flag/environment variable | Omit telemetry initialization from a dedicated helper; do not run the stock defaults. |
| macOS, Linux, Windows | Release binaries for Darwin/Linux AMD64/ARM64 | Windows is an explicit engineering and validation task. |
| Immediate vault lock/revocation | CONNECT authentication once per tunnel; shutdown does not track all hijacked tunnels | Revalidate each request and terminate live tunnels/helper processes on lock, revocation, and quit. |
| Credentials absent from agent-visible output | Response header filtering, followed by streaming response-body copy | Add bounded response handling and credential filtering; the reviewed path does not scan reflected credential values. |

### Storage and approval extension points

[`CredentialProvider.Inject`](https://github.com/Infisical/agent-vault/blob/872578e4cdf9e03d5e3bcb5512023a70bf90ed65/internal/brokercore/credential.go) receives vault ID, host, port, and path. It does not receive the method, body, or full caller identity. It cannot, by itself, implement precise approval of the actual operation. The stock credential-store selector supports built-in storage and Infisical, rather than a general executable or HTTP callback provider.

The [external-store sync implementation](https://github.com/Infisical/agent-vault/blob/872578e4cdf9e03d5e3bcb5512023a70bf90ed65/internal/infisical/sync.go) encrypts fetched static secrets and writes them to its local credential store. This is not an on-demand KeyHarbor integration. The [proposal implementation](https://github.com/Infisical/agent-vault/blob/872578e4cdf9e03d5e3bcb5512023a70bf90ed65/internal/server/handle_proposals.go) reviews configuration changes, not each outgoing API operation.

Add a hook to the shared [forwarding path](https://github.com/Infisical/agent-vault/blob/872578e4cdf9e03d5e3bcb5512023a70bf90ed65/internal/mitm/forward.go) before `Inject` and `RoundTrip`. For the first supported scope, freeze bounded request headers, query, and body so the approved request is the one dispatched. Denial, cancellation, timeout, malformed adapter responses, and desktop disconnection must prevent dispatch. Automatic retries must be disabled initially or have an explicit approved retry policy.

### Packaging and licensing

The [license](https://github.com/Infisical/agent-vault/blob/872578e4cdf9e03d5e3bcb5512023a70bf90ed65/LICENSE) permits redistribution and modification of MIT-covered code with notices retained. Enterprise directories have separate terms, and dependencies retain their own licenses. Preserve applicable notices and audit the dependency inventory of the exact shipped helper.

The [release configuration](https://github.com/Infisical/agent-vault/blob/872578e4cdf9e03d5e3bcb5512023a70bf90ed65/.goreleaser.yml) builds Darwin and Linux only, with CGO disabled. The full CLI also contains unconditional Unix-specific calls such as `syscall.Exec` and `SysProcAttr.Setsid`. Adding Windows to the release matrix alone is insufficient. A dedicated entry point can avoid these CLI paths, but all transitive proxy dependencies still need Windows compilation and execution checks.

Reusable components reside under Go `internal/` paths. They are not a supported external library API. Reuse requires an upstream module change, a maintained fork with a new entry point, or a carefully tracked vendored subset. A pinned fork is the clearest initial experiment; publishing a supported library upstream would reduce long-term maintenance.

KeyHarbor already uses electron-builder and has macOS ARM64/x64, Windows, and Linux release jobs. Use platform-specific `extraResources` to place a verified helper outside the ASAR, launch it from `process.resourcesPath` with `spawn` and `shell: false`, and include it in signing and release validation. Downloads belong in the build pipeline, not first-run installation. The bundled version should update with KeyHarbor.

The [telemetry command](https://github.com/Infisical/agent-vault/blob/872578e4cdf9e03d5e3bcb5512023a70bf90ed65/cmd/telemetry.go) defaults to enabled. The proposed helper must not initialize the upstream CLI, management web app, telemetry, external-store sync, or unrelated integrations.

## Proposed integration boundary

```text
Agent with temporary proxy token and dummy credentials
    -> loopback proxy helper
    -> private inherited IPC channel to Electron main
    -> KeyHarbor validates session, destination, and frozen request
    -> desktop ApprovalGate
    -> KeyHarbor revalidates vault/project/environment/credential state
    -> selected credential returned privately to helper for this request
    -> helper injects credential and calls approved HTTPS destination
    -> bounded, filtered response returned to agent
```

This is a proposed design, not an existing upstream feature. KeyHarbor remains the sole persistent vault. The helper necessarily handles plaintext credentials briefly in memory; they must never be passed in command-line arguments, agent environment variables, management APIs, or diagnostic output.

Use an inherited, framed IPC channel with bounded messages and request correlation. Agent-supplied proxy tokens must not authorize this private channel. Give agents only short-lived, narrowly scoped proxy sessions, not KeyHarbor's current general CLI/HTTP discovery token. The existing HTTP bridge can return raw values after approval, so disabling only MCP secret-read tools would not establish a secretless agent boundary.

Extend the current typed approval contract, which describes secret reads/writes, to show the caller session, vault/project/environment, HTTPS destination, method, path, and a safe description of the operation. Treat request bodies as potentially sensitive. Use existing vault-session leases and stale-target checks to invalidate pending work.

Require HTTPS credential injection and explicit host/port/method/path restrictions. Upstream permits plain HTTP forwarding and defaults unmatched hosts to passthrough; neither should be inherited as KeyHarbor's credential-broker policy. Preserve DNS/IP protections. Private services should need narrow user-approved exceptions. Redirects must be evaluated as new requests and must not inherit upstream credentials automatically.

The [CONNECT path](https://github.com/Infisical/agent-vault/blob/872578e4cdf9e03d5e3bcb5512023a70bf90ed65/internal/mitm/connect.go) authenticates at tunnel creation, and [shutdown](https://github.com/Infisical/agent-vault/blob/872578e4cdf9e03d5e3bcb5512023a70bf90ed65/internal/mitm/proxy.go) explicitly leaves hijacked tunnels untracked. Add per-request session checks and cancellation; force process termination after a bounded shutdown deadline. An operation already delivered upstream cannot be undone by locking the vault.

Provide the public proxy CA certificate only to the launched agent/client environment. Do not disable upstream TLS verification or install a system-wide CA automatically. HTTP/1.1, proxy-aware clients with Bearer/API-key headers are a reasonable first compatibility scope. Certificate-pinned clients, HTTP/3, native database protocols, SSH, WebSockets, and large streaming responses need separate evaluation.

Proxy settings are client configuration, not an OS security boundary. An agent with unrestricted access to the same user account may reach vault files or general-access interfaces. Strong isolation requires a sandbox or separate identity that cannot access vault state, helper control channels, or general KeyHarbor credentials.

## Checks required before shipping

1. Prove a request against a local TLS fixture receives a synthetic credential only after approval, while agent output, environment, files, and logs remain credential-free.
2. Prove denial, approval-window closure, timeout, desktop exit, helper crash, and vault lock prevent pending dispatch.
3. Exercise persistent CONNECT tunnels, token expiry/revocation, concurrent projects, environment deletion/recreation, credential rotation, and default-environment resolution.
4. Check wrong hosts, ports, methods, encoded paths, redirects, private/reserved IPs, spoofed headers, and proxy bypass attempts. Include an upstream fixture that reflects credentials into response headers and bodies.
5. Verify Windows source compatibility and packaged execution, plus macOS ARM64/x64 and Linux. Check signing, executable permissions, clean shutdown, and port conflicts.
6. Verify no telemetry/background network connections and no second persistent credential store. Validate release signatures or provenance, checksums, notices, and dependency inventory in CI.

The next implementation should be an isolated helper experiment using synthetic credentials. Production packaging should follow these results; bundling the unmodified Agent Vault server would not satisfy KeyHarbor's current requirements.
