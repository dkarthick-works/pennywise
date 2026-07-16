package api

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

func TestSPAHandlerCacheControl(t *testing.T) {
	staticFS := fstest.MapFS{
		"index.html":             {Data: []byte("<html>app</html>")},
		"sw.js":                  {Data: []byte("service worker")},
		"registerSW.js":          {Data: []byte("register")},
		"assets/index-abc123.js": {Data: []byte("app bundle")},
		"favicon.svg":            {Data: []byte("icon")},
	}
	handler := spaHandler(fs.FS(staticFS))

	tests := []struct {
		name         string
		path         string
		wantCache    string
		wantResponse string
	}{
		{name: "root document", path: "/", wantCache: "no-cache", wantResponse: "<html>app</html>"},
		{name: "SPA fallback", path: "/dashboard", wantCache: "no-cache", wantResponse: "<html>app</html>"},
		{name: "service worker", path: "/sw.js", wantCache: "no-cache", wantResponse: "service worker"},
		{name: "service worker registration", path: "/registerSW.js", wantCache: "no-cache", wantResponse: "register"},
		{name: "hashed asset", path: "/assets/index-abc123.js", wantCache: "public, max-age=31536000, immutable", wantResponse: "app bundle"},
		{name: "other static asset", path: "/favicon.svg", wantResponse: "icon"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tc.path, nil)
			rr := httptest.NewRecorder()

			handler.ServeHTTP(rr, req)

			if rr.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
			}
			if got := rr.Header().Get("Cache-Control"); got != tc.wantCache {
				t.Fatalf("Cache-Control = %q, want %q", got, tc.wantCache)
			}
			if got := rr.Body.String(); got != tc.wantResponse {
				t.Fatalf("body = %q, want %q", got, tc.wantResponse)
			}
		})
	}
}
