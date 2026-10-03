# syntax=docker/dockerfile:1.7
# Loop Coder web UI: static React build served by unprivileged nginx, which also
# reverse-proxies /api (REST + live updates) and /mcp to the API container.
ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
# The user guide and its screenshots are bundled into the UI (sidebar → User guide).
COPY docs/USER_GUIDE.md docs/USER_GUIDE.md
COPY docs/images/guide docs/images/guide
ARG APP_VERSION=0.0.0
ARG GIT_SHA=unknown
ENV APP_VERSION=${APP_VERSION} GIT_SHA=${GIT_SHA}
RUN npm run build -w @loop/shared && npm run build -w @loop/web

FROM nginxinc/nginx-unprivileged:stable-alpine AS runtime
ARG APP_VERSION=0.0.0
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.title="loop-coder-web" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}"
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chmod=0755 apps/web/frame-policy.sh /docker-entrypoint.d/40-loop-coder-frame-policy.sh
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/nginx-health > /dev/null || exit 1
