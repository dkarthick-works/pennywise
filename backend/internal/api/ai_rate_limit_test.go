package api

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestAIUserRateLimiter(t *testing.T) {
	limiter := newAIUserRateLimiter()
	now := time.Date(2026, 8, 26, 10, 0, 0, 0, time.UTC)
	firstUser := uuid.New()
	secondUser := uuid.New()

	for i := 0; i < aiRequestsPerWindow; i++ {
		if !limiter.allow(firstUser, now) {
			t.Fatalf("request %d unexpectedly rejected", i+1)
		}
	}
	if limiter.allow(firstUser, now) {
		t.Fatal("request over per-user limit should be rejected")
	}
	if !limiter.allow(secondUser, now) {
		t.Fatal("one user's limit should not affect another user")
	}
	if !limiter.allow(firstUser, now.Add(aiRequestWindow)) {
		t.Fatal("user should be allowed after window resets")
	}
}
