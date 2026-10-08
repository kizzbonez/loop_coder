# syntax=docker/dockerfile:1.7
# Loop Coder API: REST + Server-Sent Events + MCP server, SQLite storage.
ARG NODE_IMAGE=node:24-alpine

# ---- dependencies (all, for building) -----------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# --ignore-scripts: better-sqlite3 ships prebuilt binaries (incl. linux-musl); no compiler needed.
RUN npm ci --ignore-scripts --no-audit --no-fund

# ---- build -------------------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @loop/shared && npm run build -w @loop/api

# ---- production dependencies only ------------------------------------------------
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund -w @loop/api -w @loop/shared \
  && npm cache clean --force

# ---- runtime -----------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ARG APP_VERSION=0.0.0
ARG GIT_SHA=unknown
ARG BUILD_TIME=
LABEL org.opencontainers.image.title="loop-coder-api" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_TIME}"
ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION} \
    GIT_SHA=${GIT_SHA} \
    BUILD_TIME=${BUILD_TIME} \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/loopcoder.db \
    WORKSPACES_DIR=/workspaces

RUN apk add --no-cache tini \
  && mkdir -p /data /workspaces /egress \
  && chown node:node /data /workspaces /egress

WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/drizzle ./apps/api/drizzle

USER node
WORKDIR /app/apps/api
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz > /dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/index.js"]
