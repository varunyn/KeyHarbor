package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"keyharbor/native/agent-proxy/internal/netguard"
)

const maxRequest = 256 << 10
const maxResponse = 1 << 20
const maxConcurrent = 16

type proxy struct {
	ctx       context.Context
	cfg       configure
	root      *caAuthority
	ctl       *control
	sem       chan struct{}
	transport *http.Transport
	expires   time.Time
}

func newProxy(ctx context.Context, cfg configure, root *caAuthority, ctl *control, expires time.Time) *proxy {
	roots, err := x509.SystemCertPool()
	if err != nil || roots == nil {
		roots = x509.NewCertPool()
	}
	if cfg.UpstreamCACertificate != "" {
		roots.AppendCertsFromPEM([]byte(cfg.UpstreamCACertificate))
	}
	return &proxy{ctx: ctx, cfg: cfg, root: root, ctl: ctl, sem: make(chan struct{}, maxConcurrent), expires: expires, transport: &http.Transport{Proxy: nil, DialContext: netguard.SafeDialContext(cfg.AllowPrivateNetwork), TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: roots}, ForceAttemptHTTP2: false, DisableCompression: true, DisableKeepAlives: true, ResponseHeaderTimeout: 15 * time.Second, TLSHandshakeTimeout: 10 * time.Second}}
}
func (p *proxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodConnect {
		http.Error(w, "CONNECT required", http.StatusBadRequest)
		return
	}
	if !proxyAuth(r, p.cfg.Token) {
		w.Header().Set("Proxy-Authenticate", `Basic realm="KeyHarbor"`)
		http.Error(w, "proxy authentication required", http.StatusProxyAuthRequired)
		return
	}
	host, port, err := net.SplitHostPort(r.Host)
	if err != nil || canonicalOrigin(host, port) != p.cfg.Origin {
		http.Error(w, "destination denied", http.StatusForbidden)
		return
	}
	hj, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "proxy unavailable", http.StatusInternalServerError)
		return
	}
	conn, rw, err := hj.Hijack()
	if err != nil {
		return
	}
	if _, err = rw.WriteString("HTTP/1.1 200 Connection Established\r\n\r\n"); err != nil {
		_ = conn.Close()
		return
	}
	if err = rw.Flush(); err != nil {
		_ = conn.Close()
		return
	}
	leaf, err := mintLeaf(p.root, host)
	if err != nil {
		_ = conn.Close()
		return
	}
	tlsConn := tls.Server(conn, &tls.Config{MinVersion: tls.VersionTLS12, NextProtos: []string{"http/1.1"}, Certificates: []tls.Certificate{leaf}})
	_ = tlsConn.SetDeadline(time.Now().Add(10 * time.Second))
	if tlsConn.Handshake() != nil {
		_ = tlsConn.Close()
		return
	}
	_ = tlsConn.SetDeadline(time.Time{})
	listener := &oneConnListener{conn: tlsConn, closed: make(chan struct{})}
	srv := &http.Server{Handler: http.HandlerFunc(p.handle), ReadHeaderTimeout: 8 * time.Second, ReadTimeout: 35 * time.Second, WriteTimeout: 160 * time.Second, IdleTimeout: 15 * time.Second, MaxHeaderBytes: 64 << 10}
	srv.ConnState = func(_ net.Conn, state http.ConnState) {
		if state == http.StateClosed || state == http.StateHijacked {
			_ = listener.Close()
		}
	}
	stopWatch := make(chan struct{})
	go func() {
		select {
		case <-p.ctx.Done():
			_ = srv.Close()
			_ = tlsConn.Close()
		case <-stopWatch:
		}
	}()
	_ = srv.Serve(listener)
	close(stopWatch)
}

type oneConnListener struct {
	conn      net.Conn
	once      sync.Once
	closed    chan struct{}
	closeOnce sync.Once
}

func (l *oneConnListener) Accept() (net.Conn, error) {
	var c net.Conn
	l.once.Do(func() { c = l.conn })
	if c != nil {
		return c, nil
	}
	<-l.closed
	return nil, net.ErrClosed
}
func (l *oneConnListener) Close() error   { l.closeOnce.Do(func() { close(l.closed) }); return nil }
func (l *oneConnListener) Addr() net.Addr { return l.conn.LocalAddr() }

