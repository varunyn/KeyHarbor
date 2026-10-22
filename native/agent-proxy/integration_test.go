package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

type wire struct {
	Type            string            `json:"type"`
	ID              string            `json:"id,omitempty"`
	Approved        bool              `json:"approved,omitempty"`
	HeaderName      string            `json:"headerName,omitempty"`
	HeaderValue     string            `json:"headerValue,omitempty"`
	RedactionValues []string          `json:"redactionValues,omitempty"`
	Port            int               `json:"port,omitempty"`
	CACertificate   string            `json:"caCertificate,omitempty"`
	Method          string            `json:"method,omitempty"`
	URL             string            `json:"url,omitempty"`
	Headers         map[string]string `json:"headers,omitempty"`
	BodyBase64      string            `json:"bodyBase64,omitempty"`
	Status          int               `json:"status,omitempty"`
}

func TestOriginAndPathBoundaryRules(t *testing.T) {
	origin, err := parseOrigin("https://API.Example.com/")
	if err != nil || origin.Host != "api.example.com:443" {
		t.Fatalf("implicit HTTPS port was not canonicalized: %#v, %v", origin, err)
	}
	for _, tc := range []struct {
		path string
		want bool
	}{{"/v1", true}, {"/v1/users", true}, {"/v10", false}, {"/v1/../admin", false}, {"/v1/admin", true}} {
		if got := pathAllowed(tc.path, []string{"/v1"}); got != tc.want {
			t.Errorf("pathAllowed(%q)=%v want %v", tc.path, got, tc.want)
		}
	}
}

func buildHelper(t *testing.T) string {
	t.Helper()
	out := filepath.Join(t.TempDir(), "agent-proxy")
	if runtime.GOOS == "windows" {
		out += ".exe"
	}
	goPath := os.Getenv("KEYHARBOR_GO_BINARY")
	if goPath == "" {
		goPath = "go"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, goPath, "build", "-o", out, ".")
	if b, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("build helper: %v: %s", err, b)
	}
	return out
}

func startHelper(t *testing.T, binary, origin, upstreamCA string, ttl int) (*exec.Cmd, *bufio.Reader, io.WriteCloser, wire) {
	t.Helper()
	cmd := exec.Command(binary)
	in, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	cmd.Stderr = io.Discard
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = in.Close()
		if cmd.Process != nil && cmd.ProcessState == nil {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
		}
	})
	r := bufio.NewReader(out)
	configure := map[string]any{"type": "configure", "token": "synthetic-session-token-0123456789", "origin": origin, "methods": []string{"GET", "POST"}, "pathPrefixes": []string{"/v1"}, "allowPrivateNetwork": true, "ttlSeconds": ttl, "upstreamCaCertificate": upstreamCA}
	if err = writeWire(in, configure); err != nil {
		t.Fatal(err)
	}
	var ready wire
	if err = readWireWithin(r, &ready, 5*time.Second); err != nil {
		t.Fatalf("read ready: %v", err)
	}
	if ready.Type != "ready" || ready.Port == 0 || ready.CACertificate == "" {
		t.Fatalf("invalid ready: %+v", ready)
	}
	return cmd, r, in, ready
}
func writeWire(w io.Writer, v any) error {
	b, e := json.Marshal(v)
	if e != nil {
		return e
	}
	_, e = w.Write(append(b, '\n'))
	return e
}
func readWire(r *bufio.Reader, v any) error {
	line, e := r.ReadBytes('\n')
	if e != nil {
		return e
	}
	if len(line) > maxLine {
		return fmt.Errorf("oversized protocol line")
	}
	return json.Unmarshal(bytes.TrimSpace(line), v)
}
func readWireWithin(r *bufio.Reader, v any, d time.Duration) error {
	done := make(chan error, 1)
	go func() { done <- readWire(r, v) }()
	select {
	case e := <-done:
		return e
	case <-time.After(d):
		return fmt.Errorf("timed out waiting for helper protocol message")
	}
}
func proxyClient(t *testing.T, ready wire) *http.Client {
	t.Helper()
	block, _ := pem.Decode([]byte(ready.CACertificate))
	if block == nil {
		t.Fatal("invalid proxy CA")
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	roots.AddCert(cert)
	proxyURL, _ := url.Parse(fmt.Sprintf("http://synthetic-session-token-0123456789:vault@127.0.0.1:%d", ready.Port))
	return &http.Client{Transport: &http.Transport{Proxy: http.ProxyURL(proxyURL), TLSClientConfig: &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12}, DisableKeepAlives: true}, Timeout: 10 * time.Second}
}
func fixture(t *testing.T, handler http.HandlerFunc) (string, string, func()) {
	t.Helper()
	server := httptest.NewTLSServer(handler)
	cert := server.Certificate()
	ca := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: cert.Raw})
	return server.URL, string(ca), server.Close
}

