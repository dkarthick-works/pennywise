// Package auth handles validating Goauth access tokens and exposing the
// authenticated user id to downstream handlers.
package auth

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type ctxKey int

const userKey ctxKey = iota

// Identity is the authenticated subject extracted from a verified JWT.
type Identity struct {
	UserID uuid.UUID
	Email  string
}

// Verifier validates HS256 access tokens issued by the external Goauth service
// using the shared signing secret, and pulls the user id + email from claims.
type Verifier struct {
	secret     []byte
	userClaim  string
	emailClaim string
}

func NewVerifier(secret, userClaim, emailClaim string) *Verifier {
	return &Verifier{secret: []byte(secret), userClaim: userClaim, emailClaim: emailClaim}
}

var ErrUnauthorized = errors.New("unauthorized")

// Parse verifies a raw token string and returns the identity it carries.
func (v *Verifier) Parse(raw string) (Identity, error) {
	token, err := jwt.Parse(raw, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return v.secret, nil
	})
	if err != nil || !token.Valid {
		return Identity{}, ErrUnauthorized
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return Identity{}, ErrUnauthorized
	}

	rawID, _ := claims[v.userClaim].(string)
	if rawID == "" {
		// fall back to the standard subject claim
		rawID, _ = claims["sub"].(string)
	}
	id, err := uuid.Parse(rawID)
	if err != nil {
		return Identity{}, ErrUnauthorized
	}
	email, _ := claims[v.emailClaim].(string)
	return Identity{UserID: id, Email: email}, nil
}

// Middleware requires a valid Bearer token and stashes the identity in context.
func (v *Verifier) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw := bearer(r)
		if raw == "" {
			http.Error(w, `{"error":"missing access token"}`, http.StatusUnauthorized)
			return
		}
		id, err := v.Parse(raw)
		if err != nil {
			http.Error(w, `{"error":"invalid or expired token"}`, http.StatusUnauthorized)
			return
		}
		ctx := context.WithValue(r.Context(), userKey, id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func bearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if len(h) > 7 && strings.EqualFold(h[:7], "Bearer ") {
		return strings.TrimSpace(h[7:])
	}
	return ""
}

// FromContext returns the authenticated identity stored by Middleware.
func FromContext(ctx context.Context) (Identity, bool) {
	id, ok := ctx.Value(userKey).(Identity)
	return id, ok
}
