# Prahari developer commands. Run `make help` for the list.
SHELL := /bin/bash
COMPOSE := docker compose -f deploy/docker-compose.yml
UV := $(shell command -v uv 2>/dev/null || echo $(HOME)/.local/bin/uv)
BACKEND := cd backend &&
# Tests and local tools talk to the compose database on localhost:5433.
export PRAHARI_DATABASE_URL ?= postgresql+psycopg://prahari:prahari@localhost:5433/prahari

.DEFAULT_GOAL := help
.PHONY: help up down logs ps db demo-data reset dev fmt lint typecheck test check roads dealer export-world lan-url

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-13s\033[0m %s\n", $$1, $$2}'

up: ## Build and start everything → http://localhost:8080
	$(COMPOSE) up -d --build
	@echo "Dashboard: http://localhost:$${PRAHARI_PORT:-8080}   API docs: http://localhost:$${PRAHARI_PORT:-8080}/api/docs"

down: ## Stop the stack (data is kept)
	$(COMPOSE) down

logs: ## Follow logs from all services
	$(COMPOSE) logs -f --tail=100

ps: ## Show service status
	$(COMPOSE) ps

db: ## Start only the database (for tests and local development)
	$(COMPOSE) up -d --wait db

demo-data: ## Generate and import today's sample data (a new day first clears the previous day's records)
	$(COMPOSE) run --rm migrate

reset: ## Delete all data and start again from scratch
	$(COMPOSE) down -v
	$(MAKE) up

dev: ## Install the backend's Python environment (native Python 3.12 via uv)
	$(BACKEND) $(UV) sync

fmt: ## Format the backend code
	$(BACKEND) $(UV) run ruff format src tests && $(UV) run ruff check --fix src tests

lint: ## Lint (ruff) and check the formatting
	$(BACKEND) $(UV) run ruff check src tests && $(UV) run ruff format --check src tests

typecheck: ## Static type checks (mypy --strict)
	$(BACKEND) $(UV) run mypy

test: db ## Run the backend tests against the compose database
	$(BACKEND) $(UV) run pytest -q

check: lint typecheck test roads dealer ## Everything that must pass before a commit
	$(BACKEND) PRAHARI_DATABASE_URL=$(PRAHARI_DATABASE_URL) $(UV) run alembic -c src/prahari/alembic.ini check

roads: ## Check the dashboard's road routing (Node)
	node tools/check_roads.mjs

dealer: ## Check the dealer app's forecasts, orders and recommendations (Node)
	node tools/check_dealer.mjs

export-world: ## Re-export the dashboard's synthetic world for the sample generator
	node tools/export_world.mjs

lan-url: ## Print the address other devices on this Wi-Fi can use (needs PRAHARI_BIND=0.0.0.0)
	@echo "http://$$(ipconfig getifaddr en0 2>/dev/null || hostname -I | awk '{print $$1}'):$${PRAHARI_PORT:-8080}"
