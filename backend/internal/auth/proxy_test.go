package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRewriteCookiePathPreservesAttributes(t *testing.T) {
	t.Parallel()

	input := "refresh=secret; pAtH=/auth; Max-Age=2592000; Expires=Tue, 22 Sep 2026 10:00:00 GMT; HttpOnly; Secure; SameSite=Lax; Domain=deeka.work"
	got := rewriteCookiePath(input, "/auth", "/api/auth")
	want := "refresh=secret; Path=/api/auth; Max-Age=2592000; Expires=Tue, 22 Sep 2026 10:00:00 GMT; HttpOnly; Secure; SameSite=Lax; Domain=deeka.work"
	if got != want {
		t.Fatalf("rewriteCookiePath() = %q, want %q", got, want)
	}
}

func TestRewriteCookiePathHandlesNestedAndUnrelatedPaths(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		in   string
		want string
	}{
		{"nested", "refresh=x; Path=/auth/refresh; HttpOnly", "refresh=x; Path=/api/auth/refresh; HttpOnly"},
		{"deletion", "refresh=; Path=/auth; Max-Age=0", "refresh=; Path=/api/auth; Max-Age=0"},
		{"root unchanged", "refresh=x; Path=/; HttpOnly", "refresh=x; Path=/; HttpOnly"},
		{"missing unchanged", "refresh=x; HttpOnly", "refresh=x; HttpOnly"},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := rewriteCookiePath(tt.in, "/auth", "/api/auth"); got != tt.want {
				t.Fatalf("rewriteCookiePath() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestProxyForwardsRefreshCookieAndRewritesResponseCookies(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/auth/refresh" {
			t.Errorf("upstream path = %q, want /auth/refresh", r.URL.Path)
		}
		if cookie, err := r.Cookie("refresh"); err != nil || cookie.Value != "old" {
			t.Errorf("upstream refresh cookie = %#v, %v", cookie, err)
		}
		w.Header().Add("Set-Cookie", "refresh=new; Path=/auth; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax")
		w.Header().Add("Set-Cookie", "other=value; Path=/auth/metadata; HttpOnly")
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	proxy, err := NewProxy(upstream.URL)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/auth/refresh", strings.NewReader("{}"))
	req.AddCookie(&http.Cookie{Name: "refresh", Value: "old", Path: "/api/auth"})
	rec := httptest.NewRecorder()

	proxy.Handler().ServeHTTP(rec, req)

	got := rec.Result().Header.Values("Set-Cookie")
	want := []string{
		"refresh=new; Path=/api/auth; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax",
		"other=value; Path=/api/auth/metadata; HttpOnly",
	}
	if len(got) != len(want) {
		t.Fatalf("Set-Cookie count = %d, want %d: %v", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("Set-Cookie[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}
