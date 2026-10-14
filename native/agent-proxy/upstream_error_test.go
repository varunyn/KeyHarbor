package main

import (
	"errors"
	"fmt"
	"net"
	"net/http/httptest"
	"strings"
	"syscall"
	"testing"

	"keyharbor/native/agent-proxy/internal/netguard"
)

func TestUpstreamDiagnosticsNeverEchoTransportErrorText(t *testing.T) {
	const secret = "synthetic-private-error-detail"
	for _, tc := range []struct {
		name string
		err  error
		code string
	}{
		{"permission", fmt.Errorf("%s: %w", secret, &net.OpError{Op: "dial", Net: "tcp", Err: syscall.EPERM}), "network_permission_denied"},
		{"policy", fmt.Errorf("%s: %w", secret, netguard.ErrBlockedAddress), "network_policy_denied"},
		{"dns", &net.DNSError{Name: secret, Err: secret}, "dns_failure"},
		{"unknown", errors.New(secret), "upstream_connection_failed"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			writeUpstreamError(response, tc.err)
			if response.Code != 502 || response.Header().Get("X-KeyHarbor-Proxy-Error") != tc.code {
				t.Fatal("missing stable upstream failure diagnostic")
			}
			if strings.Contains(response.Body.String(), secret) {
				t.Fatal("transport error text leaked")
			}
		})
	}
}
