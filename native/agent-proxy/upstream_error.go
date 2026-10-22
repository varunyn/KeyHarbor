package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"net"
	"net/http"
	"syscall"

	"keyharbor/native/agent-proxy/internal/netguard"
)

// Return only allowlisted diagnostics. Transport errors can contain request URLs
// or credential-bearing values, so their text must never reach the agent.
func writeUpstreamError(w http.ResponseWriter, err error) {
	code, guidance := upstreamFailure(err)
	w.Header().Set("X-KeyHarbor-Proxy-Error", code)
	http.Error(w, "Request approved, but upstream unavailable ("+code+"). "+guidance, http.StatusBadGateway)
}

func upstreamFailure(err error) (string, string) {
	var unknownAuthority x509.UnknownAuthorityError
	var hostname x509.HostnameError
	var invalidCertificate x509.CertificateInvalidError
	var dns *net.DNSError
	var network net.Error
	var record tls.RecordHeaderError
	switch {
	case errors.Is(err, netguard.ErrBlockedAddress):
		return "network_policy_denied", "The destination is blocked by the session's network policy. Private-network access needs explicit connection approval; metadata endpoints remain blocked."
	case errors.As(err, &unknownAuthority):
		return "tls_untrusted_certificate", "The upstream certificate is not trusted. Use a trusted server certificate or explicitly approve its CA; certificate verification remains required."
	case errors.As(err, &hostname):
		return "tls_hostname_mismatch", "The upstream certificate does not match the approved hostname."
	case errors.As(err, &invalidCertificate):
		return "tls_invalid_certificate", "The upstream certificate is invalid or expired."
	case errors.Is(err, syscall.EACCES), errors.Is(err, syscall.EPERM):
		return "network_permission_denied", "The operating system denied network access. On macOS, check KeyHarbor under System Settings > Privacy & Security > Local Network."
	case errors.Is(err, syscall.EHOSTUNREACH), errors.Is(err, syscall.ENETUNREACH):
		return "network_unreachable", "Check the network route. On macOS, Local Network privacy can also block LAN access; check KeyHarbor's permission."
	case errors.Is(err, connectionRefusedErrno):
		return "connection_refused", "The upstream refused the connection. Check the service address and port."
	case errors.As(err, &dns):
		return "dns_failure", "The upstream hostname could not be resolved."
	case errors.Is(err, context.DeadlineExceeded), errors.As(err, &network) && network.Timeout():
		return "upstream_timeout", "The upstream connection or response timed out."
	case errors.Is(err, context.Canceled):
		return "request_canceled", "The request or session ended before the upstream response."
	case errors.As(err, &record):
		return "tls_handshake_failed", "The upstream did not complete a valid TLS handshake."
	default:
		return "upstream_connection_failed", "The upstream connection failed. Check the service, network, and TLS configuration."
	}
}
