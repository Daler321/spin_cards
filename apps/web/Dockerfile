# syntax=docker/dockerfile:1.7
# Build context: repository root.
ARG NODE_IMAGE=node:24.21.0-alpine
ARG CADDY_IMAGE=caddy:2.11.7-alpine

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    npm_config_store_dir=/pnpm/store \
    COREPACK_HOME=/usr/local/share/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
COPY package.json ./
# Installs the pnpm version pinned in package.json "packageManager" as the global default.
RUN corepack enable && corepack install -g "$(node -p 'require("./package.json").packageManager')" \
    && chmod -R a+rX "$COREPACK_HOME"

# Dev: Vite dev server; sources are bind-mounted, node_modules live in compose volumes.
FROM base AS dev
CMD ["pnpm", "--filter", "@spincards/web", "dev"]

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --offline
RUN pnpm --filter "@spincards/web..." run build

# Runtime: static files behind Caddy with SPA fallback.
FROM ${CADDY_IMAGE} AS runtime
ENV SPA_INDEX=/index.html
COPY infra/caddy/Caddyfile.static /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
EXPOSE 80
