# KakaoMolt - Standalone Webhook Server for Railway/Docker Deployment
# Runs the Kakao webhook directly without the full OpenClaw gateway
#
# Build context: repo root (railway.json sets dockerfilePath to this file)
# Usage: docker build -f extensions/kakao/Dockerfile .

FROM node:22-alpine

WORKDIR /app

# Create a minimal ESM package.json for the standalone server
RUN echo '{"type":"module","private":true}' > package.json

# Install only required runtime dependencies:
#   tsx:                  TypeScript execution engine
#   zod:                  Schema validation (used in config.ts)
#   @supabase/supabase-js: Database client (used in supabase.ts, billing, sync)
RUN npm install tsx@4 zod@4 @supabase/supabase-js@2

# Copy extension source code (paths relative to repo root build context)
COPY extensions/kakao ./extensions/kakao

# Security: non-root user
RUN addgroup -g 1001 -S moltbot && \
    adduser -S moltbot -u 1001 && \
    mkdir -p /data/.moltbot && chown -R moltbot:moltbot /data && \
    chown -R moltbot:moltbot /app

USER moltbot

# Environment defaults (Railway injects PORT automatically)
ENV NODE_ENV=production \
    PORT=8788 \
    KAKAO_WEBHOOK_PORT=8788 \
    KAKAO_WEBHOOK_PATH=/kakao/webhook

EXPOSE 8788

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8788/health || exit 1

# Start standalone webhook server
CMD ["npx", "tsx", "extensions/kakao/server.ts"]
