FROM node:22-bookworm

# Install Bun (required for build scripts)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

RUN corepack enable

WORKDIR /app

ARG OPENCLAW_DOCKER_APT_PACKAGES=""
RUN if [ -n "$OPENCLAW_DOCKER_APT_PACKAGES" ]; then \
      apt-get update && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends $OPENCLAW_DOCKER_APT_PACKAGES && \
      apt-get clean && \
      rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*; \
    fi

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY ui/package.json ./ui/package.json
COPY patches ./patches
COPY scripts ./scripts

# Force NODE_ENV=development during install to ensure devDependencies (tsx) are installed
# Railway may set NODE_ENV=production in build env which causes pnpm to skip devDeps
RUN NODE_ENV=development pnpm install --frozen-lockfile

COPY . .
RUN OPENCLAW_A2UI_SKIP_MISSING=1 pnpm build
# Force pnpm for UI build (Bun may fail on ARM/Synology architectures)
ENV OPENCLAW_PREFER_PNPM=1
RUN pnpm ui:build

# Install MoA extension runtime deps + tsx (ensures tsx is always available
# even if devDependencies were somehow skipped during pnpm install)
RUN npm install --no-save tsx@4 @supabase/supabase-js@2 zod@4

# Verify tsx binary exists at build time (fail early if missing)
RUN test -x ./node_modules/.bin/tsx && echo "[MoA] tsx binary found" || (echo "[MoA] ERROR: tsx binary NOT found!" && exit 1)

ENV NODE_ENV=production

# Expose webhook port (Railway overrides via $PORT)
EXPOSE 8788

# Health check for Railway/Docker
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-8788}/health || exit 1

# Security hardening: Run as non-root user
USER node

# Start MoA (Master of AI) webhook server
# Use direct path to tsx binary — do NOT use "node --import tsx" (unreliable in pnpm)
# and do NOT rely on npm start (runs OpenClaw CLI, not MoA server)
CMD ["./node_modules/.bin/tsx", "extensions/kakao/server.ts"]
