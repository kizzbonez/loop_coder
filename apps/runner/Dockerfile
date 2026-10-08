# syntax=docker/dockerfile:1.7
# Loop Coder runner: runs the API agents administrators start. It reaches only the API on the
# internal network (no internet). The runner process holds the agents' access tokens; every file
# operation and command of an agent runs as the unprivileged "agent" user, which cannot read them.
ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/egress/package.json apps/egress/
COPY apps/runner/package.json apps/runner/
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund -w @loop/runner \
  && npm cache clean --force

FROM ${NODE_IMAGE}
ARG APP_VERSION=0.0.0
LABEL org.opencontainers.image.title="loop-coder-runner" \
      org.opencontainers.image.version="${APP_VERSION}"
ENV NODE_ENV=production \
    WORKSPACES_DIR=/workspaces \
    TOOL_HOME=/home/agent \
    TOOL_GIT_CONFIG=/app/gitconfig

# Tools the agents may use in their commands. The "node" user (uid 1000) of the base image is
# the agents' user: it matches the owner of the workspaces on a Linux host.
RUN apk add --no-cache tini git bash ripgrep \
  && mkdir -p /workspaces /home/agent \
  && chown node:node /home/agent

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY apps/runner/package.json ./package.json
COPY apps/runner/src ./src
# Git for the agents: workspaces written from Windows hosts, worktrees other machines can read.
RUN printf '%s\n' \
    '[safe]' '	directory = *' \
    '[core]' '	autocrlf = input' \
    '[worktree]' '	useRelativePaths = true' \
    '[init]' '	defaultBranch = main' \
    '[gc]' '	worktreePruneExpire = never' \
    '[advice]' '	detachedHead = false' \
    > /app/gitconfig \
  && chmod 444 /app/gitconfig

# Root, with only the capabilities to switch to the agents' user (see docker-compose.yml).
USER root
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD pgrep -f "node src/main.mjs" > /dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/main.mjs"]