func (p *proxy) handle(w http.ResponseWriter, r *http.Request) {
	select {
	case p.sem <- struct{}{}:
		defer func() { <-p.sem }()
	case <-p.ctx.Done():
		return
	default:
		http.Error(w, "too many requests", http.StatusServiceUnavailable)
		return
	}
	if p.ctx.Err() != nil || time.Now().After(p.expires) {
		http.Error(w, "session expired", http.StatusGone)
		return
	}
	if r.Method == http.MethodConnect || r.Header.Get("Upgrade") != "" || r.Header.Get("Connection") != "" && strings.Contains(strings.ToLower(r.Header.Get("Connection")), "upgrade") {
		http.Error(w, "unsupported request", http.StatusBadRequest)
		return
	}
	if !contains(p.cfg.Methods, r.Method) {
		http.Error(w, "method denied", http.StatusForbidden)
		return
	}
	if r.URL == nil || r.URL.IsAbs() || r.URL.Host != "" || r.URL.Fragment != "" || !pathAllowed(r.URL.Path, p.cfg.PathPrefixes) {
		http.Error(w, "path denied", http.StatusForbidden)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxRequest+1))
	if err != nil || len(body) > maxRequest {
		http.Error(w, "request too large", http.StatusRequestEntityTooLarge)
		return
	}
	id := randomID()
	if id == "" {
		http.Error(w, "request unavailable", http.StatusBadGateway)
		return
	}
	frozenHeaders := r.Header.Clone()
	headers := safeHeaders(frozenHeaders)
	fullURL := "https://" + p.cfg.Origin + r.URL.RequestURI()
	approval := authorize{Type: "authorize", ID: id, Method: r.Method, URL: fullURL, Headers: headers, BodyBase64: base64.StdEncoding.EncodeToString(body)}
	approvalCtx, cancelApproval := context.WithTimeout(r.Context(), approvalTimeout)
	stopParentCancel := context.AfterFunc(p.ctx, cancelApproval)
	defer func() { stopParentCancel(); cancelApproval() }()
	replyCh := make(chan struct {
		m message
		e error
	}, 1)
	go func() {
		m, e := p.ctl.authorize(approval)
		replyCh <- struct {
			m message
			e error
		}{m, e}
	}()
	var reply message
	select {
	case v := <-replyCh:
		reply = v.m
		err = v.e
	case <-approvalCtx.Done():
		err = approvalCtx.Err()
	}
	if err != nil || !reply.Approved || reply.HeaderName == "" || !validHeader(reply.HeaderName, reply.HeaderValue) {
		p.complete(id, 0)
		http.Error(w, "request not approved", http.StatusForbidden)
		return
	}
	select {
	case <-p.ctx.Done():
		p.complete(id, 0)
		http.Error(w, "session expired", http.StatusGone)
		return
	default:
	}
	if time.Now().After(p.expires) {
		p.complete(id, 0)
		http.Error(w, "session expired", http.StatusGone)
		return
	}
	u := &url.URL{Scheme: "https", Host: p.cfg.Origin, Path: r.URL.Path, RawPath: r.URL.RawPath, RawQuery: r.URL.RawQuery}
	upstreamCtx, cancelUpstream := context.WithTimeout(r.Context(), 15*time.Second)
	stopUpstreamCancel := context.AfterFunc(p.ctx, cancelUpstream)
	defer func() { stopUpstreamCancel(); cancelUpstream() }()
	upReq, err := http.NewRequestWithContext(upstreamCtx, r.Method, u.String(), bytes.NewReader(body))
	if err != nil {
		p.complete(id, 0)
		writeUpstreamError(w, err)
		return
	}
	for k, vals := range frozenHeaders {
		if hopHeader(k) || strings.EqualFold(k, "Proxy-Authorization") {
			continue
		}
		for _, v := range vals {
			upReq.Header.Add(k, v)
		}
	}
	upReq.Header.Del(reply.HeaderName)
	upReq.Header.Set(reply.HeaderName, reply.HeaderValue)
	upReq.Host = p.cfg.Origin
	resp, err := p.transport.RoundTrip(upReq)
	if err != nil {
		p.complete(id, 0)
		writeUpstreamError(w, err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 && resp.StatusCode < 400 {
		p.complete(id, resp.StatusCode)
		http.Error(w, "redirects are not followed", http.StatusBadGateway)
		return
	}
	if resp.ContentLength > maxResponse {
		p.complete(id, 0)
		http.Error(w, "response too large", http.StatusBadGateway)
		return
	}
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, maxResponse+1))
	if err != nil || len(respBody) > maxResponse {
		p.complete(id, 0)
		http.Error(w, "response unavailable", http.StatusBadGateway)
		return
	}
	if resp.Header.Get("Content-Encoding") != "" && resp.Header.Get("Content-Encoding") != "identity" {
		p.complete(id, 0)
		http.Error(w, "encoded response unsupported", http.StatusBadGateway)
		return
	}
	ct, params, _ := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	charset := strings.ToLower(params["charset"])
	if len(respBody) > 0 && (!textContent(ct) || (charset != "" && charset != "utf-8" && charset != "us-ascii") || !utf8.Valid(respBody)) {
		p.complete(id, 0)
		http.Error(w, "binary response unsupported", http.StatusBadGateway)
		return
	}
	redactions := append([]string{reply.HeaderValue}, reply.RedactionValues...)
	respBody = redact(respBody, redactions...)
	for k, vals := range resp.Header {
		if hopHeader(k) || strings.EqualFold(k, "Content-Length") || strings.EqualFold(k, "Content-Encoding") || strings.EqualFold(k, "Set-Cookie") || strings.EqualFold(k, "Location") || headerNameContainsSecret(k, redactions...) {
			continue
		}
		clean := make([]string, 0, len(vals))
		for _, v := range vals {
			clean = append(clean, redactString(v, redactions...))
		}
		for _, v := range clean {
			w.Header().Add(k, v)
		}
	}
	w.Header().Set("Content-Length", strconv.Itoa(len(respBody)))
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(respBody)
	p.complete(id, resp.StatusCode)
}
func (p *proxy) complete(id string, status int) {
	_ = p.ctl.send(map[string]any{"type": "complete", "id": id, "status": status})
}
func canonicalOrigin(host, port string) string {
	n, e := strconv.Atoi(port)
	if e != nil || n < 1 || n > 65535 {
		return ""
	}
	host = strings.ToLower(strings.TrimSuffix(host, "."))
	if strings.ContainsAny(host, "%/\\?#@ \r\n") {
		return ""
	}
	return net.JoinHostPort(host, strconv.Itoa(n))
}
func parseOrigin(raw string) (*url.URL, error) {
	u, e := url.Parse(raw)
	if e != nil || !strings.EqualFold(u.Scheme, "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || u.Hostname() == "" {
		return nil, errors.New("origin must be an HTTPS origin")
	}
	p := u.Port()
	if p == "" {
		p = "443"
	}
	return &url.URL{Host: canonicalOrigin(u.Hostname(), p)}, nil
}
func pathAllowed(path string, prefixes []string) bool {
	if path == "" {
		path = "/"
	}
	if strings.ContainsAny(path, "\\\x00") {
		return false
	}
	for _, segment := range strings.Split(path, "/") {
		if segment == "." || segment == ".." {
			return false
		}
	}
	for _, p := range prefixes {
		if path == p || strings.HasSuffix(p, "/") && strings.HasPrefix(path, p) || strings.HasPrefix(path, p+"/") {
			return true
		}
	}
	return false
}
func contains(xs []string, s string) bool {
	for _, x := range xs {
		if x == s {
			return true
		}
	}
	return false
}
func safeHeaders(h http.Header) map[string]string {
	m := map[string]string{}
	for k, v := range h {
		if hopHeader(k) || strings.EqualFold(k, "Proxy-Authorization") {
			continue
		}
		m[http.CanonicalHeaderKey(k)] = strings.Join(v, ", ")
	}
	return m
}
func hopHeader(k string) bool {
	switch strings.ToLower(k) {
	case "connection", "proxy-connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade":
		return true
	}
	return false
}
func validHeader(k, v string) bool {
	if k == "" || strings.EqualFold(k, "host") || strings.EqualFold(k, "content-length") || hopHeader(k) || len(v) > 8192 {
		return false
	}
	for _, c := range k {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || strings.ContainsRune("!#$%&'*+-.^_`|~", c)) {
			return false
		}
	}
	for _, c := range v {
		if c < 0x20 && c != '\t' || c == 0x7f {
			return false
		}
	}
	return true
}
func textContent(s string) bool {
	return strings.HasPrefix(s, "text/") || strings.Contains(s, "json") || strings.Contains(s, "xml") || strings.Contains(s, "javascript") || strings.Contains(s, "x-www-form-urlencoded")
}
func redact(b []byte, secrets ...string) []byte { return []byte(redactString(string(b), secrets...)) }

