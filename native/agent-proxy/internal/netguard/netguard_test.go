package netguard

import (
	"net"
	"testing"
)

func TestPrivateRangesBlockedByDefaultAndMetadataAlwaysBlocked(t *testing.T) {
	for _, raw := range []string{"127.0.0.1", "10.1.2.3", "192.0.2.1", "100.64.0.1", "fd00::1"} {
		if !isBlockedIP(net.ParseIP(raw), false) {
			t.Errorf("private or reserved address %s was allowed by default", raw)
		}
	}
	for _, raw := range []string{"169.254.169.254", "fd00:ec2::254"} {
		if !isBlockedIP(net.ParseIP(raw), true) {
			t.Errorf("metadata address %s was allowed with private network enabled", raw)
		}
	}
	if isBlockedIP(net.ParseIP("127.0.0.1"), true) {
		t.Fatal("explicit private-network support did not allow loopback")
	}
}
