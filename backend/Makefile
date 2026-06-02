.PHONY: help db-up db-down generate build run seed tidy test

help:
	@echo "Targets:"
	@echo "  db-up     start Postgres via docker compose"
	@echo "  db-down   stop Postgres"
	@echo "  generate  run sqlc code generation"
	@echo "  build     compile the server"
	@echo "  run       run the API server (applies migrations on boot)"
	@echo "  seed      seed a user: make seed USER=<uuid> [EMAIL=a@b.com]"
	@echo "  tidy      go mod tidy"

db-up:
	docker compose up -d db

db-down:
	docker compose down

generate:
	sqlc generate

build:
	go build ./...

run:
	go run ./cmd/server

seed:
	go run ./cmd/seed -user $(USER) $(if $(EMAIL),-email $(EMAIL),)

tidy:
	go mod tidy

test:
	go test ./...
