# SpinCards — everything runs in Docker; the host needs only Docker and make.
SHELL := /bin/sh

COMPOSE      := docker compose -f infra/docker-compose.yml
COMPOSE_DEV  := $(COMPOSE) -f infra/docker-compose.dev.yml
COMPOSE_PROD := $(COMPOSE) -f infra/docker-compose.prod.yml
TOOLS        := $(COMPOSE_DEV) run --rm --no-deps tools

ENV_FILES := infra/.env apps/api/.env apps/web/.env apps/admin/.env apps/bot/.env

# Optional service filter: make logs s=api, make restart s=bot
s ?=

.DEFAULT_GOAL := help
.PHONY: help env up down restart ps logs migrate seed e2e backup restore-check ledger-verify broadcast stats config-defaults load-spin install test check lint typecheck format build sim progression \
        tunnel tunnel-down prod-build prod-up prod-down release ship clean

help: ## Show available commands
	@awk 'BEGIN {FS = ":.*## "} /^[a-z-]+:.*## / {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

env: ## Create or update .env files from .env.example (never overwrites existing values)
	@sh infra/scripts/sync-env.sh $(addsuffix .example,$(ENV_FILES))

up: env ## Start the dev stack (hot reload) and wait until healthy
	$(COMPOSE_DEV) up -d --build --wait --wait-timeout 300
	@port=$$(grep -E '^PROXY_PORT=' infra/.env | cut -d= -f2); port=$${port:-8080}; \
	printf '\n  Mini App: http://localhost:%s/\n  Admin:    http://localhost:%s/admin/\n  API:      http://localhost:%s/api/health\n\n' $$port $$port $$port

down: ## Stop the dev stack (data volumes are kept)
	$(COMPOSE_DEV) --profile ngrok --profile cloudflared down

restart: env ## Recreate services to pick up .env changes (all or s=<service>)
	$(COMPOSE_DEV) up -d --force-recreate --no-deps --wait $(s)

ps: ## Show service status
	$(COMPOSE_DEV) --profile ngrok --profile cloudflared ps

logs: ## Follow logs (all or s=<service>)
	$(COMPOSE_DEV) logs -f --tail=200 $(s)

migrate: ## Apply DB migrations, regenerate the Prisma client and restart api and worker
	$(COMPOSE_DEV) exec api pnpm migrate
	$(COMPOSE_DEV) exec api pnpm --filter @spincards/api exec prisma generate
	$(COMPOSE_DEV) restart api worker

seed: ## Seed the database
	$(COMPOSE_DEV) exec api pnpm seed

load-spin: install ## Load test POST /v1/spin on the test DB (ARGS="--users 50 --seconds 30 --target 100")
	$(COMPOSE_DEV) up -d --wait postgres redis
	$(TOOLS) pnpm --filter @spincards/api load:spin $(ARGS)

E2E_IMAGE := mcr.microsoft.com/playwright:v1.63.0-noble
e2e: install ## Playwright smoke tests of the Mini App against the running dev stack (make up first)
	docker run --rm --network spincards_default --ipc=host \
	  -v "$(CURDIR):/app" -v spincards_nm_root:/app/node_modules -v spincards_nm_web:/app/apps/web/node_modules \
	  -w /app/apps/web $(E2E_IMAGE) node node_modules/@playwright/test/cli.js test --config e2e/playwright.config.ts $(ARGS)

backup: ## Dump the dev database now (worker volume, /backups/manual)
	$(COMPOSE_DEV) exec worker pnpm --silent --filter @spincards/api ops backup

restore-check: ## Restore the newest daily dump into a scratch DB and verify the ledger
	$(COMPOSE_DEV) exec worker pnpm --silent --filter @spincards/api ops restore-check

ledger-verify: ## Check that every balance equals the sum of its ledger entries
	$(COMPOSE_DEV) exec api pnpm --silent ledger:verify

config-defaults: ## Activate the built-in default config (simulated first; old version archived)
	$(COMPOSE_DEV) exec api pnpm --silent config:defaults

stats: ## Recompute and print daily metrics (DATE=2026-10-13, today by default)
	$(COMPOSE_DEV) exec -e DATE="$(DATE)" api pnpm --silent stats

broadcast: ## Queue a bot broadcast (TEXT="…" SEGMENT=all|active|inactive DAYS=7)
	$(COMPOSE_DEV) exec -e TEXT="$(TEXT)" -e SEGMENT="$(SEGMENT)" -e DAYS="$(DAYS)" api pnpm --silent broadcast

