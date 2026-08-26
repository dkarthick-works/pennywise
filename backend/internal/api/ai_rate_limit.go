package api

import (
	"sync"
	"time"

	"github.com/google/uuid"
)

const (
	aiRequestsPerWindow = 20
	aiRequestWindow     = time.Minute
)

type aiUserRateLimiter struct {
	mu      sync.Mutex
	entries map[uuid.UUID]aiUserRateEntry
}

type aiUserRateEntry struct {
	windowStart time.Time
	count       int
}

func newAIUserRateLimiter() *aiUserRateLimiter {
	return &aiUserRateLimiter{entries: make(map[uuid.UUID]aiUserRateEntry)}
}

func (l *aiUserRateLimiter) allow(userID uuid.UUID, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	entry := l.entries[userID]
	if entry.windowStart.IsZero() || now.Sub(entry.windowStart) >= aiRequestWindow {
		l.entries[userID] = aiUserRateEntry{windowStart: now, count: 1}
		if len(l.entries) > 1024 {
			l.removeExpired(now)
		}
		return true
	}
	if entry.count >= aiRequestsPerWindow {
		return false
	}
	entry.count++
	l.entries[userID] = entry
	return true
}

func (l *aiUserRateLimiter) removeExpired(now time.Time) {
	for id, entry := range l.entries {
		if now.Sub(entry.windowStart) >= aiRequestWindow {
			delete(l.entries, id)
		}
	}
}
