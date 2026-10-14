package netguard

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"syscall"
	"time"
)

// ErrBlockedAddress supports safe diagnostics without exposing raw dial errors.
var ErrBlockedAddress = errors.New("destination blocked by network policy")

// alwaysBlocked contains IP ranges that are blocked regardless of policy.
// These are metadata service endpoints and other dangerous destinations.
var alwaysBlocked = []net.IPNet{
	// AWS/GCP/Azure IMDS
	parseCIDR("169.254.169.254/32"),
	// AWS IMDSv2 IPv6
	parseCIDR("fd00:ec2::254/128"),
}

// privateRanges contains RFC-1918 and other private/reserved ranges.
// Blocked unless the parent explicitly enables private-network access.
var privateRanges = []net.IPNet{
	// Globally reserved documentation and special-purpose ranges.
	parseCIDR("192.0.0.0/24"),
	parseCIDR("192.0.2.0/24"),
	parseCIDR("198.18.0.0/15"),
	parseCIDR("198.51.100.0/24"),
	parseCIDR("203.0.113.0/24"),
	parseCIDR("2001:db8::/32"),
	// IPv4 private
	parseCIDR("10.0.0.0/8"),
	parseCIDR("172.16.0.0/12"),
	parseCIDR("192.168.0.0/16"),
	// IPv4 loopback
	parseCIDR("127.0.0.0/8"),
	// IPv4 link-local
	parseCIDR("169.254.0.0/16"),
	// IPv4 shared address space (CGN)
	parseCIDR("100.64.0.0/10"),
	// IPv6 loopback
	parseCIDR("::1/128"),
	// IPv6 link-local
	parseCIDR("fe80::/10"),
	// IPv6 unique local
	parseCIDR("fc00::/7"),
	// 0.0.0.0 and :: (unspecified; connecting to them reaches localhost)
	parseCIDR("0.0.0.0/32"),
	parseCIDR("::/128"),
}

func parseCIDR(s string) net.IPNet {
	_, ipNet, err := net.ParseCIDR(s)
	if err != nil {
		panic("netguard: bad CIDR: " + s)
	}
	return *ipNet
}

// isBlockedIP checks if an IP is blocked. IMDS endpoints are always blocked.
func isBlockedIP(ip net.IP, allowPrivate bool) bool {
	for _, n := range alwaysBlocked {
		if n.Contains(ip) {
			return true
		}
	}

	for _, n := range privateRanges {
		if n.Contains(ip) {
			return !allowPrivate
		}
	}
	return !ip.IsGlobalUnicast()
}

// SafeDialContext returns a DialContext function that blocks connections to
// forbidden IP ranges. When allowPrivate is true, only IMDS endpoints and
// non-unicast destinations remain blocked.
//
// Resolution and address selection are left to net.Dialer, which tries every
// resolved address and races IPv6 against IPv4 (RFC 6555 Fast Fallback), so
// one broken address family does not fail or stall the dial. The policy check
// runs in the dialer's ControlContext hook on each address right before
// connect, so blocked addresses are skipped and DNS rebinding cannot swap in
// an unchecked IP between validation and connection.
func SafeDialContext(allowPrivate bool) func(ctx context.Context, network, addr string) (net.Conn, error) {
	return newSafeDialer(allowPrivate).DialContext
}

func newSafeDialer(allowPrivate bool) *net.Dialer {
	return &net.Dialer{
		Timeout:   10 * time.Second,
		KeepAlive: 30 * time.Second,
		ControlContext: func(_ context.Context, _, address string, _ syscall.RawConn) error {
			err := checkDialAddress(address, allowPrivate)
			return err
		},
	}
}

// checkDialAddress applies the network policy to the ip:port net.Dialer is
// about to connect to. Anything that does not parse as an IP address is
// rejected, so an unexpected address form cannot slip past the policy.
func checkDialAddress(address string, allowPrivate bool) error {
	addrPort, err := netip.ParseAddrPort(address)
	if err != nil {
		return fmt.Errorf("%w: cannot validate dial address", ErrBlockedAddress)
	}
	ip := addrPort.Addr().Unmap()
	if isBlockedIP(ip.AsSlice(), allowPrivate) {
		return fmt.Errorf("%w: connection to %s", ErrBlockedAddress, ip)
	}
	return nil
}
