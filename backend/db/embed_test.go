package dbfs

import (
	"testing"

	"github.com/golang-migrate/migrate/v4/source/iofs"
)

func TestEmbeddedMigrationsLoad(t *testing.T) {
	src, err := iofs.New(Migrations, "migrations")
	if err != nil {
		t.Fatalf("load embedded migrations: %v", err)
	}
	t.Cleanup(func() { _ = src.Close() })

	version, err := src.First()
	if err != nil {
		t.Fatal(err)
	}
	for want := uint(1); want <= 19; want++ {
		if version != want {
			t.Fatalf("migration version = %d, want %d", version, want)
		}
		up, upName, err := src.ReadUp(version)
		if err != nil {
			t.Fatalf("read up migration %d: %v", version, err)
		}
		_ = up.Close()
		down, downName, err := src.ReadDown(version)
		if err != nil {
			t.Fatalf("read down migration %d: %v", version, err)
		}
		_ = down.Close()
		if upName != downName {
			t.Fatalf("migration %d has mismatched pair: %s / %s", version, upName, downName)
		}
		if want < 19 {
			version, err = src.Next(version)
			if err != nil {
				t.Fatal(err)
			}
		}
	}
}
