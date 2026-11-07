# Use the same Node major required by package metadata and CI
FROM node:22-alpine AS base

# Targets (see docs/runbooks/postgresql-cutover.md, "Container images"):
#   docker build --target socket .   Socket.IO draft room server (Cloud Run service)
#   docker build --target worker .   BullMQ draft worker (Cloud Run worker pool)
#   docker build .                   Next.js web image (default, last stage)
#   docker build --target afl-trade-external-dispatcher .   outcomes capture operator

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat python3 make g++ openssl
WORKDIR /app
COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* ./
RUN \
  if [ -f yarn.lock ]; then yarn --frozen-lockfile; \
  elif [ -f package-lock.json ]; then npm ci; \
  elif [ -f pnpm-lock.yaml ]; then corepack enable && pnpm i --frozen-lockfile; \
  else echo "Lockfile not found." && exit 1; \
  fi

# One-shot production operator for scheduler-owned external draft/trade capture ticks.
# Build with --target afl-trade-external-dispatcher and inject all credentials at runtime.
FROM deps AS afl-trade-external-dispatcher
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node . .
RUN npm run outcomes:prisma:generate
USER node
CMD ["sh", "-c", "exec npm run outcomes:sources:dispatch-due-external -- --worker \"$AFL_TRADE_CAPTURE_WORKER_ID\" --limit \"${AFL_TRADE_CAPTURE_DISPATCH_LIMIT:-25}\""]

# Production-only dependencies and the generated fantasy Prisma client, shared by the Socket.IO
# server and the workers. tsx is a production dependency: it runs the TypeScript entry points
# directly, exactly as `worker:start` and the Draft worker E2E job do.
FROM base AS server-deps
# Same unpinned toolchain as the deps stage; Alpine drops old package revisions, so pins break builds.
# skipcq: DOK-DL3018
RUN apk add --no-cache libc6-compat python3 make g++ openssl
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN PRISMA_HIDE_UPDATE_MESSAGE=1 npx --no-install prisma generate --schema=prisma/schema.prisma

# Shared runtime for the long-running server processes: no Next.js build output, no dev
# dependencies, no build toolchain. Files stay root-owned and read-only to the runtime user; tsx
# writes its transpile cache to /tmp.
FROM base AS server-runtime
# Prisma's engine needs OpenSSL on Alpine. Unpinned for the same reason as the toolchain above.
# skipcq: DOK-DL3018
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY --from=server-deps /app/node_modules ./node_modules
COPY package.json tsconfig.json tsconfig.app.json tsconfig.base.json ./
COPY src ./src
USER node

# Socket.IO draft room server. It listens on SOCKET_PORT, else PORT (Cloud Run sets PORT), and
# serves GET /health. Production refuses to start without Redis and SOCKET_IO_CORS_ORIGINS.
FROM server-runtime AS socket
ENV PORT=3002
EXPOSE 3002
CMD ["node", "--import", "tsx", "src/server/socketioServer.ts"]

# BullMQ draft worker. It serves no HTTP port. The web-vitals worker uses the same image with
# the command `node --import tsx src/server/workers/webVitalsWorker.ts`.
FROM server-runtime AS worker
CMD ["node", "--import", "tsx", "src/server/workers/enhancedDraftWorker.ts"]

# Build source
FROM base AS builder
WORKDIR /app

# Copy node_modules and source
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate both application authorities inside the image; generated local output is excluded from the
# build context so image builds cannot depend on a developer workstation artifact.
RUN npm run prisma:generate && npm run outcomes:prisma:generate

# Next build. The Firebase web config is public (it is compiled into the browser bundle and the auth
# service worker) and the build refuses to run without it, so pass it with --build-arg. Never pass a
# secret as a build argument. The build itself talks to no Redis or Firebase Admin, as in CI's Build job.
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ARG NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID
ENV NEXT_TELEMETRY_DISABLED=1
ENV FIREBASE_ADMIN_DISABLED=true
ENV REDIS_DISABLED=1
RUN npm run build

# Production web image (default target: keep it the last stage)
FROM base AS web
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Non-root user
RUN addgroup -S nodejs -g 1001 && adduser -S nextjs -u 1001

# Public assets
COPY --from=builder /app/public ./public

# Standalone output (contains server.js + node_modules subset)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# (Optional) Prisma schema if runtime needs it (migrations/Prisma at runtime)
# COPY --from=builder /app/prisma ./prisma

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# In .next/standalone, server.js lives at the root
CMD ["node", "server.js"]
