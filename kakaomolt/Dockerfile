# KakaoMolt - Standalone Webhook Server for Railway Deployment
# Runs the Kakao webhook directly without the full OpenClaw gateway

FROM node:22-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy package files first for layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY extensions/kakao/package.json extensions/kakao/

# Install all dependencies (including dev for tsx)
RUN pnpm install --frozen-lockfile

# Copy extension source code
COPY extensions/kakao ./extensions/kakao

# Production stage - minimal image
FROM node:22-alpine AS production

# Add non-root user for security
RUN addgroup -g 1001 -S moltbot && \
    adduser -S moltbot -u 1001

WORKDIR /app

# Copy necessary files from builder
COPY --from=builder --chown=moltbot:moltbot /app/package.json ./
COPY --from=builder --chown=moltbot:moltbot /app/node_modules ./node_modules
COPY --from=builder --chown=moltbot:moltbot /app/extensions/kakao ./extensions/kakao

# Create data directory
RUN mkdir -p /data/.moltbot && chown -R moltbot:moltbot /data

# Switch to non-root user
USER moltbot

# Environment defaults
ENV NODE_ENV=production \
    PORT=8788 \
    KAKAO_WEBHOOK_PORT=8788 \
    KAKAO_WEBHOOK_PATH=/kakao/webhook

# Expose webhook port (Railway uses $PORT)
EXPOSE 8788

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8788/health || exit 1

# Start standalone webhook server via tsx
CMD ["npx", "tsx", "extensions/kakao/server.ts"]