func TestApprovalPrecedesDispatchAndReflectedCredentialIsRedacted(t *testing.T) {
	secret := "synthetic/credential+44"
	headerSecret := "headersecret44"
	called := make(chan struct{}, 1)
	origin, upstreamCA, closeServer := fixture(t, func(w http.ResponseWriter, r *http.Request) {
		called <- struct{}{}
		if r.Header.Get("Authorization") != "Bearer "+secret {
			http.Error(w, "missing auth", 401)
			return
		}
		w.Header().Set("X-Reflected", "Bearer "+secret)
		w.Header().Set("X-"+headerSecret, "reflected secret header name")
		w.Header().Set("Content-Type", "text/plain")
		lowerURLForm := strings.ReplaceAll(url.QueryEscape(secret), "%2F", "%2f")
		_, _ = io.WriteString(w, "bare="+secret+" reflected Bearer "+secret+" "+base64.StdEncoding.EncodeToString([]byte(secret))+" "+url.QueryEscape(secret)+" "+lowerURLForm)
	})
	defer closeServer()
	binary := buildHelper(t)
	_, reader, parent, ready := startHelper(t, binary, origin, upstreamCA, 30)
	client := proxyClient(t, ready)
	response := make(chan *http.Response, 1)
	requestErr := make(chan error, 1)
	go func() {
		req, _ := http.NewRequest(http.MethodGet, origin+"/v1/account", nil)
		resp, err := client.Do(req)
		if err != nil {
			requestErr <- err
			return
		}
		response <- resp
	}()
	var a wire
	if err := readWireWithin(reader, &a, 5*time.Second); err != nil {
		t.Fatalf("authorization event: %v", err)
	}
	if a.Type != "authorize" || a.Method != "GET" || !strings.Contains(a.URL, "/v1/account") {
		t.Fatalf("unexpected approval event: %+v", a)
	}
	select {
	case <-called:
		t.Fatal("upstream dispatched before parent approval")
	case <-time.After(100 * time.Millisecond):
	}
	// The raw value is separately transmitted so every representation can be filtered.
	if err := writeWire(parent, map[string]any{"type": "authorization", "id": a.ID, "approved": true, "headerName": "Authorization", "headerValue": "Bearer " + secret, "redactionValues": []string{secret, headerSecret}}); err != nil {
		t.Fatal(err)
	}
	var resp *http.Response
	select {
	case resp = <-response:
	case err := <-requestErr:
		t.Fatal(err)
	case <-time.After(5 * time.Second):
		t.Fatal("upstream response timeout")
	}
	body, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if strings.Contains(string(body), secret) || strings.Contains(string(body), base64.StdEncoding.EncodeToString([]byte(secret))) || strings.Contains(string(body), url.QueryEscape(secret)) || strings.Contains(string(body), strings.ReplaceAll(url.QueryEscape(secret), "%2F", "%2f")) {
		t.Fatalf("credential leaked in body: %s", body)
	}
	if strings.Contains(resp.Header.Get("X-Reflected"), secret) {
		t.Fatalf("credential leaked in response header")
	}
	for name := range resp.Header {
		if strings.Contains(strings.ToLower(name), headerSecret) {
			t.Fatalf("credential leaked in response header name %q", name)
		}
	}
	if resp.ContentLength != int64(len(body)) {
		t.Fatalf("filtered Content-Length=%d, body=%d", resp.ContentLength, len(body))
	}
	select {
	case <-called:
	case <-time.After(time.Second):
		t.Fatal("upstream was not dispatched")
	}
	var complete wire
	if err := readWireWithin(reader, &complete, 5*time.Second); err != nil {
		t.Fatal(err)
	}
	if complete.Type != "complete" || complete.ID != a.ID || complete.Status != 200 {
		t.Fatalf("unexpected completion: %+v", complete)
	}
}

