# syntax=docker/dockerfile:1.7
# Build context: repository root.
ARG NODE_IMAGE=node:24.21.0-alpine

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

# Dev: sources are bind-mounted, node_modules live in compose volumes.
FROM base AS dev
CMD ["pnpm", "--filter", "@spincards/bot", "dev"]

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --offline
RUN pnpm --filter "@spincards/bot..." run build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @spincards/bot deploy --prod --legacy /out

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3002
CMD ["node", "dist/main.js"]
