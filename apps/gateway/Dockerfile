FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json tsconfig.json ./
RUN npm install

COPY src/ src/
RUN npx tsc

# ─── Production image ───
FROM node:22-alpine

WORKDIR /app

RUN addgroup -g 1001 -S moa && \
    adduser -S moa -u 1001 -G moa

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY --from=builder /app/dist/ dist/

USER moa

ENV NODE_ENV=production
ENV GATEWAY_PORT=8900

EXPOSE 8900

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8900/health || exit 1

CMD ["node", "dist/index.js"]
