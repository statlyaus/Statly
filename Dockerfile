# Use the same Node major required by package metadata and CI
FROM node:22-alpine AS base

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

# Build source
FROM base AS builder
WORKDIR /app

# Copy node_modules and source
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate both application authorities inside the image; generated local output is excluded from the
# build context so image builds cannot depend on a developer workstation artifact.
RUN npm run prisma:generate && npm run outcomes:prisma:generate

# Next build
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Production image
FROM base AS runner
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
