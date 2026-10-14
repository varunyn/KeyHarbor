// KeyHarbor's short-lived HTTPS credential proxy helper.
package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

const maxLine = 2 << 20

// The desktop decides within 120 seconds; leave room for the control reply.
const approvalTimeout = 130 * time.Second

var buildVersion = "dev"

type configure struct {
	Type                  string   `json:"type"`
	Token                 string   `json:"token"`
	Origin                string   `json:"origin"`
	Methods               []string `json:"methods"`
	PathPrefixes          []string `json:"pathPrefixes"`
	AllowPrivateNetwork   bool     `json:"allowPrivateNetwork"`
	TTLSeconds            int      `json:"ttlSeconds"`
	UpstreamCACertificate string   `json:"upstreamCaCertificate,omitempty"`
}
type message struct {
	Type            string   `json:"type"`
	ID              string   `json:"id,omitempty"`
	Approved        bool     `json:"approved,omitempty"`
	HeaderName      string   `json:"headerName,omitempty"`
	HeaderValue     string   `json:"headerValue,omitempty"`
	RedactionValues []string `json:"redactionValues,omitempty"`
}
type authorize struct {
	Type       string            `json:"type"`
	ID         string            `json:"id"`
	Method     string            `json:"method"`
	URL        string            `json:"url"`
	Headers    map[string]string `json:"headers"`
	BodyBase64 string            `json:"bodyBase64"`
}

type control struct {
	w         io.Writer
	mu        sync.Mutex
	pendingMu sync.Mutex
	pending   map[string]chan message
	cancel    context.CancelFunc
}

func (c *control) send(v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	if len(b) > maxLine {
		return errors.New("control message too large")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	_, err = c.w.Write(append(b, '\n'))
	return err
}
func (c *control) authorize(a authorize) (message, error) {
	ch := make(chan message, 1)
	c.pendingMu.Lock()
	c.pending[a.ID] = ch
	c.pendingMu.Unlock()
	defer func() { c.pendingMu.Lock(); delete(c.pending, a.ID); c.pendingMu.Unlock() }()
	if err := c.send(a); err != nil {
		return message{}, err
	}
	select {
	case m := <-ch:
		return m, nil
	case <-time.After(approvalTimeout):
		return message{}, errors.New("authorization timeout")
	}
}
func readLine(r *bufio.Reader) ([]byte, error) {
	b := make([]byte, 0, 4096)
	for {
		c, err := r.ReadByte()
		if err != nil {
			return nil, err
		}
		if c == '\n' {
			return b, nil
		}
		if len(b) >= maxLine {
			return nil, errors.New("control message too large")
		}
		b = append(b, c)
	}
}

func main() {
	if len(os.Args) == 2 && os.Args[1] == "--version" {
		_, _ = fmt.Fprintf(os.Stdout, "keyharbor-agent-proxy %s\n", buildVersion)
		return
	}
	in := bufio.NewReaderSize(os.Stdin, 64*1024)
	line, err := readLine(in)
	if err != nil {
		return
	}
	var cfg configure
	if json.Unmarshal(line, &cfg) != nil || cfg.Type != "configure" || validateConfig(&cfg) != nil {
		return
	}
	caPEM, cert, err := newCA()
	if err != nil {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	controlCh := &control{w: os.Stdout, pending: map[string]chan message{}, cancel: cancel}
	go controlCh.readLoop(in)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return
	}
	defer cancel()
	expires := time.Now().Add(time.Duration(cfg.TTLSeconds) * time.Second)
	deadline := time.AfterFunc(time.Duration(cfg.TTLSeconds)*time.Second, func() { cancel(); _ = listener.Close() })
	defer deadline.Stop()
	p := newProxy(ctx, cfg, cert, controlCh, expires)
	srv := &http.Server{Handler: p, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 64 << 10}
	go func() { <-ctx.Done(); _ = srv.Close() }()
	if controlCh.send(map[string]any{"type": "ready", "port": listener.Addr().(*net.TCPAddr).Port, "caCertificate": string(caPEM)}) != nil {
		return
	}
	_ = srv.Serve(listener)
}

func (c *control) readLoop(in *bufio.Reader) {
	for {
		line, err := readLine(in)
		if err != nil {
			c.cancel()
			return
		}
		var m message
		if json.Unmarshal(line, &m) != nil {
			c.cancel()
			return
		}
		if m.Type == "cancel" {
			c.cancel()
			return
		}
		if m.Type != "authorization" || m.ID == "" {
			c.cancel()
			return
		}
		c.pendingMu.Lock()
		ch := c.pending[m.ID]
		c.pendingMu.Unlock()
		if ch == nil {
			c.cancel()
			return
		}
		if len(m.RedactionValues) > 16 {
			c.cancel()
			return
		}
		for _, value := range m.RedactionValues {
			if len(value) > 8192 || strings.ContainsAny(value, "\r\n") {
				c.cancel()
				return
			}
		}
		ch <- m
	}
}

func validateConfig(c *configure) error {
	if len(c.Token) < 24 || len(c.Token) > 512 || strings.ContainsAny(c.Token, "\r\n") {
		return errors.New("invalid token")
	}
	if strings.Contains(c.Token, ":") {
		return errors.New("invalid token")
	}
	if c.TTLSeconds < 1 || c.TTLSeconds > 3600 {
		return errors.New("invalid ttl")
	}
	if c.UpstreamCACertificate != "" && !x509.NewCertPool().AppendCertsFromPEM([]byte(c.UpstreamCACertificate)) {
		return errors.New("invalid upstream CA certificate")
	}
	u, err := parseOrigin(c.Origin)
	if err != nil {
		return err
	}
	c.Origin = u.Host
	if len(c.Methods) == 0 || len(c.Methods) > 32 {
		return errors.New("invalid methods")
	}
	for i, m := range c.Methods {
		if m == "" || strings.ToUpper(m) != m || strings.ContainsAny(m, " \t\r\n") || m == http.MethodConnect {
			return errors.New("invalid method")
		}
		c.Methods[i] = m
	}
	if len(c.PathPrefixes) == 0 || len(c.PathPrefixes) > 64 {
		return errors.New("invalid path prefixes")
	}
	for _, p := range c.PathPrefixes {
		if !strings.HasPrefix(p, "/") || strings.Contains(p, "\\") || strings.ContainsAny(p, "?#\r\n") {
			return errors.New("invalid path prefix")
		}
	}
	return nil
}

func proxyAuth(req *http.Request, token string) bool {
	v := req.Header.Get("Proxy-Authorization")
	if v == "" {
		return false
	}
	want := sha256.Sum256([]byte(token))
	var got []byte
	if strings.HasPrefix(v, "Bearer ") {
		got = []byte(strings.TrimPrefix(v, "Bearer "))
	} else if strings.HasPrefix(v, "Basic ") {
		b, e := base64.StdEncoding.DecodeString(strings.TrimPrefix(v, "Basic "))
		if e != nil {
			return false
		}
		s := string(b)
		i := strings.IndexByte(s, ':')
		if i < 0 || s[i+1:] != "vault" {
			return false
		}
		got = []byte(s[:i])
	} else {
		return false
	}
	actual := sha256.Sum256(got)
	return subtle.ConstantTimeCompare(want[:], actual[:]) == 1
}

func randomID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return ""
	}
	return hex.EncodeToString(b)
}
