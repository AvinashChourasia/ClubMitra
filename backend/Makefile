# A Makefile is a collection of named shortcuts ("targets") for common commands.
# Run them like:  make run   /   make db-up
#
# Why bother? It documents the project's commands in one place and saves you
# from memorizing long flags. `make help` lists everything.

# .PHONY tells make these targets are commands, not files to build.
.PHONY: help db-up db-down db-logs run build tidy lint \
	migrate-up migrate-down migrate-status migrate-create

# Default target (running bare `make`) shows the help.
.DEFAULT_GOAL := help

# Load variables from .env so goose uses the SAME DATABASE_URL as the app.
# `export` makes them available to the commands the recipes run.
ifneq (,$(wildcard ./.env))
	include .env
	export
endif

# Where migration files live, and a reusable goose invocation.
# Form:  goose -dir <dir> <driver> <connstring> <command>
MIGRATIONS_DIR := db/migrations
GOOSE := go tool goose -dir $(MIGRATIONS_DIR) postgres "$(DATABASE_URL)"

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

db-up: ## Start the Postgres+PostGIS container in the background
	docker compose up -d

db-down: ## Stop the database container (data is preserved)
	docker compose down

db-logs: ## Tail the database container logs
	docker compose logs -f db

run: ## Run the API locally (talks to the Dockerized DB)
	go run ./cmd/api

build: ## Compile the API into ./bin/api
	go build -o bin/api ./cmd/api

tidy: ## Sync go.mod/go.sum with the code's imports
	go mod tidy

lint: ## Run golangci-lint (install: brew install golangci-lint)
	golangci-lint run ./...

test: ## Run tests (integration tests use DATABASE_URL from .env)
	go test ./... -count=1

# --- Database migrations (goose) ---

migrate-up: ## Apply all pending migrations
	$(GOOSE) up

migrate-down: ## Roll back the most recent migration
	$(GOOSE) down

migrate-status: ## Show which migrations have/haven't run
	$(GOOSE) status

migrate-create: ## Create a new migration: make migrate-create name=add_widgets
	go tool goose -dir $(MIGRATIONS_DIR) create $(name) sql