func TestUpstreamFailuresExposeSafeCodesAfterApproval(t *testing.T) {
	binary := buildHelper(t)
	for _, mode := range []string{"tls_untrusted_certificate", "connection_refused"} {
		t.Run(mode, func(t *testing.T) {
			origin, ca, closeServer := fixture(t, func(w http.ResponseWriter, r *http.Request) {
				t.Error("failed TLS or closed listener must not receive an HTTP request")
			})
			defer closeServer()
			trust := ""
			if mode == "connection_refused" {
				closeServer()
				trust = ca
			}
			_, reader, parent, ready := startHelper(t, binary, origin, trust, 30)
			client := proxyClient(t, ready)
			secret := "synthetic-diagnostic-secret"
			type result struct {
				response *http.Response
				err      error
			}
			results := make(chan result, 1)
			go func() {
				response, err := client.Get(origin + "/v1/account?trace=" + secret)
				results <- result{response, err}
			}()
			var approval wire
			if err := readWireWithin(reader, &approval, 5*time.Second); err != nil {
				t.Fatal(err)
			}
			if approval.Type != "authorize" {
				t.Fatal("missing request approval")
			}
			if err := writeWire(parent, map[string]any{"type": "authorization", "id": approval.ID, "approved": true, "headerName": "Authorization", "headerValue": "Bearer " + secret, "redactionValues": []string{secret}}); err != nil {
				t.Fatal(err)
			}
			select {
			case got := <-results:
				if got.err != nil {
					t.Fatal(got.err)
				}
				defer got.response.Body.Close()
				body, err := io.ReadAll(got.response.Body)
				if err != nil {
					t.Fatal(err)
				}
				if got.response.StatusCode != 502 || got.response.Header.Get("X-KeyHarbor-Proxy-Error") != mode {
					t.Fatalf("expected safe %s failure, got HTTP %d, code %q", mode, got.response.StatusCode, got.response.Header.Get("X-KeyHarbor-Proxy-Error"))
				}
				if !strings.Contains(string(body), mode) || strings.Contains(string(body), secret) || strings.Contains(string(body), origin) {
					t.Fatal("diagnostic must expose only a safe failure code and guidance")
				}
			case <-time.After(5 * time.Second):
				t.Fatal("missing upstream error response")
			}
		})
	}
}

func TestDenialAndDestinationMismatchNeverDispatch(t *testing.T) {
	called := make(chan struct{}, 1)
	origin, ca, closeServer := fixture(t, func(http.ResponseWriter, *http.Request) { called <- struct{}{} })
	defer closeServer()
	binary := buildHelper(t)
	_, reader, parent, ready := startHelper(t, binary, origin, ca, 30)
	client := proxyClient(t, ready)
	go func() { req, _ := http.NewRequest(http.MethodGet, origin+"/v1/no", nil); _, _ = client.Do(req) }()
	var a wire
	if err := readWireWithin(reader, &a, 5*time.Second); err != nil {
		t.Fatal(err)
	}
	if err := writeWire(parent, map[string]any{"type": "authorization", "id": a.ID, "approved": false}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-called:
		t.Fatal("denied request reached upstream")
	case <-time.After(250 * time.Millisecond):
	}
	// CONNECT to an unconfigured port is rejected before TLS and cannot retarget the session.
	other, _ := url.Parse(fmt.Sprintf("https://127.0.0.1:%d/v1/no", ready.Port+1))
	req, _ := http.NewRequest(http.MethodGet, other.String(), nil)
	_, _ = client.Do(req)
	select {
	case <-called:
		t.Fatal("mismatched destination reached upstream")
	case <-time.After(250 * time.Millisecond):
	}
}

func TestCancelAndTTLTerminateHelper(t *testing.T) {
	dispatched := make(chan struct{}, 1)
	origin, ca, closeServer := fixture(t, func(http.ResponseWriter, *http.Request) { dispatched <- struct{}{} })
	defer closeServer()
	binary := buildHelper(t)
	cmd, reader, parent, ready := startHelper(t, binary, origin, ca, 30)
	client := proxyClient(t, ready)
	type requestResult struct {
		status int
		err    error
	}
	clientResult := make(chan requestResult, 1)
	go func() {
		req, _ := http.NewRequest(http.MethodGet, origin+"/v1/cancel", nil)
		resp, err := client.Do(req)
		status := 0
		if resp != nil {
			status = resp.StatusCode
			_ = resp.Body.Close()
		}
		clientResult <- requestResult{status: status, err: err}
	}()
	var authorization wire
	if err := readWireWithin(reader, &authorization, 5*time.Second); err != nil {
		t.Fatal(err)
	}
	if err := writeWire(parent, map[string]any{"type": "cancel"}); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case <-done:
	case <-ctx.Done():
		t.Fatal("helper did not exit after cancellation")
	}
	select {
	case result := <-clientResult:
		// Cancellation can return a denial before the helper closes the socket.
		if result.err == nil && result.status != http.StatusForbidden {
			t.Fatalf("cancelled proxy request was not refused: HTTP %d", result.status)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("client request remained open after helper cancellation")
	}
	select {
	case <-dispatched:
		t.Fatal("cancelled request reached upstream")
	case <-time.After(150 * time.Millisecond):
	}
	cancel()
	cmd2, _, _, _ := startHelper(t, binary, origin, ca, 1)
	doneTTL := make(chan error, 1)
	go func() { doneTTL <- cmd2.Wait() }()
	select {
	case err := <-doneTTL:
		if err != nil {
			t.Fatalf("TTL helper exit: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for helper TTL")
	}
}
