package auth

import (
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
)

// Proxy forwards /api/auth/* requests to the external Goauth service, relaying
// request/response bodies and (crucially) the HttpOnly refresh-token cookie via
// Set-Cookie. This keeps the browser talking to a single origin.
type Proxy struct {
	rp     *httputil.ReverseProxy
	target *url.URL
}

func NewProxy(goauthBaseURL string) (*Proxy, error) {
	target, err := url.Parse(goauthBaseURL)
	if err != nil {
		return nil, err
	}
	rp := httputil.NewSingleHostReverseProxy(target)

	// Rewrite "/api/auth/login" → "<goauth>/auth/login" on the way out.
	orig := rp.Director
	rp.Director = func(r *http.Request) {
		orig(r)
		r.URL.Path = strings.Replace(r.URL.Path, "/api/auth", "/auth", 1)
		r.Host = target.Host
	}

	// Rewrite Set-Cookie headers on the way back so the browser's cookie
	// path matches the proxied URL space (/api/auth, not /auth).
	// Goauth sets Path=/auth; we need Path=/api/auth so the browser sends
	// the refresh-token cookie to /api/auth/refresh.
	rp.ModifyResponse = func(resp *http.Response) error {
		cookies := resp.Header["Set-Cookie"]
		if len(cookies) == 0 {
			return nil
		}
		rewritten := make([]string, 0, len(cookies))
		for _, c := range cookies {
			c = rewriteCookiePath(c, "/auth", "/api/auth")
			rewritten = append(rewritten, c)
		}
		resp.Header["Set-Cookie"] = rewritten
		return nil
	}

	return &Proxy{rp: rp, target: target}, nil
}

func (p *Proxy) Handler() http.Handler { return p.rp }

// rewriteCookiePath replaces the Path attribute value in a Set-Cookie string.
// It handles both exact matches (Path=/auth) and prefix matches (Path=/auth/refresh).
func rewriteCookiePath(cookie, from, to string) string {
	parts := strings.Split(cookie, ";")
	for i, part := range parts {
		trimmed := strings.TrimSpace(part)
		if strings.HasPrefix(strings.ToLower(trimmed), "path=") {
			pathVal := strings.TrimSpace(trimmed[5:])
			if pathVal == from || strings.HasPrefix(pathVal, from+"/") {
				newPath := to + pathVal[len(from):]
				// Preserve leading whitespace of the original segment.
				prefix := part[:len(part)-len(strings.TrimLeft(part, " \t"))]
				parts[i] = prefix + "Path=" + newPath
			}
		}
	}
	return strings.Join(parts, ";")
}