install: env ## Install dependencies into the dev volumes
	$(COMPOSE_DEV) run --rm deps

test: install ## Run all tests (api integration tests use the spincards_test database)
	$(COMPOSE_DEV) up -d --wait postgres redis
	$(TOOLS) pnpm test

P ?= packages/shared
check: install ## Quiet lint + typecheck + tests of one package (P=apps/web); shared/game-core: also run make typecheck
	$(COMPOSE_DEV) up -d --wait postgres redis >/dev/null 2>&1
	$(TOOLS) sh -c 'cd $(P) && pnpm exec eslint . --max-warnings=0 && pnpm exec prettier --check . --log-level warn --ignore-path /app/.gitignore --ignore-path /app/.prettierignore && pnpm run typecheck && pnpm exec vitest run --reporter=dot' 2>&1 | tail -40

lint: install ## ESLint + Prettier check
	$(TOOLS) pnpm lint

typecheck: install ## TypeScript type check
	$(TOOLS) pnpm typecheck

format: install ## Format the codebase with Prettier
	$(TOOLS) pnpm format

build: install ## Build every package
	$(TOOLS) pnpm build

sim: install ## Run the economy simulator (ARGS="--pack basic --spins 1000000 --region US --json")
	$(TOOLS) pnpm sim $(ARGS)

progression: install ## Season progression by player kind: level, money, unlocks (ARGS="--players 200")
	$(TOOLS) pnpm --filter @spincards/game-core progression $(ARGS)

# Tunnel provider: make tunnel TUNNEL=cloudflared (no account, random URL) or ngrok (default).
TUNNEL ?= ngrok
TUNNEL_URL_ngrok       := https://[a-z0-9.-]+\.ngrok(-free)?\.(app|dev)
TUNNEL_URL_cloudflared := https://[a-z0-9-]+\.trycloudflare\.com

tunnel: env ## Start an HTTPS tunnel (TUNNEL=ngrok|cloudflared) and print its URL
	@if [ "$(TUNNEL)" = ngrok ] && ! grep -Eq '^NGROK_AUTHTOKEN=.+' infra/.env; then \
	  printf 'NGROK_AUTHTOKEN is empty in infra/.env (https://dashboard.ngrok.com).\nOr use: make tunnel TUNNEL=cloudflared\n'; exit 1; \
	fi
	$(COMPOSE_DEV) --profile $(TUNNEL) up -d --force-recreate $(TUNNEL)
	@printf "Waiting for tunnel URL"; \
	for i in $$(seq 1 30); do \
	  url=$$($(COMPOSE_DEV) --profile $(TUNNEL) logs --no-log-prefix $(TUNNEL) 2>/dev/null | grep -Eo '$(TUNNEL_URL_$(TUNNEL))' | tail -1); \
	  if [ -n "$$url" ]; then \
	    printf '\n\n  Tunnel: %s\n\n' "$$url"; \
	    printf '  1. Set PUBLIC_URL=%s in infra/.env, then: make restart s=bot\n' "$$url"; \
	    printf '  2. In @BotFather set the Mini App URL to %s\n\n' "$$url"; \
	    exit 0; \
	  fi; \
	  printf "."; sleep 2; \
	done; printf '\nTunnel URL not found, see: make logs s=$(TUNNEL)\n'; exit 1

tunnel-down: ## Stop the tunnel
	$(COMPOSE_DEV) --profile ngrok --profile cloudflared stop ngrok cloudflared

prod-build: env ## Build production images
	$(COMPOSE_PROD) build

prod-up: env ## Start the production stack locally
	$(COMPOSE_PROD) up -d --build --wait --wait-timeout 300

prod-down: ## Stop the production stack
	$(COMPOSE_PROD) down

release: ## Build server images (linux/amd64) tagged with the commit; PLATFORM=linux/arm64 for ARM servers
	infra/scripts/release.sh $(PLATFORM)

ship: ## Upload the last release to the server and start it (HOST=user@server [TAG=...]); see docs/deploy.md
	infra/scripts/ship.sh $(HOST) $(TAG)

clean: ## Stop everything and delete volumes (DB data, node_modules)
	$(COMPOSE_DEV) --profile ngrok --profile cloudflared --profile tools down -v --remove-orphans
