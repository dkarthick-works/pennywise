// Command token mints a dev HS256 access token signed with JWT_SECRET, so you
// can exercise the API locally without standing up Goauth.
//
//	go run ./cmd/token -user <uuid> -email me@example.com
package main

import (
	"flag"
	"fmt"
	"log"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/ledger/backend/internal/config"
)

func main() {
	user := flag.String("user", "11111111-1111-1111-1111-111111111111", "user UUID")
	email := flag.String("email", "demo@ledger.app", "email claim")
	ttl := flag.Duration("ttl", time.Hour, "token lifetime")
	flag.Parse()

	cfg := config.Load()
	claims := jwt.MapClaims{
		cfg.JWTUserClaim:  *user,
		cfg.JWTEmailClaim: *email,
		"sub":             *user,
		"exp":             time.Now().Add(*ttl).Unix(),
		"iat":             time.Now().Unix(),
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := tok.SignedString([]byte(cfg.JWTSecret))
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(signed)
}
