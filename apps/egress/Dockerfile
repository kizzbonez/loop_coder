# syntax=docker/dockerfile:1.7
# Loop Coder egress gateway: the only way from the internal network to the internet, limited to
# HTTPS to the hosts of enabled AI providers (the API writes the list to the shared volume).
ARG NODE_IMAGE=node:24-alpine
FROM ${NODE_IMAGE}
ARG APP_VERSION=0.0.0
LABEL org.opencontainers.image.title="loop-coder-egress" \
      org.opencontainers.image.version="${APP_VERSION}"
ENV NODE_ENV=production \
    PORT=3128 \
    EGRESS_ALLOWLIST_PATH=/egress/allowlist.json

# /egress is owned by the same user in the API image, so the shared volume is writable there.
RUN apk add --no-cache tini \
  && mkdir -p /egress \
  && chown node:node /egress

WORKDIR /app
COPY --chown=node:node apps/egress/package.json ./package.json
COPY --chown=node:node apps/egress/src ./src

USER node
EXPOSE 3128
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3128/healthz > /dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.mjs"]
