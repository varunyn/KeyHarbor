# Upstream provenance

This helper selectively adapts the HTTP CONNECT/TLS interception flow from Infisical Agent Vault v0.40.0, source commit `872578e4cdf9e03d5e3bcb5512023a70bf90ed65` (MIT License). The design of the CONNECT termination and per-request upstream TLS transport is adapted from `internal/mitm/connect.go`, `internal/mitm/proxy.go`, and `internal/mitm/forward.go`. The network destination guard in `internal/netguard/upstream_netguard.go` is copied from upstream `internal/netguard/netguard.go`; changes remove environment-driven policy and diagnostic logging, and make the policy configurable per helper session.

No upstream CLI, credential store, database, telemetry, external-store, or management server code is included. Keep this notice and `UPSTREAM-LICENSE` with redistributed builds.

The network guard also exposes a typed blocked-address error for allowlisted proxy diagnostics; raw dial-error text is not returned to callers.