var percentEscape = regexp.MustCompile(`%[0-9a-fA-F]{2}`)

func redactString(s string, secrets ...string) string {
	for _, secret := range secrets {
		if secret == "" {
			continue
		}
		for _, f := range redactionForms(secret) {
			if f != "" {
				if strings.Contains(f, "%") {
					pattern := percentEscape.ReplaceAllStringFunc(regexp.QuoteMeta(f), func(escape string) string {
						return "(?i:" + escape + ")"
					})
					s = regexp.MustCompile(pattern).ReplaceAllLiteralString(s, "[REDACTED]")
				} else {
					s = strings.ReplaceAll(s, f, "[REDACTED]")
				}
			}
		}
	}
	return s
}

func headerNameContainsSecret(name string, secrets ...string) bool {
	lowerName := strings.ToLower(name)
	for _, secret := range secrets {
		for _, form := range redactionForms(secret) {
			if form != "" && strings.Contains(lowerName, strings.ToLower(form)) {
				return true
			}
		}
	}
	return false
}

func redactionForms(secret string) []string {
	query, path := url.QueryEscape(secret), url.PathEscape(secret)
	forms := []string{secret, query, path, base64.StdEncoding.EncodeToString([]byte(secret)), base64.RawStdEncoding.EncodeToString([]byte(secret)), base64.URLEncoding.EncodeToString([]byte(secret)), base64.RawURLEncoding.EncodeToString([]byte(secret))}
	for _, form := range []string{query, path} {
		if lower := lowerEscapeHex(form); lower != form {
			forms = append(forms, lower)
		}
	}
	return forms
}

func lowerEscapeHex(s string) string {
	b := []byte(s)
	for i := 0; i+2 < len(b); i++ {
		if b[i] == '%' {
			if b[i+1] >= 'A' && b[i+1] <= 'F' {
				b[i+1] += 32
			}
			if b[i+2] >= 'A' && b[i+2] <= 'F' {
				b[i+2] += 32
			}
			i += 2
		}
	}
	return string(b)
}
